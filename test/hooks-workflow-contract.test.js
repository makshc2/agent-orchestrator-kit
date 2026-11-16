import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { dispatch, createStore, builtinPolicies } from '../bin/hooks/index.js';
import { builtinPolicies as registeredPolicies } from '../bin/hooks/policies/index.js';
import { workflowPolicies } from '../bin/hooks/policies/workflow.js';
import { bindSession } from '../bin/hooks/binding.js';
import { scopeIds } from '../bin/hooks/adapters/shared.js';
import { run as runClaude } from '../bin/hooks/adapters/claude.js';
import { run as runCursor, capabilities as cursorCapabilities } from '../bin/hooks/adapters/cursor.js';
import { run as runAmp, capabilities as ampCapabilities } from '../bin/hooks/adapters/amp.js';
import { capabilities as claudeCapabilities } from '../bin/hooks/adapters/claude.js';
import { changeStore, worktreeStore } from '../bin/hooks/workflow/stores.js';
import { acquireLease, coalesceKey, enqueueJob, readQueue, releaseLease, withLease } from '../bin/hooks/workflow/jobs.js';
import { ackOutcome, OUTCOME_LIMIT, OUTCOME_TTL_MS, readOutcomes, recordOutcome } from '../bin/hooks/workflow/outcomes.js';

const execFileAsync = promisify(execFile);
const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW_IDS = ['verification', 'completion', 'scope', 'checks', 'owned-sync', 'workflow-notifications'];
const FORBIDDEN_SEGMENTS = ['workflow-outcomes', 'verification-evidence', 'completion-intent', 'completion-state', 'followup-budget', 'owned-sync', 'jobs'];
const SENTINEL = 'node -e "require(\'node:fs\').writeFileSync(\'aok-sentinel.txt\',\'ran\')"';

function event(kind, extra = {}) {
  return {
    schemaVersion: 1,
    kind,
    eventId: extra.eventId ?? `e-${kind}`,
    occurredAt: new Date().toISOString(),
    scope: {
      repoId: 'repo',
      worktreeId: 'wt',
      changeId: null,
      sessionId: null,
      agentId: null,
      ...(extra.scope ?? {}),
    },
    contextEpoch: null,
    source: { client: 'test', clientVersion: null, runtime: 'test', nativeEvent: {} },
    data: {
      role: null,
      taskId: null,
      files: [],
      tool: null,
      outcome: null,
      stopReason: extra.stopReason ?? null,
    },
  };
}

function stub(action) {
  return {
    id: 'p-deny',
    evaluate: () => ({ context: [], findings: [], decision: { action, reason: 'because' } }),
  };
}

function enforceConfig(enabled = true, mode = 'enforce') {
  return { hooks: { enabled: true, mode, policies: { 'p-deny': { enabled, mode: 'enforce' } } } };
}

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-workflow-contract-'));
  await execFileAsync('git', ['init', '--quiet', dir]);
  return dir;
}

async function writeConfig(dir, yaml) {
  await mkdir(join(dir, '.agents'), { recursive: true });
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), yaml);
}

async function removeTree(dir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
}

async function walk(dir) {
  const out = [];
  async function visit(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) await visit(abs);
      else out.push(abs);
    }
  }
  await visit(dir);
  return out;
}

async function assertNoWorkflowEffects(dir) {
  assert.equal(existsSync(join(dir, 'aok-sentinel.txt')), false);
  const paths = await walk(dir);
  for (const abs of paths) {
    const parts = abs.split(/[\\/]/);
    const hit = FORBIDDEN_SEGMENTS.find((segment) => parts.includes(segment));
    assert.equal(hit, undefined, abs);
    if (parts.includes('diagnostics')) {
      const text = await readFile(abs, 'utf8');
      assert.equal(text.includes('workflow.'), false, abs);
    }
  }
}

async function bindDemo(dir, sessionId) {
  const change = 'demo-change';
  await mkdir(join(dir, 'openspec', 'changes', change), { recursive: true });
  await writeFile(join(dir, 'openspec', 'changes', change, 'tasks.md'), '- [ ] 1.1 Sample\n  Files: src/a.js\n');
  await bindSession({
    projectDir: dir,
    ids: scopeIds(dir),
    change,
    role: 'implementer',
    task: '1.1',
    session: sessionId,
  });
}

