import { createHash, randomBytes } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { sanitizeRecord, oncePerCodeScope } from './diagnostics.js';

const execFile = promisify(execFileCallback);

export const STORE_LAYOUT_VERSION = 'v1';

const LEVELS = new Set(['worktree', 'change', 'session', 'agent']);
const REQUIRED_IDS = {
  worktree: [],
  change: ['changeId'],
  session: ['sessionId'],
  agent: ['sessionId', 'agentId'],
};
const SANITIZED_NAMESPACES = new Set(['diagnostics', 'audit']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOCK_TIMEOUT_CODE = 'ERR_HOOK_STORE_LOCK_TIMEOUT';
const RETENTION_DAYS_DEFAULT = 30;
const RETENTION_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;
const GIT_PROBE_TIMEOUT_MS = 5000;
const NOTIFY_TTL_MS = 60000;
const STALE_TMP_MS = 60000;
const MS_PER_DAY = 86400000;

const rootResolverSlot = Symbol('rootResolver');
const notifyGates = new Map();
const pruneLastRun = new Map();

const hashSegment = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const oldestFirst = (a, b) => a.mtime - b.mtime;

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertIdentifier(value, what) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    const shown = value === null || value === undefined ? null : String(value);
    throw storeError('ERR_HOOK_STORE_IDENTIFIER', `invalid ${what}: ${JSON.stringify(shown).slice(0, 96)}`);
  }
}

function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function writeAtomic(filePath, text) {
  const dirPath = dirname(filePath);
  await mkdir(dirPath, { recursive: true });
  const tmpPath = join(dirPath, `tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
  try {
    const handle = await open(tmpPath, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, filePath);
    try {
      const dirHandle = await open(dirPath, 'r');
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    } catch {
      /* directory fsync is best effort */
    }
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJsonFile(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return { ok: false };
  }
  const parsed = tryParse(text);
  return parsed.ok ? { ok: true, text, value: parsed.value } : { ok: false, corrupt: true };
}

// Corrupt target recovers from `<file>.last-good`; when neither parses it reads as missing.
async function readJsonWithRecovery(filePath) {
  const direct = await readJsonFile(filePath);
  if (direct.ok) return direct;
  const lastGood = await readJsonFile(`${filePath}.last-good`);
  if (lastGood.ok) {
    try {
      await writeAtomic(filePath, lastGood.text);
    } catch {
      /* restore is best effort; the good text is still returned */
    }
    return lastGood;
  }
  return null;
}

async function lockInfo(lockPath) {
  let text;
  let mtimeMs;
  try {
    text = await readFile(lockPath, 'utf8');
    mtimeMs = (await stat(lockPath)).mtimeMs;
  } catch {
    return null;
  }
  const parsed = tryParse(text);
  const token = parsed.ok && parsed.value && typeof parsed.value === 'object' ? parsed.value : null;
  return {
    token: text.trim(),
    mtimeMs,
    pid: token && Number.isInteger(token.pid) ? token.pid : null,
  };
}

async function acquireLock(lockPath, { timeoutMs, staleMs, pollMs }) {
  await mkdir(dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    const token = { pid: process.pid, ts: Date.now(), rand: randomBytes(6).toString('hex') };
    const tokenText = JSON.stringify(token);
    let handle;
    try {
      handle = await open(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await lockInfo(lockPath);
      if (!info) continue;
      const staleByAge = Date.now() - info.mtimeMs > staleMs;
      const staleByPid = info.pid !== null && !pidAlive(info.pid);
      if (staleByAge || staleByPid) {
        await rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw storeError(LOCK_TIMEOUT_CODE, `lock timeout after ${timeoutMs} ms waiting for ${lockPath}`);
      }
      await sleep(pollMs);
      continue;
    }
    try {
      await handle.writeFile(`${tokenText}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return async () => {
      const info = await lockInfo(lockPath);
      if (info && info.token === tokenText) await rm(lockPath, { force: true }).catch(() => {});
    };
  }
}

