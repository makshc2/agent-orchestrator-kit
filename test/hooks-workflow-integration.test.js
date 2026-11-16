import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { readHooksConfig, scopeIds } from '../bin/hooks/adapters/shared.js';
import { capabilities as ampCapabilities, downgradedCapabilities as ampDown, normalize as normalizeAmp } from '../bin/hooks/adapters/amp.js';
import { capabilities as claudeCapabilities, downgradedCapabilities as claudeDown, normalize as normalizeClaude } from '../bin/hooks/adapters/claude.js';
import { capabilities as cursorCapabilities, downgradedCapabilities as cursorDown, normalize as normalizeCursor } from '../bin/hooks/adapters/cursor.js';
import { bindSession, linkChild, resolveBinding } from '../bin/hooks/binding.js';
import { builtinPolicies, dispatch } from '../bin/hooks/index.js';
import { registerCompletionIntent, validateCompletion } from '../bin/hooks/workflow/completion.js';
import { acquireLease, readQueue, releaseLease } from '../bin/hooks/workflow/jobs.js';
import { readOutcomes } from '../bin/hooks/workflow/outcomes.js';
import { changeStore } from '../bin/hooks/workflow/stores.js';
import { ownedSync } from '../bin/hooks/workflow/owned-sync.js';
import { setWorkerLauncher } from '../bin/hooks/workflow/worker.js';

const execFileAsync = promisify(execFile);
const PROFILES = ['generic', 'mvp', 'node', 'vue3'];
const HOSTS = {
  claude: { version: 'command-hook', capabilities: claudeCapabilities(), downgraded: claudeDown(claudeCapabilities()) },
  cursor: { version: '3.22.12', capabilities: cursorCapabilities({ cursor_version: '3.22.12' }), downgraded: cursorDown(cursorCapabilities({ cursor_version: '3.22.12' })) },
  amp: { version: 'plugin-api', capabilities: ampCapabilities(), downgraded: ampDown(ampCapabilities()) },
};

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
}

function enforce(profileText) {
  return profileText
    .replace('hooks:\n  enabled: false\n  mode: observe', 'hooks:\n  enabled: true\n  mode: enforce')
    .replaceAll('enabled: false\n      mode: observe', 'enabled: true\n      mode: enforce');
}

async function makeProject(profile, { enforced = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-int-'));
  await git(dir, ['init', '--quiet']);
  const profileText = await readFile(join(process.cwd(), 'profiles', profile, 'orchestrator.yaml'), 'utf8');
  await mkdir(join(dir, '.agents', 'rules'), { recursive: true });
  await mkdir(join(dir, '.cursor'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'demo-change', 'specs'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'other-change'), { recursive: true });
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), enforced ? enforce(profileText) : profileText);
  await writeFile(join(dir, '.agents', 'rules', 'demo.mdc'), 'rule\n');
  await writeFile(join(dir, 'src', 'a.js'), 'base\n');
  await writeFile(join(dir, 'probe.cjs'), 'process.exit(0);\n');
  const tasks = '- [ ] 5.2 Integration\n  Files: src/a.js\n';
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), tasks);
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'proposal.md'), 'proposal\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'design.md'), 'design\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'specs', 'scope.md'), 'spec\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'review.md'), '# Review\n\nVerdict: APPROVE\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'handoff.md'), 'same prose\n');
  await writeFile(join(dir, 'openspec', 'changes', 'other-change', 'tasks.md'), tasks);
  await writeFile(join(dir, '.cursor', 'hooks.json'), '{"foreign":true}\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init', '--quiet']);
  return dir;
}

function toolEvent(dir, ids, sessionId, file, contents) {
  const event = normalizeClaude({
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      tool_name: 'Edit',
      tool_use_id: 'tu-1',
      cwd: dir,
      tool_input: { file_path: join(dir, file) },
    },
    projectDir: dir,
    nativeEvent: 'PreToolUse',
  });
  event.scope = { ...event.scope, ...ids, sessionId, agentId: event.scope.agentId ?? null };
  event.data.files = [file];
  event.data.tool = { ...(event.data.tool ?? {}), name: 'Edit', operation: 'write', contents };
  return event;
}

