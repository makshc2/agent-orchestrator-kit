import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { scopeIds } from '../bin/hooks/adapters/shared.js';
import { bindSession } from '../bin/hooks/binding.js';
import { createStore } from '../bin/hooks/store.js';
import {
  completionIntentKey,
  evaluateCompletion,
  registerCompletionIntent,
  validateCompletion,
} from '../bin/hooks/workflow/completion.js';
import { readQueue } from '../bin/hooks/workflow/jobs.js';
import { readOutcomes, recordOutcome } from '../bin/hooks/workflow/outcomes.js';
import { changeStore } from '../bin/hooks/workflow/stores.js';

const execFileAsync = promisify(execFile);
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { env: GIT_ENV });
}

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-complete-'));
  await git(dir, ['init', '--quiet']);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.agents'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'demo-change'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.js'), 'base\n');
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), 'verifier:\n  test_command: node -e "process.exit(0)"\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [ ] 2.3 Verify genuine completion\n  Files: src/a.js\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'handoff.md'), 'same prose\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init', '--quiet']);
  return dir;
}

function endEvent(id, stopReason = 'completed') {
  return {
    eventId: id,
    kind: 'agent.end',
    source: { client: 'cursor' },
    scope: { sessionId: 'sess', agentId: null },
    data: { stopReason, files: [], origin: null },
  };
}

function ctx(dir, ids, store = null) {
  return {
    projectDir: dir,
    ids,
    store,
    capabilities: { events: { 'agent.end': { followup: true } } },
  };
}

test('completion uses the bound task and rejects a mismatch without writing intent', async () => {
  const dir = await makeProject();
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '2.3', session: 'sess' });
    await assert.rejects(
      () => registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'missing', task: '2.3' }),
      /exact session binding/,
    );
    await assert.rejects(
      () => registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess', task: '9.9' }),
      /bound task/,
    );
    const store = changeStore(dir, ids, 'demo-change');
    assert.equal(await store.read('completion-intent', completionIntentKey('sess', null, '2.3')), null);
    assert.equal(await store.read('completion-intent', completionIntentKey('missing', null, '2.3')), null);
    const recorded = await registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess' });
    assert.equal(recorded.taskId, '2.3');
    assert.equal(recorded.intentKey, completionIntentKey('sess', null, '2.3'));
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== 'ENOTEMPTY' || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  }
});

test('byte-identical handoff needs explicit confirmation and later outcomes stale the receipt', async () => {
  const dir = await makeProject();
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '2.3', session: 'sess' });
    const rejected = await registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess' });
    assert.equal(rejected.receipt, null);
    assert.equal(rejected.validation.reason, 'confirmation-required');
    const confirmed = await registerCompletionIntent({
      projectDir: dir, ids, change: 'demo-change', session: 'sess', confirmHandoff: true,
    });
    assert.equal(confirmed.accepted, true);
    assert.match(confirmed.receipt.confirmationId, /^cf-/);
    const reused = await registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess' });
    assert.equal(reused.accepted, true);
    assert.equal(reused.receipt.confirmationId, confirmed.receipt.confirmationId);
    await recordOutcome({
      projectDir: dir,
      ids,
      outcome: { policy: 'verification', status: 'full', reason: 'ok', changeId: 'demo-change', sessionId: 'sess', taskId: '2.3' },
    });
    const stale = await registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess' });
    assert.equal(stale.accepted, false);
    assert.equal(stale.validation.reason, 'stale-receipt');
    assert.equal(stale.receipt.confirmationId, confirmed.receipt.confirmationId);
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== 'ENOTEMPTY' || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  }
});

test('skip, narrow, and manual evidence stay unresolved and a late write is not completion', async () => {
  const dir = await makeProject();
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '2.3', session: 'sess' });
    const confirmed = await registerCompletionIntent({
      projectDir: dir, ids, change: 'demo-change', session: 'sess', confirmHandoff: true,
    });
    const store = changeStore(dir, ids, 'demo-change');
    await store.transact('verification-evidence', 'latest', () => ({ status: 'skipped-no-command', inputDigest: confirmed.receipt.inputDigest }));
    assert.equal((await validateCompletion({ projectDir: dir, ids, change: 'demo-change', session: 'sess' })).reason, 'skipped');
    await store.transact('verification-evidence', 'latest', () => ({ status: 'narrowed', inputDigest: confirmed.receipt.inputDigest }));
    assert.equal((await validateCompletion({ projectDir: dir, ids, change: 'demo-change', session: 'sess' })).reason, 'narrowed');
    await store.transact('verification-evidence', 'latest', () => ({ status: 'failed', reason: 'manual-failure', inputDigest: confirmed.receipt.inputDigest }));
    assert.equal((await validateCompletion({ projectDir: dir, ids, change: 'demo-change', session: 'sess' })).reason, 'manual-failure');
    await store.transact('verification-evidence', 'latest', () => ({ status: 'full', inputDigest: confirmed.receipt.inputDigest, scope: { mode: 'full' } }));
    const fresh = await validateCompletion({ projectDir: dir, ids, change: 'demo-change', session: 'sess', persist: true });
    assert.equal(fresh.status, 'current');
    assert.equal(fresh.launchesTurn, false);
    const saved = await readOutcomes({ projectDir: dir, ids, match: { policy: 'completion' } });
    assert.equal(saved[0].status, 'completed');
    assert.equal(saved[0].command, undefined);
    await writeFile(join(dir, 'src', 'a.js'), 'changed after complete\n');
    const drifted = await validateCompletion({
      projectDir: dir,
      ids,
      change: 'demo-change',
      session: 'sess',
      between: async () => writeFile(join(dir, 'src', 'a.js'), 'changed during validation\n'),
    });
    assert.equal(drifted.reason, 'drift');
    const pending = await evaluateCompletion(endEvent('end-late'), ctx(dir, ids));
    assert.equal(pending.status, 'pending');
    assert.equal(pending.pending, true);
    assert.notEqual(pending.status, 'completed');
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== 'ENOTEMPTY' || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  }
});

