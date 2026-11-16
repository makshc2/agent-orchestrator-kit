import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, builtinPolicies } from '../bin/hooks/index.js';
import { builtinPolicies as builtinPoliciesList } from '../bin/hooks/policies/index.js';

const EVENT_KINDS = [
  'session.start',
  'session.resume',
  'session.end',
  'context.compacting',
  'context.reset',
  'agent.start',
  'agent.end',
  'tool.before',
  'tool.after',
  'file.changed',
];

const CLEAN_RESULT = { schemaVersion: 1, context: [], findings: [], decision: null };

function makeEvent(kind, overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'evt-1',
    occurredAt: '2026-11-16T10:00:00.000Z',
    kind,
    source: {
      client: 'amp',
      clientVersion: '1.2.3',
      runtime: 'node',
      nativeEvent: { name: kind },
    },
    scope: {
      repoId: 'repo-1',
      worktreeId: 'wt-1',
      sessionId: 'sess-1',
      agentId: 'agent-1',
      changeId: 'add-agent-hook-runtime',
    },
    contextEpoch: 3,
    data: {
      role: 'Implementer',
      taskId: '1.1',
      files: ['src/a.js'],
      tool: null,
      outcome: null,
      stopReason: null,
    },
    ...overrides,
  };
}

function fakeStore() {
  const calls = { storeFor: [], reads: [], appends: [], transacts: [] };
  const child = (level) => ({
    level,
    read: (...args) => {
      calls.reads.push({ level, args });
      return null;
    },
    transact: (...args) => {
      calls.transacts.push({ level, args });
    },
    append: (...args) => {
      calls.appends.push({ level, args });
    },
  });
  return {
    calls,
    storeFor(level) {
      calls.storeFor.push(level);
      return child(level);
    },
  };
}

const noopPolicy = {
  id: 'noop',
  events: null,
  evaluate: async () => ({ context: [], findings: [], decision: null }),
};

const decisionPolicy = (id, decision) => ({
  id,
  events: null,
  evaluate: async () => ({ context: [], findings: [], decision }),
});

function capabilitiesFor(kind, { deny = false, followup = false, reason = null } = {}) {
  return {
    schemaVersion: 1,
    client: 'amp',
    clientVersion: '1.0.0',
    runtime: 'node',
    events: { [kind]: { supported: true, injectContext: true, deny, followup, reason } },
  };
}

function enforceConfig(...ids) {
  const policies = {};
  for (const id of ids) policies[id] = { enabled: true, mode: 'enforce' };
  return { hooks: { mode: 'enforce', policies } };
}

const findingCodes = (result) => result.findings.map((finding) => finding.code);

test('dispatch returns a clean result for every event kind', async () => {
  for (const kind of EVENT_KINDS) {
    const result = await dispatch(makeEvent(kind), { policies: [noopPolicy], config: {} });
    assert.deepEqual(result, CLEAN_RESULT, `unexpected result for kind ${kind}`);
  }
});

test('events with missing or all-null fields are accepted, not rejected', async () => {
  const sparse = makeEvent('context.reset', {
    scope: { repoId: null, worktreeId: null, sessionId: null, agentId: null, changeId: null },
    data: { role: null, taskId: null, files: null, tool: null, outcome: null, stopReason: null },
  });
  assert.deepEqual(await dispatch(sparse, { policies: [] }), CLEAN_RESULT);

  const minimal = { schemaVersion: 1, eventId: null, occurredAt: null, kind: 'file.changed' };
  assert.deepEqual(await dispatch(minimal, { policies: [] }), CLEAN_RESULT);
});

test('default store derives the agent level when sessionId and agentId are both set', async () => {
  const store = fakeStore();
  await dispatch(makeEvent('agent.start'), { policies: [], store });
  assert.deepEqual(store.calls.storeFor, ['agent']);
});

