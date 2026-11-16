import { scopeIds } from '../adapters/shared.js';
import { resolveBinding } from '../binding.js';
import { resolvePolicyOptions } from '../install.js';
import { evaluateCompletion as evaluateCompletionEvent } from '../workflow/completion.js';
import { enqueueJob } from '../workflow/jobs.js';
import { drainOutcomes } from '../workflow/notifications.js';
import { recordOutcome } from '../workflow/outcomes.js';
import { evaluateScopePolicy } from '../workflow/scope.js';
import { changeStore } from '../workflow/stores.js';
import { enqueueScopedChecks, ensureWorker } from '../workflow/worker.js';

const WORKFLOW_EVENTS = Object.freeze(['tool.before', 'tool.after', 'file.changed', 'agent.end', 'session.end']);

function emptyResult() {
  return { context: [], findings: [], decision: null };
}

function runtime(ctx, event) {
  const projectDir = ctx?.config?.projectDir ?? ctx?.projectDir ?? null;
  if (!projectDir) return null;
  const scope = event?.scope ?? {};
  const ids = scope.repoId && scope.worktreeId
    ? { repoId: scope.repoId, worktreeId: scope.worktreeId }
    : ctx?.ids?.repoId && ctx?.ids?.worktreeId
      ? ctx.ids
      : scopeIds(projectDir);
  return { projectDir, ids };
}

async function evaluateVerification(event, ctx) {
  if (event?.kind !== 'tool.after' && event?.kind !== 'file.changed') return emptyResult();
  const where = runtime(ctx, event);
  if (!where) return emptyResult();
  const binding = await resolveBinding({
    projectDir: where.projectDir,
    ids: where.ids,
    sessionId: event?.scope?.sessionId ?? null,
    agentId: event?.scope?.agentId ?? null,
  });
  if (!binding) return emptyResult();
  const store = changeStore(where.projectDir, where.ids, binding.changeId);
  if (store) {
    await store.transact('verification-evidence', 'latest', (prior) => ({
      ...(prior ?? {}),
      reusable: false,
      status: 'stale',
    }));
  }
  return {
    context: [],
    findings: [{
      code: 'verification.evidence.stale',
      severity: 'warn',
      message: 'verification evidence is stale',
      paths: Array.isArray(event?.data?.files) ? event.data.files.filter((file) => typeof file === 'string') : [],
    }],
    decision: null,
  };
}

async function evaluateCompletion(event, ctx) {
  if (event?.kind === 'tool.after' && event?.data?.origin === 'worker') return emptyResult();
  if (!['tool.after', 'agent.end', 'session.end'].includes(event?.kind)) return emptyResult();
  const where = runtime(ctx, event);
  if (!where) return emptyResult();
  const result = await evaluateCompletionEvent(event, {
    ...ctx,
    projectDir: where.projectDir,
    ids: where.ids,
  });
  const notable = Boolean(result?.decision) || result?.pending === true || (result?.findings ?? []).length > 0;
  if (notable) {
    const binding = await resolveBinding({
      projectDir: where.projectDir,
      ids: where.ids,
      sessionId: event?.scope?.sessionId ?? null,
      agentId: event?.scope?.agentId ?? null,
    });
    await recordOutcome({
      projectDir: where.projectDir,
      ids: where.ids,
      outcome: {
        policy: 'completion',
        status: 'pending',
        reason: result.decision?.reason || result.findings?.[0]?.id || 'pending',
        changeId: binding?.changeId ?? null,
        sessionId: event?.scope?.sessionId ?? null,
        agentId: event?.scope?.agentId ?? null,
        taskId: binding?.task ?? null,
        source: { eventId: event.eventId ?? null, jobId: null },
      },
    });
  }
  return {
    context: [],
    findings: (result?.findings ?? []).map((finding) => ({
      code: finding.id || finding.code || 'completion.note',
      severity: 'warn',
      message: finding.reason || finding.id || 'completion',
      paths: [],
    })),
    decision: result?.decision ?? null,
  };
}

