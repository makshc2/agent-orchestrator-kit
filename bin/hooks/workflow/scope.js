import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { approvalRevision, tasksDigestText } from '../../recovery-sources.js';
import { readHooksConfig } from '../adapters/shared.js';
import { resolveBinding } from '../binding.js';
import { recordOutcome } from './outcomes.js';

const PROGRESS_ROLES = new Set(['implementer', 'conductor', 'implementation']);

function empty() {
  return { context: [], findings: [], decision: null };
}

function decision(action, reason) {
  return { context: [], findings: [], decision: { action, reason } };
}

function finding(code, message, paths = []) {
  return { context: [], findings: [{ code, severity: 'warn', message, paths }], decision: null };
}

function digestText(text) {
  return createHash('sha256').update(tasksDigestText('tasks.md', text)).digest('hex');
}

function lexicalRelative(projectDir, input) {
  if (typeof input !== 'string' || input === '') return null;
  let root;
  try {
    root = realpathSync(projectDir);
  } catch {
    return null;
  }
  let rel = input;
  if (isAbsolute(input)) {
    rel = relative(root, resolve(input));
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
  }
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

function follow(projectDir, lexical) {
  let root;
  try {
    root = realpathSync(projectDir);
  } catch {
    return null;
  }
  let current = root;
  for (const part of lexical.split('/')) {
    const next = join(current, part);
    try {
      if (lstatSync(next).isSymbolicLink()) {
        const target = realpathSync(next);
        const escaped = relative(root, target);
        if (escaped.startsWith('..') || isAbsolute(escaped)) return null;
        current = target;
        continue;
      }
    } catch {
      current = next;
      continue;
    }
    current = next;
  }
  const out = relative(root, current);
  if (!out || out.startsWith('..') || isAbsolute(out)) return null;
  return out.split(sep).join('/');
}

function inspect(projectDir, input) {
  const lexical = lexicalRelative(projectDir, input);
  if (!lexical) return null;
  const resolved = follow(projectDir, lexical);
  if (!resolved) return null;
  return { lexical, resolved, linked: resolved !== lexical };
}

function parentProgress(binding) {
  return binding?.via === 'explicit' && binding.parentSessionId == null && PROGRESS_ROLES.has(binding.role);
}

function progressKind(projectDir, changeId, seen) {
  if (!seen || seen.linked || seen.lexical !== seen.resolved) return null;
  if (seen.resolved === `openspec/changes/${changeId}/tasks.md`) return 'tasks';
  if (seen.resolved === `openspec/changes/${changeId}/handoff.md`) return 'handoff';
  return null;
}

function inFiles(projectDir, binding, seen) {
  if (!seen) return false;
  return (binding.files ?? []).some((root) => {
    const allowed = inspect(projectDir, root);
    if (!allowed) return false;
    return seen.resolved === allowed.resolved || seen.resolved.startsWith(`${allowed.resolved}/`);
  });
}

function proposedText(event) {
  const bags = [event?.data?.tool, event?.data, event?.source?.nativeEvent?.tool_input, event?.source?.nativeEvent?.input];
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object') continue;
    for (const key of ['contents', 'content', 'file_text', 'new_contents', 'after']) {
      if (typeof bag[key] === 'string') return bag[key];
    }
  }
  return null;
}

function operationOf(event) {
  const name = event?.data?.tool?.name ?? '';
  const operation = event?.data?.tool?.operation ?? '';
  if (operation === 'read' || operation === 'shell' || operation === 'write') return operation;
  if (/^(bash|shell|terminal|sh|exec|run_command)$/i.test(name)) return 'shell';
  if (/^(read|read_file|view|grep|glob)$/i.test(name) || name === 'Read') return 'read';
  if (/^(edit|write|edit_file|notebookedit|create|apply_patch)$/i.test(name) || name === 'Edit' || name === 'Write') return 'write';
  return operation || 'other';
}

async function publish(projectDir, event, binding, status, reason, digest) {
  const scope = event.scope ?? {};
  await recordOutcome({
    projectDir,
    ids: { repoId: scope.repoId ?? null, worktreeId: scope.worktreeId ?? null },
    outcome: {
      policy: 'scope',
      status,
      reason,
      changeId: binding?.changeId ?? null,
      sessionId: scope.sessionId ?? null,
      agentId: scope.agentId ?? null,
      taskId: binding?.task ?? event.data?.taskId ?? null,
      source: { eventId: event.eventId ?? null, jobId: null },
      evidence: {
        digest: digest ?? null,
        freshness: status,
        scope: { mode: 'scope', files: Array.isArray(event.data?.files) ? event.data.files : [] },
      },
    },
  });
}

async function noteContract(projectDir, event, binding, revision) {
  const tasksPath = `openspec/changes/${binding.changeId}/tasks.md`;
  const files = Array.isArray(event?.data?.files) ? event.data.files : [];
  const touched = files.some((file) => {
    const seen = inspect(projectDir, file);
    return seen && seen.resolved === tasksPath && !seen.linked;
  });
  if (!touched) return;
  let current = null;
  try {
    current = digestText(readFileSync(join(projectDir, tasksPath), 'utf8'));
  } catch {
    current = null;
  }
  if (current && binding.tasksDigest && current !== binding.tasksDigest) {
    await publish(projectDir, event, binding, 'violation', 'task-contract', revision?.digest ?? null);
  }
}

