// Cursor hooks adapter. Verified against the official hooks reference
// (https://cursor.com/docs/hooks, recorded 2026-11-16): common input fields
// conversation_id/generation_id/hook_event_name/cursor_version/workspace_roots;
// sessionStart returns {env, additional_context} and is fire-and-forget;
// sessionEnd has no output; subagentStart returns permission only (no context
// injection); postToolUse returns additional_context; preCompact is
// observational. Cloud agents do not run sessionStart/sessionEnd.

import { contextText, classifyOperation, echoContext, nativeEventId, nowIso, runAdapter, toRelativePaths } from './shared.js';

export const SOURCE = {
  client: 'cursor',
  docUrl: 'https://cursor.com/docs/hooks',
  recordedAt: '2026-11-16',
  testedVersions: ['3.22.12 (cursor --version on the fixture machine)'],
  notes: 'Payloads carrying a cursor_version outside the tested list downgrade to observation-only. Cloud agents lack sessionStart/sessionEnd by design.',
};

const NATIVE_TO_KIND = {
  sessionStart: 'session.start',
  sessionEnd: 'session.end',
  beforeReadFile: 'tool.before',
  afterFileEdit: 'file.changed',
  postToolUse: 'tool.after',
  subagentStart: 'agent.start',
  subagentStop: 'agent.end',
  stop: 'agent.end',
  preCompact: 'context.compacting',
};

const STOP_REASON = {
  completed: 'completed',
  error: 'error',
  aborted: 'user_cancelled',
  window_close: 'unknown',
  user_close: 'unknown',
  done: 'completed',
  cancelled: 'user_cancelled',
};

function baseCapabilities({ cloud = false } = {}) {
  const events = {};
  const set = (kind, supported, injectContext, deny, followup, reason = null) => {
    events[kind] = { supported, injectContext, deny, followup, reason };
  };
  const cloudNote = cloud ? ' (cloud agents do not run sessionStart/sessionEnd)' : '';
  set('session.start', !cloud, !cloud, false, false, `fire-and-forget additional_context${cloudNote}`);
  set('session.resume', false, false, false, false, 'no native resume event; sessionStart fires per conversation');
  set('session.end', !cloud, false, false, false, `no output; observation only${cloudNote}`);
  set('context.compacting', true, false, false, false, 'preCompact is observational');
  set('context.reset', false, false, false, false, 'no native post-compaction event');
  set('agent.start', true, false, true, false, 'subagentStart has permission output, not context injection');
  set('agent.end', true, false, false, true, 'subagentStop/stop followup_message only');
  set('tool.before', true, false, true, false, 'preToolUse permission allow/deny');
  set('tool.after', true, false, false, false, 'postToolUse additional_context');
  set('file.changed', true, false, false, false, 'afterFileEdit observation');
  return { schemaVersion: 1, client: 'cursor', clientVersion: null, runtime: 'command-hook', events };
}

const LOCAL_CAPABILITIES = baseCapabilities({ cloud: false });
const CLOUD_CAPABILITIES = baseCapabilities({ cloud: true });

export function capabilities(payload = {}) {
  return payload?.is_background_agent === true ? CLOUD_CAPABILITIES : LOCAL_CAPABILITIES;
}

export function downgradedCapabilities(capabilitiesV1) {
  const events = {};
  for (const [kind, entry] of Object.entries(capabilitiesV1.events)) {
    events[kind] = entry.supported
      ? { ...entry, injectContext: false, deny: false, followup: false, reason: `unverified cursor_version: ${entry.reason ?? 'observe only'}` }
      : entry;
  }
  return { ...capabilitiesV1, events };
}

export function versionStatus(payload) {
  const version = typeof payload?.cursor_version === 'string' ? payload.cursor_version : null;
  return { verified: SOURCE.testedVersions.some((tested) => version && version.startsWith(tested.split(' ')[0])), version };
}

function cursorTool(payload) {
  const name = payload?.tool_name ?? (payload?.hook_event_name === 'beforeReadFile' ? 'Read' : null);
  if (!name) return null;
  return {
    id: typeof payload.tool_use_id === 'string' ? payload.tool_use_id : null,
    name,
    operation: classifyOperation(name),
  };
}