async function writeRecordFile(logDir, recordId, record) {
  const filePath = join(logDir, `${hashSegment(recordId)}.json`);
  const existing = await readJsonFile(filePath);
  if (existing.ok) return { stored: false, deduped: true, id: recordId, path: filePath };
  await writeAtomic(filePath, `${JSON.stringify(record)}\n`);
  return { stored: true, deduped: false, id: recordId, path: filePath };
}

function recordIdOf(record) {
  for (const field of ['id', 'effectId', 'occurrenceId']) {
    const value = record[field];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

function prepareSanitizedRecord(record) {
  const sanitized = sanitizeRecord(record);
  if (sanitized.occurredAt === undefined) sanitized.occurredAt = new Date().toISOString();
  return sanitized;
}

async function walkFiles(dirPath, out = []) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) await walkFiles(entryPath, out);
    else if (entry.isFile()) {
      const stats = await stat(entryPath).catch(() => null);
      if (stats) out.push({ path: entryPath, name: entry.name, size: stats.size, mtime: stats.mtimeMs });
    }
  }
  return out;
}

// Retention: oldest terminal audit-like entries (audit/diagnostics/quarantine logs, stale tmp)
// go before receipts of live sessions; every eviction is reported, never silent.
async function runPrune(areaPath, options) {
  const files = await walkFiles(areaPath);
  const now = Date.now();
  const ageCutoff = now - options.retentionDays * MS_PER_DAY;
  const candidates = [];
  for (const file of files) {
    const segments = file.path.split(sep);
    const logIndex = segments.lastIndexOf('log');
    const isTmp = file.name.startsWith('tmp-');
    if (!isTmp && logIndex === -1) continue;
    const namespaceDir = logIndex >= 0 ? segments[logIndex + 1] ?? '' : '';
    const scopeDir = logIndex >= 1 ? segments[logIndex - 1] : '';
    const auditLike = isTmp || namespaceDir === 'diagnostics' || namespaceDir === 'audit' || scopeDir.startsWith('quarantine-');
    candidates.push({ ...file, auditLike });
  }
  let bytes = candidates.reduce((sum, candidate) => sum + candidate.size, 0);
  const ordered = [
    ...candidates.filter((candidate) => candidate.auditLike).sort(oldestFirst),
    ...candidates.filter((candidate) => !candidate.auditLike).sort(oldestFirst),
  ];
  let evicted = 0;
  let bytesEvicted = 0;
  for (const candidate of ordered) {
    const staleTmp = candidate.name.startsWith('tmp-') && now - candidate.mtime > STALE_TMP_MS;
    const expired = candidate.mtime < ageCutoff;
    if (!staleTmp && !expired && bytes <= options.retentionMaxBytes) continue;
    try {
      await rm(candidate.path, { force: true });
      evicted += 1;
      bytesEvicted += candidate.size;
      bytes -= candidate.size;
    } catch {
      /* best effort */
    }
  }
  if (evicted > 0) {
    await writeRecordFile(join(areaPath, 'worktree', 'log', 'diagnostics'), `eviction-${hashSegment(`${now}\u0000${randomBytes(6).toString('hex')}`)}`, sanitizeRecord({
      type: 'diagnostic',
      code: 'store.retention.evicted',
      severity: 'info',
      message: `retention evicted ${evicted} record(s) freeing ${bytesEvicted} byte(s)`,
      occurredAt: new Date().toISOString(),
    })).catch(() => {});
  }
  return { evicted, bytesEvicted };
}

function schedulePrune(areaPath, options) {
  const now = Date.now();
  if (now - (pruneLastRun.get(areaPath) ?? 0) < options.pruneIntervalMs) return;
  pruneLastRun.set(areaPath, now);
  runPrune(areaPath, options).catch(() => {});
}

function createRootResolver(absoluteProjectDir) {
  let promise = null;
  const resolveRoot = async () => {
    let gitDir = null;
    try {
      const { stdout } = await execFile('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: absoluteProjectDir,
        timeout: GIT_PROBE_TIMEOUT_MS,
      });
      const value = String(stdout).trim();
      if (value !== '' && isAbsolute(value)) gitDir = value;
    } catch {
      gitDir = null;
    }
    const rootPath = gitDir
      ? join(gitDir, 'aok-hooks', STORE_LAYOUT_VERSION)
      : join(absoluteProjectDir, '.agents', '.hook-state', STORE_LAYOUT_VERSION);
    await mkdir(rootPath, { recursive: true });
    return rootPath;
  };
  return () => (promise ??= resolveRoot());
}