test('shipped adapters keep their platform gaps and cannot authorize themselves', () => {
  assert.equal(HOSTS.claude.capabilities.events['file.changed'].supported, false);
  assert.equal(HOSTS.claude.capabilities.events['agent.end'].followup, false);
  assert.equal(HOSTS.cursor.capabilities.events['session.resume'].supported, false);
  assert.equal(HOSTS.cursor.capabilities.events['context.reset'].supported, false);
  assert.equal(HOSTS.amp.capabilities.events['context.compacting'].supported, false);
  assert.equal(HOSTS.amp.capabilities.events['file.changed'].supported, false);
  for (const [name, host] of Object.entries(HOSTS)) {
    assert.equal(host.downgraded.events['tool.before'].deny, false, `${name} ${host.version} unverified payload is not a production authorization`);
    assert.equal(host.capabilities.events['tool.before'].deny, true, `${name} ${host.version} verified tool.before can deny`);
  }
  const cursorStop = normalizeCursor({
    payload: { conversation_id: 'conv', hook_event_name: 'stop', cursor_version: '3.22.12', status: 'completed' },
    projectDir: process.cwd(),
    nativeEvent: 'stop',
  });
  const ampEnd = normalizeAmp({
    payload: { thread: { id: 'thread-1' }, status: 'cancelled' },
    projectDir: process.cwd(),
    nativeEvent: 'agent.end',
  });
  assert.equal(cursorStop.kind, 'agent.end');
  assert.equal(ampEnd.kind, 'agent.end');
  assert.equal(ampEnd.data.stopReason, 'user_cancelled');
});