function cursorFiles(payload, projectDir, cwd) {
  const raw = payload?.file_path;
  if (raw) return toRelativePaths([raw], projectDir, cwd);
  const input = payload?.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  if (input.file_path) return toRelativePaths([input.file_path], projectDir, cwd);
  return [];
}

// Occurrence ids: only native per-invocation ids participate; events without one
// (file reads/edits, stops, pre-compaction) get a fresh persisted invocation id,
// so identical tool arguments never collapse separate executions.
function occurrenceKeys(payload) {
  const eventName = payload?.hook_event_name;
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : payload.conversation_id;
  if (eventName === 'postToolUse' && typeof payload.tool_use_id === 'string') return [sessionId, payload.tool_use_id];
  if (eventName === 'subagentStart' && typeof payload.tool_call_id === 'string') return [sessionId, payload.tool_call_id];
  if (eventName === 'sessionStart' || eventName === 'sessionEnd') return [sessionId, eventName, payload.generation_id ?? null];
  return null;
}

export function normalize({ payload, projectDir, nativeEvent = null }) {
  const eventName = payload?.hook_event_name;
  const kind = typeof eventName === 'string' && eventName in NATIVE_TO_KIND ? NATIVE_TO_KIND[eventName] : null;
  if (!kind) return null;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : null;
  const sessionId = typeof payload.session_id === 'string'
    ? payload.session_id
    : typeof payload.conversation_id === 'string' ? payload.conversation_id : null;
  const occurrence = occurrenceKeys(payload);
  return {
    schemaVersion: 1,
    eventId: occurrence ? nativeEventId('cursor', occurrence) : nativeEventId('cursor', []),
    occurredAt: nowIso(),
    kind,
    source: {
      client: 'cursor',
      clientVersion: typeof payload.cursor_version === 'string' ? payload.cursor_version : null,
      runtime: typeof payload.is_background_agent === 'boolean' && payload.is_background_agent ? 'cloud-hook' : 'command-hook',
      nativeEvent: nativeEvent ?? { hook_event_name: eventName },
    },
    scope: {
      repoId: null,
      worktreeId: null,
      sessionId,
      agentId: typeof payload.subagent_id === 'string' ? payload.subagent_id : null,
      changeId: null,
    },
    contextEpoch: null,
    data: {
      role: null,
      taskId: null,
      files: cursorFiles(payload, projectDir, cwd),
      tool: cursorTool(payload),
      outcome: eventName === 'postToolUse' ? { status: 'success', exitCode: null } : null,
      stopReason: typeof payload.reason === 'string' && STOP_REASON[payload.reason]
        ? STOP_REASON[payload.reason]
        : typeof payload.status === 'string' && STOP_REASON[payload.status] ? STOP_REASON[payload.status] : null,
    },
  };
}

export function serialize({ event, result, capabilities: caps }) {
  const kindCap = caps.events[event.kind];
  const eventName = event.source.nativeEvent?.hook_event_name;
  const echo = event.kind === 'session.start' ? echoContext(event.scope.sessionId, 'cursor conversationId') : '';
  const injected = contextText(result, null);
  const text = [echo, injected].filter((part) => part !== '').join('\n\n');

  if (event.kind === 'tool.before' && result.decision?.action === 'deny' && kindCap?.deny === true) {
    return { permission: 'deny', user_message: result.decision.reason || 'denied by agent-orchestrator-kit policy' };
  }
  if (event.kind === 'agent.start' && result.decision?.action === 'deny' && kindCap?.deny === true) {
    return { permission: 'deny', user_message: result.decision.reason || 'denied by agent-orchestrator-kit policy' };
  }
  if (event.kind === 'agent.end' && result.decision?.action === 'followup' && kindCap?.followup === true) {
    return { followup_message: result.decision.reason || 'follow-up requested by agent-orchestrator-kit policy' };
  }
  if (kindCap?.injectContext === true && text !== '' && (eventName === 'sessionStart' || eventName === 'postToolUse')) {
    return { additional_context: text };
  }
  return null;
}

export async function run(options) {
  return runAdapter({ adapter: { client: 'cursor', capabilities, downgradedCapabilities, versionStatus, normalize, serialize }, ...options });
}