test('default store derives the session level when only sessionId is set', async () => {
  const store = fakeStore();
  const event = makeEvent('session.start', {
    scope: { repoId: 'repo-1', worktreeId: 'wt-1', sessionId: 'sess-1', agentId: null, changeId: null },
  });
  await dispatch(event, { policies: [], store });
  assert.deepEqual(store.calls.storeFor, ['session']);
});

test('null sessionId still requests the session level and never the worktree level', async () => {
  const store = fakeStore();
  const event = makeEvent('file.changed', {
    scope: { repoId: 'repo-1', worktreeId: 'wt-1', sessionId: null, agentId: null, changeId: null },
  });
  await dispatch(event, { policies: [], store });
  assert.deepEqual(store.calls.storeFor, ['session']);
  assert.equal(store.calls.storeFor.includes('worktree'), false);
});

test('ctx.storeFor passes through to the store seam for every level', async () => {
  const store = fakeStore();
  let seenStore = 'unset';
  const policy = {
    id: 'passthrough',
    events: null,
    evaluate: async (event, ctx) => {
      seenStore = ctx.store;
      for (const level of ['worktree', 'change', 'session', 'agent']) {
        ctx.storeFor(level);
      }
      return { context: [], findings: [], decision: null };
    },
  };
  await dispatch(makeEvent('tool.before'), { policies: [policy], store });
  assert.equal(seenStore.level, 'agent', 'ctx.store must be the derived default-level store');
  assert.deepEqual(store.calls.storeFor, ['agent', 'worktree', 'change', 'session', 'agent']);
});

test('ctx.store and ctx.storeFor are null when store is null', async () => {
  let capturedCtx = null;
  const policy = {
    id: 'storeless',
    events: null,
    evaluate: async (event, ctx) => {
      capturedCtx = ctx;
      return { context: [], findings: [], decision: null };
    },
  };
  await dispatch(makeEvent('tool.after'), { policies: [policy], store: null });
  assert.equal(capturedCtx.store, null);
  assert.equal(capturedCtx.storeFor, null);
});

test('enabled policy under global observe mode cannot block: deny is downgraded to advisory', async () => {
  const config = {
    hooks: { mode: 'observe', policies: { 'p-deny': { enabled: true, mode: 'enforce' } } },
  };
  const capabilities = capabilitiesFor('tool.before', { deny: true, followup: true });
  const result = await dispatch(makeEvent('tool.before'), {
    policies: [decisionPolicy('p-deny', { action: 'deny', reason: 'too risky' })],
    capabilities,
    config,
    store: fakeStore(),
  });
  assert.equal(result.decision, null);
  assert.ok(result.findings.some((finding) => finding.code === 'policy.decision.downgraded'));
});

test('enabled policy in policy-level observe mode is downgraded even under global enforce', async () => {
  const config = {
    hooks: { mode: 'enforce', policies: { 'p-deny': { enabled: true, mode: 'observe' } } },
  };
  const capabilities = capabilitiesFor('tool.before', { deny: true, followup: true });
  const result = await dispatch(makeEvent('tool.before'), {
    policies: [decisionPolicy('p-deny', { action: 'deny', reason: 'too risky' })],
    capabilities,
    config,
  });
  assert.equal(result.decision, null);
  assert.ok(result.findings.some((finding) => finding.code === 'policy.decision.downgraded'));
});

test('deny is honored when enabled + global enforce + policy enforce + capability deny', async () => {
  const capabilities = capabilitiesFor('tool.before', { deny: true, followup: false });
  const result = await dispatch(makeEvent('tool.before'), {
    policies: [decisionPolicy('p-deny', { action: 'deny', reason: 'too risky' })],
    capabilities,
    config: enforceConfig('p-deny'),
  });
  assert.deepEqual(result.decision, { action: 'deny', reason: 'too risky' });
});

test('deny without the deny capability is downgraded to advisory', async () => {
  const capabilities = capabilitiesFor('tool.before', { deny: false, followup: true, reason: 'client cannot block' });
  const result = await dispatch(makeEvent('tool.before'), {
    policies: [decisionPolicy('p-deny', { action: 'deny', reason: 'too risky' })],
    capabilities,
    config: enforceConfig('p-deny'),
  });
  assert.equal(result.decision, null);
  assert.ok(result.findings.some((finding) => finding.code === 'policy.decision.downgraded'));
});

