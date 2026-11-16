import { builtinPolicies } from './policies/index.js';

export { createStore } from './store.js';
export { sanitizeRecord } from './diagnostics.js';

const SCHEMA_VERSION = 1;
const EVENT_KINDS = new Set([
  'session.start',
  'session.resume',
  'session.end',
  'context.compacting',
  'context.reset',
  'agent.start',
  'agent.end',
  'tool.before',
  'tool.after',
  'file.changed',
]);
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_CONTEXT_BYTES = 32 * 1024;
const DISPATCH_TIMEOUT_MS = 1500;
const MAX_NOTIFIED_CODES = 32;
const SEVERITIES = new Set(['info', 'warn', 'error']);
const ACTIONS = new Set(['allow', 'deny', 'followup']);
const DIAGNOSTICS_NAMESPACE = 'diagnostics';

const POLICY_TIMEOUT = Symbol('policy-timeout');

const serializedBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const shortError = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 160);

function rejection(code, message) {
  return {
    schemaVersion: SCHEMA_VERSION,
    context: [],
    findings: [{ code, severity: 'error', message, paths: [] }],
    decision: null,
  };
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return rejection('event.schema.unsupported', 'event must be a non-null event object');
  }
  if (event.schemaVersion !== SCHEMA_VERSION) {
    return rejection('event.schema.unsupported', `unsupported event schemaVersion: ${JSON.stringify(event.schemaVersion)}`);
  }
  if (typeof event.kind !== 'string' || !EVENT_KINDS.has(event.kind)) {
    return rejection('event.kind.unknown', `unknown event kind: ${JSON.stringify(event.kind)}`);
  }
  let size;
  try {
    size = serializedBytes(event);
  } catch {
    return rejection('event.input.invalid', 'event is not JSON-serializable');
  }
  if (size > MAX_INPUT_BYTES) {
    return rejection('event.input.oversized', `event size ${size} bytes exceeds the ${MAX_INPUT_BYTES} byte limit`);
  }
  return null;
}

// A null session id still requests the session level on purpose: the store answers that
// with a quarantine keyed by the event id plus a diagnostic. Dispatch never coarsens to
// the shared worktree namespace on its own.
function defaultStoreLevel(scope) {
  if (scope.sessionId != null && scope.agentId != null) return 'agent';
  return 'session';
}

const isCancellation = (event) =>
  event.data?.stopReason === 'user_cancelled' || event.data?.outcome?.status === 'cancelled';

const capabilityFor = (capabilities, kind) => capabilities?.events?.[kind] ?? null;

function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.code !== 'string' || raw.code === '') return null;
  return {
    code: raw.code,
    severity: SEVERITIES.has(raw.severity) ? raw.severity : 'info',
    message: String(raw.message ?? ''),
    paths: Array.isArray(raw.paths) ? raw.paths.filter((path) => typeof path === 'string') : [],
  };
}

function normalizeContextItem(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.text !== 'string') return null;
  return raw;
}

function policyConfigFor(config, id) {
  const entry = config?.hooks?.policies?.[id];
  return entry && typeof entry === 'object' ? entry : {};
}

function downgradeFinding(id, action, capabilities, event, globalMode, policyConfig) {
  const why = policyConfig.enabled !== true
    ? 'policy disabled'
    : globalMode !== 'enforce'
      ? `global mode ${globalMode}`
      : policyConfig.mode !== 'enforce'
        ? `policy mode ${policyConfig.mode ?? 'observe'}`
        : `capability ${action} unsupported for ${event.kind}`;
  const capability = capabilityFor(capabilities, event.kind);
  if (capability && capability.reason) {
    return {
      code: 'policy.decision.downgraded',
      severity: 'info',
      message: `policy ${id} ${action} downgraded to advisory (${why}: ${capability.reason})`,
      paths: [],
    };
  }
  return {
    code: 'policy.decision.downgraded',
    severity: 'info',
    message: `policy ${id} ${action} downgraded to advisory (${why})`,
    paths: [],
  };
}

