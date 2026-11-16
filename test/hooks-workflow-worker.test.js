import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { readHooksConfig, scopeIds } from '../bin/hooks/adapters/shared.js';
import { bindSession } from '../bin/hooks/binding.js';
import { workflowPolicies } from '../bin/hooks/policies/workflow.js';
import { acquireLease, enqueueJob, readQueue, releaseLease, renewLease } from '../bin/hooks/workflow/jobs.js';
import { readOutcomes } from '../bin/hooks/workflow/outcomes.js';
import { worktreeStore } from '../bin/hooks/workflow/stores.js';
import {
  ensureWorker,
  enqueueScopedChecks,
  recoverWorker,
  runWorker,
  setWorkerLauncher,
} from '../bin/hooks/workflow/worker.js';

const execFileAsync = promisify(execFile);
const checksPolicy = workflowPolicies.find((policy) => policy.id === 'checks');
const launches = [];

function rememberLaunch(spec) {
  launches.push(spec);
  return { pid: 0 };
}

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
}

function command(id, args) {
  return { id, executable: 'node', args, globs: ['src/*.js'], writablePaths: [] };
}

function yamlFor(commands, { enabled = true, timeoutMs = 30000, debounceMs = 0 } = {}) {
  const options = JSON.stringify({ commands, debounceMs, timeoutMs });
  return `hooks:\n  enabled: ${enabled}\n  mode: enforce\n  policies:\n    checks:\n      enabled: ${enabled}\n      mode: enforce\n      options: ${options}\n    owned-sync:\n      enabled: true\n      mode: observe\n      options: {}\nverifier:\n  test_command: "node -e \\"require('node:fs').writeFileSync('suite-ran.txt','1')\\""\n`;
}

async function makeProject(yaml) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-worker-'));
  await git(dir, ['init', '--quiet']);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.agents'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'demo-change'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.js'), 'original\n');
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), yaml);
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [ ] 3.3 Start the worker\n  Files: src/a.js\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init', '--quiet']);
  return dir;
}

function event(kind, files, extra = {}) {
  return {
    eventId: extra.eventId ?? 'evt-1',
    kind,
    source: { client: extra.client ?? 'cursor' },
    scope: { sessionId: 'sess', agentId: null },
    data: { files, origin: extra.origin ?? 'observed', originJobIds: extra.originJobIds ?? [] },
  };
}

