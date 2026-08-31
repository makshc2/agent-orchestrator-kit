import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectSessionClient, resolveRestoreClient, readAmpSessionHint, parseAmpThreadList, isUsableTtyPath } from '../bin/session-client.js';
import { collectSpend } from '../bin/spend-collect.js';

test('detectSessionClient: Amp env beats Cursor env', () => {
  const client = detectSessionClient({
    env: { AMP_CURRENT_THREAD: 'T-1', CURSOR_AGENT: '1' },
  });
  assert.deepEqual(client, { platform: 'amp', threadId: 'T-1', source: 'amp-env' });
});

test('detectSessionClient: Cursor env when Amp env is empty', () => {
  const client = detectSessionClient({
    env: { CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'c-1' },
    parentComm: 'node',
  });
  assert.equal(client.platform, 'cursor');
  assert.equal(client.source, 'cursor-env');
  assert.equal(client.threadId, 'c-1');
});

test('detectSessionClient: parent amp + session.json tty', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-client-tty-'));
  try {
    const amp = join(root, 'amp');
    mkdirSync(amp, { recursive: true });
    writeFileSync(join(amp, 'session.json'), JSON.stringify({
      lastThreadId: 'T-other',
      lastThreadByTerminal: {
        'tty:/dev/pts/1': { lastThreadId: 'T-tty', updatedAt: Date.now() },
      },
    }));
    const client = detectSessionClient({
      env: { AMP_DATA_DIR: amp },
      homedir: root,
      parentComm: 'amp',
      ttyKey: 'tty:/dev/pts/1',
      now: Date.now(),
    });
    assert.equal(client.platform, 'amp');
    assert.equal(client.threadId, 'T-tty');
    assert.equal(client.source, 'amp-parent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readAmpSessionHint ignores stale tty mapping', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-client-stale-'));
  try {
    const amp = join(root, 'amp');
    mkdirSync(amp, { recursive: true });
    writeFileSync(join(amp, 'session.json'), JSON.stringify({
      lastThreadByTerminal: {
        'tty:/dev/pts/1': { lastThreadId: 'T-old', updatedAt: Date.now() - 8 * 60 * 60 * 1000 },
      },
    }));
    const hint = readAmpSessionHint({
      env: { AMP_DATA_DIR: amp },
      homedir: root,
      ttyKey: 'tty:/dev/pts/1',
      now: Date.now(),
    });
    assert.equal(hint.threadId, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('detectSessionClient: parent amp without tty uses threads list, not lastThreadId', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-client-list-'));
  try {
    const amp = join(root, 'amp');
    mkdirSync(amp, { recursive: true });
    writeFileSync(join(amp, 'session.json'), JSON.stringify({
      lastThreadId: 'T-01a05425-4ae7-735e-aa8b-0441efc12b01',
    }));
    const client = detectSessionClient({
      env: { AMP_DATA_DIR: amp },
      homedir: root,
      parentComm: 'amp',
      ttyKey: 'tty:/dev/null',
      listAmpThreads: () => [
        'T-01a0541e-a7f5-779f-9305-4b9a467c90f8',
        'T-01a05425-4ae7-735e-aa8b-0441efc12b01',
      ],
    });
    assert.equal(client.platform, 'amp');
    assert.equal(client.threadId, 'T-01a0541e-a7f5-779f-9305-4b9a467c90f8');
    assert.equal(client.source, 'amp-threads-list');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parseAmpThreadList reads Thread ID column', () => {
  const text = [
    'Title                                         Last Updated  Visibility  Messages  Thread ID',
    '────────────────────────────────────────────  ────────────  ──────────  ────────  ──────────────────────────────────────',
    'Модель Amp-агента                             2m ago        Workspace   4         T-01a0541e-a7f5-779f-9305-4b9a467c90f8',
    'Визначення назви агента                       3m ago        Workspace   1         T-01a05425-4ae7-735e-aa8b-0441efc12b01',
  ].join('\n');
  assert.deepEqual(parseAmpThreadList(text), [
    'T-01a0541e-a7f5-779f-9305-4b9a467c90f8',
    'T-01a05425-4ae7-735e-aa8b-0441efc12b01',
  ]);
});

test('isUsableTtyPath rejects /dev/null and pipes', () => {
  assert.equal(isUsableTtyPath('/dev/null'), false);
  assert.equal(isUsableTtyPath('tty:/dev/null'), false);
  assert.equal(isUsableTtyPath('pipe:[123]'), false);
  assert.equal(isUsableTtyPath('/dev/pts/1'), true);
});

test('resolveRestoreClient: --platform overrides detection', () => {
  const client = resolveRestoreClient({
    env: { AMP_CURRENT_THREAD: 'T-1' },
    platform: 'cursor',
  });
  assert.equal(client.platform, 'cursor');
  assert.equal(client.threadId, 'T-1');
  assert.equal(client.source, 'flag');
});

test('collectSpend Amp CLI export is used when injected', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-amp-cli-'));
  try {
    const cwd = join(root, 'proj');
    mkdirSync(cwd, { recursive: true });
    const result = collectSpend({
      cwd,
      env: { HOME: join(root, 'home'), AMP_DATA_DIR: join(root, 'amp') },
      homedir: join(root, 'home'),
      windowStart: '2026-08-30T00:00:00.000Z',
      windowEnd: '2026-08-30T23:59:59.000Z',
      platforms: ['amp'],
      ampThreadId: 'T-cli',
      exportAmpThread: (id) => ({
        id,
        agentMode: 'low',
        env: { initial: { trees: [{ uri: `file://${cwd}` }] } },
        messages: [{
          messageId: 'm1',
          usage: {
            model: 'accounts/fireworks/models/glm-5p2',
            totalInputTokens: 100,
            outputTokens: 9,
            timestamp: '2026-08-30T12:00:00.000Z',
          },
        }],
      }),
      usageAmpThread: () => ({
        costUsd: 1.3,
        models: [{ model: 'GLM-5.2', costUsd: 0.67, inputTokens: 100, outputTokens: 9 }],
      }),
    });
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].id, 'T-cli:m1');
    assert.equal(result.sources[0].via, 'amp-cli');
    assert.equal(result.sources[0].model, 'accounts/fireworks/models/glm-5p2');
    assert.equal(result.sources[0].agentMode, 'low');
    assert.equal(result.byPlatform.amp.source, 'amp-cli');
    assert.equal(result.ampThreads[0].agentMode, 'low');
    assert.equal(result.ampThreads[0].costUsd, 1.3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