export async function dispatch(event, options = {}) {
  const invalid = validateEvent(event);
  if (invalid) return invalid;

  const { capabilities, store, config, signal } = options;
  const scope = event.scope ?? {};
  const deadline = Date.now() + DISPATCH_TIMEOUT_MS;
  const context = [];
  const findings = [];
  const skippedContextIds = [];
  let contextFull = false;

  let ctxStore = null;
  let storeFor = null;
  if (store && typeof store.storeFor === 'function') {
    storeFor = (level) => store.storeFor(level);
    ctxStore = store.storeFor(defaultStoreLevel(scope));
  }

  const notified = new Set();
  const notify = ({ code, message } = {}) => {
    if (typeof code !== 'string' || code === '' || notified.has(code) || notified.size >= MAX_NOTIFIED_CODES) return;
    notified.add(code);
    if (!ctxStore || typeof ctxStore.append !== 'function') return;
    try {
      Promise.resolve(ctxStore.append(DIAGNOSTICS_NAMESPACE, {
        type: 'notify',
        code,
        message: String(message ?? ''),
        eventId: event.eventId ?? null,
        occurredAt: event.occurredAt ?? null,
      })).catch(() => {});
    } catch {
      /* notifications never break dispatch */
    }
  };

  const ctx = { capabilities, config, store: ctxStore, storeFor, signal, notify };
  const policies = Array.isArray(options.policies) ? options.policies : builtinPolicies;
  const globalMode = config?.hooks?.mode ?? 'observe';
  const cancellation = isCancellation(event);
  const denies = [];
  let followup = null;
  let allow = null;

  for (const policy of policies) {
    if (!policy || typeof policy.evaluate !== 'function') continue;
    const id = typeof policy.id === 'string' && policy.id !== '' ? policy.id : 'policy';
    if (policy.events != null && !(Array.isArray(policy.events) && policy.events.includes(event.kind))) continue;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      findings.push({ code: 'policy.timeout', severity: 'warn', message: `policy ${id} skipped: dispatch deadline exceeded`, paths: [] });
      continue;
    }

    let evaluation;
    try {
      evaluation = Promise.resolve(policy.evaluate(event, ctx));
    } catch (error) {
      findings.push({ code: 'policy.error', severity: 'warn', message: `policy ${id} failed: ${shortError(error)}`, paths: [] });
      continue;
    }

    let result;
    let timer = null;
    try {
      result = await Promise.race([
        evaluation,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(POLICY_TIMEOUT), remaining);
        }),
      ]);
    } catch (error) {
      findings.push({ code: 'policy.error', severity: 'warn', message: `policy ${id} failed: ${shortError(error)}`, paths: [] });
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (result === POLICY_TIMEOUT) {
      evaluation.catch(() => {});
      findings.push({ code: 'policy.timeout', severity: 'warn', message: `policy ${id} timed out after ${DISPATCH_TIMEOUT_MS} ms dispatch deadline`, paths: [] });
      continue;
    }

    const raw = result && typeof result === 'object' ? result : {};
    const items = Array.isArray(raw.context) ? raw.context : [];
    for (const item of items) {
      const normalized = normalizeContextItem(item);
      if (!normalized) continue;
      if (contextFull) {
        skippedContextIds.push(normalized.id);
        continue;
      }
      if (serializedBytes([...context, normalized]) > MAX_CONTEXT_BYTES) {
        contextFull = true;
        skippedContextIds.push(normalized.id);
        continue;
      }
      context.push(normalized);
    }

    const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
    for (const finding of rawFindings) {
      const normalized = normalizeFinding(finding);
      if (normalized) findings.push(normalized);
    }

    const decision = raw.decision;
    if (!decision || typeof decision !== 'object' || !ACTIONS.has(decision.action)) continue;
    if (cancellation) continue;

    const action = decision.action;
    const reason = typeof decision.reason === 'string' ? decision.reason : '';
    const policyConfig = policyConfigFor(config, id);
    const capability = capabilityFor(capabilities, event.kind);
    const capabilityOk = action === 'deny'
      ? capability?.deny === true
      : action === 'followup'
        ? capability?.followup === true
        : true;
    if (policyConfig.enabled === true && globalMode === 'enforce' && policyConfig.mode === 'enforce' && capabilityOk) {
      if (action === 'deny') denies.push({ id, reason });
      else if (action === 'followup') followup = followup ?? { id, reason };
      else allow = allow ?? { id, reason };
    } else {
      findings.push(downgradeFinding(id, action, capabilities, event, globalMode, policyConfig));
    }
  }

  if (skippedContextIds.length > 0) {
    findings.push({
      code: 'context.overflow',
      severity: 'warn',
      message: `context budget of ${MAX_CONTEXT_BYTES} bytes exceeded; skipped item ids: ${skippedContextIds.join(', ')}`,
      paths: [...skippedContextIds],
    });
  }

  let decision = null;
  if (denies.length > 0) {
    decision = { action: 'deny', reason: denies.map((d) => d.reason || `policy ${d.id} denied`).join('; ') };
  } else if (followup) {
    decision = { action: 'followup', reason: followup.reason || `policy ${followup.id} requested followup` };
  } else if (allow) {
    decision = { action: 'allow', reason: allow.reason || `policy ${allow.id} allowed` };
  }
  if (cancellation) decision = null;

  return { schemaVersion: SCHEMA_VERSION, context, findings, decision };
}

export { builtinPolicies };
