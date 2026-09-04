import { existsSync, readFileSync, readlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir as osHomedir } from 'os';
import { execFileSync } from 'child_process';

const VALID_PLATFORMS = new Set(['cursor', 'claude', 'amp']);
const AMP_TTY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function envFlagOn(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

export function ampDataRoot(env = {}, homedir) {
  if (env.AMP_DATA_DIR && String(env.AMP_DATA_DIR).trim()) return String(env.AMP_DATA_DIR).trim();
  if (env.XDG_DATA_HOME && String(env.XDG_DATA_HOME).trim()) {
    return join(String(env.XDG_DATA_HOME).trim(), 'amp');
  }
  return join(homedir || env.HOME || osHomedir(), '.local', 'share', 'amp');
}

export function ampThreadIdFromEnv(env = {}) {
  for (const key of ['AMP_CURRENT_THREAD', 'AMP_THREAD_ID']) {
    const value = trim(env[key]);
    if (value) return value;
  }
  return '';
}

export function isUsableTtyPath(raw) {
  const path = String(raw || '').replace(/^tty:/, '').trim();
  if (!path.startsWith('/dev/')) return false;
  if (path === '/dev/null' || path.startsWith('/dev/null')) return false;
  return true;
}

export function currentTtyKey(env = {}, readlink = null) {
  const forced = trim(env.AOK_TTY);
  if (forced) {
    const path = forced.startsWith('tty:') ? forced.slice(4) : forced;
    return isUsableTtyPath(path) ? (forced.startsWith('tty:') ? forced : `tty:${path}`) : '';
  }
  try {
    const fn = readlink || readlinkSync;
    const raw = String(fn('/proc/self/fd/0') || '').trim();
    return isUsableTtyPath(raw) ? `tty:${raw}` : '';
  } catch {
    return '';
  }
}

const AMP_THREAD_ID_RE = /\bT-[0-9a-fA-F-]{8,}\b/g;

export function parseAmpThreadList(text) {
  const ids = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim() || /^Title\b/.test(line) || /^─/.test(line)) continue;
    const matches = line.match(AMP_THREAD_ID_RE);
    if (!matches || !matches.length) continue;
    const id = matches[matches.length - 1];
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function listRecentAmpThreadIds(options = {}) {
  if (typeof options.listAmpThreads === 'function') {
    try {
      const out = options.listAmpThreads();
      if (Array.isArray(out)) return out.map((id) => trim(id)).filter(Boolean);
      return parseAmpThreadList(out);
    } catch {
      return [];
    }
  }
  const env = options.env || {};
  const bin = options.ampBin || trim(env.AOK_AMP_BIN) || 'amp';
  if (bin !== 'amp' && !existsSync(bin)) return [];
  try {
    const text = execFileSync(bin, ['threads', 'list', '--limit', String(options.limit || 5)], {
      encoding: 'utf-8',
      timeout: options.timeoutMs != null ? Number(options.timeoutMs) : 15000,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseAmpThreadList(text);
  } catch {
    return [];
  }
}

export function parentProcessComm(ppid = process.ppid, readFile = readFileSync) {
  try {
    return String(readFile(`/proc/${ppid}/comm`, 'utf-8')).trim();
  } catch {
    return '';
  }
}

function looksLikeAmpProcess(comm) {
  const name = String(comm || '').toLowerCase();
  return name === 'amp' || name.startsWith('amp');
}

function isFreshTimestamp(value, now, maxAgeMs) {
  if (value == null || value === '') return false;
  const n = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(String(value));
  if (!Number.isFinite(n)) return false;
  return now - n >= 0 && now - n <= maxAgeMs;
}

function isSessionFileFresh(updatedAt, filePath, now, maxAgeMs) {
  if (updatedAt != null && updatedAt !== '') {
    return isFreshTimestamp(updatedAt, now, maxAgeMs);
  }
  try {
    return isFreshTimestamp(statSync(filePath).mtimeMs, now, maxAgeMs);
  } catch {
    return false;
  }
}

function emptyAmpSessionHint(filePath, fileFresh, updatedAt) {
  return {
    threadId: '',
    source: '',
    lastThreadId: '',
    filePath: filePath || '',
    fileFresh: Boolean(fileFresh),
    updatedAt: updatedAt == null ? '' : updatedAt,
  };
}

export function readAmpSessionHint(options = {}) {
  const env = options.env || {};
  const homedir = options.homedir || env.HOME;
  const now = options.now != null ? Number(options.now) : Date.now();
  const maxAgeMs = options.maxAgeMs != null ? Number(options.maxAgeMs) : AMP_TTY_MAX_AGE_MS;
  const filePath = join(ampDataRoot(env, homedir), 'session.json');
  if (!existsSync(filePath)) return emptyAmpSessionHint(filePath, false, '');
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return emptyAmpSessionHint(filePath, isSessionFileFresh('', filePath, now, maxAgeMs), '');
  }
  if (!data || typeof data !== 'object') {
    return emptyAmpSessionHint(filePath, isSessionFileFresh('', filePath, now, maxAgeMs), '');
  }
  const lastThreadId = trim(data.lastThreadId);
  const updatedAt = data.updatedAt;
  const fileFresh = isSessionFileFresh(updatedAt, filePath, now, maxAgeMs);
  const rawTty = options.ttyKey != null ? options.ttyKey : currentTtyKey(env, options.readlink);
  const ttyKey = isUsableTtyPath(rawTty) ? (String(rawTty).startsWith('tty:') ? rawTty : `tty:${rawTty}`) : '';
  const byTty = data.lastThreadByTerminal && ttyKey ? data.lastThreadByTerminal[ttyKey] : null;
  if (byTty && trim(byTty.lastThreadId) && isFreshTimestamp(byTty.updatedAt, now, maxAgeMs)) {
    return {
      threadId: trim(byTty.lastThreadId),
      source: 'amp-session-tty',
      lastThreadId,
      filePath,
      fileFresh,
      updatedAt,
    };
  }
  return {
    threadId: '',
    source: '',
    lastThreadId,
    filePath,
    fileFresh,
    updatedAt,
  };
}

export function detectSessionClient(options = {}) {
  const env = options.env || {};
  const ampId = ampThreadIdFromEnv(env);
  if (ampId) {
    return { platform: 'amp', threadId: ampId, source: 'amp-env' };
  }

  if (envFlagOn(env.CURSOR_AGENT) || trim(env.CURSOR_CONVERSATION_ID)) {
    return { platform: 'cursor', threadId: trim(env.CURSOR_CONVERSATION_ID) || null, source: 'cursor-env' };
  }
  if (envFlagOn(env.CLAUDECODE) || envFlagOn(env.CLAUDE_CODE) || trim(env.CLAUDE_CODE_ENTRYPOINT)) {
    return { platform: 'claude', threadId: null, source: 'claude-env' };
  }

  const comm = options.parentComm != null ? options.parentComm : parentProcessComm();
  const hint = readAmpSessionHint(options);
  if (looksLikeAmpProcess(comm)) {
    if (hint.threadId) {
      return { platform: 'amp', threadId: hint.threadId, source: 'amp-parent' };
    }
    const listed = listRecentAmpThreadIds(options);
    return {
      platform: 'amp',
      threadId: listed[0] || null,
      source: listed[0] ? 'amp-threads-list' : 'amp-parent',
    };
  }
  if (hint.threadId) {
    return { platform: 'amp', threadId: hint.threadId, source: hint.source };
  }
  if (hint.lastThreadId && hint.fileFresh) {
    return { platform: 'amp', threadId: hint.lastThreadId, source: 'amp-session-last' };
  }
  if (hint.fileFresh) {
    const listed = listRecentAmpThreadIds(options);
    if (listed[0]) {
      return { platform: 'amp', threadId: listed[0], source: 'amp-session-list' };
    }
  }

  return { platform: null, threadId: null, source: 'none' };
}

export function resolveRestoreClient(options = {}) {
  const env = options.env || {};
  const detected = detectSessionClient(options);
  const flag = trim(options.platform || env.AOK_PLATFORM).toLowerCase();
  if (flag && VALID_PLATFORMS.has(flag)) {
    return {
      platform: flag,
      threadId: detected.threadId,
      source: options.platform ? 'flag' : 'aok-platform',
    };
  }
  return detected;
}
