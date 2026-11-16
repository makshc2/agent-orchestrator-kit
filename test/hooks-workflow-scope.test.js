import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { approvalRevision } from '../bin/recovery-sources.js';
import { readHooksConfig, scopeIds } from '../bin/hooks/adapters/shared.js';
import * as amp from '../bin/hooks/adapters/amp.js';
import * as claude from '../bin/hooks/adapters/claude.js';
import * as cursor from '../bin/hooks/adapters/cursor.js';
import { TOKEN_TTL_MS, bindSession, resolveBinding } from '../bin/hooks/binding.js';
import { dispatch, builtinPolicies } from '../bin/hooks/index.js';
import { createStore } from '../bin/hooks/store.js';
import { readOutcomes } from '../bin/hooks/workflow/outcomes.js';

const execFileAsync = promisify(execFile);
const CLI = join(process.cwd(), 'bin', 'agent-orchestrator.js');
const CHANGE = 'demo-change';
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function fixture(name, entry) {
  const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'fixtures', 'hooks', name), 'utf8'));
  return data.fixtures.find((item) => item.name === entry);
}

function orchestrator(review = true) {
  return `pipeline:\n  require_spec_review: ${review}\nhooks:\n  enabled: true\n  mode: enforce\n  policies:\n    scope:\n      enabled: true\n      mode: enforce\n      options: {}\n`;
}

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { env: GIT_ENV });
}

async function makeTree(dir, { review = 'APPROVE', pipeline = true } = {}) {
  await git(dir, ['init', '--quiet']);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.agents'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', CHANGE, 'specs'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'other-change'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.js'), 'base\n');
  await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'proposal.md'), 'proposal\n');
  await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'design.md'), 'design\n');
  await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [ ] 2.1 Evidence\n  Files: src/a.js\n');
  await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'specs', 'scope.md'), 'spec\n');
  await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'decisions.md'), 'decision\n');
  await writeFile(join(dir, 'openspec', 'changes', 'other-change', 'tasks.md'), '- [ ] 1.1 Other\n  Files: src/a.js\n');
  await writeFile(join(dir, 'openspec', 'changes', 'other-change', 'handoff.md'), 'other\n');
  if (review) await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'review.md'), `# Review\n\nVerdict: ${review}\n`);
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), orchestrator(pipeline));
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'base', '--quiet']);
}

async function makeApproved() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-scope-'));
  await makeTree(dir);
  const ids = scopeIds(dir);
  return { dir, ids };
}

async function bind(dir, { role = 'implementer', session = 'sess-1', task = '2.1', agent = null } = {}) {
  return bindSession({ projectDir: dir, ids: scopeIds(dir), change: CHANGE, role, task, session, agent });
}

function stamp(event, ids, sessionId, agentId, role) {
  event.scope.repoId = ids.repoId;
  event.scope.worktreeId = ids.worktreeId;
  event.scope.sessionId = sessionId;
  event.scope.agentId = agentId;
  event.data.role = role;
  event.data.taskId = '2.1';
  return event;
}

function editEvent(client, dir, ids, rel, { sessionId = 'sess-1', agentId = null, role = 'implementer', kind = 'before' } = {}) {
  if (client === 'claude') {
    const payload = {
      ...fixture('claude.json', 'pre-tool-use-read').input,
      cwd: dir,
      session_id: sessionId,
      agent_id: agentId ?? undefined,
      hook_event_name: kind === 'after' ? 'PostToolUse' : 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(dir, rel) },
      tool_use_id: `toolu-${rel}-${kind}-${agentId ?? 'parent'}`,
    };
    return stamp(claude.normalize({ payload, projectDir: dir }), ids, sessionId, agentId, role);
  }
  if (client === 'cursor') {
    const payload = {
      ...fixture('cursor.json', 'before-read-file').input,
      cwd: dir,
      conversation_id: sessionId,
      cursor_version: '3.22.12',
      file_path: join(dir, rel),
      tool_name: 'Edit',
      tool_use_id: `cur-${rel}-${kind}`,
      hook_event_name: kind === 'after' ? 'postToolUse' : 'beforeReadFile',
    };
    const event = cursor.normalize({ payload, projectDir: dir });
    if (kind === 'after') event.kind = 'tool.after';
    return stamp(event, ids, sessionId, agentId, role);
  }
  const payload = {
    ...fixture('amp.json', 'tool-call-edit-file').input,
    thread: { id: sessionId },
    tool: 'edit_file',
    toolUseID: `amp-${rel}-${kind}-${agentId ?? 'parent'}`,
    input: { file_path: join(dir, rel) },
  };
  const event = amp.normalize({ payload, projectDir: dir, nativeEvent: kind === 'after' ? 'tool.result' : 'tool.call' });
  return stamp(event, ids, sessionId, agentId, role);
}

