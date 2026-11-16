import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { dispatch, builtinPolicies } from '../index.js';
import { createStore } from '../store.js';
import { hookConfigDefaults, parseHookConfig, readRequireSpecReview } from '../install.js';
import { commitContextDelivery } from '../policies/context.js';
import { TOKEN_RE, linkChild, recordSeenSession, resolveBinding } from '../binding.js';

const sha16 = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const GIT_TIMEOUT_MS = 2000;

export function classifyOperation(toolName) {
  const name = String(toolName || '');
  if (/^(read|read_file|view|grep|glob|beforeReadFile)$/i.test(name) || name === 'Read') return 'read';
  if (/^(edit|write|edit_file|notebookedit|afterfileedit|create|apply_patch)$/i.test(name)
    || name === 'Edit' || name === 'Write') return 'write';
  if (/^(bash|shell|terminal|sh|exec|run_command)$/i.test(name)) return 'shell';
  return 'other';
}

export function toRelativePaths(paths, projectDir, cwd = null) {
  const base = resolve(cwd || projectDir);
  const out = [];
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (typeof raw !== 'string' || raw === '') continue;
    const absolute = isAbsolute(raw) ? raw : resolve(base, raw);
    const rel = relative(base, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    if (!out.includes(rel)) out.push(rel);
  }
  return out;
}

export function scopeIds(projectDir) {
  let origin = '';
  try {
    origin = execFileSync('git', ['-C', projectDir, 'config', '--get', 'remote.origin.url'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    }).toString().trim();
  } catch {}
  const absolute = resolve(projectDir);
  return {
    repoId: origin ? `origin-${sha16(origin)}` : `path-${sha16(absolute)}`,
    worktreeId: `wt-${sha16(absolute)}`,
  };
}

export function readHooksConfig(projectDir) {
  const absent = () => ({
    hooks: { ...hookConfigDefaults(), findings: [] },
    pipeline: { require_spec_review: true },
  });
  const orchPath = resolve(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(orchPath)) return absent();
  try {
    const content = readFileSync(orchPath, 'utf8');
    return {
      hooks: parseHookConfig(content),
      pipeline: { require_spec_review: readRequireSpecReview(content) },
    };
  } catch {
    return absent();
  }
}

export const nowIso = () => new Date().toISOString();

export function nativeEventId(client, nativeKeys) {
  const parts = nativeKeys.filter((value) => typeof value === 'string' && value !== '');
  return parts.length > 0 ? `${client}-${sha16(parts.join('\u0000'))}` : `${client}-${randomUUID()}`;
}

export const ECHO_PREFIX = '[aok-hooks] native session id:';

export function echoContext(sessionId, clientLabel) {
  if (!sessionId) return '';
  return `${ECHO_PREFIX} ${sessionId} (${clientLabel})`;
}

function joinContext(items, echo) {
  const texts = [];
  const echoLine = echo || '';
  if (echoLine) texts.push(echoLine);
  for (const item of items) if (item && typeof item.text === 'string' && item.text !== '') texts.push(item.text);
  return texts.join('\n\n');
}

// Shared adapter runner: normalize -> dispatch -> serialize, nonblocking on errors.
export async function runAdapter({ adapter, projectDir, payload, nativeEvent = null, respond = 'stdout' }) {
  const writeError = (message) => process.stderr.write(`[aok-hooks:${adapter.client}] ${message}\n`);
  try {
    const parsed = payload && typeof payload === 'object' ? payload : {};
    const versionStatus = adapter.versionStatus(parsed);
    const capabilities = adapter.capabilities(parsed);
    const event = adapter.normalize({ payload: parsed, projectDir, nativeEvent, versionStatus });
    if (!event) {
      writeError('unrecognized native payload shape — observed only, manual workflow applies');
      return { output: null, event: null };
    }

    const config = { ...readHooksConfig(projectDir), projectDir };
    const ids = scopeIds(projectDir);
    if (config.hooks?.enabled === true) await bindEvent({ projectDir, ids, event, payload: parsed, config, client: adapter.client });
    const store = createStore({
      projectDir,
      scope: {
        level: 'session',
        ...ids,
        changeId: event.scope.changeId,
        sessionId: event.scope.sessionId,
        agentId: event.scope.agentId,
        eventId: event.eventId,
      },
      lockTimeoutMs: 1000,
      pruneIntervalMs: 10 ** 9,
    });
    const signal = AbortSignal.timeout(1400);
    const effectiveCapabilities = versionStatus.verified ? capabilities : adapter.downgradedCapabilities(capabilities);
    const result = await dispatch(event, {
      capabilities: effectiveCapabilities,
      policies: builtinPolicies,
      store,
      config,
      signal,
    });

    const output = adapter.serialize({ event, result, capabilities: effectiveCapabilities, versionStatus });
    try {
      await store.append('audit', {
        id: event.eventId,
        kind: event.kind,
        status: result.decision ? result.decision.action : 'observed',
        durationMs: null,
        eventId: event.eventId,
        sessionId: event.scope.sessionId,
        agentId: event.scope.agentId,
        paths: event.data.files,
      });
    } catch {}

    if (output && respond === 'stdout') {
      await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(output)}\n`, (error) => error ? reject(error) : resolve()));
      await commitContextDelivery({ event, result, output, store });
    }
    return { output, event, result };
  } catch (error) {
    writeError(`adapter error (nonblocking): ${error && error.message ? error.message : String(error)}`);
    return { output: null, event: null };
  }
}

// Resolve explicit bindings only; a presented single-use token links a child identity.
// Unbound or ambiguous identity leaves changeId null with a diagnostic.
async function bindEvent({ projectDir, ids, event, payload, config, client }) {
  try {
    const { sessionId, agentId } = event.scope;
    if (event.kind === 'session.start' || event.kind === 'session.resume') await recordSeenSession({ projectDir, ids, client, sessionId });
    let binding = await resolveBinding({ projectDir, ids, sessionId, agentId });
    if (!binding && ['agent.start', 'session.start'].includes(event.kind)) {
      const token = JSON.stringify(payload).match(TOKEN_RE)?.[0];
      if (token) {
        const linked = await linkChild({ projectDir, ids, token, session: sessionId, agent: agentId });
        if (linked.ok) binding = linked.binding;
        else process.stderr.write(`[aok-hooks:${client}] binding token not linked (${linked.reason}); manual workflow applies\n`);
      }
    }
    if (!binding) return;
    event.scope.changeId = binding.changeId;
    if (!event.data.role) event.data.role = binding.role;
    config.binding = binding;
  } catch (error) {
    process.stderr.write(`[aok-hooks:${client}] binding lookup failed (nonblocking): ${error?.message ?? error}\n`);
  }
}

export function contextText(result, echo) {
  return joinContext(result?.context ?? [], echo);
}
