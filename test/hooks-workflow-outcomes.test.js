import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { readHooksConfig, scopeIds } from '../bin/hooks/adapters/shared.js';
import { normalize as normalizeCursor } from '../bin/hooks/adapters/cursor.js';
import { bindSession } from '../bin/hooks/binding.js';
import { builtinPolicies, dispatch } from '../bin/hooks/index.js';
import { createStore } from '../bin/hooks/store.js';
import { enqueueJob, readQueue } from '../bin/hooks/workflow/jobs.js';
import { drainOutcomes, noticeRecord } from '../bin/hooks/workflow/notifications.js';
import { readOutcomes, recordOutcome } from '../bin/hooks/workflow/outcomes.js';
import { ensureWorker, runWorker, setWorkerLauncher } from '../bin/hooks/workflow/worker.js';

const execFileAsync = promisify(execFile);
const launches = [];

function yaml(enabled = true) {
  const command = JSON.stringify({
    commands: [{ id: 'fail', executable: 'node', args: ['-e', 'process.exit(1)'], globs: ['src/*.js'], writablePaths: [] }],
    debounceMs: 0,
    timeoutMs: 30000,
  });
  return `hooks:\n  enabled: ${enabled}\n  mode: enforce\n  policies:\n    scope:\n      enabled: true\n      mode: enforce\n      options: {}\n    checks:\n      enabled: true\n      mode: enforce\n      options: ${command}\n    owned-sync:\n      enabled: true\n      mode: enforce\n      options: {"target":"all","debounceMs":0,"timeoutMs":30000}\n    workflow-notifications:\n      enabled: ${enabled}\n      mode: enforce\n      options: {"dedupMs":60000}\n    verification:\n      enabled: false\n      mode: observe\n      options: {}\n    completion:\n      enabled: false\n      mode: observe\n      options: {}\n`;
}

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
}

function withScope(event, ids, sessionId) {
  event.scope = { ...event.scope, ...ids, sessionId, agentId: null, changeId: null };
  return event;
}

