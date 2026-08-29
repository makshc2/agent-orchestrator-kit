import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectSpend } from '../bin/spend-collect.js';

function encodeClaudeProject(cwd) {
  return String(cwd).replace(/[/.]/g, '-');
}

function writeClaudeJsonl(home, cwd, rows) {
  const projectDir = join(home, '.claude', 'projects', encodeClaudeProject(cwd));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'session.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function writeAmpThread(ampDir, thread) {
  mkdirSync(join(ampDir, 'threads'), { recursive: true });
  writeFileSync(join(ampDir, 'threads', 't1.json'), JSON.stringify(thread));
}

test('claude jsonl: window, cwd, encode, cache_*, null cost, dedup', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-claude-'));
  const cwd = join(root, 'proj.dir');
  const home = join(root, 'home');
  mkdirSync(cwd, { recursive: true });
  const inWindow = '2026-08-29T12:00:00.000Z';
  writeClaudeJsonl(home, cwd, [
    {
      type: 'assistant',
      cwd,
      timestamp: inWindow,
      message: {
        id: 'msg-1',
        role: 'assistant',
        model: 'claude-opus-4-7',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 2,
        },
      },
    },
    {
      type: 'assistant',
      cwd,
      timestamp: '2026-08-29T08:00:00.000Z',
      message: {
        id: 'msg-old',
        role: 'assistant',
        model: 'claude-opus-4-7',
        usage: { input_tokens: 99, output_tokens: 1 },
      },
    },
    {
      type: 'assistant',
      cwd: join(root, 'other'),
      timestamp: inWindow,
      message: {
        id: 'msg-other',
        role: 'assistant',
        model: 'claude-opus-4-7',
        usage: { input_tokens: 7, output_tokens: 1 },
      },
    },
  ]);
  const env = { HOME: home, AMP_DATA_DIR: join(root, 'amp'), XDG_CONFIG_HOME: join(root, 'xdg') };
  const result = collectSpend({
    cwd,
    homedir: home,
    env,
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
    existingSourceIds: [],
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, 'msg-1');
  assert.equal(result.sources[0].platform, 'claude');
  assert.equal(result.sources[0].model, 'claude-opus-4-7');
  assert.equal(result.sources[0].inputTokens, 15);
  assert.equal(result.sources[0].outputTokens, 5);
  assert.equal(result.sources[0].totalTokens, 20);
  assert.equal(result.sources[0].costUsd, null);
  assert.equal(result.byPlatform.claude.source, 'claude-jsonl');

  const dedup = collectSpend({
    cwd,
    homedir: home,
    env,
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
    existingSourceIds: ['msg-1'],
  });
  assert.equal(dedup.sources.length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('amp thread: trees uri match, skip without trees, no ledger → null credits', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-amp-'));
  const cwd = join(root, 'work');
  mkdirSync(cwd, { recursive: true });
  const amp = join(root, 'amp');
  const env = { HOME: join(root, 'home'), AMP_DATA_DIR: amp, XDG_CONFIG_HOME: join(root, 'xdg') };
  writeAmpThread(amp, {
    env: { initial: { trees: [{ uri: `file://${cwd}` }] } },
    messages: [
      {
        messageId: 'amp-1',
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          model: 'amp-model',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      },
    ],
  });
  const threadText = readFileSync(join(amp, 'threads', 't1.json'), 'utf-8');
  assert.doesNotMatch(threadText, /meta\.cwd/);
  const matched = collectSpend({
    cwd,
    env,
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  assert.equal(matched.sources.length, 1);
  assert.equal(matched.sources[0].platform, 'amp');
  assert.equal(matched.sources[0].inputTokens, 8);
  assert.equal(matched.sources[0].outputTokens, 2);
  assert.equal(matched.sources[0].model, 'amp-model');
  assert.equal(matched.sources[0].costUsd, null);
  assert.equal(matched.sources[0].ampCredits, null);
  assert.equal(matched.byPlatform.amp.source, 'amp-thread');

  writeAmpThread(amp, {
    messages: [
      {
        messageId: 'amp-notrees',
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          model: 'amp-model',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      },
    ],
  });
  const skipped = collectSpend({
    cwd,
    env,
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  assert.ok(!skipped.sources.some((src) => src.id === 'amp-notrees'));

  writeAmpThread(amp, {
    env: { initial: { trees: [{ uri: 'file:///tmp/other-project' }] } },
    messages: [
      {
        messageId: 'amp-other',
        usage: {
          totalInputTokens: 40,
          outputTokens: 2,
          model: 'amp-model',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      },
    ],
  });
  const other = collectSpend({
    cwd,
    env,
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  assert.ok(!other.sources.some((src) => src.id === 'amp-other'));
  rmSync(root, { recursive: true, force: true });
});

test('amp inputTokens prefers totalInputTokens', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-amp-total-'));
  const cwd = join(root, 'work');
  mkdirSync(cwd, { recursive: true });
  const amp = join(root, 'amp');
  writeAmpThread(amp, {
    env: { initial: { trees: [{ uri: `file://${cwd}` }] } },
    messages: [
      {
        toMessageId: 'amp-total',
        usage: {
          totalInputTokens: 50,
          inputTokens: 8,
          cacheCreationInputTokens: 1,
          cacheReadInputTokens: 1,
          outputTokens: 4,
          model: 'amp-model',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      },
    ],
  });
  const result = collectSpend({
    cwd,
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: amp, XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  assert.equal(result.sources[0].inputTokens, 50);
  rmSync(root, { recursive: true, force: true });
});

test('cursor without db or sqlite returns empty sources and a note', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-cursor-'));
  const result = collectSpend({
    cwd: join(root, 'work'),
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: join(root, 'amp'), XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
  });
  assert.deepEqual(result.sources, []);
  assert.ok(result.notes.some((note) => /cursor/i.test(note)));
  const src = readFileSync(new URL('../bin/spend-collect.js', import.meta.url), 'utf-8');
  assert.doesNotMatch(src, /better-sqlite3|sql\.js|ccusage/);
  rmSync(root, { recursive: true, force: true });
});