test('followup is honored when capability.followup is true and deny is absent', async () => {
  const capabilities = capabilitiesFor('context.reset', { deny: false, followup: true });
  const result = await dispatch(makeEvent('context.reset'), {
    policies: [decisionPolicy('p-ask', { action: 'followup', reason: 'needs human' })],
    capabilities,
    config: enforceConfig('p-ask'),
  });
  assert.deepEqual(result.decision, { action: 'followup', reason: 'needs human' });
});

test('deny takes precedence over followup when both are honored', async () => {
  const capabilities = capabilitiesFor('tool.before', { deny: true, followup: true });
  const result = await dispatch(makeEvent('tool.before'), {
    policies: [
      decisionPolicy('p-ask', { action: 'followup', reason: 'needs human' }),
      decisionPolicy('p-deny', { action: 'deny', reason: 'too risky' }),
    ],
    capabilities,
    config: enforceConfig('p-ask', 'p-deny'),
  });
  assert.equal(result.decision.action, 'deny');
});

test('user_cancelled stopReason never blocks despite a fully honored deny', async () => {
  const event = makeEvent('agent.end', {
    data: { role: 'Implementer', taskId: '1.1', files: [], tool: null, outcome: null, stopReason: 'user_cancelled' },
  });
  const capabilities = capabilitiesFor('agent.end', { deny: true, followup: true });
  const result = await dispatch(event, {
    policies: [decisionPolicy('p-deny', { action: 'deny', reason: 'too risky' })],
    capabilities,
    config: enforceConfig('p-deny'),
  });
  assert.equal(result.decision, null);
  assert.equal(result.schemaVersion, 1);
  assert.ok(Array.isArray(result.findings));
});

test('cancelled outcome status never blocks despite a fully honored deny', async () => {
  const event = makeEvent('tool.after', {
    data: {
      role: 'Implementer',
      taskId: '1.1',
      files: [],
      tool: { name: 'edit' },
      outcome: { status: 'cancelled' },
      stopReason: null,
    },
  });
  const capabilities = capabilitiesFor('tool.after', { deny: true, followup: true });
  const result = await dispatch(event, {
    policies: [decisionPolicy('p-deny', { action: 'deny', reason: 'too risky' })],
    capabilities,
    config: enforceConfig('p-deny'),
  });
  assert.equal(result.decision, null);
  assert.equal(result.schemaVersion, 1);
});

test('schemaVersion 2 is rejected with an error finding and no side effects', async () => {
  const store = fakeStore();
  let evaluations = 0;
  const policy = { id: 'spy', events: null, evaluate: async () => { evaluations += 1; return { context: [], findings: [], decision: null }; } };
  const event = makeEvent('session.start', { schemaVersion: 2 });
  const result = await dispatch(event, { policies: [policy], store });
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.context, []);
  assert.equal(result.decision, null);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'event.schema.unsupported');
  assert.equal(result.findings[0].severity, 'error');
  assert.equal(store.calls.storeFor.length, 0);
  assert.equal(evaluations, 0);
});

test('non-object and array events are rejected as unsupported schema', async () => {
  for (const bad of ['event', 42, true, null, ['schemaVersion', 1]]) {
    const result = await dispatch(bad, { policies: [] });
    assert.deepEqual(result.context, []);
    assert.equal(result.decision, null);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'event.schema.unsupported');
    assert.equal(result.findings[0].severity, 'error');
  }
});

test('unknown kind is rejected with an error finding and no side effects', async () => {
  const store = fakeStore();
  let evaluations = 0;
  const policy = { id: 'spy', events: null, evaluate: async () => { evaluations += 1; return { context: [], findings: [], decision: null }; } };
  const event = makeEvent('session.paused');
  const result = await dispatch(event, { policies: [policy], store });
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.context, []);
  assert.equal(result.decision, null);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'event.kind.unknown');
  assert.equal(result.findings[0].severity, 'error');
  assert.equal(store.calls.storeFor.length, 0);
  assert.equal(evaluations, 0);
});

