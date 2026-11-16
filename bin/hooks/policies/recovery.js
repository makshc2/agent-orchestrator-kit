// Metrics-neutral recovery: bounded briefing on bound start/resume/reset and
// technical snapshots in local hook storage. Never calls handoff --restore,
// bare checkpoint or metrics code, and never writes change artifacts.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { collectRecoverySources } from '../../recovery-sources.js';
import { buildRecoveryBriefing } from '../../session-recovery.js';

const SNAPSHOT_VERSION = 1;
const MAX_PATHS = 200;
const ARTIFACTS = ['proposal.md', 'design.md', 'tasks.md', 'review.md', 'design-brief.md'];
const BRIEF_KINDS = new Set(['session.start', 'session.resume', 'context.reset']);
const SNAPSHOT_KINDS = new Set(['file.changed', 'agent.end', 'context.compacting']);
const finding = (code, message, paths = []) => ({ code, severity: 'info', message, paths });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function git(projectDir, args) {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).toString();
  } catch {
    return null;
  }
}

function artifactDigests(projectDir, changeId) {
  const dir = join(projectDir, 'openspec', 'changes', changeId);
  const out = {};
  const visit = (rel) => {
    const abs = join(dir, rel);
    let st;
    try { st = statSync(abs); } catch { return; }
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) visit(rel ? `${rel}/${name}` : name);
    } else if (ARTIFACTS.includes(rel) || (rel.startsWith('specs/') && rel.endsWith('.md'))) {
      out[rel] = sha(readFileSync(abs));
    }
  };
  if (existsSync(dir)) visit('');
  return out;
}

// Technical capture only: sourced HEAD, changed paths, bound task, artifact digests and
// observed outcome references. Semantic done/blocked/next/decisions are never stored.
export function buildSnapshot({ projectDir, event, binding = null, trigger }) {
  const head = git(projectDir, ['rev-parse', 'HEAD']);
  const status = git(projectDir, ['status', '--porcelain']);
  const changeId = event.scope?.changeId ?? null;
  const outcome = event.data?.outcome?.status ? { eventId: event.eventId, kind: event.kind, status: event.data.outcome.status } : null;
  return {
    version: SNAPSHOT_VERSION,
    trigger,
    capturedAt: new Date().toISOString(),
    eventId: event.eventId ?? null,
    sessionId: event.scope?.sessionId ?? null,
    agentId: event.scope?.agentId ?? null,
    changeId,
    head: head ? { value: head.trim(), source: 'git rev-parse HEAD' } : null,
    changedPaths: status == null ? null : status.split('\n').filter(Boolean).map((line) => line.slice(3)).slice(0, MAX_PATHS),
    task: binding?.task ?? null,
    artifacts: changeId ? artifactDigests(projectDir, changeId) : {},
    outcomes: outcome ? [outcome] : [],
  };
}

export function validSnapshot(record) {
  return Boolean(record) && record.version === SNAPSHOT_VERSION && typeof record.capturedAt === 'string'
    && !Number.isNaN(Date.parse(record.capturedAt)) && typeof record.trigger === 'string';
}

export async function captureSnapshot({ projectDir, event, store, binding = null, trigger = 'explicit' }) {
  const snapshot = buildSnapshot({ projectDir, event, binding, trigger });
  await store.transact('snapshots', 'latest', () => snapshot);
  return snapshot;
}

function snapshotLines(record) {
  const lines = [`[aok-hooks] technical snapshot observed at ${record.capturedAt} (${record.trigger}); stale observation, not current fact, and not proof of passing tests or completion.`];
  if (record.head) lines.push(`- HEAD then: ${record.head.value.slice(0, 12)} [${record.head.source}]`);
  if (record.task) lines.push(`- bound task then: ${record.task}`);
  if (Array.isArray(record.changedPaths)) lines.push(`- changed paths then: ${record.changedPaths.length}`);
  return lines;
}

export const recoveryPolicy = {
  id: 'recovery',
  events: [...BRIEF_KINDS, ...SNAPSHOT_KINDS],
  async evaluate(event, ctx) {
    const result = { context: [], findings: [], decision: null };
    if (ctx.config?.hooks?.enabled !== true) return result;
    const projectDir = ctx.config?.projectDir;
    const changeId = event.scope?.changeId;
    if (!projectDir || !changeId || !event.scope?.sessionId || !ctx.store) {
      if (BRIEF_KINDS.has(event.kind)) result.findings.push(finding('recovery.unbound', 'No explicit binding; use the canonical once-per-session restore.'));
      return result;
    }
    if (SNAPSHOT_KINDS.has(event.kind)) {
      await captureSnapshot({ projectDir, event, store: ctx.store, binding: ctx.config?.binding, trigger: event.kind });
      return result;
    }
    const lines = [];
    try {
      lines.push(...buildRecoveryBriefing(collectRecoverySources(projectDir, changeId), { changeName: changeId }));
    } catch (error) {
      result.findings.push(finding('recovery.briefing.failed', String(error?.message ?? error).split('\n')[0]));
    }
    let snapshot = null;
    try { snapshot = await ctx.store.read('snapshots', 'latest'); } catch { snapshot = null; }
    const extra = validSnapshot(snapshot) ? snapshotLines(snapshot) : [];
    if (extra.length === 0) result.findings.push(finding('recovery.snapshot.missing', snapshot ? 'Local snapshot is invalid and was ignored.' : 'No local snapshot for this session.'));
    if (event.data?.runtime === 'cloud') result.findings.push(finding('recovery.cloud.unsupported', 'Cloud runtime state is not available locally.'));
    if (event.kind !== 'context.reset' && ctx.capabilities?.events?.['context.reset'] == null) {
      result.findings.push(finding('recovery.reset.unsupported', 'This client does not report context resets; re-run the canonical restore after a reset.'));
    }
    if (ctx.capabilities?.events?.[event.kind]?.injectContext === true) {
      // The briefing keeps its own 4096-byte/40-line bound; the snapshot is a separate small item.
      if (lines.length > 0) result.context.push({ id: `recovery-${changeId}`, text: lines.join('\n') });
      if (extra.length > 0) result.context.push({ id: `recovery-snapshot-${changeId}`, text: Buffer.from(extra.join('\n')).subarray(0, 1024).toString('utf8').replace(/\uFFFD$/, '') });
    }
    return result;
  },
};