async function exercise(client, dir, sessionId) {
  const common = { projectDir: dir, respond: 'silent' };
  if (client === 'claude') {
    const payloads = [
      { hook_event_name: 'PreToolUse', session_id: sessionId, tool_name: 'Edit', tool_use_id: 't1', cwd: dir, tool_input: { file_path: 'src/a.js' } },
      { hook_event_name: 'PostToolUse', session_id: sessionId, tool_name: 'Edit', tool_use_id: 't2', cwd: dir, tool_input: { file_path: 'src/a.js' } },
      { hook_event_name: 'SubagentStop', session_id: sessionId },
      { hook_event_name: 'SessionEnd', session_id: sessionId },
    ];
    for (const payload of payloads) {
      const ran = await runClaude({ ...common, payload });
      assert.ok(ran.event, payload.hook_event_name);
      assert.equal(ran.result.decision, null);
    }
    return;
  }
  if (client === 'cursor') {
    const payloads = [
      { hook_event_name: 'postToolUse', conversation_id: sessionId, cursor_version: '3.22.12', tool_name: 'Edit', tool_use_id: 't1', cwd: dir, tool_input: { file_path: 'src/a.js' } },
      { hook_event_name: 'afterFileEdit', conversation_id: sessionId, cursor_version: '3.22.12', file_path: join(dir, 'src', 'a.js'), cwd: dir },
      { hook_event_name: 'stop', conversation_id: sessionId, cursor_version: '3.22.12', status: 'completed' },
      { hook_event_name: 'sessionEnd', conversation_id: sessionId, cursor_version: '3.22.12' },
    ];
    for (const payload of payloads) {
      const ran = await runCursor({ ...common, payload });
      assert.ok(ran.event, payload.hook_event_name);
      assert.equal(ran.result.decision, null);
    }
    return;
  }
  const events = [
    ['tool.call', { thread: { id: sessionId }, tool: 'Edit', toolUseID: 't1', input: { file_path: 'src/a.js' } }],
    ['tool.result', { thread: { id: sessionId }, tool: 'Edit', toolUseID: 't1', status: 'done', input: { file_path: 'src/a.js' } }],
    ['agent.end', { thread: { id: sessionId }, id: 'turn-1', status: 'done' }],
  ];
  for (const [nativeEvent, payload] of events) {
    const ran = await runAmp({ ...common, nativeEvent, payload });
    assert.ok(ran.event, nativeEvent);
    assert.equal(ran.result.decision, null);
  }
}

test('shipped runtime exports and worktree storeFor stay on the frozen contract', async () => {
  assert.equal(typeof dispatch, 'function');
  assert.equal(typeof createStore, 'function');
  assert.ok(Array.isArray(builtinPolicies));
  assert.equal(registeredPolicies, builtinPolicies);
  const dir = await makeProject();
  const store = createStore({
    projectDir: dir,
    scope: { level: 'session', repoId: 'repo', worktreeId: 'wt', changeId: null, sessionId: null, agentId: null, eventId: 'probe' },
    pruneIntervalMs: 10 ** 9,
  });
  assert.equal(typeof store.read, 'function');
  assert.equal(typeof store.transact, 'function');
  assert.equal(typeof store.append, 'function');
  assert.equal(store.quarantined, true);
  let captured = null;
  await dispatch(event('tool.before', { eventId: 'probe', scope: { sessionId: null } }), {
    policies: [{ id: 'probe', evaluate: (_event, ctx) => { captured = ctx; return { context: [], findings: [], decision: null }; } }],
    store,
    config: { hooks: { enabled: false, mode: 'observe', policies: {} } },
  });
  assert.equal(typeof captured.storeFor, 'function');
  const worktree = captured.storeFor('worktree');
  assert.equal(worktree.level, 'worktree');
  assert.equal(worktree.quarantined, false);
  assert.equal(changeStore(dir, { repoId: 'repo', worktreeId: 'wt' }, ''), null);
  const change = changeStore(dir, { repoId: 'repo', worktreeId: 'wt' }, 'demo-change');
  assert.equal(change.quarantined, false);
  assert.equal(change.level, 'change');
  await removeTree(dir);
});

