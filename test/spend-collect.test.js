import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectSpend, attachCursorEstimates, enrichMetricsCursorEstimates } from '../bin/spend-collect.js';

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

test('amp thread: trees uri match, fallback cwd signals, skip other project, no ledger → null credits', () => {
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
    env: { initial: { cwd } },
    messages: [
      {
        messageId: 'amp-cwd',
        usage: {
          inputTokens: 9,
          outputTokens: 1,
          model: 'amp-model',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      },
    ],
  });
  const byCwd = collectSpend({
    cwd,
    env,
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  assert.ok(byCwd.sources.some((src) => src.id === 't1:amp-cwd'));

  writeFileSync(join(amp, 'threads', 'T-current.json'), JSON.stringify({
    id: 'T-current',
    messages: [
      {
        messageId: 'amp-current',
        usage: {
          inputTokens: 4,
          outputTokens: 1,
          model: 'amp-model',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      },
    ],
  }));
  const byThread = collectSpend({
    cwd,
    env: { ...env, AMP_CURRENT_THREAD: 'T-current' },
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  assert.ok(byThread.sources.some((src) => src.id === 'T-current:amp-current'));

  writeAmpThread(amp, {
    messages: [
      {
        messageId: 'amp-mention',
        content: `working in ${cwd}`,
        usage: {
          inputTokens: 3,
          outputTokens: 1,
          model: 'amp-model',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      },
    ],
  });
  const byMention = collectSpend({
    cwd,
    env,
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  assert.ok(byMention.sources.some((src) => src.id === 't1:amp-mention'));

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
  assert.equal(cursorSources[0].costUsdEstimated, 0.0021);
  assert.equal(cursorSources[0].costSource, 'api-estimate');
  assert.equal(result.byPlatform.cursor.source, 'cursor-hook');
  rmSync(root, { recursive: true, force: true });
});

test('cursor hook jsonl: CURSOR_CONVERSATION_ID filters rows; without env both in-window rows stay', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-cursor-convid-'));
  const cwd = join(root, 'work');
  const spendDir = join(cwd, '.agents', 'spend');
  mkdirSync(spendDir, { recursive: true });
  const rows = [
    { id: 'conv-x', event: 'stop', conversationId: 'X', model: 'cursor-grok-4.6', inputTokens: 10, outputTokens: 1, at: '2026-08-29T12:00:00.000Z' },
    { id: 'conv-y', event: 'stop', conversationId: 'Y', model: 'cursor-grok-4.6', inputTokens: 20, outputTokens: 2, at: '2026-08-29T12:05:00.000Z' },
  ];
  writeFileSync(join(spendDir, 'cursor-usage.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const base = {
    cwd,
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: join(root, 'amp'), XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  };
  const filtered = collectSpend({
    ...base,
    env: { ...base.env, CURSOR_CONVERSATION_ID: 'Y' },
  });
  const filteredCursor = filtered.sources.filter((src) => src.platform === 'cursor');
  assert.equal(filteredCursor.length, 1);
  assert.equal(filteredCursor[0].id, 'conv-y');

  const unfiltered = collectSpend(base);
  const unfilteredIds = unfiltered.sources.filter((src) => src.platform === 'cursor').map((src) => src.id).sort();
  assert.deepEqual(unfilteredIds, ['conv-x', 'conv-y']);
  rmSync(root, { recursive: true, force: true });
});

test('cursor hook jsonl: stop and afterAgentResponse with different ids collapse to one turn', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-cursor-pair-'));
  const cwd = join(root, 'work');
  const spendDir = join(cwd, '.agents', 'spend');
  mkdirSync(spendDir, { recursive: true });
  writeFileSync(join(spendDir, 'cursor-usage.jsonl'), `${[
    {
      id: '198c3bea-d10b-483c-81d4-26c7e761a38e',
      event: 'afterAgentResponse',
      conversationId: 'e5938d8e-dfd8-41ca-a9b3-e3642988d99a',
      model: 'cursor-grok-4.6-xhigh-fast',
      inputTokens: 3388022,
      outputTokens: 14932,
      cacheReadTokens: 3113472,
      at: '2026-08-31T14:02:30.217Z',
    },
    {
      id: '2e0e5c14-c1f7-4f6d-8fba-dc433e2f6070',
      event: 'stop',
      conversationId: 'e5938d8e-dfd8-41ca-a9b3-e3642988d99a',
      model: 'cursor-grok-4.6-xhigh-fast',
      inputTokens: 3388022,
      outputTokens: 14932,
      cacheReadTokens: 3113472,
      at: '2026-08-31T14:02:30.304Z',
    },
  ].map((row) => JSON.stringify(row)).join('\n')}\n`);
  const result = collectSpend({
    cwd,
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: join(root, 'amp'), XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
    windowStart: '2026-08-31T13:59:47.000Z',
    windowEnd: '2026-08-31T14:03:08.400Z',
  });
  const cursorSources = result.sources.filter((src) => src.platform === 'cursor');
  assert.equal(cursorSources.length, 1);
  assert.equal(cursorSources[0].id, '2e0e5c14-c1f7-4f6d-8fba-dc433e2f6070');
  assert.equal(cursorSources[0].inputTokens, 3388022);
  assert.equal(cursorSources[0].costUsdEstimated, 8.7817);
  assert.equal(cursorSources[0].event, undefined);
  rmSync(root, { recursive: true, force: true });
});

test('cursor hook jsonl: existing source fingerprint skips the paired stop row', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-cursor-fp-skip-'));
  const cwd = join(root, 'work');
  const spendDir = join(cwd, '.agents', 'spend');
  mkdirSync(spendDir, { recursive: true });
  writeFileSync(join(spendDir, 'cursor-usage.jsonl'), `${JSON.stringify({
    id: 'stop-pair',
    event: 'stop',
    model: 'cursor-grok-4.6-xhigh-fast',
    inputTokens: 3388022,
    outputTokens: 14932,
    cacheReadTokens: 3113472,
    at: '2026-08-31T14:02:30.304Z',
  })}\n`);
  const result = collectSpend({
    cwd,
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: join(root, 'amp'), XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
    windowStart: '2026-08-31T13:59:47.000Z',
    windowEnd: '2026-08-31T14:03:08.400Z',
    existingSourceIds: ['after-pair'],
    existingSources: [{
      id: 'after-pair',
      platform: 'cursor',
      model: 'cursor-grok-4.6-xhigh-fast',
      inputTokens: 3388022,
      outputTokens: 14932,
      cacheReadTokens: 3113472,
    }],
  });
  assert.equal(result.sources.filter((src) => src.platform === 'cursor').length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('cursor hook jsonl: non-grok model writes fallback estimate', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-collect-cursor-fallback-'));
  const cwd = join(root, 'work');
  const spendDir = join(cwd, '.agents', 'spend');
  mkdirSync(spendDir, { recursive: true });
  writeFileSync(join(spendDir, 'cursor-usage.jsonl'), `${JSON.stringify({
    id: 'g-gpt',
    event: 'stop',
    model: 'gpt-5.6',
    inputTokens: 1000000,
    outputTokens: 1000000,
    at: '2026-08-29T12:00:00.000Z',
  })}\n`);
  const result = collectSpend({
    cwd,
    env: { HOME: join(root, 'home'), AMP_DATA_DIR: join(root, 'amp'), XDG_CONFIG_HOME: join(root, 'xdg') },
    homedir: join(root, 'home'),
    windowStart: '2026-08-29T11:00:00.000Z',
    windowEnd: '2026-08-29T13:00:00.000Z',
  });
  const cursorSources = result.sources.filter((src) => src.platform === 'cursor');
  assert.equal(cursorSources.length, 1);
  assert.equal(cursorSources[0].costUsd, null);
  assert.equal(cursorSources[0].costUsdEstimated, 18);
  assert.equal(cursorSources[0].costSource, 'api-estimate-fallback');
  assert.equal(cursorSources[0].platform, 'cursor');
  rmSync(root, { recursive: true, force: true });
});

test('attachCursorEstimates backfills cache and grok long-fast estimate onto legacy sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-enrich-cursor-'));
  const cwd = join(root, 'work');
  mkdirSync(join(cwd, '.agents', 'spend'), { recursive: true });
  writeFileSync(join(cwd, '.agents', 'spend', 'cursor-usage.jsonl'), `${JSON.stringify({
    id: '5642f1f3-db39-4b87-9749-f41bd0871d53',
    event: 'stop',
    model: 'cursor-grok-4.6-xhigh-fast',
    inputTokens: 648131,
    outputTokens: 7891,
    cacheReadTokens: 631424,
    at: '2026-08-31T13:41:18.378Z',
  })}\n`);
  const sources = [{
    id: '5642f1f3-db39-4b87-9749-f41bd0871d53',
    platform: 'cursor',
    model: 'cursor-grok-4.6-xhigh-fast',
    inputTokens: 648131,
    outputTokens: 7891,
    totalTokens: 656022,
    costUsd: null,
    ampCredits: null,
    at: '2026-08-31T13:41:18.378Z',
  }];
  assert.equal(attachCursorEstimates(sources, cwd), true);
  assert.equal(sources[0].cacheReadTokens, 631424);
  assert.equal(sources[0].costUsdEstimated, 1.5859);
  assert.equal(sources[0].costSource, 'api-estimate');
  const metrics = {
    sessions: [{
      sources,
      inputTokens: 648131,
      outputTokens: 7891,
      totalTokens: 656022,
      costUsdEstimated: null,
      spendSource: 'unreported',
    }],
  };
  assert.equal(enrichMetricsCursorEstimates(metrics, cwd), true);
  assert.equal(metrics.sessions[0].costUsdEstimated, 1.5859);
  assert.equal(metrics.sessions[0].spendSource, 'adapter');
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
  run(JSON.stringify({
    hook_event_name: 'afterAgentResponse',
    conversation_id: 'c-stable',
    model: 'cursor-grok-4.6-xhigh-fast',
    input_tokens: 10,
    output_tokens: 2,
    cache_read_tokens: 4,
  }));
  run(JSON.stringify({
    hook_event_name: 'stop',
    conversation_id: 'c-stable',
    model: 'cursor-grok-4.6-xhigh-fast',
    input_tokens: 10,
    output_tokens: 2,
    cache_read_tokens: 4,
  }));
  const all = readFileSync(usageFile, 'utf-8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  assert.equal(all[1].id, 'c-stable:10:2:4');
  assert.equal(all[2].id, all[1].id);
  rmSync(root, { recursive: true, force: true });
});

test('cursor spend hook leftover attaches after stop without a separate collect', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-hook-leftover-'));
  try {
    const endedAt = new Date(Date.now() - 5000).toISOString();
    const threadId = 'thread-hook-leftover';
    mkdirSync(join(root, 'openspec/changes/add-thing'), { recursive: true });
    writeFileSync(join(root, 'openspec/changes/add-thing/metrics.json'), `${JSON.stringify({
      sessions: [{
        startedAt: new Date(Date.parse(endedAt) - 60000).toISOString(),
        endedAt,
        durationMs: 60000,
        role: 'Implementer',
        phase: 'apply',
        platform: 'cursor',
        threadId,
        sources: [],
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        costUsdEstimated: null,
        spendSource: 'unreported',
      }],
      pending: null,
    }, null, 2)}\n`);
    mkdirSync(join(root, '.agents'), { recursive: true });
    const hookPath = new URL('../scripts/cursor-spend-hook.cjs', import.meta.url).pathname;
    const stdout = execFileSync('node', [hookPath], {
      cwd: root,
      input: JSON.stringify({
        hook_event_name: 'stop',
        conversation_id: threadId,
        generation_id: 'hook-leftover-stop',
        model: 'cursor-grok-4.6',
        input_tokens: 40,
        output_tokens: 2,
      }),
      encoding: 'utf-8',
    });
    assert.equal(stdout, '');
    const jsonl = readFileSync(join(root, '.agents/spend/cursor-usage.jsonl'), 'utf-8');
    assert.match(jsonl, /hook-leftover-stop/);
    const metrics = JSON.parse(readFileSync(join(root, 'openspec/changes/add-thing/metrics.json'), 'utf-8'));
    const last = metrics.sessions[metrics.sessions.length - 1];
    assert.equal((last.sources || []).filter((src) => src.id === 'hook-leftover-stop').length, 1);
    const collectPath = new URL('../scripts/cursor-spend-collect.cjs', import.meta.url).pathname;
    execFileSync('node', [collectPath], {
      cwd: root,
      input: '{}\n',
      encoding: 'utf-8',
    });
    const again = JSON.parse(readFileSync(join(root, 'openspec/changes/add-thing/metrics.json'), 'utf-8'));
    assert.equal(again.sessions.at(-1).sources.filter((src) => src.id === 'hook-leftover-stop').length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sessionEnd leftover attaches only last.threadId conversation rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-leftover-convid-'));
  try {
    const endedAt = '2026-09-02T16:20:21.000Z';
    const at = '2026-09-02T16:20:40.000Z';
    mkdirSync(join(root, 'openspec/changes/archive/2026-09-02-add-auth'), { recursive: true });
    writeFileSync(join(root, 'openspec/changes/archive/2026-09-02-add-auth/metrics.json'), `${JSON.stringify({
      sessions: [{
        startedAt: '2026-09-02T16:19:00.000Z',
        endedAt,
        durationMs: 81000,
        role: 'Archiver',
        phase: 'archive',
        platform: 'cursor',
        threadId: 'A',
        sources: [],
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        costUsdEstimated: null,
        spendSource: 'unreported',
      }],
      pending: null,
    }, null, 2)}\n`);
    mkdirSync(join(root, '.agents/spend'), { recursive: true });
    writeFileSync(join(root, '.agents/spend/cursor-usage.jsonl'), `${[
      { id: 'archiver-a', event: 'stop', conversationId: 'A', model: 'cursor-grok-4.6', inputTokens: 11, outputTokens: 1, at },
      { id: 'hotfix-b', event: 'stop', conversationId: 'B', model: 'cursor-grok-4.6', inputTokens: 99, outputTokens: 9, at },
    ].map((row) => JSON.stringify(row)).join('\n')}\n`);
    const collectPath = new URL('../scripts/cursor-spend-collect.cjs', import.meta.url).pathname;
    execFileSync('node', [collectPath], {
      cwd: root,
      input: '{}\n',
      encoding: 'utf-8',
    });
    const metrics = JSON.parse(readFileSync(join(root, 'openspec/changes/archive/2026-09-02-add-auth/metrics.json'), 'utf-8'));
    const ids = (metrics.sessions.at(-1).sources || []).map((src) => src.id);
    assert.ok(ids.includes('archiver-a'));
    assert.ok(!ids.includes('hotfix-b'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hook writes consumer jsonl in multi-root; collect from kit updates consumer archive', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aok-multiroot-'));
  const kit = join(tmp, 'kit');
  const consumer = join(tmp, 'consumer');
  try {
    const conversationId = 'consumer-thread';
    const endedAt = new Date(Date.now() - 8000).toISOString();
    mkdirSync(join(kit, '.agents'), { recursive: true });
    mkdirSync(join(kit, 'openspec/changes/kit-change'), { recursive: true });
    writeFileSync(join(kit, 'openspec/changes/kit-change/metrics.json'), `${JSON.stringify({
      sessions: [],
      pending: null,
    }, null, 2)}\n`);
    mkdirSync(join(consumer, 'openspec/changes/archive/2026-09-02-add-auth'), { recursive: true });
    writeFileSync(join(consumer, 'openspec/changes/archive/2026-09-02-add-auth/metrics.json'), `${JSON.stringify({
      sessions: [{
        startedAt: new Date(Date.parse(endedAt) - 30000).toISOString(),
        endedAt,
        durationMs: 30000,
        role: 'Archiver',
        phase: 'archive',
        platform: 'cursor',
        threadId: conversationId,
        sources: [],
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        costUsdEstimated: null,
        spendSource: 'unreported',
      }],
      pending: null,
    }, null, 2)}\n`);
    mkdirSync(join(consumer, '.agents'), { recursive: true });
    const hookPath = new URL('../scripts/cursor-spend-hook.cjs', import.meta.url).pathname;
    execFileSync('node', [hookPath], {
      cwd: kit,
      input: JSON.stringify({
        hook_event_name: 'stop',
        conversation_id: conversationId,
        generation_id: 'multi-root-g1',
        model: 'cursor-grok-4.6',
        input_tokens: 15,
        output_tokens: 1,
        workspace_roots: [kit, consumer],
      }),
      encoding: 'utf-8',
    });
    const consumerJsonl = join(consumer, '.agents/spend/cursor-usage.jsonl');
    const kitJsonl = join(kit, '.agents/spend/cursor-usage.jsonl');
    assert.ok(existsSync(consumerJsonl));
    assert.match(readFileSync(consumerJsonl, 'utf-8'), /multi-root-g1/);
    if (existsSync(kitJsonl)) {
      assert.doesNotMatch(readFileSync(kitJsonl, 'utf-8'), /multi-root-g1/);
    }
    const collectPath = new URL('../scripts/cursor-spend-collect.cjs', import.meta.url).pathname;
    execFileSync('node', [collectPath], {
      cwd: kit,
      input: `${JSON.stringify({ workspace_roots: [kit, consumer], conversation_id: conversationId })}\n`,
      encoding: 'utf-8',
    });
    const archived = JSON.parse(readFileSync(join(consumer, 'openspec/changes/archive/2026-09-02-add-auth/metrics.json'), 'utf-8'));
    assert.ok((archived.sessions.at(-1).sources || []).some((src) => src.id === 'multi-root-g1'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('leftover recompute rounds costUsdEstimated sum to four decimals', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-round-usd4-'));
  try {
    mkdirSync(join(root, 'openspec/changes/add-thing'), { recursive: true });
    writeFileSync(join(root, 'openspec/changes/add-thing/metrics.json'), `${JSON.stringify({
      sessions: [{
        startedAt: '2026-09-02T16:00:00.000Z',
        endedAt: '2026-09-02T16:01:00.000Z',
        durationMs: 60000,
        role: 'Implementer',
        phase: 'apply',
        platform: 'cursor',
        threadId: null,
        sources: [
          { id: 'e1', platform: 'cursor', costUsdEstimated: 2.3911 },
          { id: 'e2', platform: 'cursor', costUsdEstimated: 2.8153 },
          { id: 'e3', platform: 'cursor', costUsdEstimated: 1.355 },
        ],
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        costUsdEstimated: null,
        spendSource: 'unreported',
      }],
      pending: null,
    }, null, 2)}\n`);
    const collectPath = new URL('../scripts/cursor-spend-collect.cjs', import.meta.url).pathname;
    execFileSync('node', [collectPath], {
      cwd: root,
      input: '{}\n',
      encoding: 'utf-8',
    });
    const metrics = JSON.parse(readFileSync(join(root, 'openspec/changes/add-thing/metrics.json'), 'utf-8'));
    assert.equal(metrics.spend.costUsdEstimated, 6.5614);
    assert.notEqual(metrics.spend.costUsdEstimated, 6.561400000000001);
    assert.equal(metrics.spendByPlatform.cursor.costUsdEstimated, 6.5614);
    assert.equal(metrics.phases.apply.costUsdEstimated, 6.5614);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
