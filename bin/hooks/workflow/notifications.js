import { readHooksConfig } from '../adapters/shared.js';
import { sanitizeRecord } from '../diagnostics.js';
import { resolvePolicyOptions } from '../install.js';
import { ackOutcome, readOutcomes } from './outcomes.js';
import { worktreeStore } from './stores.js';

const MESSAGES = {
  'verification.evidence.stale': 'Verification evidence is stale.',
  'verification.narrowed': 'Verification covered a narrowed scope.',
  'verification.skipped': 'Verification did not run because no command is configured.',
  'verification.manual': 'Verification needs a manual check.',
  'owned-sync.conflict': 'Owned sync left a conflict in place.',
  'checks.timeout': 'A scoped check timed out.',
  'checks.failed': 'A scoped check failed.',
  'completion.pending': 'Completion is still pending.',
  'completion.blocked': 'Completion is blocked.',
};

function notificationsEnabled(projectDir) {
  const config = readHooksConfig(projectDir);
  const entry = config.hooks?.policies?.['workflow-notifications'];
  return config.hooks?.enabled === true && entry?.enabled === true;
}

function dedupWindow(projectDir) {
  const config = readHooksConfig(projectDir);
  const resolved = resolvePolicyOptions('workflow-notifications', config.hooks?.policies?.['workflow-notifications']?.options ?? {});
  return resolved.ok ? resolved.options.dedupMs : 60000;
}

function stableCode(outcome) {
  const reason = outcome?.reason || outcome?.evidence?.freshness || '';
  const known = {
    stale: 'verification.evidence.stale',
    'stale-evidence': 'verification.evidence.stale',
    narrowed: 'verification.narrowed',
    skipped: 'verification.skipped',
    'skipped-no-command': 'verification.skipped',
    'manual-failure': 'verification.manual',
    conflict: 'owned-sync.conflict',
    timeout: 'checks.timeout',
    failed: 'checks.failed',
    pending: 'completion.pending',
    blocked: 'completion.blocked',
  };
  if (known[reason]) return known[reason];
  if (String(reason).startsWith('exit-') || (outcome?.policy === 'checks' && outcome?.status === 'failed')) return 'checks.failed';
  if (known[outcome?.status]) return known[outcome.status];
  return 'workflow.notice';
}

export function noticeRecord(outcome) {
  const code = stableCode(outcome);
  const files = Array.isArray(outcome?.evidence?.scope?.files) ? outcome.evidence.scope.files : [];
  return sanitizeRecord({
    id: outcome?.outcomeId ?? 'workflow-notice',
    type: 'workflow-notice',
    code,
    severity: outcome?.status === 'failed' || outcome?.status === 'blocked' ? 'error' : 'info',
    message: MESSAGES[code] || 'Workflow outcome recorded.',
    status: outcome?.status ?? 'unknown',
    digest: outcome?.evidence?.digest ?? undefined,
    durationMs: outcome?.duration ?? undefined,
    eventId: outcome?.source?.eventId ?? undefined,
    sessionId: outcome?.sessionId ?? undefined,
    agentId: outcome?.agentId ?? undefined,
    changeId: outcome?.changeId ?? undefined,
    repoId: outcome?.repoId ?? undefined,
    worktreeId: outcome?.worktreeId ?? undefined,
    paths: files,
  });
}

function dedupKey(outcome) {
  return [outcome?.outcomeId ?? '', outcome?.sessionId ?? '', outcome?.changeId ?? '', outcome?.reason ?? ''].join('\u0000');
}

async function claim(projectDir, ids, outcome, now) {
  const windowMs = dedupWindow(projectDir);
  let fresh = false;
  await worktreeStore(projectDir, ids).transact('notice-dedup', 'seen', (prior) => {
    const entries = { ...(prior?.entries ?? {}) };
    const key = dedupKey(outcome);
    const seenAt = entries[key];
    if (typeof seenAt === 'number' && now - seenAt < windowMs) return { entries };
    entries[key] = now;
    fresh = true;
    return { entries };
  });
  return fresh;
}

export async function notifyOutcome({ projectDir, ids, outcome, ctx = null, now = Date.now() } = {}) {
  if (!notificationsEnabled(projectDir)) return { delivered: false, retained: true, record: null };
  if (!outcome) return { delivered: false, retained: true, record: null };
  const fresh = await claim(projectDir, ids, outcome, now);
  const record = noticeRecord(outcome);
  if (!fresh) return { delivered: false, coalesced: true, retained: false, record };
  if (typeof ctx?.notify === 'function') ctx.notify({ code: record.code, message: record.message });
  else await worktreeStore(projectDir, ids).append('diagnostics', record);
  return { delivered: true, coalesced: false, retained: false, record };
}

export async function drainOutcomes({ projectDir, ids, ctx = null, match = null, now = Date.now() } = {}) {
  if (!notificationsEnabled(projectDir)) {
    const pending = await readOutcomes({ projectDir, ids, now, match });
    return { delivered: 0, retained: pending.length };
  }
  const pending = await readOutcomes({ projectDir, ids, now, match });
  let delivered = 0;
  for (const outcome of pending) {
    const result = await notifyOutcome({ projectDir, ids, outcome, ctx, now });
    if (result.delivered || result.coalesced) {
      await ackOutcome({ projectDir, ids, outcomeId: outcome.outcomeId });
      if (result.delivered) delivered += 1;
    }
  }
  return { delivered, retained: 0 };
}
