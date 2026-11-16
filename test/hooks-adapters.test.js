import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as claude from '../bin/hooks/adapters/claude.js';
import * as cursor from '../bin/hooks/adapters/cursor.js';
import * as amp from '../bin/hooks/adapters/amp.js';
import { createStore } from '../bin/hooks/store.js';
import { scopeIds } from '../bin/hooks/adapters/shared.js';

const execFileAsync = promisify(execFile);
const fixturesDir = fileURLToPath(new URL('./fixtures/hooks/', import.meta.url));
const readFixtures = async (name) => JSON.parse(await readFile(join(fixturesDir, `${name}.json`), 'utf8'));
const PROJECT_DIR_PLACEHOLDER = '/home/user/project';

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-adapters-'));
  await execFileAsync('git', ['init', '--quiet', dir]);
  return dir;
}

test('claude fixtures normalize to EventV1 with verified lifecycle meanings', async () => {
  const { fixtures } = await readFixtures('claude');
  for (const fixture of fixtures) {
    const event = claude.normalize({ payload: fixture.input, projectDir: PROJECT_DIR_PLACEHOLDER });
    assert.equal(event?.kind ?? null, fixture.expected.kind, fixture.name);
    if (!event) continue;
    assert.equal(event.schemaVersion, 1, fixture.name);
    assert.equal(event.scope.sessionId, fixture.expected.sessionId ?? 'sess-claude-1', fixture.name);
    assert.equal(event.scope.agentId ?? null, fixture.expected.agentId ?? null, fixture.name);
    if (fixture.expected.operation) assert.equal(event.data.tool.operation, fixture.expected.operation, fixture.name);
    if (fixture.expected.files) assert.deepEqual(event.data.files, fixture.expected.files, fixture.name);
    if (fixture.expected.toolId) assert.equal(event.data.tool.id, fixture.expected.toolId, fixture.name);
    if (fixture.expected.outcome) assert.equal(event.data.outcome.status, fixture.expected.outcome, fixture.name);
    assert.equal(event.data.stopReason ?? null, fixture.expected.stopReason ?? null, fixture.name);
    assert.equal(event.source.nativeEvent.hook_event_name, fixture.input.hook_event_name, fixture.name);
  }
});