export function createStore(options = {}) {
  const {
    projectDir = process.cwd(),
    lockTimeoutMs = 5000,
    staleLockMs = 30000,
    lockPollMs = 25,
    retentionDays = RETENTION_DAYS_DEFAULT,
    retentionMaxBytes = RETENTION_MAX_BYTES_DEFAULT,
    pruneIntervalMs = 30000,
  } = options;
  const { [rootResolverSlot]: sharedRoot = null } = options;
  const scope = options.scope ?? {};
  const level = scope.level;
  if (!LEVELS.has(level)) {
    const shown = level === undefined || level === null ? null : String(level);
    throw storeError('ERR_HOOK_STORE_SCOPE', `invalid scope.level: ${JSON.stringify(shown).slice(0, 96)}`);
  }

  const absoluteProjectDir = resolve(projectDir);
  const ids = {
    repoId: scope.repoId ?? null,
    worktreeId: scope.worktreeId ?? null,
    changeId: scope.changeId ?? null,
    sessionId: scope.sessionId ?? null,
    agentId: scope.agentId ?? null,
    eventId: scope.eventId ?? null,
  };
  const missingIds = REQUIRED_IDS[level].filter((name) => ids[name] === null || ids[name] === '');
  // Unresolved identity quarantines by event id (worktree never quarantines), so no later
  // event can claim these writes and identity is never silently coarsened.
  const quarantined = missingIds.length > 0;
  const areaName = `wt-${hashSegment(`${ids.repoId ?? ''}\u0000${ids.worktreeId ?? ''}`)}`;
  const scopeDirectoryName = quarantined
    ? `quarantine-${hashSegment(`quarantine\u0000${level}\u0000${ids.eventId ?? ''}`)}`
    : level === 'worktree'
      ? 'worktree'
      : level === 'change'
        ? `change-${hashSegment(ids.changeId)}`
        : level === 'session'
          ? `session-${hashSegment(ids.sessionId)}`
          : `agent-${hashSegment(`${ids.sessionId ?? ''}\u0000${ids.agentId ?? ''}`)}`;
  const scopeKey = `${areaName}/${scopeDirectoryName}`;
  const lockOptions = { timeoutMs: lockTimeoutMs, staleMs: staleLockMs, pollMs: lockPollMs };
  const retentionOptions = { retentionDays, retentionMaxBytes, pruneIntervalMs };

  const getRoot = sharedRoot ?? createRootResolver(absoluteProjectDir);
  const root = () => getRoot();
  const areaPath = async () => join(await getRoot(), areaName);

  let scopeDirPromise = null;
  const scopeDirPath = () => (scopeDirPromise ??= (async () => {
    const dirPath = join(await areaPath(), scopeDirectoryName);
    await mkdir(dirPath, { recursive: true });
    return dirPath;
  })());

  const recordDiagnostic = async (code, message, { id, severity = 'warn', ...extra } = {}) => {
    const record = sanitizeRecord({
      type: 'diagnostic',
      code,
      severity,
      message,
      eventId: ids.eventId ?? undefined,
      occurredAt: new Date().toISOString(),
      ...extra,
    });
    const recordId = id ?? `diag-${hashSegment(`${code}\u0000${scopeKey}`)}`;
    return writeRecordFile(join(await areaPath(), 'worktree', 'log', 'diagnostics'), recordId, record);
  };

  if (quarantined) {
    recordDiagnostic(
      'store.identity.quarantined',
      `scope level ${level} is missing required id(s) ${missingIds.join(', ')}; writes are quarantined by event id`,
    ).catch(() => {});
  }

  const read = async (namespace, key) => {
    assertIdentifier(namespace, 'namespace');
    assertIdentifier(key, 'key');
    const recovered = await readJsonWithRecovery(join(await scopeDirPath(), 'data', namespace, `${key}.json`));
    return recovered ? recovered.value : null;
  };

  const transact = async (namespace, key, updater) => {
    assertIdentifier(namespace, 'namespace');
    assertIdentifier(key, 'key');
    if (typeof updater !== 'function') {
      throw storeError('ERR_HOOK_STORE_RECORD', 'transact updater must be a function');
    }
    const dirPath = await scopeDirPath();
    const filePath = join(dirPath, 'data', namespace, `${key}.json`);
    const lockPath = join(dirPath, 'locks', `${hashSegment(`${namespace}\u0000${key}`)}.lock`);
    let release;
    try {
      release = await acquireLock(lockPath, lockOptions);
    } catch (error) {
      if (error.code === LOCK_TIMEOUT_CODE) {
        try {
          await recordDiagnostic(
            'store.lock.timeout',
            `lock timeout on ${namespace}/${key} after ${lockTimeoutMs} ms`,
            { id: `diag-${hashSegment(`store.lock.timeout\u0000${scopeKey}\u0000${namespace}\u0000${key}`)}` },
          );
        } catch {
          /* the timeout error is never masked by a failed diagnostic */
        }
      }
      throw error;
    }
    try {
      const prior = await readJsonWithRecovery(filePath);
      const next = await updater(prior ? prior.value : null);
      if (next === undefined) return prior ? prior.value : null;
      if (prior) await writeAtomic(`${filePath}.last-good`, prior.text);
      await writeAtomic(filePath, `${JSON.stringify(next)}\n`);
      return next;
    } finally {
      await release();
    }
  };

  const append = async (namespace, record) => {
    assertIdentifier(namespace, 'namespace');
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw storeError('ERR_HOOK_STORE_RECORD', 'append record must be a non-null object');
    }
    const prepared = SANITIZED_NAMESPACES.has(namespace) ? prepareSanitizedRecord(record) : record;
    const recordId = recordIdOf(record) ?? `rec-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
    const result = await writeRecordFile(join(await scopeDirPath(), 'log', namespace), recordId, prepared);
    if (result.stored) schedulePrune(await areaPath(), retentionOptions);
    return result;
  };

  const log = async (namespace) => {
    assertIdentifier(namespace, 'namespace');
    const dirPath = join(await scopeDirPath(), 'log', namespace);
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('tmp-')) continue;
      const filePath = join(dirPath, entry.name);
      const parsed = await readJsonFile(filePath);
      const stats = await stat(filePath).catch(() => null);
      if (parsed.ok && stats) records.push({ record: parsed.value, mtime: stats.mtimeMs });
    }
    records.sort(oldestFirst);
    return records.map((entry) => entry.record);
  };

  const notify = async ({ code, message } = {}) => {
    if (typeof code !== 'string' || code === '') return { stored: false, deduped: false };
    let gate = notifyGates.get(scopeKey);
    if (!gate) {
      gate = oncePerCodeScope(NOTIFY_TTL_MS);
      notifyGates.set(scopeKey, gate);
    }
    if (!gate(scopeKey, code)) return { stored: false, deduped: true };
    return append('diagnostics', {
      type: 'notify',
      code,
      message: String(message ?? ''),
      eventId: ids.eventId ?? null,
      occurredAt: new Date().toISOString(),
    });
  };

  const prune = async () => {
    const areaPathValue = await areaPath();
    const summary = await runPrune(areaPathValue, retentionOptions);
    pruneLastRun.set(areaPathValue, Date.now());
    return summary;
  };

  const storeFor = (nextLevel) => {
    if (!LEVELS.has(nextLevel)) {
      const shown = nextLevel === undefined || nextLevel === null ? null : String(nextLevel);
      throw storeError('ERR_HOOK_STORE_SCOPE', `invalid scope.level: ${JSON.stringify(shown).slice(0, 96)}`);
    }
    return createStore({
      projectDir: absoluteProjectDir,
      scope: { ...scope, level: nextLevel },
      lockTimeoutMs,
      staleLockMs,
      lockPollMs,
      retentionDays,
      retentionMaxBytes,
      pruneIntervalMs,
      [rootResolverSlot]: getRoot,
    });
  };

  return {
    level,
    scope: { level, ...ids },
    get quarantined() { return quarantined; },
    get missingIds() { return [...missingIds]; },
    root,
    read,
    transact,
    append,
    log,
    notify,
    prune,
    storeFor,
  };
}