test('dispatch applies an object decision only with enforce mode and capability', async () => {
  const dir = await makeProject();
  const store = createStore({
    projectDir: dir,
    scope: { level: 'session', repoId: 'repo', worktreeId: 'wt', changeId: null, sessionId: 's', agentId: null, eventId: 'gate' },
    pruneIntervalMs: 10 ** 9,
  });
  const caps = claudeCapabilities();
  const denied = await dispatch(event('tool.before'), {
    policies: [stub('deny')],
    capabilities: caps,
    store,
    config: enforceConfig(true, 'enforce'),
  });
  assert.equal(denied.decision.action, 'deny');

  const observed = await dispatch(event('tool.before', { eventId: 'observe' }), {
    policies: [stub('deny')],
    capabilities: caps,
    store,
    config: enforceConfig(true, 'observe'),
  });
  assert.equal(observed.decision, null);
  assert.ok(observed.findings.some((finding) => finding.code === 'policy.decision.downgraded'));

  const disabled = await dispatch(event('tool.before', { eventId: 'disabled' }), {
    policies: [stub('deny')],
    capabilities: caps,
    store,
    config: enforceConfig(false, 'enforce'),
  });
  assert.equal(disabled.decision, null);
  assert.ok(disabled.findings.some((finding) => finding.code === 'policy.decision.downgraded'));

  const unsupported = await dispatch(event('agent.end', { eventId: 'follow' }), {
    policies: [stub('followup')],
    capabilities: caps,
    store,
    config: enforceConfig(true, 'enforce'),
  });
  assert.equal(unsupported.decision, null);
  assert.ok(unsupported.findings.some((finding) => finding.code === 'policy.decision.downgraded'));

  const cancelled = await dispatch(event('tool.before', { eventId: 'cancel', stopReason: 'user_cancelled' }), {
    policies: [stub('deny')],
    capabilities: caps,
    store,
    config: enforceConfig(true, 'enforce'),
  });
  assert.equal(cancelled.decision, null);

  const ignored = await dispatch(event('tool.before', { eventId: 'string' }), {
    policies: [{ id: 'p-deny', evaluate: () => ({ context: [], findings: [], decision: 'deny' }) }],
    capabilities: caps,
    store,
    config: enforceConfig(true, 'enforce'),
  });
  assert.equal(ignored.decision, null);
  await removeTree(dir);
});

test('client capability fixtures downgrade decisions they cannot honor', async () => {
  const cases = [
    ['claude', claudeCapabilities(), 'agent.end', 'followup'],
    ['cursor', cursorCapabilities({}), 'file.changed', 'deny'],
    ['amp', ampCapabilities(), 'agent.end', 'deny'],
  ];
  for (const [client, capabilities, kind, action] of cases) {
    const result = await dispatch(event(kind, { eventId: client }), {
      policies: [stub(action)],
      capabilities,
      config: enforceConfig(true, 'enforce'),
    });
    assert.equal(result.decision, null, client);
    assert.ok(result.findings.some((finding) => finding.code === 'policy.decision.downgraded'), client);
  }
});

test('builtinPolicies registers six inert workflow policies after recovery and context', async () => {
  const source = await readFile(join(KIT_ROOT, 'bin', 'hooks', 'policies', 'workflow.js'), 'utf8');
  assert.equal(source.split("id: '").length - 1, 6);
  assert.deepEqual(builtinPolicies.map((policy) => policy.id), ['recovery', 'context', ...WORKFLOW_IDS]);
  assert.deepEqual(workflowPolicies.map((policy) => policy.id), WORKFLOW_IDS);
  for (const policy of workflowPolicies) {
    assert.deepEqual(policy.events, ['tool.before', 'tool.after', 'file.changed', 'agent.end', 'session.end']);
    const disabled = await policy.evaluate(event('tool.before'), {
      config: { hooks: { enabled: true, mode: 'enforce', policies: { [policy.id]: { enabled: false, mode: 'enforce', options: {} } } } },
    });
    assert.deepEqual(disabled, { context: [], findings: [], decision: null });
    const absent = await policy.evaluate(event('agent.end'), { config: { hooks: { enabled: false, policies: {} } } });
    assert.deepEqual(absent, { context: [], findings: [], decision: null });
  }
});

