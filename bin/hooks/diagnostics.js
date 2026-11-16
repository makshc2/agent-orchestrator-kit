const MAX_MESSAGE_CHARS = 300;
const MAX_PATHS = 32;
const MAX_PATH_CHARS = 512;
const MAX_DIGEST_CHARS = 128;
const SECRET_TOKEN = /[A-Za-z0-9_-]{20,}/g;
const SEVERITIES = new Set(['info', 'warn', 'error']);

const ALLOWED_FIELDS = [
  'id', 'effectId', 'occurrenceId', 'type', 'kind', 'code', 'severity', 'message', 'paths',
  'digest', 'contentDigest', 'status', 'exitCode', 'durationMs', 'eventId', 'occurredAt',
  'sessionId', 'agentId', 'changeId', 'worktreeId', 'repoId', 'epoch',
];

export function redactSecrets(text) {
  return String(text).replace(SECRET_TOKEN, '[redacted]');
}

export function sanitizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  const out = {};
  for (const field of ALLOWED_FIELDS) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  if (out.message !== undefined) out.message = redactSecrets(out.message).slice(0, MAX_MESSAGE_CHARS);
  if (out.paths !== undefined) {
    out.paths = Array.isArray(out.paths)
      ? out.paths.filter((path) => typeof path === 'string').slice(0, MAX_PATHS).map((path) => path.slice(0, MAX_PATH_CHARS))
      : [];
  }
  if (out.severity !== undefined && !SEVERITIES.has(out.severity)) out.severity = 'info';
  for (const field of ['digest', 'contentDigest']) {
    if (typeof out[field] === 'string' && out[field].length > MAX_DIGEST_CHARS) {
      out[field] = out[field].slice(0, MAX_DIGEST_CHARS);
    }
  }
  return out;
}

export function oncePerCodeScope(ttlMs = 60000) {
  const seen = new Map();
  return (scope, code) => {
    const key = `${scope}:${code}`;
    const now = Date.now();
    const last = seen.get(key);
    if (last !== undefined && now - last < ttlMs) return false;
    seen.set(key, now);
    if (seen.size > 4096) {
      for (const [key, ts] of seen) {
        if (now - ts >= ttlMs) seen.delete(key);
      }
    }
    return true;
  };
}