async function evaluateScope(event, ctx) {
  return evaluateScopePolicy(event, ctx);
}

async function evaluateChecks(event, ctx, options) {
  const where = runtime(ctx, event);
  if (!where) return emptyResult();
  const { projectDir, ids } = where;
  const binding = await resolveBinding({
    projectDir,
    ids,
    sessionId: event?.scope?.sessionId ?? null,
    agentId: event?.scope?.agentId ?? null,
  });
  await enqueueScopedChecks({ projectDir, ids, event, options, binding });
  return emptyResult();
}

async function evaluateOwnedSync(event, ctx) {
  if (event?.kind !== 'tool.after' && event?.kind !== 'file.changed') return emptyResult();
  const files = (event?.data?.files ?? []).filter((file) => typeof file === 'string' && (file.startsWith('.agents/') || file.startsWith('templates/')));
  if (files.length === 0) return emptyResult();
  const where = runtime(ctx, event);
  if (!where) return emptyResult();
  const binding = await resolveBinding({
    projectDir: where.projectDir,
    ids: where.ids,
    sessionId: event?.scope?.sessionId ?? null,
    agentId: event?.scope?.agentId ?? null,
  });
  const queued = await enqueueJob({
    projectDir: where.projectDir,
    ids: where.ids,
    kind: 'owned-sync',
    changeId: binding?.changeId ?? null,
    sessionId: binding?.sessionId ?? event?.scope?.sessionId ?? null,
    agentId: binding?.agentId ?? event?.scope?.agentId ?? null,
    taskId: binding?.task ?? null,
    paths: files,
    commandId: event.eventId ?? 'owned-sync',
  });
  await ensureWorker({ projectDir: where.projectDir, ids: where.ids, jobId: queued.jobId });
  return emptyResult();
}

async function evaluateWorkflowNotifications(event, ctx) {
  if (event?.kind !== 'agent.end' && event?.kind !== 'session.end') return emptyResult();
  const where = runtime(ctx, event);
  if (!where) return emptyResult();
  await drainOutcomes({
    projectDir: where.projectDir,
    ids: where.ids,
    ctx,
    match: event?.scope?.sessionId ? { sessionId: event.scope.sessionId } : null,
  });
  return emptyResult();
}

async function evaluateGuarded(id, event, ctx, handle) {
  const hooks = ctx?.config?.hooks;
  const entry = hooks?.policies?.[id];
  if (hooks?.enabled !== true || entry?.enabled !== true) return emptyResult();
  const resolved = resolvePolicyOptions(id, entry.options ?? {});
  if (!resolved.ok) {
    return {
      context: [],
      findings: [{ code: 'hooks.policy.config.invalid', severity: 'error', message: resolved.message, paths: [] }],
      decision: null,
    };
  }
  return handle(event, ctx, resolved.options);
}

export const workflowPolicies = [
  {
    id: 'verification',
    events: WORKFLOW_EVENTS,
    evaluate: (event, ctx) => evaluateGuarded('verification', event, ctx, evaluateVerification),
  },
  {
    id: 'completion',
    events: WORKFLOW_EVENTS,
    evaluate: (event, ctx) => evaluateGuarded('completion', event, ctx, evaluateCompletion),
  },
  {
    id: 'scope',
    events: WORKFLOW_EVENTS,
    evaluate: (event, ctx) => evaluateGuarded('scope', event, ctx, evaluateScope),
  },
  {
    id: 'checks',
    events: WORKFLOW_EVENTS,
    evaluate: (event, ctx) => evaluateGuarded('checks', event, ctx, evaluateChecks),
  },
  {
    id: 'owned-sync',
    events: WORKFLOW_EVENTS,
    evaluate: (event, ctx) => evaluateGuarded('owned-sync', event, ctx, evaluateOwnedSync),
  },
  {
    id: 'workflow-notifications',
    events: WORKFLOW_EVENTS,
    evaluate: (event, ctx) => evaluateGuarded('workflow-notifications', event, ctx, evaluateWorkflowNotifications),
  },
];