test('shipped adapters with real disabled configs produce no workflow effects', async () => {
  const shipped = (await readFile(join(KIT_ROOT, 'templates', 'orchestrator.yaml'), 'utf8'))
    .replace('test_command: ""', `test_command: "${SENTINEL.replaceAll('"', '\\"')}"`);
  const absent = `hooks:\n  enabled: true\n  mode: enforce\n  policies: {}\nverifier:\n  test_command: "${SENTINEL.replaceAll('"', '\\"')}"\n`;
  const disabledPolicies = WORKFLOW_IDS.map((id) => `    ${id}:\n      enabled: false\n      mode: observe`).join('\n');
  const perPolicy = `hooks:\n  enabled: true\n  mode: enforce\n  policies:\n${disabledPolicies}\nverifier:\n  test_command: "${SENTINEL.replaceAll('"', '\\"')}"\n`;
  const configs = [
    ['global-disabled', shipped, false],
    ['absent-entry', absent, true],
    ['per-policy-disabled', perPolicy, true],
  ];
  for (const [name, yaml, bind] of configs) {
    for (const client of ['claude', 'cursor', 'amp']) {
      const dir = await makeProject();
      await writeConfig(dir, yaml);
      const sessionId = `sess-${name}-${client}`;
      if (bind) await bindDemo(dir, sessionId);
      await exercise(client, dir, sessionId);
      await assertNoWorkflowEffects(dir);
      await removeTree(dir);
    }
  }
});

test('lease tokens are reused without reacquire and queues keep identity apart', async () => {
  const dir = await makeProject();
  const ids = { repoId: 'repo', worktreeId: 'wt-lease' };
  const other = { repoId: 'repo', worktreeId: 'wt-other' };
  const acquired = await acquireLease({ projectDir: dir, ids });
  assert.equal(acquired.ok, true);
  const before = await worktreeStore(dir, ids).read('jobs', 'lease');
  let ran = false;
  await withLease({ projectDir: dir, ids, ownerToken: acquired.ownerToken }, async () => {
    ran = true;
  });
  assert.equal(ran, true);
  const after = await worktreeStore(dir, ids).read('jobs', 'lease');
  assert.equal(after.owner, acquired.ownerToken);
  assert.equal(after.expiresAt, before.expiresAt);
  await assert.rejects(() => withLease({ projectDir: dir, ids, ownerToken: 'wrong-token' }, async () => {}), /lease token/);
  const separate = await acquireLease({ projectDir: dir, ids: other });
  assert.equal(separate.ok, true);
  let woke = false;
  const released = await releaseLease({
    projectDir: dir,
    ids,
    ownerToken: acquired.ownerToken,
    wakeup: () => { woke = true; },
  });
  assert.equal(released.ok, true);
  assert.equal(woke, true);
  assert.equal((await worktreeStore(dir, ids).read('jobs', 'lease'))?.owner ?? null, null);

  await withLease({ projectDir: dir, ids, timeoutMs: 1000 }, async ({ ownerToken }) => {
    assert.equal((await worktreeStore(dir, ids).read('jobs', 'lease')).owner, ownerToken);
  });
  assert.equal((await worktreeStore(dir, ids).read('jobs', 'lease'))?.owner ?? null, null);

  const expired = await acquireLease({ projectDir: dir, ids, ownerToken: 'expired-token', now: Date.now() - 10000 });
  assert.equal(expired.ok, true);
  await assert.rejects(() => withLease({ projectDir: dir, ids, ownerToken: 'expired-token' }, async () => {}), /lease token/);

  let releaseHold;
  let started = false;
  const holderIds = { repoId: 'repo', worktreeId: 'wt-hold' };
  const hold = withLease({ projectDir: dir, ids: holderIds }, () => new Promise((resolve) => {
    started = true;
    releaseHold = resolve;
  }));
  while (!started) await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    () => withLease({ projectDir: dir, ids: holderIds, timeoutMs: 80 }, async () => {}),
    (error) => error.code === 'ERR_HOOK_LEASE_TIMEOUT',
  );
  releaseHold();
  await hold;

  const base = {
    projectDir: dir,
    ids,
    kind: 'checks',
    changeId: 'demo-change',
    sessionId: 'sess-1',
    agentId: null,
    taskId: '1.1',
    bindingDigest: 'bind',
    allowedFiles: ['src/a.js'],
    paths: ['src/a.js'],
    commandId: 'lint',
    optionsDigest: 'opt',
  };
  await enqueueJob(base);
  await enqueueJob({ ...base, paths: ['src/b.js'] });
  const coalesced = await readQueue({ projectDir: dir, ids });
  assert.equal(Object.keys(coalesced.jobs).length, 1);
  const only = Object.values(coalesced.jobs)[0];
  assert.deepEqual(only.paths, ['src/a.js', 'src/b.js']);
  assert.equal(only.sessionId, 'sess-1');
  assert.equal(only.changeId, 'demo-change');

  await worktreeStore(dir, ids).transact('jobs', 'queue', (prior) => {
    prior.jobs[only.jobId].status = 'running';
    return prior;
  });
  await enqueueJob({ ...base, paths: ['src/c.js'] });
  await enqueueJob({ ...base, paths: ['src/d.js'], originJobId: 'origin-1' });
  const queued = await readQueue({ projectDir: dir, ids });
  const jobs = Object.values(queued.jobs);
  assert.equal(jobs.length, 2);
  const successor = jobs.find((job) => job.status === 'pending');
  assert.deepEqual(successor.paths, ['src/c.js', 'src/d.js']);
  assert.deepEqual(successor.originJobIds, ['origin-1']);
  assert.equal(successor.generation, 2);
  assert.equal(jobs.find((job) => job.status === 'running').paths.includes('src/c.js'), false);

  await enqueueJob({ ...base, taskId: '1.2', paths: ['src/a.js'] });
  await enqueueJob({ ...base, changeId: 'other-change', paths: ['src/a.js'] });
  await enqueueJob({ ...base, commandId: 'typecheck', paths: ['src/a.js'] });
  const mixed = await readQueue({ projectDir: dir, ids });
  assert.equal(Object.keys(mixed.jobs).length, 5);
  const extra = Object.values(mixed.jobs).filter((job) => job.coalesceKey !== only.coalesceKey);
  assert.equal(extra.length, 3);
  assert.equal(new Set(extra.map((job) => job.coalesceKey)).size, 3);
  assert.equal(coalesceKey(base), only.coalesceKey);
  await removeTree(dir);
});

