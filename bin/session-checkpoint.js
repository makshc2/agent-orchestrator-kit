import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const CHECKPOINT_FILE = 'checkpoint.json';
export const CHECKPOINT_TMP = 'checkpoint.json.tmp';
export const CHECKPOINT_TEXT_MAX = 500;
export const CHECKPOINT_DECISIONS_PER_CALL = 10;
export const CHECKPOINT_DECISIONS_TOTAL = 30;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// The normalization handoff persist applies: list marker stripped, whitespace collapsed.
export function decisionKey(text) {
  return String(text).trim().replace(/^[-*]\s*/, '').trim().replace(/\s+/g, ' ');
}

function checkText(flag, value) {
  if (value.length > CHECKPOINT_TEXT_MAX) return `--${flag} is longer than ${CHECKPOINT_TEXT_MAX} characters`;
  if (/[\r\n]/.test(value)) return `--${flag} must be one line`;
  return null;
}

export function validateCheckpointInput({ task, role, done, blocked, next, decisions } = {}, roleTokens = []) {
  const value = { task: null, role: null, done: '', blocked: '', next: '', decisions: [] };
  for (const [flag, raw] of [['done', done], ['blocked', blocked], ['next', next]]) {
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    const error = checkText(flag, text);
    if (error) return { ok: false, error };
    value[flag] = flag === 'blocked' && text.toLowerCase() === 'none' ? '' : text;
  }
  const given = decisions === undefined || decisions === null ? [] : decisions;
  if (given.length > CHECKPOINT_DECISIONS_PER_CALL) {
    return { ok: false, error: `at most ${CHECKPOINT_DECISIONS_PER_CALL} --decision values per call` };
  }
  for (const item of given) {
    const text = String(item).trim();
    if (!text) return { ok: false, error: '--decision must not be empty' };
    const error = checkText('decision', text);
    if (error) return { ok: false, error };
    if (decisionKey(text).toLowerCase() === 'none') {
      return { ok: false, error: '--decision none is reserved (handoff persist drops it)' };
    }
    value.decisions.push(text);
  }
  if (role !== undefined && role !== null && String(role).trim() !== '') {
    const text = String(role).trim();
    if (!roleTokens.includes(text)) return { ok: false, error: `--role must be one of: ${roleTokens.join(', ')}` };
    value.role = text;
  }
  if (task !== undefined && task !== null && String(task).trim() !== '') {
    const text = String(task).trim();
    if (!/^\d+\.\d+$/.test(text)) return { ok: false, error: '--task must be a task id like 2.1' };
    value.task = text;
  }
  return { ok: true, value };
}

export function mergeDecisions(previous = [], given = [], recordedKeys = new Set(), total = CHECKPOINT_DECISIONS_TOTAL) {
  const decisions = [];
  const kept = new Set();
  for (const item of [...previous, ...given]) {
    const key = decisionKey(item);
    if (recordedKeys.has(key) || kept.has(key)) continue;
    kept.add(key);
    decisions.push(item);
  }
  if (decisions.length > total) {
    return {
      ok: false,
      error: `checkpoint holds more than ${total} unrecorded decisions: list them under ## Decisions at Session Exit`,
    };
  }
  return { ok: true, decisions };
}

export function buildSnapshot(projectDir, changeDir, { tasks, review } = {}) {
  let head = null;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    head = null;
  }
  let handoffSha256 = null;
  try {
    handoffSha256 = sha256(readFileSync(join(changeDir, 'handoff.md')));
  } catch {
    handoffSha256 = null;
  }
  return {
    tasks: tasks === undefined ? null : tasks,
    review: review === undefined ? null : review,
    head,
    handoffSha256,
  };
}

export function buildRecord({ change, seq, savedAt, input, decisions, snapshot }) {
  const content = {
    version: 1,
    change,
    role: input.role,
    done: input.done,
    blocked: input.blocked,
    next: input.next,
    task: input.task,
    decisions,
    snapshot,
  };
  const contentDigest = sha256(JSON.stringify(content));
  const record = {
    version: 1,
    change,
    seq,
    savedAt,
    role: input.role,
    done: input.done,
    blocked: input.blocked,
    next: input.next,
    task: input.task,
    decisions,
    snapshot,
    contentDigest,
  };
  record.digest = sha256(JSON.stringify(record));
  return record;
}

const isString = (value) => typeof value === 'string';
const isStringOrNull = (value) => value === null || typeof value === 'string';
const isInteger = (value) => Number.isInteger(value);

function missingField(record) {
  if (!isInteger(record.seq) || record.seq < 1) return 'seq';
  for (const name of ['savedAt', 'done', 'blocked', 'next', 'contentDigest', 'digest']) {
    if (!isString(record[name])) return name;
  }
  for (const name of ['role', 'task']) {
    if (!isStringOrNull(record[name])) return name;
  }
  if (!Array.isArray(record.decisions) || !record.decisions.every(isString)) return 'decisions';
  const snapshot = record.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'snapshot';
  const tasks = snapshot.tasks;
  if (tasks !== null) {
    if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) return 'snapshot';
    if (!isInteger(tasks.done) || !isInteger(tasks.total)) return 'snapshot';
  }
  for (const name of ['review', 'head', 'handoffSha256']) {
    if (!isStringOrNull(snapshot[name])) return 'snapshot';
  }
  return null;
}

export function readCheckpoint(changeDir, changeName) {
  const filePath = join(changeDir, CHECKPOINT_FILE);
  if (!existsSync(filePath)) return { state: 'missing' };
  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (error) {
    return { state: 'corrupt', reason: String(error.message || error) };
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return { state: 'corrupt', reason: 'invalid JSON' };
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { state: 'corrupt', reason: 'invalid JSON' };
  if (record.version !== 1) return { state: 'corrupt', reason: 'unsupported version' };
  if (record.change !== changeName) return { state: 'corrupt', reason: 'wrong change' };
  const missing = missingField(record);
  if (missing) return { state: 'corrupt', reason: `missing field ${missing}` };
  const copy = { ...record };
  delete copy.digest;
  if (sha256(JSON.stringify(copy)) !== record.digest) return { state: 'corrupt', reason: 'digest mismatch' };
  return { state: 'valid', record };
}

export function writeFileAtomic(filePath, text, ops = {}) {
  const io = { openSync, writeSync, fsyncSync, closeSync, renameSync, rmSync, ...ops };
  const tmpPath = `${filePath}.tmp`;
  try {
    io.rmSync(tmpPath, { force: true });
  } catch {
    /* ignore */
  }
  let fd = null;
  try {
    fd = io.openSync(tmpPath, 'w');
    io.writeSync(fd, text);
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = null;
    io.renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd !== null) {
      try {
        io.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      io.rmSync(tmpPath, { force: true });
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function saveCheckpoint(changeDir, record, ops) {
  writeFileAtomic(join(changeDir, CHECKPOINT_FILE), `${JSON.stringify(record, null, 2)}\n`, ops);
}
