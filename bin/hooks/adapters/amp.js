// Amp plugin adapter. Verified against the official plugin API reference
// (https://ampcode.com/docs/plugin-api, recorded 2026-11-16): PluginEventMap
// has exactly session.start, tool.call, tool.result, agent.start, agent.end,
// changes.prompt. session.start is fire-and-forget (no result type); only
// agent.start injects context (message.content); agent.end is request/turn
// completion with status done|error|cancelled — there is no session.end, and
// this adapter never invents one.

import { contextText, classifyOperation, echoContext, nativeEventId, nowIso, runAdapter, toRelativePaths } from './shared.js';

export const SOURCE = {
  client: 'amp',
  docUrl: 'https://ampcode.com/docs/plugin-api',
  recordedAt: '2026-11-16',
  testedVersions: ['PluginEventMap shape-verified (plugin events carry no in-band version)'],
  notes: 'Loaded through the owned .amp/plugins/agent-orchestrator.ts thin plugin. No compaction events exist in the plugin API.',
};

const NATIVE_TO_KIND = {
  'session.start': 'session.start',
  'agent.start': 'agent.start',
  'agent.end': 'agent.end',
  'tool.call': 'tool.before',
  'tool.result': 'tool.after',
};

const STOP_REASON = { done: 'completed', error: 'error', cancelled: 'user_cancelled' };

function baseCapabilities() {
  const events = {};
  const set = (kind, supported, injectContext, deny, followup, reason = null) => {
    events[kind] = { supported, injectContext, deny, followup, reason };
  };
  set('session.start', true, false, false, false, 'SessionStartEvent has no result type in PluginRequestResultMap');
  set('session.resume', false, false, false, false, 'no native resume event');
  set('session.end', false, false, false, false, 'agent.end is request completion, not session end; no synthetic session.end');
  set('context.compacting', false, false, false, false, 'no compaction events in the plugin API');
  set('context.reset', false, false, false, false, 'no compaction events in the plugin API');
  set('agent.start', true, true, false, false, 'agent.start result message.content is the verified injection point');
  set('agent.end', true, false, false, true, 'agent.end follow-up via action:continue; observation only here');
  set('tool.before', true, false, true, false, 'tool.call reject-and-continue');
  set('tool.after', true, false, false, false, 'tool.result observation');
  set('file.changed', false, false, false, false, 'no file event; paths only from verified tool shapes');
  return { schemaVersion: 1, client: 'amp', clientVersion: null, runtime: 'project-plugin', events };
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
  const threadId = payload?.thread?.id;
  const hasThread = typeof threadId === 'string' && threadId !== '';
  const carriesKnownKey = hasThread || typeof payload?.toolUseID === 'string' || typeof payload?.id === 'string';
  return { verified: carriesKnownKey, version: null };
}

function ampTool(payload) {
  const name = payload?.tool;
  if (typeof name !== 'string' || name === '') return null;
  return {
    id: typeof payload.toolUseID === 'string' ? payload.toolUseID : null,
    name,
    operation: classifyOperation(name),
  };
}

function ampFiles(payload, projectDir) {
  const input = payload?.input && typeof payload.input === 'object' ? payload.input : {};
  const candidates = [];
  for (const key of ['file_path', 'path', 'file', 'filename']) {
    if (typeof input[key] === 'string') candidates.push(input[key]);
  }
  if (Array.isArray(input.files)) candidates.push(...input.files.filter((file) => typeof file === 'string'));
  const rels = toRelativePaths(candidates, projectDir, null);
  return rels;
}

export function normalize({ payload, projectDir, nativeEvent = null }) {
  const eventName = typeof nativeEvent === 'string' ? nativeEvent : null;
  const kind = eventName && eventName in NATIVE_TO_KIND ? NATIVE_TO_KIND[eventName] : null;
  if (!kind) return null;
  const threadId = typeof payload?.thread?.id === 'string' ? payload.thread.id : null;
  return {
    schemaVersion: 1,
    eventId: nativeEventId('amp', [threadId, eventName, payload.toolUseID, payload.id]),
    occurredAt: nowIso(),
    kind,
    source: {
      client: 'amp',
      clientVersion: null,
      runtime: 'project-plugin',
      nativeEvent: nativeEvent ?? { event: eventName },
    },
    scope: {
      repoId: null,
      worktreeId: null,
      sessionId: threadId,
      agentId: null,
      changeId: null,
    },
    contextEpoch: null,
    data: {
      role: null,
      taskId: null,
      files: kind === 'tool.before' || kind === 'tool.after' ? ampFiles(payload, projectDir) : [],
      tool: kind === 'tool.before' || kind === 'tool.after' ? ampTool(payload) : null,
      outcome: kind === 'tool.after' && typeof payload?.status === 'string'
        ? { status: payload.status === 'done' ? 'success' : payload.status === 'error' ? 'failure' : payload.status === 'cancelled' ? 'cancelled' : 'unknown', exitCode: null }
        : null,
      stopReason: kind === 'agent.end' && typeof payload?.status === 'string' ? STOP_REASON[payload.status] ?? 'unknown' : null,
    },
  };
}

export function serialize({ event, result, capabilities: caps }) {
  const kindCap = caps.events[event.kind];
  if (event.kind === 'tool.before' && result.decision?.action === 'deny' && kindCap?.deny === true) {
    return { action: 'reject-and-continue', message: result.decision.reason || 'denied by agent-orchestrator-kit policy' };
  }
  if (event.kind === 'agent.end' && result.decision?.action === 'followup' && kindCap?.followup === true) {
    return { action: 'continue', userMessage: result.decision.reason || 'follow-up requested by agent-orchestrator-kit policy' };
  }
  if (event.kind === 'agent.start' && kindCap?.injectContext === true) {
    const text = contextText(result, echoContext(event.scope.sessionId, 'amp thread id'));
    if (text !== '') return { message: { content: text, display: false } };
    return {};
  }
  return null;
}

export async function run(options) {
  return runAdapter({ adapter: { client: 'amp', capabilities, downgradedCapabilities, versionStatus, normalize, serialize }, ...options });
}
