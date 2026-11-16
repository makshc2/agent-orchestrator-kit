import { randomBytes } from 'node:crypto';

import { worktreeStore } from './stores.js';

export const OUTCOME_LIMIT = 256;
export const OUTCOME_TTL_MS = 24 * 60 * 60 * 1000;

const FORBIDDEN = new Set([
  'command', 'commands', 'output', 'stdout', 'stderr', 'secret', 'secrets', 'env', 'environment', 'args',
]);

function cleanScope(scope) {
  if (typeof scope === 'string') return scope.slice(0, 200);
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return null;
  const next = {};
  if (typeof scope.mode === 'string') next.mode = scope.mode.slice(0, 80);
  if (typeof scope.narrowed === 'boolean') next.narrowed = scope.narrowed;
  if (Array.isArray(scope.files)) {
    next.files = scope.files.filter((file) => typeof file === 'string').slice(0, 32).map((file) => file.slice(0, 200));
  }
  return next;
}

function sanitizeOutcome(source, ids, now) {
  const input = source && typeof source === 'object' ? source : {};
  for (const key of FORBIDDEN) {
    if (key in input) delete input[key];
  }
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  return {
    outcomeId: typeof input.outcomeId === 'string' && input.outcomeId !== ''
      ? input.outcomeId
      : `oc-${randomBytes(8).toString('hex')}`,
    repoId: input.repoId ?? ids?.repoId ?? null,
    worktreeId: input.worktreeId ?? ids?.worktreeId ?? null,
    changeId: input.changeId ?? null,
    sessionId: input.sessionId ?? null,
    agentId: input.agentId ?? null,
    taskId: input.taskId ?? null,
    policy: typeof input.policy === 'string' ? input.policy : 'workflow',
    source: {
      eventId: input.source?.eventId ?? input.eventId ?? null,
      jobId: input.source?.jobId ?? input.jobId ?? null,
    },
    status: typeof input.status === 'string' ? input.status : 'unknown',
    evidence: {
      digest: typeof (evidence.digest ?? input.digest) === 'string' ? (evidence.digest ?? input.digest) : null,
      freshness: typeof (evidence.freshness ?? input.freshness) === 'string' ? (evidence.freshness ?? input.freshness) : null,
      scope: cleanScope(evidence.scope ?? input.scope),
    },
    duration: Number.isFinite(input.duration) ? input.duration : (Number.isFinite(input.durationMs) ? input.durationMs : null),
    reason: typeof input.reason === 'string' ? input.reason.slice(0, 300) : '',
    recordedAt: new Date(now).toISOString(),
  };
}

function freshEntries(entries, now) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const recorded = Date.parse(entry?.recordedAt ?? '');
    return Number.isFinite(recorded) && now - recorded <= OUTCOME_TTL_MS;
  });
}

export async function recordOutcome({ projectDir, ids, now = Date.now(), outcome = null, ...rest } = {}) {
  const source = outcome && typeof outcome === 'object' ? { ...outcome } : { ...rest };
  const record = sanitizeOutcome(source, ids, now);
  await worktreeStore(projectDir, ids).transact('workflow-outcomes', 'pending', (prior) => {
    const entries = freshEntries(prior?.entries, now);
    entries.push(record);
    return { entries: entries.slice(-OUTCOME_LIMIT) };
  });
  return record;
}

export async function readOutcomes({ projectDir, ids, now = Date.now(), match = null } = {}) {
  const pending = await worktreeStore(projectDir, ids).read('workflow-outcomes', 'pending');
  return freshEntries(pending?.entries, now).filter((entry) => {
    if (!match) return true;
    return Object.entries(match).every(([key, value]) => entry[key] === value);
  });
}

export async function ackOutcome({ projectDir, ids, outcomeId } = {}) {
  let removed = false;
  await worktreeStore(projectDir, ids).transact('workflow-outcomes', 'pending', (prior) => {
    const entries = Array.isArray(prior?.entries) ? prior.entries : [];
    const next = entries.filter((entry) => entry.outcomeId !== outcomeId);
    removed = next.length !== entries.length;
    return { entries: next };
  });
  return { ok: true, removed };
}