test('outcome records keep identity, drop secrets, and stay bounded', async () => {
  const dir = await makeProject();
  const ids = { repoId: 'repo', worktreeId: 'wt-outcomes' };
  const other = { repoId: 'repo', worktreeId: 'wt-outcomes-b' };
  const secret = {
    policy: 'checks',
    status: 'failed',
    reason: 'timeout',
    sessionId: 'sess-a',
    changeId: 'demo-change',
    taskId: '1.1',
    duration: 12,
    evidence: { digest: 'abc', freshness: 'stale', scope: { mode: 'narrowed', files: ['src/a.js'] } },
    source: { eventId: 'e1', jobId: 'job-1' },
    command: 'DO_NOT_STORE_COMMAND',
    output: 'DO_NOT_STORE_OUTPUT',
    secret: 'DO_NOT_STORE_SECRET',
  };
  const first = await recordOutcome({ projectDir: dir, ids, outcome: secret });
  const second = await recordOutcome({
    projectDir: dir,
    ids,
    outcome: { ...secret, sessionId: 'sess-b', changeId: 'other-change', status: 'blocked', outcomeId: 'oc-fixed' },
  });
  assert.equal(JSON.stringify([first, second]).includes('DO_NOT_STORE'), false);
  assert.equal(first.evidence.digest, 'abc');
  assert.equal(first.evidence.freshness, 'stale');
  assert.equal(first.duration, 12);
  assert.equal(first.source.jobId, 'job-1');
  const rows = await readOutcomes({ projectDir: dir, ids });
  assert.deepEqual(rows.map((row) => row.sessionId).sort(), ['sess-a', 'sess-b']);
  assert.equal(JSON.stringify(rows).includes('DO_NOT_STORE'), false);
  assert.deepEqual(await readOutcomes({ projectDir: dir, ids: other }), []);

  await ackOutcome({ projectDir: dir, ids, outcomeId: second.outcomeId });
  assert.equal((await readOutcomes({ projectDir: dir, ids })).some((row) => row.outcomeId === 'oc-fixed'), false);

  for (let index = 0; index < OUTCOME_LIMIT + 10; index += 1) {
    await recordOutcome({
      projectDir: dir,
      ids: other,
      outcome: { policy: 'verification', status: 'completed', reason: 'ok', sessionId: `s-${index}` },
    });
  }
  const bounded = await readOutcomes({ projectDir: dir, ids: other });
  assert.equal(bounded.length, OUTCOME_LIMIT);
  assert.equal(bounded.some((row) => row.sessionId === 's-0'), false);
  assert.equal(bounded.some((row) => row.sessionId === `s-${OUTCOME_LIMIT + 9}`), true);

  const staleIds = { repoId: 'repo', worktreeId: 'wt-stale' };
  await recordOutcome({
    projectDir: dir,
    ids: staleIds,
    now: Date.now() - OUTCOME_TTL_MS - 1000,
    outcome: { policy: 'completion', status: 'blocked', reason: 'old', sessionId: 'old' },
  });
  assert.deepEqual(await readOutcomes({ projectDir: dir, ids: staleIds }), []);
  await removeTree(dir);
});