test('events over 256 KiB are rejected as oversized without side effects', async () => {
  const store = fakeStore();
  let evaluations = 0;
  const policy = { id: 'spy', events: null, evaluate: async () => { evaluations += 1; return { context: [], findings: [], decision: null }; } };
  const event = makeEvent('tool.before');
  event.source.nativeEvent = { payload: 'x'.repeat(280 * 1024) };
  const result = await dispatch(event, { policies: [policy], store });
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.context, []);
  assert.equal(result.decision, null);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'event.input.oversized');
  assert.equal(result.findings[0].severity, 'error');
  assert.equal(store.calls.storeFor.length, 0);
  assert.equal(evaluations, 0);
});

test('a policy that never settles times out and dispatch still returns a valid nonblocking result', async () => {
  const hanging = { id: 'p-hang', events: null, evaluate: () => new Promise(() => {}) };
  const result = await dispatch(makeEvent('agent.end'), { policies: [hanging], config: {} });
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.context, []);
  assert.equal(result.decision, null);
  assert.ok(result.findings.some((finding) => finding.code === 'policy.timeout'));
});

test('a throwing policy produces a policy.error finding and dispatch continues', async () => {
  const boom = {
    id: 'p-boom',
    events: null,
    evaluate: () => {
      throw new Error('kaput');
    },
  };
  const after = {
    id: 'p-after',
    events: null,
    evaluate: async () => ({
      context: [],
      findings: [{ code: 'after.ran', severity: 'info', message: 'dispatch continued' }],
      decision: null,
    }),
  };
  const result = await dispatch(makeEvent('session.end'), { policies: [boom, after] });
  assert.ok(result.findings.some((finding) => finding.code === 'policy.error'));
  assert.ok(result.findings.some((finding) => finding.code === 'after.ran'));
  assert.equal(result.decision, null);
});

test('context budget keeps whole items up to 32 KiB, skips the rest, and reports overflow', async () => {
  const smallText = (char) => char.repeat(1024);
  const bigText = (char) => char.repeat(20 * 1024);
  const item = (id, text) => ({
    id,
    text,
    sourcePath: 'openspec/changes/add-agent-hook-runtime/design.md',
    contentDigest: `digest-${id}`,
  });
  const first = {
    id: 'p-budget-a',
    events: null,
    evaluate: async () => ({
      context: [item('ctx-small-1', smallText('1')), item('ctx-big-a', bigText('a'))],
      findings: [],
      decision: null,
    }),
  };
  const second = {
    id: 'p-budget-b',
    events: null,
    evaluate: async () => ({
      context: [item('ctx-big-b', bigText('b')), item('ctx-small-2', smallText('2'))],
      findings: [],
      decision: null,
    }),
  };
  const result = await dispatch(makeEvent('context.compacting'), { policies: [first, second], config: {} });

  assert.deepEqual(result.context.map((entry) => entry.id), ['ctx-small-1', 'ctx-big-a']);
  assert.equal(result.context[0].text.length, 1024, 'included items must keep their full text');
  assert.equal(result.context[1].text.length, 20 * 1024, 'included items must keep their full text');
  assert.ok(Buffer.byteLength(JSON.stringify(result.context), 'utf8') <= 32 * 1024);

  const overflow = result.findings.find((finding) => finding.code === 'context.overflow');
  assert.ok(overflow, 'expected a context.overflow finding');
  assert.ok(overflow.paths.includes('ctx-big-b'));
  assert.ok(overflow.paths.includes('ctx-small-2'));
  assert.equal(result.decision, null);
});

test('builtinPolicies is the same registered list from both entry points', () => {
  assert.equal(Array.isArray(builtinPolicies), true);
  assert.equal(builtinPolicies, builtinPoliciesList);
  assert.deepEqual(builtinPolicies.map((policy) => policy.id), ['recovery', 'context']);
});
