import { createHash, randomBytes } from 'node:crypto';

import { worktreeStore } from './stores.js';

export const LEASE_TTL_MS = 5000;
export const RENEW_INTERVAL_MS = 1000;
export const JOB_DEADLINE_MS = 5 * 60 * 1000;

let registeredWakeup = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function leaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function storeFor(projectDir, ids) {
  return worktreeStore(projectDir, ids);
}

export function setLeaseWakeup(fn) {
  registeredWakeup = typeof fn === 'function' ? fn : null;
}

async function readLease(projectDir, ids) {
  return storeFor(projectDir, ids).read('jobs', 'lease');
}

function liveLease(lease, now) {
  return Boolean(lease && lease.owner && lease.expiresAt > now);
}

export async function acquireLease({ projectDir, ids, ownerToken = null, now = Date.now() } = {}) {
  const token = ownerToken || randomBytes(16).toString('hex');
  let outcome = { ok: false, reason: 'held' };
  await storeFor(projectDir, ids).transact('jobs', 'lease', (prior) => {
    if (liveLease(prior, now)) {
      if (prior.owner === token) {
        outcome = { ok: true, ownerToken: token, expiresAt: prior.expiresAt };
        return prior;
      }
      outcome = { ok: false, reason: 'held' };
      return prior;
    }
    const expiresAt = now + LEASE_TTL_MS;
    outcome = { ok: true, ownerToken: token, expiresAt };
    return { owner: token, expiresAt };
  });
  return outcome;
}

export async function renewLease({ projectDir, ids, ownerToken, now = Date.now() } = {}) {
  let outcome = { ok: false, reason: 'not-owner' };
  await storeFor(projectDir, ids).transact('jobs', 'lease', (prior) => {
    if (!prior || prior.owner !== ownerToken) {
      outcome = { ok: false, reason: 'not-owner' };
      return prior;
    }
    const expiresAt = now + LEASE_TTL_MS;
    outcome = { ok: true, ownerToken, expiresAt };
    return { owner: ownerToken, expiresAt };
  });
  return outcome;
}

async function invokeWakeup(wakeup, details) {
  const callbacks = [wakeup, registeredWakeup].filter((fn) => typeof fn === 'function');
  for (const fn of callbacks) await fn(details);
}

export async function releaseLease({ projectDir, ids, ownerToken, wakeup = null, now = Date.now() } = {}) {
  let outcome = { ok: false, reason: 'not-owner' };
  await storeFor(projectDir, ids).transact('jobs', 'lease', (prior) => {
    if (!prior || prior.owner !== ownerToken) {
      outcome = { ok: false, reason: 'not-owner' };
      return prior;
    }
    outcome = { ok: true };
    return { owner: null, expiresAt: 0 };
  });
  if (outcome.ok) await invokeWakeup(wakeup, { projectDir, ids, ownerToken, now });
  return outcome;
}

export async function withLease({ projectDir, ids, ownerToken = null, timeoutMs = 30000 } = {}, fn) {
  if (typeof fn !== 'function') throw leaseError('ERR_HOOK_LEASE', 'withLease requires a function');
  if (ownerToken) {
    const lease = await readLease(projectDir, ids);
    if (!liveLease(lease, Date.now()) || lease.owner !== ownerToken) {
      throw leaseError('ERR_HOOK_LEASE_TOKEN', 'lease token is missing, expired, or held by another owner');
    }
    const controller = new AbortController();
    return fn({
      ownerToken,
      signal: controller.signal,
      renew: async () => {
        const renewed = await renewLease({ projectDir, ids, ownerToken });
        if (!renewed.ok) controller.abort();
        return renewed;
      },
    });
  }

  const token = randomBytes(16).toString('hex');
  const started = Date.now();
  let acquired = null;
  for (;;) {
    acquired = await acquireLease({ projectDir, ids, ownerToken: token });
    if (acquired.ok) break;
    if (Date.now() - started >= timeoutMs) {
      throw leaseError('ERR_HOOK_LEASE_TIMEOUT', `timed out after ${timeoutMs} ms waiting for the worktree lease`);
    }
    await sleep(20);
  }

  const controller = new AbortController();
  const timer = setInterval(() => {
    renewLease({ projectDir, ids, ownerToken: token }).then((renewed) => {
      if (!renewed.ok) controller.abort();
    }).catch(() => controller.abort());
  }, RENEW_INTERVAL_MS);
  timer.unref?.();
  try {
    return await fn({
      ownerToken: token,
      signal: controller.signal,
      renew: async () => {
        const renewed = await renewLease({ projectDir, ids, ownerToken: token });
        if (!renewed.ok) controller.abort();
        return renewed;
      },
    });
  } finally {
    clearInterval(timer);
    await releaseLease({ projectDir, ids, ownerToken: token });
  }
}

