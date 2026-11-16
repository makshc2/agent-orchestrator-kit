import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { readHooksConfig, scopeIds } from '../bin/hooks/adapters/shared.js';
import { bindSession } from '../bin/hooks/binding.js';
import { builtinPolicies, dispatch } from '../bin/hooks/index.js';
import { workflowPolicies } from '../bin/hooks/policies/workflow.js';
import { registerCompletionIntent } from '../bin/hooks/workflow/completion.js';
import { readQueue } from '../bin/hooks/workflow/jobs.js';
import { readOutcomes } from '../bin/hooks/workflow/outcomes.js';
import { changeStore } from '../bin/hooks/workflow/stores.js';
import { setWorkerLauncher } from '../bin/hooks/workflow/worker.js';

const execFileAsync = promisify(execFile);

function evaluateLimit() {
  const load = Number(readFileSync('/proc/loadavg', 'utf8').split(/\s+/)[0]);
  return load < availableParallelism() * 0.5 ? 200 : 1000;
}

function policy(id, enabled, mode = 'enforce') {
  return `    ${id}:\n      enabled: ${enabled}\n      mode: ${mode}\n      options: {}\n`;
}

function yaml({ verification = true, completion = true } = {}) {
  return `hooks:\n  enabled: true\n  mode: enforce\n  policies:\n${policy('verification', verification)}${policy('completion', completion)}${policy('scope', false, 'observe')}${policy('checks', false, 'observe')}${policy('owned-sync', false, 'observe')}${policy('workflow-notifications', false, 'observe')}verifier:\n  test_command: "node -e \\"require('node:fs').writeFileSync('suite-ran.txt','1')\\""\n`;
}

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
}

async function makeProject(text) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-wire-'));
  await git(dir, ['init', '--quiet']);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.agents'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'demo-change'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.js'), 'base\n');
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), text);
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [ ] 2.4 Wire policies\n  Files: src/a.js\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'handoff.md'), 'same prose\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init', '--quiet']);
  return dir;
}

function baseEvent(kind, extra = {}) {
  return {
    schemaVersion: 1,
    kind,
    eventId: extra.eventId ?? kind,
    occurredAt: new Date().toISOString(),
    scope: { repoId: null, worktreeId: null, changeId: null, sessionId: 'sess', agentId: null },
    contextEpoch: null,
    source: { client: extra.client ?? 'cursor', clientVersion: null, runtime: 'test', nativeEvent: {} },
    data: {
      role: null,
      taskId: null,
      files: extra.files ?? [],
      tool: null,
      outcome: null,
      stopReason: extra.stopReason ?? null,
      origin: extra.origin ?? 'observed',
    },
  };
}

test('verification and completion policies stay inline-free and pending', async () => {
  setWorkerLauncher(() => ({ pid: 0 }));
  const dir = await makeProject(yaml());
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '2.4', session: 'sess' });
    await registerCompletionIntent({
      projectDir: dir, ids, change: 'demo-change', session: 'sess', confirmHandoff: true,
    });
    const store = changeStore(dir, ids, 'demo-change');
    await store.transact('verification-evidence', 'latest', () => ({ status: 'full', reusable: true }));
    const { completionIntentKey } = await import('../bin/hooks/workflow/completion.js');
    const key = completionIntentKey('sess', null, '2.4');
    const config = { ...readHooksConfig(dir), projectDir: dir };
    const caps = { events: { 'agent.end': { followup: true }, 'session.end': { followup: true }, 'tool.after': { deny: true } } };
    const ctx = { config, capabilities: caps, ids };
    const verification = workflowPolicies.find((policy) => policy.id === 'verification');
    const completion = workflowPolicies.find((policy) => policy.id === 'completion');
    const writeEvent = baseEvent('tool.after', { eventId: 'edit-1', files: ['src/a.js'], scope: ids });
    const started = Date.now();
    await verification.evaluate(writeEvent, ctx);
    const writeMs = Date.now() - started;
    assert.ok(writeMs < evaluateLimit(), `verification evaluate took ${writeMs}ms`);
    const write = await dispatch(writeEvent, {
      policies: builtinPolicies,
      config,
      capabilities: caps,
    });
    assert.ok(write.findings.some((finding) => finding.code === 'verification.evidence.stale'));
    assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);
    const jobs = Object.values((await readQueue({ projectDir: dir, ids })).jobs ?? {});
    assert.equal(jobs.some((job) => job.kind === 'verification'), false);
    const evidence = await store.read('verification-evidence', 'latest');
    assert.equal(evidence.status, 'stale');
    assert.equal(evidence.reusable, false);

    assert.ok(await store.read('completion-intent', key));
    await store.transact('completion-state', key, (prior) => ({ ...prior, validation: { status: 'current', reason: '' } }));
    const warmed = await completion.evaluate(baseEvent('agent.end', { eventId: 'end-warm', stopReason: 'completed', scope: ids }), ctx);
    assert.equal(warmed.decision?.action, 'followup');
    const endEvent = baseEvent('agent.end', { eventId: 'end-1', stopReason: 'completed', scope: ids });
    const endStarted = Date.now();
    const directEnd = await completion.evaluate(endEvent, ctx);
    const endMs = Date.now() - endStarted;
    assert.ok(endMs < evaluateLimit(), `completion evaluate took ${endMs}ms`);
    assert.equal(directEnd.decision, null);
    const end = await dispatch(baseEvent('agent.end', { eventId: 'end-2', stopReason: 'completed', scope: ids }), {
      policies: builtinPolicies,
      config,
      capabilities: caps,
    });
    assert.notEqual(end.decision?.action, 'allow');
    const outcomes = await readOutcomes({ projectDir: dir, ids, match: { policy: 'completion' } });
    assert.ok(outcomes.some((entry) => entry.status === 'pending'));
    assert.equal(outcomes.some((entry) => entry.status === 'completed'), false);
    const queued = Object.values((await readQueue({ projectDir: dir, ids })).jobs);
    assert.ok(queued.some((job) => job.kind === 'completion-validation'));
    assert.equal(queued.some((job) => job.kind === 'verification'), false);

    const manual = await dispatch(baseEvent('agent.end', { eventId: 'end-claude', stopReason: 'completed', client: 'claude', scope: ids }), {
      policies: builtinPolicies,
      config,
      capabilities: { events: { 'agent.end': { followup: false } } },
    });
    assert.equal(manual.decision, null);
    assert.ok(manual.findings.some((finding) => finding.code === 'completion.manual.required'));

    const disabledConfig = { ...readHooksConfig(await rewrite(dir)), projectDir: dir };
    const before = (await readOutcomes({ projectDir: dir, ids })).length;
    const disabledEvent = baseEvent('tool.after', { eventId: 'edit-2', files: ['src/a.js'], scope: ids });
    const disabledStarted = Date.now();
    await verification.evaluate(disabledEvent, { config: disabledConfig, capabilities: caps, ids });
    assert.ok(Date.now() - disabledStarted < evaluateLimit());
    const disabled = await dispatch(disabledEvent, {
      policies: builtinPolicies,
      config: disabledConfig,
      capabilities: caps,
    });
    assert.equal(disabled.findings.some((finding) => finding.code === 'verification.evidence.stale'), false);
    assert.equal((await readOutcomes({ projectDir: dir, ids })).length, before);
    assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function rewrite(dir) {
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), yaml({ verification: false, completion: false }));
  return dir;
}