test('one startup wins, jobs stay isolated, and release wakes the worker', async () => {
  launches.length = 0;
  setWorkerLauncher(rememberLaunch);
  const dir = await makeProject(yamlFor([command('format', ['-e', 'process.exit(0)'])]));
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '3.3', session: 'sess' });
    const first = await enqueueJob({
      projectDir: dir, ids, kind: 'checks', changeId: 'demo-change', sessionId: 'sess', agentId: null, taskId: '3.3', commandId: 'format', paths: ['src/a.js'],
    });
    const second = await enqueueJob({
      projectDir: dir, ids, kind: 'owned-sync', changeId: 'other-change', sessionId: 'sess', agentId: null, taskId: '9.1', commandId: 'sync', paths: [],
    });
    const queue = await readQueue({ projectDir: dir, ids });
    assert.equal(queue.jobs[first.jobId].changeId, 'demo-change');
    assert.equal(queue.jobs[second.jobId].kind, 'owned-sync');
    assert.notEqual(queue.jobs[first.jobId].coalesceKey, queue.jobs[second.jobId].coalesceKey);
    const log = join(dir, 'launches.log');
    await writeFile(log, '');
    const childCode = `
      import { ensureWorker } from ${JSON.stringify(join(process.cwd(), 'bin/hooks/workflow/worker.js'))};
      const result = await ensureWorker({ projectDir: process.env.DIR, ids: JSON.parse(process.env.IDS) });
      process.stdout.write(JSON.stringify(result));
    `;
    const runChild = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
        env: { ...process.env, AOK_WORKER_LAUNCH: 'record', AOK_WORKER_LAUNCH_LOG: log, DIR: dir, IDS: JSON.stringify(ids) },
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || out || String(code)))));
    });
    const [left, right] = await Promise.all([runChild(), runChild()]);
    const winners = [left, right].filter((result) => result.spawned);
    assert.equal(winners.length, 1);
    assert.ok([first.jobId, second.jobId].includes(winners[0].jobId));
    const recorded = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean);
    assert.equal(recorded.length, 1);
    assert.match(recorded[0], /hooks","worker","--job"/);
    await worktreeStore(dir, ids).transact('jobs', 'queue', (prior) => ({ ...prior, reservation: null }));
    const held = await acquireLease({ projectDir: dir, ids });
    const queued = await enqueueScopedChecks({
      projectDir: dir,
      ids,
      binding: { changeId: 'demo-change', sessionId: 'sess', agentId: null, task: '3.3', files: ['src/a.js'] },
      options: { commands: [command('format', ['-e', 'process.exit(0)'])], debounceMs: 0 },
      event: event('tool.after', ['src/a.js'], { eventId: 'during-sync' }),
    });
    assert.equal(queued.worker.spawned, false);
    assert.equal(launches.length, 0);
    await releaseLease({ projectDir: dir, ids, ownerToken: held.ownerToken });
    assert.equal(launches.length, 1);
    assert.equal(launches[0].cwd, dir);
    assert.ok(launches[0].args.includes('--reservation'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('drain keeps a successor, recovers an expired reservation, and cancels disabled work', async () => {
  launches.length = 0;
  setWorkerLauncher(rememberLaunch);
  const dir = await makeProject(yamlFor([command('format', ['-e', 'process.exit(0)'])]));
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '3.3', session: 'sess' });
    for (let index = 0; index < 17; index += 1) {
      await enqueueJob({
        projectDir: dir,
        ids,
        kind: 'checks',
        changeId: 'demo-change',
        sessionId: 'sess',
        agentId: null,
        taskId: '3.3',
        commandId: `cmd-${index}`,
        paths: ['src/a.js'],
        allowedFiles: ['src/a.js'],
      });
    }
    const started = await ensureWorker({ projectDir: dir, ids });
    assert.equal(started.spawned, true);
    const drained = await runWorker({ projectDir: dir, ids, jobId: started.jobId, reservationToken: started.reservation });
    assert.equal(drained.processed, 16);
    const left = Object.values((await readQueue({ projectDir: dir, ids })).jobs).filter((job) => job.status === 'pending');
    assert.equal(left.length, 1);
    assert.equal(launches.length, 2);

    const expiredDir = await makeProject(yamlFor([command('format', ['-e', 'process.exit(0)'])]));
    const expiredIds = scopeIds(expiredDir);
    await enqueueJob({ projectDir: expiredDir, ids: expiredIds, kind: 'checks', changeId: 'demo-change', commandId: 'format', paths: ['src/a.js'] });
    await worktreeStore(expiredDir, expiredIds).transact('jobs', 'queue', (prior) => ({
      ...prior,
      reservation: { token: 'stale', jobId: 'missing', expiresAt: Date.now() - 1000 },
    }));
    launches.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(launches.length, 0);
    const recovered = await recoverWorker({ projectDir: expiredDir, ids: expiredIds });
    assert.equal(recovered.spawned, true);
    assert.equal(launches.length, 1);

    const disabled = await makeProject(yamlFor([], { enabled: false }));
    const disabledIds = scopeIds(disabled);
    const marker = join(disabled, 'src', 'ran.txt');
    const job = await enqueueJob({
      projectDir: disabled,
      ids: disabledIds,
      kind: 'checks',
      changeId: 'demo-change',
      commandId: 'format',
      paths: ['src/a.js'],
    });
    launches.length = 0;
    const reserved = await ensureWorker({ projectDir: disabled, ids: disabledIds, jobId: job.jobId });
    await runWorker({ projectDir: disabled, ids: disabledIds, jobId: job.jobId, reservationToken: reserved.reservation });
    const cancelled = (await readQueue({ projectDir: disabled, ids: disabledIds })).jobs[job.jobId];
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(existsSync(marker), false);
    await rm(expiredDir, { recursive: true, force: true });
    await rm(disabled, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('timeout and a held lease fail closed, and owned sync reuses the worker lease', async () => {
  launches.length = 0;
  setWorkerLauncher(rememberLaunch);
  const dir = await makeProject(yamlFor([
    command('slow', ['-e', 'setTimeout(() => {}, 5000)']),
  ], { timeoutMs: 200 }));
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '3.3', session: 'sess' });
    const slow = await enqueueJob({
      projectDir: dir, ids, kind: 'checks', changeId: 'demo-change', sessionId: 'sess', agentId: null, taskId: '3.3',
      commandId: 'slow', paths: ['src/a.js'], allowedFiles: ['src/a.js'],
    });
    const reserved = await ensureWorker({ projectDir: dir, ids, jobId: slow.jobId });
    const ran = await runWorker({ projectDir: dir, ids, jobId: slow.jobId, reservationToken: reserved.reservation });
    assert.equal(ran.ok, true);
    assert.equal((await readQueue({ projectDir: dir, ids })).jobs[slow.jobId].status, 'timeout');
    assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);

    const heldDir = await makeProject(yamlFor([command('format', ['-e', 'process.exit(0)'])]));
    const heldIds = scopeIds(heldDir);
    const blocked = await enqueueJob({ projectDir: heldDir, ids: heldIds, kind: 'checks', changeId: 'demo-change', commandId: 'format' });
    const heldReservation = await ensureWorker({ projectDir: heldDir, ids: heldIds, jobId: blocked.jobId });
    const held = await acquireLease({ projectDir: heldDir, ids: heldIds });
    const renewing = setInterval(() => renewLease({ projectDir: heldDir, ids: heldIds, ownerToken: held.ownerToken }), 1000);
    const lost = await runWorker({
      projectDir: heldDir, ids: heldIds, jobId: blocked.jobId, reservationToken: heldReservation.reservation,
    });
    clearInterval(renewing);
    await releaseLease({ projectDir: heldDir, ids: heldIds, ownerToken: held.ownerToken });
    assert.equal(lost.reason, 'lease-lost');
    const outcomes = await readOutcomes({ projectDir: heldDir, ids: heldIds, match: { reason: 'lease-lost' } });
    assert.equal(outcomes.length, 1);

    const syncDir = await makeProject(yamlFor([command('format', ['-e', 'process.exit(0)'])]));
    const syncIds = scopeIds(syncDir);
    const syncJob = await enqueueJob({ projectDir: syncDir, ids: syncIds, kind: 'owned-sync', changeId: null, commandId: 'sync' });
    const syncReservation = await ensureWorker({ projectDir: syncDir, ids: syncIds, jobId: syncJob.jobId });
    const startedAt = Date.now();
    const synced = await runWorker({
      projectDir: syncDir, ids: syncIds, jobId: syncJob.jobId, reservationToken: syncReservation.reservation,
    });
    assert.equal(synced.ok, true);
    assert.ok(Date.now() - startedAt < 10000);
    assert.equal((await readQueue({ projectDir: syncDir, ids: syncIds })).jobs[syncJob.jobId].status, 'completed');
    await rm(heldDir, { recursive: true, force: true });
    await rm(syncDir, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an edit enqueues scoped work without running the verifier inline', async () => {
  launches.length = 0;
  setWorkerLauncher(rememberLaunch);
  const dir = await makeProject(yamlFor([command('format', ['-e', 'process.exit(0)'])]));
  try {
    const ids = scopeIds(dir);
    await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '3.3', session: 'sess' });
    const config = readHooksConfig(dir);
    const started = Date.now();
    const result = await checksPolicy.evaluate(event('tool.after', ['src/a.js'], { client: 'claude' }), {
      projectDir: dir,
      ids,
      config: { ...config, projectDir: dir },
    });
    assert.ok(Date.now() - started < 500);
    assert.equal(result.decision, null);
    assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);
    assert.equal(launches.length, 1);
    const outside = await checksPolicy.evaluate(event('file.changed', ['docs/readme.md'], { eventId: 'outside' }), {
      projectDir: dir,
      ids,
      config: { ...config, projectDir: dir },
    });
    assert.equal(outside.decision, null);
    assert.equal(launches.length, 1);
    const own = await checksPolicy.evaluate(event('tool.after', ['src/a.js'], { eventId: 'own', origin: 'worker' }), {
      projectDir: dir,
      ids,
      config: { ...config, projectDir: dir },
    });
    assert.equal(own.decision, null);
    assert.equal(launches.length, 1);
    assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