export function coalesceKey(input) {
  const allowed = [...(input.allowedFiles ?? [])].map(String).sort();
  return createHash('sha256').update(JSON.stringify({
    kind: input.kind ?? '',
    repoId: input.ids?.repoId ?? '',
    worktreeId: input.ids?.worktreeId ?? '',
    changeId: input.changeId ?? '',
    sessionId: input.sessionId ?? '',
    agentId: input.agentId ?? '',
    taskId: input.taskId ?? '',
    bindingDigest: input.bindingDigest ?? '',
    allowedFiles: allowed,
    commandId: input.commandId ?? '',
    optionsDigest: input.optionsDigest ?? '',
  })).digest('hex');
}

function blankQueue() {
  return { jobs: {}, reservation: null };
}

function union(left, right) {
  const out = [];
  for (const value of [...(left ?? []), ...(right ?? [])]) {
    if (typeof value !== 'string' || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

export async function enqueueJob({
  projectDir,
  ids,
  kind,
  changeId = null,
  sessionId = null,
  agentId = null,
  taskId = null,
  bindingDigest = '',
  allowedFiles = [],
  paths = [],
  commandId = '',
  optionsDigest = '',
  originJobId = null,
  now = Date.now(),
} = {}) {
  const key = coalesceKey({
    ids, kind, changeId, sessionId, agentId, taskId, bindingDigest, allowedFiles, commandId, optionsDigest,
  });
  let result = null;
  await storeFor(projectDir, ids).transact('jobs', 'queue', (prior) => {
    const queue = prior && typeof prior === 'object' && prior.jobs ? prior : blankQueue();
    const active = Object.values(queue.jobs).filter((job) => job.coalesceKey === key && (job.status === 'pending' || job.status === 'running'));
    const pending = active.find((job) => job.status === 'pending');
    const running = active.find((job) => job.status === 'running');
    if (pending) {
      pending.paths = union(pending.paths, paths);
      if (originJobId) pending.originJobIds = union(pending.originJobIds, [originJobId]);
      result = { jobId: pending.jobId, coalesced: true };
      return queue;
    }
    const jobId = `job-${randomBytes(8).toString('hex')}`;
    queue.jobs[jobId] = {
      jobId,
      kind,
      repoId: ids?.repoId ?? null,
      worktreeId: ids?.worktreeId ?? null,
      changeId,
      sessionId,
      agentId,
      taskId,
      bindingDigest,
      allowedFiles: [...allowedFiles],
      paths: union([], paths),
      commandId,
      optionsDigest,
      originJobIds: originJobId ? [originJobId] : [],
      createdAt: now,
      deadline: now + JOB_DEADLINE_MS,
      generation: running ? (running.generation ?? 1) + 1 : 1,
      status: 'pending',
      coalesceKey: key,
    };
    result = { jobId, coalesced: false };
    return queue;
  });
  return result;
}

export async function readQueue({ projectDir, ids } = {}) {
  return (await storeFor(projectDir, ids).read('jobs', 'queue')) ?? blankQueue();
}
