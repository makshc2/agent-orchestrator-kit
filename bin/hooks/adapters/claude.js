// Claude Code hooks adapter. Verified against the official hooks reference
// (https://code.claude.com/docs/en/hooks, recorded 2026-11-16): common input
// fields session_id/prompt_id/transcript_path/cwd/hook_event_name (+ agent_id,
// agent_type inside subagents); SessionStart/SubagentStart accept
// hookSpecificOutput.additionalContext only (no decision control); PreToolUse
// takes hookSpecificOutput.permissionDecision; PostToolUse runs after success;
// SubagentStop/Stop accept hookSpecificOutput.additionalContext; PreCompact is
// observational (exit-2 block only, unused here); SessionEnd is cleanup.

import { contextText, classifyOperation, echoContext, nativeEventId, nowIso, runAdapter, toRelativePaths } from './shared.js';

export const SOURCE = {
  client: 'claude',
  docUrl: 'https://code.claude.com/docs/en/hooks',
  recordedAt: '2026-11-16',
  testedVersions: ['shape-verified (hook_event_name input; no in-band version field)'],
  notes: 'Capabilities verified by payload shape: Claude hook input carries no version, so unknown shapes downgrade to observation.',
};

const NATIVE_TO_KIND = {
  SessionStart: 'session.start',
  SubagentStart: 'agent.start',
  SubagentStop: 'agent.end',
  PreToolUse: 'tool.before',
  PostToolUse: 'tool.after',
  PreCompact: 'context.compacting',
  PostCompact: 'context.reset',
  SessionEnd: 'session.end',
};

const READ_TOOLS = new Set(['Read']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function baseCapabilities() {
  const events = {};
  const set = (kind, supported, injectContext, deny, followup, reason = null) => {
    events[kind] = { supported, injectContext, deny, followup, reason };
  };
  set('session.start', true, true, false, false);
  set('session.resume', true, true, false, false, 'SessionStart source=resume');
  set('session.end', true, false, false, false, 'cleanup observation, never proof of completion');
  set('context.compacting', true, false, false, false, 'PreCompact is observational in this runtime');
  set('context.reset', true, true, false, false, 'SessionStart source=clear|compact or PostCompact');
  set('agent.start', true, true, false, false, 'SubagentStart cannot deny a spawn');
  set('agent.end', true, true, false, false, 'SubagentStop accepts additionalContext; still an observation');
  set('tool.before', true, false, true, false);
  set('tool.after', true, false, false, false);
  set('file.changed', false, false, false, false, 'FileChanged is an async watch event this kit does not install');
  return { schemaVersion: 1, client: 'claude', clientVersion: null, runtime: 'command-hook', events };
}

const CAPABILITIES = baseCapabilities();

export function capabilities() {
  return CAPABILITIES;
}

export function downgradedCapabilities(capabilitiesV1) {
  const events = {};
  for (const [kind, entry] of Object.entries(capabilitiesV1.events)) {
    events[kind] = entry.supported
      ? { ...entry, injectContext: false, deny: false, followup: false, reason: `unverified payload shape: ${entry.reason ?? 'observe only'}` }
      : entry;
  }
  return { ...capabilitiesV1, events };
}

export function versionStatus(payload) {
  const eventName = payload?.hook_event_name;
  return { verified: typeof eventName === 'string' && eventName in NATIVE_TO_KIND, version: null };
}

function claudeKind(eventName, payload) {
  if (eventName === 'SessionStart') {
    const source = payload?.source;
    if (source === 'resume') return 'session.resume';
    if (source === 'clear' || source === 'compact') return 'context.reset';
    return 'session.start';
  }
  return NATIVE_TO_KIND[eventName] ?? null;
}

function claudeTool(payload) {
  const name = payload?.tool_name ?? null;
  if (!name) return null;
  const input = payload?.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const operation = READ_TOOLS.has(name) ? 'read' : WRITE_TOOLS.has(name) ? 'write' : classifyOperation(name);
  return { id: typeof payload.tool_use_id === 'string' ? payload.tool_use_id : null, name, operation };
}

function claudeFiles(payload, projectDir, cwd) {
  const input = payload?.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const raw = input.file_path ?? input.path ?? input.notebook_path ?? null;
  if (raw) return toRelativePaths([raw], projectDir, cwd);
  if (payload?.tool_name === 'Bash') return [];
  return [];
}

export function normalize({ payload, projectDir, nativeEvent = null }) {
  const eventName = payload?.hook_event_name;
  const kind = typeof eventName === 'string' ? claudeKind(eventName, payload) : null;
  if (!kind) return null;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : null;
  return {
    schemaVersion: 1,
    eventId: nativeEventId('claude', [payload.session_id, eventName, payload.tool_use_id, payload.prompt_id]),
    occurredAt: nowIso(),
    kind,
    source: {
      client: 'claude',
      clientVersion: null,
      runtime: 'command-hook',
      nativeEvent: nativeEvent ?? { hook_event_name: eventName, source: payload.source ?? null },
    },
    scope: {
      repoId: null,
      worktreeId: null,
      sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
      agentId: typeof payload.agent_id === 'string' ? payload.agent_id : null,
      changeId: null,
    },
    contextEpoch: null,
    data: {
      role: null,
      taskId: null,
      files: claudeFiles(payload, projectDir, cwd),
      tool: claudeTool(payload),
      outcome: eventName === 'PostToolUse' ? { status: 'success', exitCode: null } : null,
      stopReason: null,
    },
  };
}

export function serialize({ event, result, capabilities: caps }) {
  const injected = contextText(result, null);
  const kindCap = caps.events[event.kind];
  const canInject = kindCap?.injectContext === true;
  const echoable = event.kind === 'session.start' || event.kind === 'session.resume' || event.kind === 'agent.start';
  const echo = echoable ? echoContext(event.scope.sessionId, 'claude session_id') : '';
  const text = [echo, injected].filter((part) => part !== '').join('\n\n');
  const eventName = event.source.nativeEvent?.hook_event_name;

  if (event.kind === 'tool.before' && result.decision?.action === 'deny' && kindCap?.deny === true) {
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        permissionDecision: 'deny',
        permissionDecisionReason: result.decision.reason || 'denied by agent-orchestrator-kit policy',
      },
    };
  }
  if (canInject && text !== '' && (eventName === 'SessionStart' || eventName === 'SubagentStart' || eventName === 'SubagentStop')) {
    return { hookSpecificOutput: { hookEventName: eventName, additionalContext: text } };
  }
  return null;
}

export async function run(options) {
  return runAdapter({ adapter: { client: 'claude', capabilities, downgradedCapabilities, versionStatus, normalize, serialize }, ...options });
}