test('follow-up budget is one per epoch and two total, and stops do not continue', async () => {
  const dir = await makeProject();
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '2.3', session: 'sess' });
    await registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess', confirmHandoff: true });
    const base = ctx(dir, ids);
    const first = await evaluateCompletion(endEvent('end-1'), base);
    const second = await evaluateCompletion(endEvent('end-2'), base);
    assert.equal(first.decision.action, 'followup');
    assert.equal(first.status, 'pending');
    assert.equal(second.decision, null);
    assert.equal(second.released, true);
    await evaluateCompletion({
      eventId: 'worker-edit',
      kind: 'tool.after',
      source: { client: 'cursor' },
      scope: { sessionId: 'sess', agentId: null },
      data: { origin: 'worker', files: ['src/a.js'] },
    }, base);
    await registerCompletionIntent({ projectDir: dir, ids, change: 'demo-change', session: 'sess', confirmHandoff: true });
    const stillSpent = await evaluateCompletion(endEvent('end-3'), base);
    assert.equal(stillSpent.decision, null);
    await evaluateCompletion({
      eventId: 'user-edit',
      kind: 'tool.after',
      source: { client: 'cursor' },
      scope: { sessionId: 'sess', agentId: null },
      data: { origin: 'observed', files: ['src/a.js'] },
    }, base);
    const third = await evaluateCompletion(endEvent('end-4'), base);
    const fourth = await evaluateCompletion(endEvent('end-5'), base);
    assert.equal(third.decision.action, 'followup');
    assert.equal(fourth.decision, null);
    await evaluateCompletion({
      eventId: 'user-edit-2',
      kind: 'tool.after',
      source: { client: 'cursor' },
      scope: { sessionId: 'sess', agentId: null },
      data: { origin: 'observed', files: ['src/a.js'] },
    }, base);
    const fifth = await evaluateCompletion(endEvent('end-6'), base);
    assert.equal(fifth.decision, null);
    const queued = await readQueue({ projectDir: dir, ids });
    assert.ok(Object.values(queued.jobs).some((job) => job.kind === 'completion-validation' && job.commandId === 'end-1'));
    const cancelled = await evaluateCompletion(endEvent('end-cancel', 'cancelled'), base);
    assert.equal(cancelled.decision, null);
    const after = await readQueue({ projectDir: dir, ids });
    assert.ok(Object.values(after.jobs).every((job) => job.kind !== 'completion-validation' || job.status === 'cancelled'));
    const unknown = await evaluateCompletion(endEvent('end-unknown', 'unknown'), base);
    assert.equal(unknown.decision, null);
    assert.equal(unknown.pending, false);
    const quarantined = createStore({
      projectDir: dir,
      scope: { level: 'session', ...ids, changeId: null, sessionId: null, agentId: null, eventId: 'q1' },
      pruneIntervalMs: 10 ** 9,
    });
    const gap = await evaluateCompletion(endEvent('end-q'), { ...base, store: quarantined });
    assert.equal(gap.decision, null);
    assert.ok(gap.findings.some((finding) => finding.id === 'completion.identity.quarantined'));
    const unbound = await evaluateCompletion({
      ...endEvent('end-free'),
      scope: { sessionId: 'nobody', agentId: null },
    }, base);
    assert.ok(unbound.findings.some((finding) => finding.id === 'completion.identity.unbound'));
    assert.equal(unbound.decision, null);
    const claude = await evaluateCompletion(
      { ...endEvent('end-claude'), source: { client: 'claude' } },
      base,
    );
    assert.equal(claude.decision, null);
    assert.equal(claude.pending, true);
    assert.ok(claude.findings.some((finding) => finding.id === 'completion.manual.required'));
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== 'ENOTEMPTY' || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  }
});
