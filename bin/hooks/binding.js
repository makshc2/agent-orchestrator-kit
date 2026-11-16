// Explicit task binding for the hook runtime. Bindings are local worktree state;
// nothing here infers a change by recency or lets a child inherit without a token.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createStore } from './store.js';

export const TOKEN_TTL_MS = 60 * 60 * 1000;
export const TOKEN_RE = /\baok-bind-[0-9a-f]{32}\b/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const ROLES = new Set(['implementer', 'test-writer', 'code-writer', 'design-implementer', 'conductor', 'implementation', 'testing']);

const fail = (message) => { const error = new Error(message); error.code = 'ERR_HOOK_BIND'; throw error; };
const bindingKey = (sessionId, agentId) => `b-${createHash('sha256').update(`${sessionId}\u0000${agentId ?? ''}`).digest('hex').slice(0, 40)}`;

export function worktreeStore(projectDir, ids, eventId = 'cli') {
  return createStore({ projectDir, scope: { level: 'worktree', ...ids, changeId: null, sessionId: null, agentId: null, eventId }, pruneIntervalMs: 10 ** 9 });
}

// Returns the task's contracted Files (paths only; "new file:" prefixes stripped).
export function taskFiles(projectDir, change, task) {
  const path = join(projectDir, 'openspec', 'changes', change, 'tasks.md');
  if (!existsSync(path)) fail(`change "${change}" has no tasks.md`);
  const lines = readFileSync(path, 'utf8').split('\n');
  const escaped = task.replace(/\./g, '\\.');
  const start = lines.findIndex((line) => new RegExp(`^- \\[[ xX]\\] ${escaped}\\s`).test(line));
  if (start < 0) fail(`task ${task} not found in ${change}/tasks.md`);
  for (let i = start + 1; i < lines.length && !/^- \[|^#/.test(lines[i]); i += 1) {
    const match = lines[i].match(/^\s+Files:\s*(.+)$/);
    if (match) return match[1].split(',').map((item) => item.trim().replace(/^new file:\s*/, '')).filter(Boolean);
  }
  return [];
}

export async function bindSession({ projectDir, ids, change, role, task, session, agent = null, now = Date.now() }) {
  if (!NAME_RE.test(String(change || ''))) fail('--change must be a kebab-case change name');
  if (!existsSync(join(projectDir, 'openspec', 'changes', change))) fail(`change "${change}" does not exist (archived or misspelled)`);
  if (!ROLES.has(String(role || '').toLowerCase())) fail(`--role must be one of ${[...ROLES].join(', ')}`);
  if (!/^\d+(\.\d+)*$/.test(String(task || ''))) fail('--task must be a task id such as 3.4');
  if (!ID_RE.test(String(session || ''))) fail('--session must be the native session id echoed by the runtime');
  if (agent != null && !ID_RE.test(String(agent))) fail('--agent is not a valid id');
  const binding = { changeId: change, role: role.toLowerCase(), task, files: taskFiles(projectDir, change, task), sessionId: session, agentId: agent, boundAt: new Date(now).toISOString(), via: 'explicit' };
  const store = worktreeStore(projectDir, ids);
  await store.transact('bindings', bindingKey(session, agent), () => binding);
  const token = `aok-bind-${randomBytes(16).toString('hex')}`;
  await store.transact('binding-tokens', token, () => ({ parent: binding, expiresAt: now + TOKEN_TTL_MS, used: false }));
  return { binding, token, expiresAt: new Date(now + TOKEN_TTL_MS).toISOString() };
}

// Single-use, short-lived linkage of a child identity to the parent's change/task.
export async function linkChild({ projectDir, ids, token, session, agent = null, role = null, now = Date.now() }) {
  if (!TOKEN_RE.test(String(token || ''))) return { ok: false, reason: 'malformed token' };
  if (!session) return { ok: false, reason: 'child session id unavailable' };
  const store = worktreeStore(projectDir, ids);
  let outcome = { ok: false, reason: 'unknown token' };
  await store.transact('binding-tokens', token, (prior) => {
    if (!prior) return prior;
    if (prior.used) { outcome = { ok: false, reason: 'token already used' }; return prior; }
    if (now > prior.expiresAt) { outcome = { ok: false, reason: 'token expired' }; return { ...prior, used: true }; }
    if (prior.parent.sessionId === session && (prior.parent.agentId ?? null) === (agent ?? null)) {
      outcome = { ok: false, reason: 'token presented by the parent identity' };
      return prior;
    }
    outcome = { ok: true, binding: { ...prior.parent, role: role ?? prior.parent.role, sessionId: session, agentId: agent, boundAt: new Date(now).toISOString(), via: 'token', parentSessionId: prior.parent.sessionId, parentAgentId: prior.parent.agentId ?? null } };
    return { ...prior, used: true };
  });
  if (outcome.ok) await store.transact('bindings', bindingKey(session, agent), () => outcome.binding);
  return outcome;
}

// Exact identity only: a child (agentId set) never falls back to the parent session binding.
export async function resolveBinding({ projectDir, ids, sessionId, agentId = null }) {
  if (!sessionId) return null;
  return worktreeStore(projectDir, ids).read('bindings', bindingKey(sessionId, agentId));
}

const MAX_SEEN = 32;

export async function recordSeenSession({ projectDir, ids, client, sessionId, now = Date.now() }) {
  if (!sessionId) return;
  await worktreeStore(projectDir, ids).transact('sessions', 'index', (prior) => {
    const rest = (prior?.sessions ?? []).filter((entry) => !(entry.client === client && entry.sessionId === sessionId));
    return { sessions: [{ client, sessionId, lastSeenAt: new Date(now).toISOString() }, ...rest].slice(0, MAX_SEEN) };
  });
}

// Advisory only: when several sessions share a worktree, the injected start context is authoritative.
export async function seenSessions({ projectDir, ids }) {
  const record = await worktreeStore(projectDir, ids).read('sessions', 'index');
  return record?.sessions ?? [];
}