test('profiles isolate sessions and enforced scope allows only the bound parent progress edit', async () => {
  setWorkerLauncher(() => ({ pid: 0 }));
  for (const profile of PROFILES) {
    const quiet = await makeProject(profile);
    try {
      const ids = scopeIds(quiet);
      const config = { ...readHooksConfig(quiet), projectDir: quiet };
      const result = await dispatch(toolEvent(quiet, ids, 'sess', 'src/a.js', 'changed\n'), {
        policies: builtinPolicies,
        config,
        capabilities: HOSTS.claude.capabilities,
      });
      assert.equal(result.decision, null, profile);
      assert.equal((await readOutcomes({ projectDir: quiet, ids })).length, 0, profile);
    } finally {
      await rm(quiet, { recursive: true, force: true });
    }

    const dir = await makeProject(profile, { enforced: true });
    try {
      const ids = scopeIds(dir);
      const config = { ...readHooksConfig(dir), projectDir: dir };
      await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '5.2', session: 'parent' });
      await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '5.2', session: 'second' });
      assert.equal((await resolveBinding({ projectDir: dir, ids, sessionId: 'parent' })).sessionId, 'parent');
      assert.equal((await resolveBinding({ projectDir: dir, ids, sessionId: 'second' })).sessionId, 'second');
      const parent = await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '5.2', session: 'sess' });
      const child = await linkChild({ projectDir: dir, ids, token: parent.token, session: 'child', agent: 'child-1', role: 'test-writer' });
      assert.equal(child.ok, true);
      const checked = '- [x] 5.2 Integration\n  Files: src/a.js\n';
      for (const [name, host] of Object.entries(HOSTS)) {
        if (host.capabilities.events['tool.before'].deny !== true) continue;
        const allowed = await dispatch(toolEvent(dir, ids, 'sess', 'openspec/changes/demo-change/tasks.md', checked), {
          policies: builtinPolicies,
          config,
          capabilities: host.capabilities,
        });
        assert.equal(allowed.decision?.action, 'allow', `${profile} ${name} ${host.version}`);
        const childEvent = toolEvent(dir, ids, 'child', 'openspec/changes/demo-change/tasks.md', checked);
        childEvent.scope.agentId = 'child-1';
        const deniedChild = await dispatch(childEvent, { policies: builtinPolicies, config, capabilities: host.capabilities });
        assert.equal(deniedChild.decision?.action, 'deny', `${profile} ${name} child`);
        const crossed = await dispatch(toolEvent(dir, ids, 'sess', 'openspec/changes/other-change/tasks.md', checked), {
          policies: builtinPolicies,
          config,
          capabilities: host.capabilities,
        });
        assert.equal(crossed.decision?.action, 'deny', `${profile} ${name} cross-change`);
      }
      const store = changeStore(dir, ids, 'demo-change');
      await store.transact('verification-evidence', 'latest', () => ({ status: 'full', reusable: true }));
      await dispatch({
        schemaVersion: 1,
        kind: 'tool.after',
        eventId: `edit-${profile}`,
        occurredAt: new Date().toISOString(),
        scope: { ...ids, sessionId: 'sess', agentId: null, changeId: null },
        contextEpoch: null,
        source: { client: 'cursor', clientVersion: null, runtime: 'test', nativeEvent: {} },
        data: { role: null, taskId: null, files: ['src/a.js'], tool: { name: 'Edit', operation: 'write' }, outcome: null, stopReason: null, origin: 'observed' },
      }, { policies: builtinPolicies, config, capabilities: HOSTS.cursor.capabilities });
      assert.equal((await store.read('verification-evidence', 'latest')).status, 'stale');
      assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);
      const observed = { ...config, hooks: { ...config.hooks, mode: 'observe' } };
      const observe = await dispatch(toolEvent(dir, ids, 'nobody', 'src/a.js', 'x\n'), {
        policies: builtinPolicies,
        config: observed,
        capabilities: HOSTS.claude.capabilities,
      });
      assert.equal(observe.decision, null);
      const held = await acquireLease({ projectDir: dir, ids });
      const before = (await readQueue({ projectDir: dir, ids })).jobs;
      await releaseLease({ projectDir: dir, ids, ownerToken: held.ownerToken });
      assert.ok(before);
      const foreign = await readFile(join(dir, '.cursor', 'hooks.json'), 'utf8');
      await ownedSync({ projectDir: dir, ids, target: 'cursor' });
      assert.equal(await readFile(join(dir, '.cursor', 'hooks.json'), 'utf8'), foreign);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('completion stays pending across cancel, drift, and a second worktree', async () => {
  setWorkerLauncher(() => ({ pid: 0 }));
  const dir = await makeProject('generic', { enforced: true });
  const other = await makeProject('generic', { enforced: true });
  try {
    const ids = scopeIds(dir);
    const otherIds = scopeIds(other);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '5.2', session: 'sess' });
    await bindSession({ projectDir: other, ids: otherIds, change: 'demo-change', role: 'implementer', task: '5.2', session: 'sess' });
    const config = { ...readHooksConfig(dir), projectDir: dir };
    const rejected = await registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess' });
    assert.equal(rejected.receipt, null);
    const confirmed = await registerCompletionIntent({
      projectDir: dir, ids, change: 'demo-change', session: 'sess', confirmHandoff: true,
    });
    assert.ok(confirmed.receipt.confirmationId);
    await writeFile(join(dir, 'src', 'a.js'), 'late\n');
    const drifted = await validateCompletion({ projectDir: dir, ids, change: 'demo-change', session: 'sess' });
    assert.equal(drifted.reason, 'drift');
    const cancelled = await dispatch({
      schemaVersion: 1,
      kind: 'agent.end',
      eventId: 'cancel-1',
      occurredAt: new Date().toISOString(),
      scope: { ...ids, sessionId: 'sess', agentId: null, changeId: null },
      contextEpoch: null,
      source: { client: 'amp', clientVersion: null, runtime: 'test', nativeEvent: {} },
      data: { role: null, taskId: null, files: [], tool: null, outcome: null, stopReason: 'user_cancelled', origin: 'observed' },
    }, { policies: builtinPolicies, config, capabilities: HOSTS.amp.capabilities });
    assert.equal(cancelled.decision, null);
    assert.equal((await resolveBinding({ projectDir: other, ids: otherIds, sessionId: 'sess' })).changeId, 'demo-change');
    const nullSession = await dispatch({
      schemaVersion: 1,
      kind: 'tool.before',
      eventId: 'null-session',
      occurredAt: new Date().toISOString(),
      scope: { ...ids, sessionId: null, agentId: null, changeId: null },
      contextEpoch: null,
      source: { client: 'claude', clientVersion: null, runtime: 'test', nativeEvent: {} },
      data: { role: null, taskId: null, files: [], tool: { name: 'Bash', operation: 'shell' }, outcome: null, stopReason: null },
    }, { policies: builtinPolicies, config, capabilities: HOSTS.claude.capabilities });
    assert.equal(nullSession.decision, null);
    assert.ok(nullSession.findings.some((finding) => finding.code === 'scope.coverage.unknown'));
    assert.equal((await resolveBinding({ projectDir: dir, ids, sessionId: 'sess' })).task, '5.2');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});