test('notices follow scope denials, worker results, and owned sync without cross-talk', async () => {
  setWorkerLauncher((spec) => {
    launches.push(spec);
    return { pid: 0 };
  });
  const dir = await mkdtemp(join(tmpdir(), 'aok-outcome-'));
  try {
    await git(dir, ['init', '--quiet']);
    await mkdir(join(dir, 'src'), { recursive: true });
    await mkdir(join(dir, '.agents', 'rules'), { recursive: true });
    await mkdir(join(dir, 'openspec', 'changes', 'demo-change'), { recursive: true });
    await writeFile(join(dir, 'src', 'a.js'), 'base\n');
    await writeFile(join(dir, '.agents', 'rules', 'demo.mdc'), 'rule\n');
    await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [ ] 4.3 Wire outcomes\n  Files: src/a.js\n');
    await writeFile(join(dir, '.agents', 'orchestrator.yaml'), yaml(true));
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-m', 'init', '--quiet']);
    const ids = scopeIds(dir);
    const config = { ...readHooksConfig(dir), projectDir: dir };
    const notices = [];
    const store = { storeFor: () => ({ append: async (_namespace, record) => { notices.push(record); return { stored: true }; } }) };
    const denied = normalizeCursor({
      payload: {
        conversation_id: 'conv',
        hook_event_name: 'beforeReadFile',
        cursor_version: '3.22.12',
        file_path: join(dir, 'src', 'a.js'),
        cwd: dir,
      },
      projectDir: dir,
      nativeEvent: 'beforeReadFile',
    });
    denied.data.tool = { ...(denied.data.tool ?? {}), name: 'Write', operation: 'write' };
    denied.data.files = ['src/a.js'];
    const denial = await dispatch(withScope(denied, ids, 'sess'), {
      policies: builtinPolicies,
      config,
      capabilities: { events: { 'tool.before': { deny: true } } },
      store,
    });
    assert.equal(denial.decision?.action, 'deny');
    const pending = await readOutcomes({ projectDir: dir, ids, match: { policy: 'scope', sessionId: 'sess' } });
    assert.equal(pending[0].reason, 'unbound');
    const ended = normalizeCursor({
      payload: {
        conversation_id: 'conv',
        hook_event_name: 'subagentStop',
        cursor_version: '3.22.12',
        status: 'completed',
        summary: 'done',
      },
      projectDir: dir,
      nativeEvent: 'subagentStop',
    });
    await dispatch(withScope(ended, ids, 'sess'), {
      policies: builtinPolicies,
      config,
      capabilities: { events: { 'agent.end': { followup: true } } },
      store,
    });
    assert.ok(notices.some((notice) => notice.code === 'workflow.notice' || notice.message));
    assert.equal(notices.some((notice) => notice.command), false);
    const other = await recordOutcome({
      projectDir: dir,
      ids,
      outcome: { policy: 'scope', status: 'denied', reason: 'unbound', sessionId: 'other', changeId: 'demo-change' },
    });
    const onlyOther = await drainOutcomes({ projectDir: dir, ids, match: { sessionId: 'other' } });
    assert.equal(onlyOther.delivered, 1);
    const runtime = createStore({
      projectDir: dir,
      scope: { level: 'worktree', ...ids, changeId: null, sessionId: null, agentId: null, eventId: 'cli' },
      pruneIntervalMs: 10 ** 9,
    });
    const logged = await runtime.log('diagnostics');
    assert.equal(logged.some((record) => record.sessionId === 'sess'), false);

    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '4.3', session: 'worker' });
    const failed = await enqueueJob({
      projectDir: dir,
      ids,
      kind: 'checks',
      changeId: 'demo-change',
      sessionId: 'worker',
      taskId: '4.3',
      commandId: 'fail',
      paths: ['src/a.js'],
      allowedFiles: ['src/a.js'],
    });
    const reserved = await ensureWorker({ projectDir: dir, ids, jobId: failed.jobId });
    await runWorker({ projectDir: dir, ids, jobId: failed.jobId, reservationToken: reserved.reservation });
    const late = await runtime.log('diagnostics');
    assert.ok(late.some((record) => record.code === 'checks.failed'));
    const narrowed = noticeRecord({ status: 'completed', reason: 'narrowed', evidence: { scope: { mode: 'narrowed', files: ['src/a.js'] } } });
    assert.match(narrowed.message, /narrowed/);
    assert.equal(narrowed.scope, undefined);
    const owned = await dispatch({
      schemaVersion: 1,
      kind: 'file.changed',
      eventId: 'owned-1',
      occurredAt: new Date().toISOString(),
      scope: { ...ids, sessionId: 'worker', agentId: null, changeId: null },
      contextEpoch: null,
      source: { client: 'cursor', clientVersion: null, runtime: 'test', nativeEvent: {} },
      data: { role: null, taskId: null, files: ['.agents/rules/demo.mdc'], tool: null, outcome: { status: 'success' }, stopReason: null },
    }, { policies: builtinPolicies, config, capabilities: { events: {} } });
    assert.equal(owned.decision, null);
    const jobs = Object.values((await readQueue({ projectDir: dir, ids })).jobs);
    assert.ok(jobs.some((job) => job.kind === 'owned-sync'));
    assert.ok(launches.some((spec) => spec.args.includes('worker')));
    const conflict = await recordOutcome({
      projectDir: dir,
      ids,
      outcome: { policy: 'owned-sync', status: 'conflict', reason: 'conflict', sessionId: 'worker', changeId: 'demo-change', command: 'npm test' },
    });
    const shown = noticeRecord(conflict);
    assert.equal(shown.code, 'owned-sync.conflict');
    assert.equal(shown.command, undefined);
    await writeFile(join(dir, '.agents', 'orchestrator.yaml'), yaml(false));
    const quiet = [];
    await dispatch(withScope(ended, ids, 'sess'), {
      policies: builtinPolicies,
      config: { ...readHooksConfig(dir), projectDir: dir },
      capabilities: { events: {} },
      store: { storeFor: () => ({ append: async (_namespace, record) => { quiet.push(record); return { stored: true }; } }) },
    });
    assert.equal(quiet.length, 0);
    assert.ok(other.outcomeId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
