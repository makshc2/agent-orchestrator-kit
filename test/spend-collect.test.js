import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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
  assert.equal(matched.sources[0].id, 't1:amp-1');
  assert.equal(matched.sources[0].inputTokens, 8);
  assert.equal(matched.sources[0].outputTokens, 2);
  assert.equal(matched.sources[0].model, 'amp-model');
  assert.equal(matched.sources[0].costUsd, null);
  assert.equal(matched.sources[0].ampCredits, null);
  assert.equal(matched.byPlatform.amp.source, 'amp-thread');

  const dedup = collectSpend({
    cwd,
    env,
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
    existingSourceIds: ['t1:amp-1'],
  });
  assert.equal(dedup.sources.length, 0);

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
  assert.ok(!skipped.sources.some((src) => String(src.id).includes('amp-notrees')));

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
  assert.ok(!other.sources.some((src) => String(src.id).includes('amp-other')));
  rmSync(root, { recursive: true, force: true });
});

test('amp thread-local messageIds do not collide across threads', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-amp-collide-'));
  const cwd = join(root, 'work');
  mkdirSync(cwd, { recursive: true });
  const amp = join(root, 'amp');
  mkdirSync(join(amp, 'threads'), { recursive: true });
  const usage = (tokens) => ({
    inputTokens: tokens,
    outputTokens: 1,
    model: 'amp-model',
    timestamp: '2026-08-29T12:00:00.000Z',
  });
  writeFileSync(join(amp, 'threads', 'T-aaa.json'), JSON.stringify({
    id: 'T-aaa',
    env: { initial: { trees: [{ uri: `file://${cwd}` }] } },
    messages: [{ messageId: 1, usage: usage(10) }],
  }));
  writeFileSync(join(amp, 'threads', 'T-bbb.json'), JSON.stringify({
    id: 'T-bbb',
    env: { initial: { trees: [{ uri: `file://${cwd}` }] } },
    messages: [{ messageId: 1, usage: usage(20) }],
  }));
  const result = collectSpend({
    cwd,
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: amp, XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  const ids = result.sources.map((src) => src.id).sort();
  assert.deepEqual(ids, ['T-aaa:1', 'T-bbb:1']);
  assert.equal(result.byPlatform.amp.inputTokens, 30);
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

test('cursor without a hook usage file returns empty sources and a note', () => {
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

test('cursor hook jsonl: window, dedup, max record per repeated id, no-token rows skipped', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-cursor-hook-'));
  const cwd = join(root, 'work');
  const spendDir = join(cwd, '.agents', 'spend');
  mkdirSync(spendDir, { recursive: true });
  const rows = [
    { id: 'g-1', event: 'stop', model: 'cursor-grok-4.6-high-fast', inputTokens: 100, outputTokens: 10, at: '2026-08-29T12:00:00.000Z' },
    { id: 'g-1', event: 'stop', model: 'cursor-grok-4.6-high-fast', inputTokens: 400, outputTokens: 40, at: '2026-08-29T12:05:00.000Z' },
    { id: 'g-old', event: 'stop', model: 'cursor-grok-4.6-high-fast', inputTokens: 9, outputTokens: 9, at: '2026-08-29T08:00:00.000Z' },
    { id: 'g-dedup', event: 'stop', model: 'cursor-grok-4.6-high-fast', inputTokens: 5, outputTokens: 5, at: '2026-08-29T12:00:00.000Z' },
    { id: 'g-empty', event: 'stop', model: 'cursor-grok-4.6-high-fast', inputTokens: null, outputTokens: null, at: '2026-08-29T12:00:00.000Z' },
  ];
  writeFileSync(join(spendDir, 'cursor-usage.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const result = collectSpend({
    cwd,
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: join(root, 'amp'), XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
    existingSourceIds: ['g-dedup'],
  });
  const cursorSources = result.sources.filter((src) => src.platform === 'cursor');
  assert.equal(cursorSources.length, 1);
  assert.equal(cursorSources[0].id, 'g-1');
  assert.equal(cursorSources[0].inputTokens, 400);
  assert.equal(cursorSources[0].outputTokens, 40);
  assert.equal(cursorSources[0].totalTokens, 440);
  assert.equal(cursorSources[0].model, 'cursor-grok-4.6-high-fast');
  assert.equal(cursorSources[0].costUsd, null);
  assert.equal(result.byPlatform.cursor.source, 'cursor-hook');
  rmSync(root, { recursive: true, force: true });
});

test('cursor spend hook script records usage and stays silent without token fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-hook-script-'));
  mkdirSync(join(root, '.agents'), { recursive: true });
  const hookPath = new URL('../templates/scripts/cursor-spend-hook.cjs', import.meta.url).pathname;
  const run = (payload) => execFileSync('node', [hookPath], {
    cwd: root,
    input: payload,
    encoding: 'utf-8',
  });
  run(JSON.stringify({
    hook_event_name: 'stop',
    conversation_id: 'c-1',
    generation_id: 'g-1',
    model: 'cursor-grok-4.6-high-fast',
    input_tokens: 1000,
    output_tokens: 50,
    cache_read_tokens: 900,
    cache_write_tokens: 10,
  }));
  run(JSON.stringify({ hook_event_name: 'stop', generation_id: 'g-2' }));
  run('not json at all');
  const usageFile = join(root, '.agents', 'spend', 'cursor-usage.jsonl');
  const lines = readFileSync(usageFile, 'utf-8').split('\n').filter((line) => line.trim());
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.id, 'g-1');
  assert.equal(record.inputTokens, 1000);
  assert.equal(record.outputTokens, 50);
  assert.equal(record.model, 'cursor-grok-4.6-high-fast');
  rmSync(root, { recursive: true, force: true });
});