export async function evaluateScopePolicy(event, ctx) {
  try {
    const kind = event?.kind;
    const post = kind === 'tool.after' || kind === 'file.changed';
    const pre = kind === 'tool.before';
    if (!pre && !post) return empty();
    if (ctx?.signal?.aborted) return finding('scope.approval.unknown', 'scope check stopped before the approval read finished');
    const projectDir = ctx?.config?.projectDir;
    const operation = operationOf(event);
    if (operation === 'read') return empty();
    const files = Array.isArray(event?.data?.files) ? event.data.files.filter((file) => typeof file === 'string') : [];
    if (!projectDir) {
      if (operation === 'shell' || files.length === 0) return finding('scope.coverage.unknown', 'write paths are not visible before execution');
      return decision('deny', 'scope could not be resolved');
    }
    const scope = event.scope ?? {};
    const binding = scope.sessionId
      ? await resolveBinding({
        projectDir,
        ids: { repoId: scope.repoId ?? null, worktreeId: scope.worktreeId ?? null },
        sessionId: scope.sessionId,
        agentId: scope.agentId ?? null,
      })
      : null;
    if (operation === 'shell' || files.length === 0) {
      await publish(projectDir, event, binding, 'coverage-gap', 'coverage-gap', null);
      return finding('scope.coverage.unknown', 'shell or hidden writes are not visible before execution', files);
    }
    if (!binding) {
      await publish(projectDir, event, null, 'denied', 'unbound', null);
      return pre
        ? decision('deny', 'no explicit binding for this session')
        : finding('scope.coverage.unknown', 'post-edit paths have no explicit binding', files);
    }
    const role = typeof event.data?.role === 'string' && event.data.role !== '' ? event.data.role.toLowerCase() : binding.role;
    let revision = null;
    const reviewRequired = readHooksConfig(projectDir).pipeline.require_spec_review !== false;
    let live = !reviewRequired;
    if (reviewRequired) {
      if (ctx?.signal?.aborted) {
        await publish(projectDir, event, binding, 'denied', 'approval-unknown', null);
        return decision('deny', 'approval could not be read before the deadline');
      }
      revision = approvalRevision(projectDir, binding.changeId);
      live = revision.state === 'current'
        && /^approve/i.test(revision.verdict || '')
        && Boolean(binding.approval)
        && revision.reviewSha === binding.approval.reviewSha
        && revision.reviewDigest === binding.approval.reviewDigest
        && revision.digest === binding.approval.digest;
    }
    if (post) await noteContract(projectDir, event, binding, revision);
    if (role !== binding.role) {
      await publish(projectDir, event, binding, 'denied', 'forbidden-role', revision?.digest ?? null);
      return pre ? decision('deny', `role ${role} does not match the bound role`) : empty();
    }
    if (!live) {
      const reason = !binding.approval || revision?.state === 'rejected' || revision?.state === 'unknown' ? 'approval-missing' : 'approval-stale';
      await publish(projectDir, event, binding, 'denied', reason, revision?.digest ?? null);
      return pre
        ? decision('deny', reason === 'approval-stale' ? 'approval revision is stale' : 'approval is missing or not current')
        : empty();
    }
    if (post) return empty();
    const seen = files.map((file) => inspect(projectDir, file));
    if (seen.some((item) => !item)) {
      await publish(projectDir, event, binding, 'denied', 'path-escape', revision?.digest ?? null);
      return decision('deny', 'path escapes the project or a canonical root');
    }
    const kinds = seen.map((item) => {
      if (inFiles(projectDir, binding, item)) return 'files';
      const progress = progressKind(projectDir, binding.changeId, item);
      if (progress && parentProgress(binding)) return progress;
      if (item.linked) return 'escape';
      return 'outside';
    });
    if (kinds.some((kind) => kind === 'escape')) {
      await publish(projectDir, event, binding, 'denied', 'path-escape', revision?.digest ?? null);
      return decision('deny', 'path escapes the project or a canonical root');
    }
    if (kinds.some((kind) => kind === 'outside')) {
      await publish(projectDir, event, binding, 'denied', 'outside-files', revision?.digest ?? null);
      return decision('deny', 'path is outside the bound task files');
    }
    if (kinds.includes('tasks')) {
      const proposed = proposedText(event);
      if (proposed != null && digestText(readTasks(projectDir, binding.changeId)) !== digestText(proposed)) {
        await publish(projectDir, event, binding, 'denied', 'task-contract', revision?.digest ?? null);
        return decision('deny', 'tasks.md change is not limited to checkbox toggles');
      }
    }
    const reason = kinds.every((kind) => kind === 'files') ? 'task file is in the bound Files list' : 'bound change progress file';
    return decision('allow', reason);
  } catch {
    return decision('deny', 'scope could not be resolved');
  }
}

function readTasks(projectDir, changeId) {
  try {
    return readFileSync(join(projectDir, 'openspec', 'changes', changeId, 'tasks.md'), 'utf8');
  } catch {
    return '';
  }
}