function caps(client, dir) {
  if (client === 'claude') return claude.capabilities();
  if (client === 'cursor') return cursor.capabilities({ cursor_version: '3.22.12', hook_event_name: 'beforeReadFile' });
  return amp.capabilities();
}

async function run(dir, ids, event, client) {
  const config = { ...readHooksConfig(dir), projectDir: dir };
  const store = createStore({
    projectDir: dir,
    scope: {
      level: 'session',
      ...ids,
      changeId: CHANGE,
      sessionId: event.scope.sessionId,
      agentId: event.scope.agentId,
      eventId: event.eventId,
    },
    pruneIntervalMs: 10 ** 9,
  });
  return dispatch(event, { policies: builtinPolicies, capabilities: caps(client), store, config });
}

test('approvalRevision stays current for checkbox edits and changes for planning edits', async () => {
  const { dir } = await makeApproved();
  try {
    const initial = approvalRevision(dir, CHANGE);
    assert.equal(initial.state, 'current');
    assert.match(initial.verdict, /^approve/i);
    assert.ok(initial.reviewSha);
    assert.ok(initial.files.includes('proposal.md'));
    assert.ok(initial.files.includes('design.md'));
    assert.ok(initial.files.includes('tasks.md'));
    assert.ok(initial.files.includes('specs/scope.md'));
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [x] 2.1 Evidence\n  Files: src/a.js\n');
    const checked = approvalRevision(dir, CHANGE);
    assert.equal(checked.digest, initial.digest);
    assert.equal(checked.state, 'current');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [ ] 2.1 Evidence\n  Files: src/a.js\n');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'proposal.md'), 'proposal changed\n');
    assert.notEqual(approvalRevision(dir, CHANGE).digest, initial.digest);
    assert.equal(approvalRevision(dir, CHANGE).state, 'stale');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'proposal.md'), 'proposal\n');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'design.md'), 'design changed\n');
    assert.notEqual(approvalRevision(dir, CHANGE).digest, initial.digest);
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'design.md'), 'design\n');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'specs', 'scope.md'), 'spec changed\n');
    assert.notEqual(approvalRevision(dir, CHANGE).digest, initial.digest);
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'specs', 'scope.md'), 'spec\n');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [ ] 2.1 Evidence edited\n  Files: src/a.js\n');
    assert.notEqual(approvalRevision(dir, CHANGE).digest, initial.digest);
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [ ] 2.1 Evidence\n  Files: src/a.js\n');
    assert.equal(approvalRevision(dir, CHANGE).digest, initial.digest);
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'design-brief.md'), 'brief\n');
    const added = approvalRevision(dir, CHANGE);
    assert.notEqual(added.digest, initial.digest);
    assert.equal(added.state, 'stale');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'design-brief.md'), 'brief changed\n');
    assert.notEqual(approvalRevision(dir, CHANGE).digest, added.digest);
    await rm(join(dir, 'openspec', 'changes', CHANGE, 'design-brief.md'));
    assert.equal(approvalRevision(dir, CHANGE).digest, initial.digest);
    assert.equal(approvalRevision(dir, CHANGE).state, 'current');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('binding stores current approval and a child does not copy a stale parent snapshot', async () => {
  assert.ok(TOKEN_TTL_MS <= 60 * 60 * 1000);
  const { dir, ids } = await makeApproved();
  try {
    const parent = await bind(dir);
    assert.equal(parent.binding.via, 'explicit');
    assert.equal(parent.binding.approval.digest, approvalRevision(dir, CHANGE).digest);
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'proposal.md'), 'drift\n');
    const { linkChild } = await import('../bin/hooks/binding.js');
    const child = await linkChild({ projectDir: dir, ids, token: parent.token, session: 'sess-1', agent: 'child-1', role: 'implementer' });
    assert.equal(child.ok, true);
    assert.equal(child.binding.via, 'token');
    assert.equal(child.binding.approval, null);
    assert.notEqual(parent.binding.approval, null);
    const storedParent = await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1' });
    assert.equal(storedParent.approval.digest, parent.binding.approval.digest);
    assert.equal((await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1', agentId: 'child-1' })).approval, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unapproved, missing, dirty, rejected and recommitted reviews do not stay authorized', async () => {
  const rejected = await mkdtemp(join(tmpdir(), 'aok-scope-'));
  await makeTree(rejected, { review: 'REQUEST CHANGES' });
  const rejectedBind = await bind(rejected);
  assert.equal(rejectedBind.binding.approval, null);
  const ids = scopeIds(rejected);
  const denied = await run(rejected, ids, editEvent('claude', rejected, ids, 'src/a.js'), 'claude');
  assert.equal(denied.decision.action, 'deny');
  await rm(rejected, { recursive: true, force: true });

  const missing = await mkdtemp(join(tmpdir(), 'aok-scope-'));
  await makeTree(missing, { review: null });
  const missingBind = await bind(missing);
  assert.equal(missingBind.binding.approval, null);
  const missingIds = scopeIds(missing);
  assert.equal((await run(missing, missingIds, editEvent('claude', missing, missingIds, 'src/a.js'), 'claude')).decision.action, 'deny');
  await rm(missing, { recursive: true, force: true });

  const { dir, ids: liveIds } = await makeApproved();
  try {
    await bind(dir);
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'review.md'), '# Review\n\nVerdict: APPROVE\n\ndirty\n');
    assert.equal(approvalRevision(dir, CHANGE).state, 'unknown');
    assert.equal((await run(dir, liveIds, editEvent('claude', dir, liveIds, 'src/a.js'), 'claude')).decision.action, 'deny');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'review.md'), '# Review\n\nVerdict: APPROVE\n');
    assert.equal((await run(dir, liveIds, editEvent('claude', dir, liveIds, 'src/a.js', { sessionId: 'sess-1' }), 'claude')).decision.action, 'allow');
    await rm(join(dir, 'openspec', 'changes', CHANGE, 'review.md'));
    assert.equal(approvalRevision(dir, CHANGE).state, 'unknown');
    assert.equal((await run(dir, liveIds, editEvent('claude', dir, liveIds, 'src/a.js'), 'claude')).decision.action, 'deny');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'review.md'), '# Review\n\nVerdict: REQUEST CHANGES\n');
    await git(dir, ['add', 'openspec/changes/demo-change/review.md']);
    await git(dir, ['commit', '-m', 'reject', '--quiet']);
    assert.equal(approvalRevision(dir, CHANGE).state, 'rejected');
    assert.equal((await run(dir, liveIds, editEvent('claude', dir, liveIds, 'src/a.js'), 'claude')).decision.action, 'deny');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'review.md'), '# Review\n\nVerdict: APPROVE\n\nagain\n');
    await git(dir, ['add', 'openspec/changes/demo-change/review.md']);
    await git(dir, ['commit', '-m', 'reapprove', '--quiet']);
    assert.equal(approvalRevision(dir, CHANGE).state, 'current');
    assert.notEqual(approvalRevision(dir, CHANGE).reviewSha, (await resolveBinding({ projectDir: dir, ids: liveIds, sessionId: 'sess-1' })).approval.reviewSha);
    assert.equal((await run(dir, liveIds, editEvent('claude', dir, liveIds, 'src/a.js'), 'claude')).decision.action, 'deny');
    await bind(dir);
    assert.equal((await run(dir, liveIds, editEvent('claude', dir, liveIds, 'src/a.js'), 'claude')).decision.action, 'allow');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('enforced scope allows implementer progress and denies children, other artifacts and escapes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aok-scope-'));
  await makeTree(dir);
  const ids = scopeIds(dir);
  try {
    const parent = JSON.parse((await execFileAsync('node', [
      CLI, 'hooks', 'bind', '--change', CHANGE, '--role', 'implementer', '--task', '2.1', '--session', 'sess-1', '--json',
    ], { cwd: dir })).stdout);
    assert.equal(parent.binding.role, 'implementer');
    assert.equal(parent.binding.via, 'explicit');
    const child = JSON.parse((await execFileAsync('node', [
      CLI, 'hooks', 'bind', '--token', parent.token, '--session', 'sess-1', '--agent', 'child-1', '--role', 'implementer', '--json',
    ], { cwd: dir })).stdout);
    assert.equal(child.binding.via, 'token');
    await bind(dir, { role: 'test-writer', session: 'sess-writer' });
    await bind(dir, { role: 'conductor', session: 'sess-conductor' });
    await bind(dir, { role: 'implementation', session: 'sess-implementation' });
    const outside = join(tmpdir(), `aok-outside-${Date.now()}`);
    await writeFile(outside, 'nope\n');
    await symlink(outside, join(dir, 'openspec', 'changes', CHANGE, 'handoff.md'));

    for (const client of ['claude', 'cursor', 'amp']) {
      assert.equal(caps(client).events['tool.before'].deny, true);
      const file = await run(dir, ids, editEvent(client, dir, ids, 'src/a.js'), client);
      assert.equal(file.decision?.action, 'allow', client);
      const tasks = editEvent(client, dir, ids, `openspec/changes/${CHANGE}/tasks.md`, { kind: 'before' });
      const current = await readFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), 'utf8');
      tasks.data.tool.contents = current.replace('- [ ]', '- [x]');
      assert.equal((await run(dir, ids, tasks, client)).decision?.action, 'allow', client);
      const contract = editEvent(client, dir, ids, `openspec/changes/${CHANGE}/tasks.md`);
      contract.data.tool.contents = current.replace('Evidence', 'Evidence edited');
      assert.equal((await run(dir, ids, contract, client)).decision?.action, 'deny', client);
    }

    await rm(join(dir, 'openspec', 'changes', CHANGE, 'handoff.md'));
    for (const client of ['claude', 'cursor', 'amp']) {
      assert.equal((await run(dir, ids, editEvent(client, dir, ids, `openspec/changes/${CHANGE}/handoff.md`), client)).decision?.action, 'allow', client);
      for (const rel of [
        `openspec/changes/${CHANGE}/tasks.md`,
        `openspec/changes/${CHANGE}/handoff.md`,
      ]) {
        const childEdit = await run(dir, ids, editEvent(client, dir, ids, rel, { agentId: 'child-1' }), client);
        assert.equal(childEdit.decision?.action, 'deny', `${client} ${rel}`);
      }
      for (const rel of [
        'openspec/changes/other-change/tasks.md',
        'openspec/changes/other-change/handoff.md',
        `openspec/changes/${CHANGE}/proposal.md`,
        `openspec/changes/${CHANGE}/design.md`,
        `openspec/changes/${CHANGE}/specs/scope.md`,
        `openspec/changes/${CHANGE}/review.md`,
        `openspec/changes/${CHANGE}/decisions.md`,
      ]) {
        assert.equal((await run(dir, ids, editEvent(client, dir, ids, rel), client)).decision?.action, 'deny', `${client} ${rel}`);
      }
    }
    await symlink(outside, join(dir, 'openspec', 'changes', CHANGE, 'handoff.md'));
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/handoff.md`), 'claude')).decision.action, 'deny');
    assert.equal((await run(dir, ids, editEvent('cursor', dir, ids, `openspec/changes/${CHANGE}/handoff.md`), 'cursor')).decision.action, 'deny');
    assert.equal((await run(dir, ids, editEvent('amp', dir, ids, `openspec/changes/${CHANGE}/handoff.md`), 'amp')).decision.action, 'deny');
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/tasks.md`, { sessionId: 'sess-writer', role: 'test-writer' }), 'claude')).decision.action, 'deny');
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/handoff.md`, { sessionId: 'sess-conductor', role: 'conductor' }), 'claude')).decision.action, 'deny');
    await rm(join(dir, 'openspec', 'changes', CHANGE, 'handoff.md'));
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/handoff.md`, { sessionId: 'sess-conductor', role: 'conductor' }), 'claude')).decision.action, 'allow');
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/tasks.md`, { sessionId: 'sess-implementation', role: 'implementation' }), 'claude')).decision.action, 'allow');
    const first = await run(dir, ids, editEvent('claude', dir, ids, 'src/a.js'), 'claude');
    const second = await run(dir, ids, editEvent('amp', dir, ids, 'src/a.js'), 'amp');
    assert.equal(first.decision.action, 'allow');
    assert.equal(second.decision.action, 'allow');

    const bash = claude.normalize({
      payload: { ...fixture('claude.json', 'pre-tool-use-bash-unknown-writes').input, cwd: dir, session_id: 'sess-1' },
      projectDir: dir,
    });
    stamp(bash, ids, 'sess-1', null, 'implementer');
    const shell = await run(dir, ids, bash, 'claude');
    assert.notEqual(shell.decision?.action, 'allow');
    assert.ok(shell.findings.some((item) => item.code === 'scope.coverage.unknown'));
    const observedConfig = { ...readHooksConfig(dir), projectDir: dir };
    observedConfig.hooks = { ...observedConfig.hooks, mode: 'observe' };
    const store = createStore({
      projectDir: dir,
      scope: { level: 'session', ...ids, changeId: CHANGE, sessionId: 'sess-1', agentId: null, eventId: 'observe' },
      pruneIntervalMs: 10 ** 9,
    });
    const observed = await dispatch(editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/proposal.md`), {
      policies: builtinPolicies,
      capabilities: claude.capabilities(),
      store,
      config: observedConfig,
    });
    assert.equal(observed.decision, null);
    assert.ok(observed.findings.some((item) => item.code === 'policy.decision.downgraded'));
    const outcomes = await readOutcomes({ projectDir: dir, ids });
    assert.ok(outcomes.some((entry) => entry.policy === 'scope' && entry.reason === 'outside-files'));
    assert.ok(outcomes.some((entry) => entry.policy === 'scope' && entry.reason === 'coverage-gap'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tool.after records a task-contract violation and the next edit is stale', async () => {
  const { dir, ids } = await makeApproved();
  try {
    await bind(dir);
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [x] 2.1 Evidence\n  Files: src/a.js\n');
    const progress = editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/tasks.md`, { kind: 'after' });
    assert.equal((await run(dir, ids, progress, 'claude')).decision, null);
    assert.equal((await readOutcomes({ projectDir: dir, ids })).some((entry) => entry.reason === 'task-contract'), false);
    assert.equal(approvalRevision(dir, CHANGE).digest, (await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1' })).approval.digest);
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, 'src/a.js'), 'claude')).decision.action, 'allow');
    await writeFile(join(dir, 'openspec', 'changes', CHANGE, 'tasks.md'), '- [x] 2.1 Evidence edited\n  Files: src/a.js\n');
    const violated = editEvent('claude', dir, ids, `openspec/changes/${CHANGE}/tasks.md`, { kind: 'after' });
    await run(dir, ids, violated, 'claude');
    assert.ok((await readOutcomes({ projectDir: dir, ids })).some((entry) => entry.policy === 'scope' && entry.status === 'violation' && entry.reason === 'task-contract'));
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, 'src/a.js'), 'claude')).decision.action, 'deny');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('review-disabled profile still checks paths and does not invent shell compliance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aok-scope-'));
  await makeTree(dir, { review: null, pipeline: false });
  const ids = scopeIds(dir);
  try {
    const bound = await bind(dir);
    assert.equal(bound.binding.approval, null);
    assert.equal((await run(dir, ids, editEvent('claude', dir, ids, 'src/a.js'), 'claude')).decision.action, 'allow');
    assert.equal((await run(dir, ids, editEvent('cursor', dir, ids, `openspec/changes/${CHANGE}/proposal.md`), 'cursor')).decision.action, 'deny');
    assert.equal((await run(dir, ids, editEvent('amp', dir, ids, `openspec/changes/${CHANGE}/tasks.md`), 'amp')).decision.action, 'allow');
    const bash = amp.normalize({
      payload: { ...fixture('amp.json', 'tool-call-shell-unknown-writes').input, thread: { id: 'sess-1' } },
      projectDir: dir,
      nativeEvent: 'tool.call',
    });
    stamp(bash, ids, 'sess-1', null, 'implementer');
    const shell = await run(dir, ids, bash, 'amp');
    assert.notEqual(shell.decision?.action, 'allow');
    assert.equal(shell.decision?.action ?? null, null);
    assert.ok(shell.findings.some((item) => item.code === 'scope.coverage.unknown'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
