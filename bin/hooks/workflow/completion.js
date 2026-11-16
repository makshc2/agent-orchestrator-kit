import { createHash, randomBytes } from 'node:crypto';

import { resolveBinding } from '../binding.js';
import { createStore } from '../store.js';
import { fingerprint } from './fingerprint.js';
import { enqueueJob, withLease } from './jobs.js';
import { readOutcomes, recordOutcome } from './outcomes.js';
import { changeStore, worktreeStore } from './stores.js';

const PROGRESS = new Set(['handoff.md', 'checkpoint.json', 'metrics.json', 'decisions.md']);
const COMPLETED = new Set(['completed', 'complete', 'success', 'end_turn']);
const BYPASS = new Set(['cancelled', 'canceled', 'user_cancelled', 'error', 'paused', 'pause', 'manual', 'stopped', 'aborted']);
const EPOCH_ORIGINS = new Set(['observed']);

const fail = (message) => {
  const error = new Error(message);
  error.code = 'ERR_HOOK_COMPLETE';
  throw error;
};

export function completionIntentKey(sessionId, agentId, taskId) {
  return createHash('sha256')
    .update(`${sessionId ?? ''}\u0000${agentId ?? ''}\u0000${taskId ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

function sessionBudgetStore(projectDir, ids, sessionId) {
  return createStore({
    projectDir,
    scope: {
      level: 'session',
      repoId: ids?.repoId ?? null,
      worktreeId: ids?.worktreeId ?? null,
      changeId: null,
      sessionId,
      agentId: null,
      eventId: 'completion',
    },
    pruneIntervalMs: 10 ** 9,
  });
}

function budgetStore(ctx, sessionId) {
  if (ctx?.store && ctx.store.quarantined !== true) return ctx.store;
  return sessionBudgetStore(ctx.projectDir, ctx.ids, sessionId);
}

async function snapshot(projectDir, changeId) {
  const fp = await fingerprint(projectDir, changeId, {});
  return {
    inputDigest: fp.digest,
    tasksDigest: fp.tasksDigest,
    handoffDigest: fp.handoffDigest,
    unstable: fp.unstable === true,
  };
}

async function outcomeSequence(projectDir, ids, changeId) {
  const entries = await readOutcomes({ projectDir, ids, match: { changeId } });
  return entries.filter((entry) => entry.policy === 'verification' || entry.reason === 'substantive').length;
}

function evidenceReason(evidence, snap) {
  if (!evidence) return 'evidence-missing';
  if (evidence.status === 'skipped-no-command') return 'skipped';
  if (evidence.status === 'narrowed' || evidence.scope?.narrowed === true) return 'narrowed';
  if (evidence.status === 'timeout') return 'timeout';
  if (evidence.status === 'failed' || evidence.status === 'not-run' || evidence.reason === 'manual-failure') return 'manual-failure';
  if (evidence.status !== 'full') return 'manual-failure';
  if (evidence.inputDigest && snap && evidence.inputDigest !== snap.inputDigest) return 'stale-evidence';
  return null;
}

function judge({ snap, receipt, sequence, evidence }) {
  const findings = [];
  if (!receipt) {
    findings.push({ id: 'completion.confirmation.required', reason: 'confirmation-required' });
    return { status: 'unresolved', reason: 'confirmation-required', findings, accepted: false };
  }
  if (receipt.lastOutcomeSeq !== sequence) {
    findings.push({ id: 'completion.receipt.stale', reason: 'stale-receipt' });
    return { status: 'unresolved', reason: 'stale-receipt', findings, accepted: false };
  }
  if (snap.unstable || receipt.inputDigest !== snap.inputDigest || receipt.tasksDigest !== snap.tasksDigest || receipt.handoffDigest !== snap.handoffDigest) {
    findings.push({ id: 'completion.inputs.drift', reason: 'drift' });
    return { status: 'unresolved', reason: 'drift', findings, accepted: false };
  }
  const reason = evidenceReason(evidence, snap);
  if (reason) {
    findings.push({ id: `completion.evidence.${reason}`, reason });
    return { status: 'unresolved', reason, findings, accepted: true };
  }
  return { status: 'current', reason: '', findings, accepted: true };
}

async function loadBinding({ projectDir, ids, change, session, agent = null, task = null }) {
  const binding = await resolveBinding({ projectDir, ids, sessionId: session, agentId: agent });
  if (!binding || binding.changeId !== change) fail('completion requires an exact session binding');
  if (task != null && String(task) !== String(binding.task)) fail('task does not match the bound task');
  return binding;
}

export async function registerCompletionIntent({
  projectDir,
  ids,
  change,
  session,
  agent = null,
  task = null,
  confirmHandoff = false,
  ownerToken = null,
} = {}) {
  const binding = await loadBinding({ projectDir, ids, change, session, agent, task });
  const taskId = binding.task;
  const intentKey = completionIntentKey(session, agent, taskId);
  const store = changeStore(projectDir, ids, change);
  return withLease({ projectDir, ids, ownerToken }, async () => {
    const snap = await snapshot(projectDir, change);
    const sequence = await outcomeSequence(projectDir, ids, change);
    const prior = (await store.read('completion-state', intentKey)) ?? {
      workEpoch: 0,
      lastOutcomeSeq: 0,
      receipt: null,
      validation: null,
      seenEvents: [],
    };
    const evidence = await store.read('verification-evidence', 'latest');
    let receipt = prior.receipt ?? null;
    if (confirmHandoff) {
      receipt = {
        changeId: change,
        sessionId: session,
        agentId: agent,
        taskId,
        handoffDigest: snap.handoffDigest,
        tasksDigest: snap.tasksDigest,
        inputDigest: snap.inputDigest,
        workEpoch: prior.workEpoch ?? 0,
        lastOutcomeSeq: sequence,
        confirmedAt: new Date().toISOString(),
        confirmationId: `cf-${randomBytes(8).toString('hex')}`,
      };
    }
    const validation = judge({ snap, receipt, sequence, evidence });
    await store.transact('completion-intent', intentKey, () => ({
      changeId: change,
      sessionId: session,
      agentId: agent,
      taskId,
      handoffDigest: snap.handoffDigest,
      tasksDigest: snap.tasksDigest,
    }));
    await store.transact('completion-state', intentKey, () => ({
      workEpoch: prior.workEpoch ?? 0,
      lastOutcomeSeq: sequence,
      receipt,
      validation,
      seenEvents: prior.seenEvents ?? [],
    }));
    return { intentKey, taskId, receipt, validation, accepted: validation.accepted, findings: validation.findings, pending: false };
  });
}

export async function validateCompletion({
  projectDir,
  ids,
  change,
  session,
  agent = null,
  persist = false,
  between = null,
} = {}) {
  const binding = await resolveBinding({ projectDir, ids, sessionId: session, agentId: agent });
  if (!binding || binding.changeId !== change) {
    return { status: 'unresolved', reason: 'unbound', findings: [{ id: 'completion.identity.unbound' }], launchesTurn: false };
  }
  const intentKey = completionIntentKey(session, agent, binding.task);
  const store = changeStore(projectDir, ids, change);
  const state = await store.read('completion-state', intentKey);
  const pre = await snapshot(projectDir, change);
  if (typeof between === 'function') await between();
  const post = await snapshot(projectDir, change);
  const sequence = await outcomeSequence(projectDir, ids, change);
  const evidence = await store.read('verification-evidence', 'latest');
  let result = judge({ snap: pre, receipt: state?.receipt ?? null, sequence, evidence });
  const moved = pre.unstable || post.unstable
    || pre.inputDigest !== post.inputDigest
    || pre.tasksDigest !== post.tasksDigest
    || pre.handoffDigest !== post.handoffDigest;
  if (moved) {
    result = { status: 'unresolved', reason: 'drift', findings: [{ id: 'completion.inputs.drift', reason: 'drift' }], accepted: false };
  }
  if (state) {
    await store.transact('completion-state', intentKey, (prior) => ({ ...(prior ?? state), validation: result }));
  }
  if (persist) {
    await recordOutcome({
      projectDir,
      ids,
      outcome: {
        policy: 'completion',
        status: result.status === 'current' ? 'completed' : 'blocked',
        reason: result.reason || 'current',
        changeId: change,
        sessionId: session,
        agentId: agent,
        taskId: binding.task,
        evidence: { digest: pre.inputDigest, freshness: result.status, scope: evidence?.scope ?? null },
      },
    });
  }
  return { ...result, launchesTurn: false, pending: false };
}

async function cancelPending(projectDir, ids, sessionId) {
  await worktreeStore(projectDir, ids).transact('jobs', 'queue', (prior) => {
    if (!prior?.jobs) return prior ?? { jobs: {}, reservation: null };
    for (const job of Object.values(prior.jobs)) {
      if (job.kind === 'completion-validation' && job.status === 'pending' && job.sessionId === sessionId) job.status = 'cancelled';
    }
    return prior;
  });
}

function progressFile(changeId, file) {
  if (typeof file !== 'string') return true;
  const name = file.split('/').pop();
  if (PROGRESS.has(name) && file === `openspec/changes/${changeId}/${name}`) return true;
  return file.startsWith('.agents/.hook-state/') || file.includes('/aok-hooks/');
}

async function advanceEpoch(event, ctx, binding) {
  const origin = event.data?.origin ?? null;
  if (!EPOCH_ORIGINS.has(origin)) return;
  const files = Array.isArray(event.data?.files) ? event.data.files : [];
  const allowed = new Set(binding.files ?? []);
  if (!files.some((file) => allowed.has(file) && !progressFile(binding.changeId, file))) return;
  const intentKey = completionIntentKey(binding.sessionId, binding.agentId, binding.task);
  const store = changeStore(ctx.projectDir, ctx.ids, binding.changeId);
  const state = await store.read('completion-state', intentKey);
  if (!state) return;
  if ((state.seenEvents ?? []).includes(event.eventId)) return;
  await store.transact('completion-state', intentKey, (prior) => {
    const current = prior ?? state;
    if ((current.seenEvents ?? []).includes(event.eventId)) return current;
    return {
      ...current,
      workEpoch: (current.workEpoch ?? 0) + 1,
      seenEvents: [...(current.seenEvents ?? []), event.eventId].slice(-64),
    };
  });
}

async function claimFollowup(store, intentKey, epoch) {
  let granted = false;
  await store.transact('followup-budget', intentKey, (prior) => {
    const current = prior && typeof prior === 'object' ? prior : { epochs: {}, total: 0 };
    const epochs = { ...(current.epochs ?? {}) };
    const used = epochs[String(epoch)] ?? 0;
    const total = current.total ?? 0;
    if (used >= 1 || total >= 2) return { epochs, total };
    granted = true;
    epochs[String(epoch)] = used + 1;
    return { epochs, total: total + 1 };
  });
  return granted;
}

function empty(extra = {}) {
  return { findings: [], decision: null, pending: false, released: false, ...extra };
}

export async function evaluateCompletion(event, ctx) {
  if (ctx?.store?.quarantined === true) {
    return empty({ findings: [{ id: 'completion.identity.quarantined' }] });
  }
  const projectDir = ctx?.config?.projectDir ?? ctx?.projectDir;
  const ids = ctx?.ids;
  const sessionId = event?.scope?.sessionId ?? null;
  const agentId = event?.scope?.agentId ?? null;
  const stop = event?.data?.stopReason ?? null;
  if (BYPASS.has(stop) || event?.data?.outcome?.status === 'cancelled') {
    if (projectDir && ids && sessionId) await cancelPending(projectDir, ids, sessionId);
    return empty();
  }
  if (!projectDir || !ids || !sessionId) return empty({ findings: [{ id: 'completion.identity.unbound' }] });
  const binding = await resolveBinding({ projectDir, ids, sessionId, agentId });
  if (!binding) return empty({ findings: [{ id: 'completion.identity.unbound' }] });
  if (event.kind === 'tool.after') {
    await advanceEpoch(event, { projectDir, ids }, binding);
    return empty();
  }
  if (event.kind !== 'agent.end' || !COMPLETED.has(stop)) return empty();
  const intentKey = completionIntentKey(sessionId, agentId, binding.task);
  const store = changeStore(projectDir, ids, binding.changeId);
  const intent = await store.read('completion-intent', intentKey);
  if (!intent) return empty();
  await enqueueJob({
    projectDir,
    ids,
    kind: 'completion-validation',
    changeId: binding.changeId,
    sessionId,
    agentId,
    taskId: binding.task,
    commandId: event.eventId ?? '',
    paths: [],
  });
  const supported = ctx?.capabilities?.events?.['agent.end']?.followup === true && event?.source?.client !== 'claude';
  const state = await store.read('completion-state', intentKey);
  if (!supported) {
    return {
      findings: [{ id: 'completion.manual.required', reason: 'manual-verification' }],
      decision: null,
      pending: true,
      released: false,
      status: 'pending',
    };
  }
  const granted = await claimFollowup(budgetStore(ctx, sessionId), intentKey, state?.workEpoch ?? 0);
  if (!granted) {
    return {
      findings: [{ id: 'completion.unresolved', reason: 'budget' }],
      decision: null,
      pending: true,
      released: true,
      status: 'pending',
    };
  }
  return {
    findings: [],
    decision: { action: 'followup', reason: 'completion evidence or handoff receipt is missing or stale' },
    pending: true,
    released: false,
    status: 'pending',
  };
}
