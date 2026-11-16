import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readHooksConfig } from '../adapters/shared.js';
import { resolveBinding } from '../binding.js';
import { validateCompletion } from './completion.js';
import { loadChecksConfig, runScopedChecks } from './checks.js';
import { enqueueJob, readQueue, setLeaseWakeup, withLease } from './jobs.js';
import { recordOutcome } from './outcomes.js';
import { changeStore, worktreeStore } from './stores.js';

const STARTUP_MS = 5000;
const DRAIN_LIMIT = 16;
const DRAIN_MS = 60000;
const MAX_GENERATIONS = 2;
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent-orchestrator.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let launcher = defaultLaunch;

function defaultLaunch(spec) {
  if (process.env.AOK_WORKER_LAUNCH === 'record') {
    appendFileSync(process.env.AOK_WORKER_LAUNCH_LOG, `${JSON.stringify(spec)}\n`);
    return { pid: 0 };
  }
  const child = spawn(spec.execPath, spec.args, {
    cwd: spec.cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid };
}

export function setWorkerLauncher(fn) {
  launcher = typeof fn === 'function' ? fn : defaultLaunch;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function policyId(kind) {
  if (kind === 'completion-validation') return 'completion';
  return kind;
}

function enabled(projectDir, kind) {
  const config = readHooksConfig(projectDir);
  const id = policyId(kind);
  const entry = config.hooks?.policies?.[id];
  return config.hooks?.enabled === true && entry?.enabled === true;
}

async function claimStartup({ projectDir, ids, jobId = null, now = Date.now() }) {
  const store = worktreeStore(projectDir, ids);
  const lease = await store.read('jobs', 'lease');
  if (lease?.owner && lease.expiresAt > now) return { claimed: null, reason: 'lease' };
  let claimed = null;
  await store.transact('jobs', 'queue', (prior) => {
    const queue = prior?.jobs ? prior : { jobs: {}, reservation: null };
    if (queue.reservation?.expiresAt > now) return queue;
    const pending = Object.values(queue.jobs)
      .filter((job) => job.status === 'pending' && job.deadline > now)
      .sort((left, right) => left.createdAt - right.createdAt || left.jobId.localeCompare(right.jobId));
    const job = jobId ? queue.jobs[jobId] : pending[0];
    if (!job || job.status !== 'pending') {
      queue.reservation = null;
      return queue;
    }
    claimed = { token: randomBytes(16).toString('hex'), jobId: job.jobId, expiresAt: now + STARTUP_MS };
    queue.reservation = claimed;
    return queue;
  });
  return { claimed, reason: claimed ? 'reserved' : 'idle' };
}

export async function ensureWorker({ projectDir, ids, jobId = null, now = Date.now() } = {}) {
  const { claimed } = await claimStartup({ projectDir, ids, jobId, now });
  if (!claimed) return { spawned: false, jobId: null, reservation: null };
  const spec = {
    execPath: process.execPath,
    args: [BIN, 'hooks', 'worker', '--job', claimed.jobId, '--reservation', claimed.token],
    cwd: projectDir,
  };
  try {
    const child = launcher(spec);
    return { spawned: true, pid: child?.pid ?? null, jobId: claimed.jobId, reservation: claimed.token };
  } catch (error) {
    await worktreeStore(projectDir, ids).transact('jobs', 'queue', (prior) => {
      if (!prior?.reservation || prior.reservation.token !== claimed.token) return prior;
      return { ...prior, reservation: null };
    });
    await recordOutcome({
      projectDir,
      ids,
      outcome: {
        policy: 'checks',
        status: 'failed',
        reason: 'spawn-failed',
        source: { eventId: null, jobId: claimed.jobId },
      },
    });
    return { spawned: false, jobId: claimed.jobId, reason: error.message };
  }
}

export async function recoverWorker({ projectDir, ids } = {}) {
  return ensureWorker({ projectDir, ids });
}

function dueJob(jobs, generations, now) {
  return Object.values(jobs)
    .filter((job) => job.status === 'pending' && job.deadline > now && (generations.get(job.coalesceKey) ?? 0) < MAX_GENERATIONS)
    .sort((left, right) => left.createdAt - right.createdAt || left.jobId.localeCompare(right.jobId))[0] ?? null;
}

async function setStatus(projectDir, ids, jobId, status, extra = {}) {
  await worktreeStore(projectDir, ids).transact('jobs', 'queue', (prior) => {
    if (!prior?.jobs?.[jobId]) return prior;
    prior.jobs[jobId] = { ...prior.jobs[jobId], status, ...extra };
    return prior;
  });
}

async function bindingFor(projectDir, ids, job) {
  if (!job.sessionId) return null;
  const binding = await resolveBinding({ projectDir, ids, sessionId: job.sessionId, agentId: job.agentId ?? null });
  if (!binding || binding.changeId !== job.changeId || binding.task !== job.taskId) return null;
  const current = digest({
    changeId: binding.changeId,
    task: binding.task,
    files: [...(binding.files ?? [])].sort(),
  });
  if (job.bindingDigest && job.bindingDigest !== current) return null;
  return binding;
}

async function invalidateEvidence(projectDir, ids, job) {
  const store = changeStore(projectDir, ids, job.changeId);
  if (store) {
    await store.transact('verification-evidence', 'latest', (prior) => (prior ? { ...prior, reusable: false, status: 'invalidated' } : prior));
  }
  return recordOutcome({
    projectDir,
    ids,
    outcome: {
      policy: 'verification',
      status: 'invalidated',
      reason: 'inputs-changed',
      changeId: job.changeId,
      sessionId: job.sessionId,
      agentId: job.agentId,
      taskId: job.taskId,
      source: { jobId: job.jobId },
    },
  });
}

async function executeJob({ projectDir, ids, job, ownerToken, signal }) {
  if (!enabled(projectDir, job.kind)) {
    await setStatus(projectDir, ids, job.jobId, 'cancelled', { reason: 'disabled' });
    return { status: 'cancelled' };
  }
  if (signal?.aborted) {
    await setStatus(projectDir, ids, job.jobId, 'failed', { reason: 'lease-lost' });
    return { status: 'failed', reason: 'lease-lost' };
  }
  const binding = await bindingFor(projectDir, ids, job);
  if (job.sessionId && !binding) {
    await setStatus(projectDir, ids, job.jobId, 'cancelled', { reason: 'binding' });
    return { status: 'cancelled', reason: 'binding' };
  }
  await setStatus(projectDir, ids, job.jobId, 'running');
  try {
    if (job.kind === 'verification') {
      await invalidateEvidence(projectDir, ids, job);
      await setStatus(projectDir, ids, job.jobId, 'completed', { reason: 'invalidated' });
      return { status: 'completed', reason: 'invalidated' };
    }
    if (job.kind === 'completion-validation') {
      const result = await validateCompletion({
        projectDir,
        ids,
        change: job.changeId,
        session: job.sessionId,
        agent: job.agentId,
        persist: true,
      });
      const status = result.status === 'current' ? 'completed' : 'blocked';
      await recordOutcome({
        projectDir,
        ids,
        outcome: {
          policy: 'completion',
          status,
          reason: result.reason || status,
          changeId: job.changeId,
          sessionId: job.sessionId,
          agentId: job.agentId,
          taskId: job.taskId,
          source: { jobId: job.jobId },
        },
      });
      await setStatus(projectDir, ids, job.jobId, status === 'completed' ? 'completed' : 'failed', { reason: result.reason });
      return { status };
    }
    if (job.kind === 'owned-sync') {
      const { ownedSync } = await import('./owned-sync.js');
      const result = await ownedSync({ projectDir, ids, ownerToken });
      await setStatus(projectDir, ids, job.jobId, 'completed');
      return { status: 'completed', result };
    }
    const mapped = binding ? {
      changeId: binding.changeId,
      sessionId: binding.sessionId,
      agentId: binding.agentId ?? null,
      taskId: binding.task,
      files: binding.files,
    } : null;
    const loaded = loadChecksConfig(projectDir);
    const timeoutMs = loaded.resolved.ok ? loaded.resolved.options.timeoutMs : 30000;
    const result = await runScopedChecks({
      projectDir,
      ids,
      ownerToken,
      binding: mapped,
      paths: job.paths,
      commandId: job.commandId || null,
      originJobIds: job.originJobIds ?? [],
      timeoutMs,
    });
    const failed = result.results?.some((entry) => entry.status === 'timeout' || entry.status === 'failed');
    const status = failed ? (result.results.some((entry) => entry.status === 'timeout') ? 'timeout' : 'failed') : 'completed';
    await setStatus(projectDir, ids, job.jobId, status, { reason: result.reason ?? null });
    return { status, result };
  } catch (error) {
    const reason = error?.code === 'ERR_HOOK_LEASE_TOKEN' ? 'lease-lost' : 'failed';
    await setStatus(projectDir, ids, job.jobId, 'failed', { reason });
    await recordOutcome({
      projectDir,
      ids,
      outcome: {
        policy: policyId(job.kind),
        status: 'failed',
        reason,
        changeId: job.changeId,
        sessionId: job.sessionId,
        agentId: job.agentId,
        taskId: job.taskId,
        source: { jobId: job.jobId },
      },
    });
    return { status: 'failed', reason };
  }
}

async function maybeNotify(projectDir, ids) {
  const config = readHooksConfig(projectDir);
  const entry = config.hooks?.policies?.['workflow-notifications'];
  if (config.hooks?.enabled !== true || entry?.enabled !== true) return;
  try {
    const mod = await import('./notifications.js');
    if (typeof mod.drainOutcomes === 'function') await mod.drainOutcomes({ projectDir, ids });
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
}

export async function runWorker({ projectDir, ids, jobId, reservationToken } = {}) {
  const store = worktreeStore(projectDir, ids);
  const queue = await store.read('jobs', 'queue');
  const reservation = queue?.reservation;
  if (!reservation || reservation.token !== reservationToken || (jobId && reservation.jobId !== jobId)) {
    return { ok: false, reason: 'reservation', processed: 0 };
  }
  if (jobId && !queue.jobs?.[jobId]) return { ok: false, reason: 'missing-job', processed: 0 };
  const timer = setInterval(() => {
    store.transact('jobs', 'queue', (prior) => {
      if (!prior?.reservation || prior.reservation.token !== reservationToken) return prior;
      return { ...prior, reservation: { ...prior.reservation, expiresAt: Date.now() + STARTUP_MS } };
    }).catch(() => {});
  }, 1000);
  timer.unref?.();
  const generations = new Map();
  let processed = 0;
  const started = Date.now();
  try {
    try {
    await withLease({ projectDir, ids, timeoutMs: STARTUP_MS }, async ({ ownerToken, signal }) => {
      while (processed < DRAIN_LIMIT && Date.now() - started < DRAIN_MS) {
        if (signal.aborted) break;
        const current = await store.read('jobs', 'queue');
        const job = dueJob(current?.jobs ?? {}, generations, Date.now());
        if (!job) break;
        if (job.createdAt > Date.now()) {
          await sleep(Math.min(job.createdAt - Date.now(), 50));
          continue;
        }
        generations.set(job.coalesceKey, (generations.get(job.coalesceKey) ?? 0) + 1);
        await executeJob({ projectDir, ids, job, ownerToken, signal });
        processed += 1;
        await maybeNotify(projectDir, ids);
      }
    });
    } catch (error) {
      if (error?.code === 'ERR_HOOK_LEASE_TIMEOUT' || error?.code === 'ERR_HOOK_LEASE_TOKEN') {
        await recordOutcome({
          projectDir,
          ids,
          outcome: {
            policy: 'checks',
            status: 'failed',
            reason: 'lease-lost',
            source: { eventId: null, jobId },
          },
        });
        return { ok: false, reason: 'lease-lost', processed };
      }
      throw error;
    }
  } finally {
    clearInterval(timer);
    await store.transact('jobs', 'queue', (prior) => {
      if (!prior?.reservation || prior.reservation.token !== reservationToken) return prior;
      return { ...prior, reservation: null };
    });
  }
  const left = await readQueue({ projectDir, ids });
  const remaining = Object.values(left.jobs ?? {}).some((job) => job.status === 'pending' && job.deadline > Date.now());
  if (remaining) await ensureWorker({ projectDir, ids });
  return { ok: true, processed };
}

function matches(command, path) {
  return command.globs.some((glob) => {
    const pattern = glob.split('*').map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('[^/]*');
    return new RegExp(`^${pattern}$`).test(path);
  });
}

export async function enqueueScopedChecks({ projectDir, ids, event, options, binding }) {
  if (event?.kind !== 'tool.after' && event?.kind !== 'file.changed') return { queued: false };
  if (event.data?.origin === 'worker' || (event.data?.originJobIds ?? []).length > 0) {
    return { queued: false, suppressed: true };
  }
  const paths = (event.data?.files ?? []).filter((file) => typeof file === 'string');
  const allowed = new Set(binding?.files ?? []);
  const commands = (options?.commands ?? []).filter((command) => paths.some((file) => allowed.has(file) && matches(command, file)));
  if (!binding || commands.length === 0) return { queued: false };
  const bindingDigest = digest({
    changeId: binding.changeId,
    task: binding.task,
    files: [...binding.files].sort(),
  });
  const queued = await enqueueJob({
    projectDir,
    ids,
    kind: 'checks',
    changeId: binding.changeId,
    sessionId: binding.sessionId,
    agentId: binding.agentId ?? null,
    taskId: binding.task,
    bindingDigest,
    allowedFiles: binding.files,
    paths,
    commandId: commands[0].id,
    optionsDigest: digest(options),
    originJobId: event.data?.originJobId ?? null,
    now: Date.now() + (options.debounceMs || 0),
  });
  const worker = await ensureWorker({ projectDir, ids, jobId: queued.jobId });
  return { queued: true, jobId: queued.jobId, worker };
}

setLeaseWakeup((details) => ensureWorker(details));