test('claude session identity is separate from subagent identity and stays null when absent', () => {
  const main = claude.normalize({
    payload: { session_id: 'sess-claude-1', cwd: '/home/user/project', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/home/user/project/a.js' }, tool_use_id: 't1' },
    projectDir: PROJECT_DIR_PLACEHOLDER,
  });
  assert.equal(main.scope.sessionId, 'sess-claude-1');
  assert.equal(main.scope.agentId, null);

  const subagent = claude.normalize({
    payload: { session_id: 'sess-claude-1', agent_id: 'agent-claude-7', agent_type: 'code-writer', hook_event_name: 'SubagentStart' },
    projectDir: PROJECT_DIR_PLACEHOLDER,
  });
  assert.equal(subagent.scope.sessionId, 'sess-claude-1');
  assert.equal(subagent.scope.agentId, 'agent-claude-7');
});

test('claude native event ids are stable per occurrence and never per arguments', () => {
  const payloadFor = (toolUseId) => ({
    session_id: 'sess-claude-1',
    cwd: '/home/user/project',
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/home/user/project/src/app.js' },
    tool_use_id: toolUseId,
  });
  const first = claude.normalize({ payload: payloadFor('toolu_1'), projectDir: PROJECT_DIR_PLACEHOLDER });
  const replay = claude.normalize({ payload: payloadFor('toolu_1'), projectDir: PROJECT_DIR_PLACEHOLDER });
  const second = claude.normalize({ payload: payloadFor('toolu_2'), projectDir: PROJECT_DIR_PLACEHOLDER });
  assert.equal(first.eventId, replay.eventId);
  assert.notEqual(first.eventId, second.eventId);
});

test('claude serializes only verified response fields', () => {
  const caps = claude.capabilities();
  const start = claude.normalize({ payload: { session_id: 'sess-claude-1', hook_event_name: 'SessionStart', source: 'startup' }, projectDir: PROJECT_DIR_PLACEHOLDER });
  const injected = claude.serialize({
    event: start,
    result: { schemaVersion: 1, context: [{ id: 'c1', text: 'delivered skill text' }], findings: [], decision: null },
    capabilities: caps,
  });
  assert.equal(injected.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(injected.hookSpecificOutput.additionalContext.includes('delivered skill text'));
  assert.ok(injected.hookSpecificOutput.additionalContext.includes('sess-claude-1'));

  const preTool = claude.normalize({ payload: { session_id: 'sess-claude-1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 't1' }, projectDir: PROJECT_DIR_PLACEHOLDER });
  const denied = claude.serialize({
    event: preTool,
    result: { schemaVersion: 1, context: [], findings: [], decision: { action: 'deny', reason: 'policy' } },
    capabilities: caps,
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');

  const subagentDeny = claude.serialize({
    event: claude.normalize({ payload: { session_id: 's', agent_id: 'a', hook_event_name: 'SubagentStart' }, projectDir: PROJECT_DIR_PLACEHOLDER }),
    result: { schemaVersion: 1, context: [], findings: [], decision: { action: 'deny', reason: 'nope' } },
    capabilities: caps,
  });
  assert.equal(subagentDeny?.hookSpecificOutput?.permissionDecision, undefined, 'SubagentStart cannot deny a spawn');
  assert.ok(subagentDeny === null || subagentDeny.hookSpecificOutput.hookEventName === 'SubagentStart');

  assert.equal(claude.serialize({
    event: claude.normalize({ payload: { session_id: 's', hook_event_name: 'SessionEnd', reason: 'clear' }, projectDir: PROJECT_DIR_PLACEHOLDER }),
    result: { schemaVersion: 1, context: [], findings: [], decision: null },
    capabilities: caps,
  }), null, 'SessionEnd is cleanup with no output');
});

test('cursor fixtures normalize with session lifecycle and identity meanings', async () => {
  const { fixtures } = await readFixtures('cursor');
  for (const fixture of fixtures) {
    const event = cursor.normalize({ payload: fixture.input, projectDir: PROJECT_DIR_PLACEHOLDER });
    assert.equal(event?.kind ?? null, fixture.expected.kind, fixture.name);
    if (!event) continue;
    if (fixture.expected.sessionId) assert.equal(event.scope.sessionId, fixture.expected.sessionId, fixture.name);
    if (fixture.expected.agentId) assert.equal(event.scope.agentId, fixture.expected.agentId, fixture.name);
    if (fixture.expected.operation) assert.equal(event.data.tool.operation, fixture.expected.operation, fixture.name);
    if (fixture.expected.files) assert.deepEqual(event.data.files, fixture.expected.files, fixture.name);
    if (fixture.expected.outcome) assert.equal(event.data.outcome.status, fixture.expected.outcome, fixture.name);
    if (fixture.expected.stopReason) assert.equal(event.data.stopReason, fixture.expected.stopReason, fixture.name);
  }
});

test('cursor identical reads are distinct events because ids are not argument-derived', () => {
  const payload = {
    conversation_id: 'conv-cursor-1',
    generation_id: 'gen-3',
    hook_event_name: 'beforeReadFile',
    cursor_version: '3.22.12',
    file_path: '/home/user/project/src/store.ts',
    content: 'same',
  };
  const first = cursor.normalize({ payload, projectDir: PROJECT_DIR_PLACEHOLDER });
  const second = cursor.normalize({ payload, projectDir: PROJECT_DIR_PLACEHOLDER });
  assert.notEqual(first.eventId, second.eventId);
});

test('cursor sessionStart injects context with the echoed conversation id; subagentStart cannot', () => {
  const caps = cursor.capabilities({ is_background_agent: false });
  const start = cursor.normalize({
    payload: { hook_event_name: 'sessionStart', cursor_version: '3.22.12', session_id: 'conv-cursor-1', is_background_agent: false },
    projectDir: PROJECT_DIR_PLACEHOLDER,
  });
  const injected = cursor.serialize({
    event: start,
    result: { schemaVersion: 1, context: [{ id: 'c1', text: 'skill body' }], findings: [], decision: null },
    capabilities: caps,
  });
  assert.ok(injected.additional_context.includes('skill body'));
  assert.ok(injected.additional_context.includes('conv-cursor-1'));

  const subagent = cursor.serialize({
    event: cursor.normalize({ payload: { hook_event_name: 'subagentStart', cursor_version: '3.22.12', subagent_id: 'sub-77' }, projectDir: PROJECT_DIR_PLACEHOLDER }),
    result: { schemaVersion: 1, context: [{ id: 'c1', text: 'skill body' }], findings: [], decision: null },
    capabilities: caps,
  });
  assert.equal(subagent, null, 'subagentStart has permission output, not context injection');

  const stopped = cursor.serialize({
    event: cursor.normalize({ payload: { hook_event_name: 'stop', cursor_version: '3.22.12', status: 'completed' }, projectDir: PROJECT_DIR_PLACEHOLDER }),
    result: { schemaVersion: 1, context: [], findings: [], decision: { action: 'followup', reason: 'verify' } },
    capabilities: caps,
  });
  assert.deepEqual(stopped, { followup_message: 'verify' });
});

test('cursor cloud agents and unknown versions downgrade to observation', () => {
  const cloudCaps = cursor.capabilities({ is_background_agent: true });
  assert.equal(cloudCaps.events['session.start'].supported, false);
  assert.equal(cloudCaps.events['session.end'].supported, false);
  const cloudEvent = cursor.normalize({
    payload: { hook_event_name: 'sessionStart', cursor_version: '3.22.12', session_id: 'conv-c', is_background_agent: true },
    projectDir: PROJECT_DIR_PLACEHOLDER,
  });
  assert.equal(cursor.serialize({
    event: cloudEvent,
    result: { schemaVersion: 1, context: [{ id: 'c', text: 'x' }], findings: [], decision: null },
    capabilities: cloudCaps,
  }), null);

  const status = cursor.versionStatus({ cursor_version: '99.0.0' });
  assert.equal(status.verified, false);
  const downgraded = cursor.downgradedCapabilities(cursor.capabilities({}));
  assert.equal(downgraded.events['session.start'].injectContext, false);
  assert.equal(downgraded.events['tool.before'].deny, false);
  const unknownVersionEvent = cursor.normalize({
    payload: { hook_event_name: 'sessionStart', cursor_version: '99.0.0', session_id: 'conv-u', is_background_agent: false },
    projectDir: PROJECT_DIR_PLACEHOLDER,
  });
  assert.equal(cursor.serialize({
    event: unknownVersionEvent,
    result: { schemaVersion: 1, context: [{ id: 'c', text: 'x' }], findings: [], decision: null },
    capabilities: downgraded,
  }), null);
});

test('amp fixtures normalize with request-scoped lifecycle meanings', async () => {
  const { fixtures } = await readFixtures('amp');
  for (const fixture of fixtures) {
    const event = amp.normalize({ payload: fixture.input, projectDir: PROJECT_DIR_PLACEHOLDER, nativeEvent: fixture.event });
    assert.equal(event?.kind ?? null, fixture.expected.kind, fixture.name);
    if (!event) continue;
    assert.equal(event.scope.sessionId, fixture.expected.sessionId ?? 'T-amp-thread-1', fixture.name);
    assert.equal(event.scope.agentId, null, fixture.name);
    if (fixture.expected.operation) assert.equal(event.data.tool.operation, fixture.expected.operation, fixture.name);
    if (fixture.expected.files) assert.deepEqual(event.data.files, fixture.expected.files, fixture.name);
    if (fixture.expected.toolId) assert.equal(event.data.tool.id, fixture.expected.toolId, fixture.name);
    if (fixture.expected.outcome) assert.equal(event.data.outcome.status, fixture.expected.outcome, fixture.name);
    if (fixture.expected.stopReason) assert.equal(event.data.stopReason, fixture.expected.stopReason, fixture.name);
  }
  assert.equal(amp.capabilities().events['session.end'].supported, false, 'no invented session.end');
  assert.equal(amp.capabilities().events['context.compacting'].supported, false, 'no compaction events');
});

test('amp serializes only verified plugin results', () => {
  const caps = amp.capabilities();
  const agentStart = amp.serialize({
    event: amp.normalize({ payload: { thread: { id: 'T-amp-1' }, message: 'go', id: 'm1' }, projectDir: PROJECT_DIR_PLACEHOLDER, nativeEvent: 'agent.start' }),
    result: { schemaVersion: 1, context: [{ id: 'c1', text: 'delivered' }], findings: [], decision: null },
    capabilities: caps,
  });
  assert.ok(agentStart.message.content.includes('delivered'));
  assert.ok(agentStart.message.content.includes('T-amp-1'));

  assert.equal(amp.serialize({
    event: amp.normalize({ payload: { thread: { id: 'T-amp-1' } }, projectDir: PROJECT_DIR_PLACEHOLDER, nativeEvent: 'session.start' }),
    result: { schemaVersion: 1, context: [{ id: 'c1', text: 'delivered' }], findings: [], decision: null },
    capabilities: caps,
  }), null, 'session.start is fire-and-forget');

  const rejected = amp.serialize({
    event: amp.normalize({ payload: { toolUseID: 'tu1', tool: 'shell', input: { command: 'x' }, thread: { id: 'T-amp-1' } }, projectDir: PROJECT_DIR_PLACEHOLDER, nativeEvent: 'tool.call' }),
    result: { schemaVersion: 1, context: [], findings: [], decision: { action: 'deny', reason: 'blocked' } },
    capabilities: caps,
  });
  assert.deepEqual(rejected, { action: 'reject-and-continue', message: 'blocked' });
});

test('run() dispatches end-to-end, audits locally, and never blocks on errors', async () => {
  const dir = await makeProject();
  const { output, event } = await claude.run({
    projectDir: dir,
    payload: { session_id: 'sess-run-1', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' },
    respond: 'return',
  });
  assert.equal(output?.hookSpecificOutput?.hookEventName, 'SessionStart');
  assert.ok(output?.hookSpecificOutput?.additionalContext.includes('sess-run-1'), 'start context echoes the native session id');
  assert.equal(event.kind, 'session.start');

  const store = createStore({ projectDir: dir, scope: { level: 'session', ...scopeIds(dir), sessionId: 'sess-run-1', eventId: event.eventId }, pruneIntervalMs: 10 ** 9 });
  const audit = await store.log('audit');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].kind, 'session.start');
  assert.equal(audit[0].sessionId, 'sess-run-1');
  assert.equal(audit[0].transcript, undefined, 'audit records are sanitized');

  const broken = await cursor.run({ projectDir: dir, payload: { hook_event_name: 'brandNewHook', cursor_version: '3.22.12' }, respond: 'return' });
  assert.equal(broken.event, null);
  assert.equal(broken.output, null);

  const ampRun = await amp.run({ projectDir: dir, payload: { thread: { id: 'T-run-1' } }, nativeEvent: 'session.start', respond: 'return' });
  assert.equal(ampRun.event.kind, 'session.start');
  await rm(dir, { recursive: true, force: true });
});

test('adapter source metadata records exercised versions and doc sources', () => {
  for (const adapter of [claude, cursor, amp]) {
    assert.ok(adapter.SOURCE.docUrl.startsWith('https://'));
    assert.equal(adapter.SOURCE.recordedAt, '2026-11-16');
    assert.ok(adapter.SOURCE.testedVersions.length >= 1);
  }
});
