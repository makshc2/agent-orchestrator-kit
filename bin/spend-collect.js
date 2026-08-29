import { existsSync, readdirSync, readFileSync, copyFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir as osHomedir } from 'os';
import { execFileSync } from 'child_process';

const PLATFORMS = ['cursor', 'claude', 'amp'];

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addNullable(a, b) {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function emptyPlatform(source = 'none') {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
    ampCredits: null,
    source,
  };
}

function emptyByPlatform() {
  return {
    cursor: emptyPlatform(),
    claude: emptyPlatform(),
    amp: emptyPlatform(),
  };
}

function encodeClaudeProjectDir(cwd) {
  return String(cwd || '').replace(/[/.]/g, '-');
}

function stripFileUri(uri) {
  const value = String(uri || '');
  return value.startsWith('file://') ? value.slice('file://'.length) : value;
}

function parseTime(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  return Date.parse(String(value));
}

function inWindow(timestamp, windowStart, windowEnd) {
  const t = parseTime(timestamp);
  if (!Number.isFinite(t)) return false;
  if (windowStart) {
    const start = parseTime(windowStart);
    if (Number.isFinite(start) && t < start) return false;
  }
  if (windowEnd) {
    const end = parseTime(windowEnd);
    if (Number.isFinite(end) && t > end) return false;
  }
  return true;
}

function sourceRecord({ id, platform, model, inputTokens, outputTokens, costUsd, ampCredits, at }) {
  const input = numOrNull(inputTokens);
  const output = numOrNull(outputTokens);
  let total = null;
  if (input != null || output != null) total = (input ?? 0) + (output ?? 0);
  return {
    id: String(id),
    platform,
    model: model == null || model === '' ? null : String(model),
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    costUsd: numOrNull(costUsd),
    ampCredits: numOrNull(ampCredits),
    at: at == null ? null : String(at),
  };
}

function claudeInputTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  let has = false;
  let sum = 0;
  if (usage.input_tokens != null || usage.inputTokens != null) {
    has = true;
    sum += numOrNull(usage.input_tokens ?? usage.inputTokens) ?? 0;
  }
  for (const [key, value] of Object.entries(usage)) {
    if (key.startsWith('cache_') && value != null) {
      has = true;
      sum += numOrNull(value) ?? 0;
    }
  }
  return has ? sum : null;
}

function claudeCostUsd(row, usage) {
  const candidates = [
    row && row.total_cost_usd,
    row && row.totalCostUsd,
    row && row.cost_usd,
    row && row.costUsd,
    usage && usage.total_cost_usd,
    usage && usage.totalCostUsd,
    usage && usage.cost_usd,
    usage && usage.costUsd,
  ];
  for (const value of candidates) {
    const n = numOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function isClaudeAssistant(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.type === 'assistant') return true;
  if (row.message && row.message.role === 'assistant') return true;
  return false;
}

function collectClaude({ cwd, windowStart, windowEnd, existing, env, homedir, notes }) {
  const home = homedir || env.HOME || osHomedir();
  const encoded = encodeClaudeProjectDir(cwd);
  const projectDir = join(home, '.claude', 'projects', encoded);
  const sources = [];
  if (!existsSync(projectDir)) {
    notes.push('claude: project folder missing');
    return sources;
  }
  let files;
  try {
    files = readdirSync(projectDir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    notes.push('claude: cannot read project folder');
    return sources;
  }
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(projectDir, file), 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isClaudeAssistant(row)) continue;
      const message = row.message || {};
      const usage = message.usage;
      if (!usage || typeof usage !== 'object') continue;
      const id = message.id;
      if (id == null || id === '') continue;
      if (existing.has(String(id))) continue;
      if (row.cwd !== cwd) continue;
      if (!inWindow(row.timestamp, windowStart, windowEnd)) continue;
      sources.push(sourceRecord({
        id,
        platform: 'claude',
        model: message.model,
        inputTokens: claudeInputTokens(usage),
        outputTokens: usage.output_tokens ?? usage.outputTokens,
        costUsd: claudeCostUsd(row, usage),
        ampCredits: null,
        at: row.timestamp,
      }));
    }
  }
  return sources;
}

function ampRoot(env, homedir) {
  if (env.AMP_DATA_DIR && String(env.AMP_DATA_DIR).trim()) return String(env.AMP_DATA_DIR).trim();
  if (env.XDG_DATA_HOME && String(env.XDG_DATA_HOME).trim()) {
    return join(String(env.XDG_DATA_HOME).trim(), 'amp');
  }
  return join(homedir || env.HOME || osHomedir(), '.local', 'share', 'amp');
}

function ampTreesMatch(thread, cwd) {
  const trees = thread && thread.env && thread.env.initial && thread.env.initial.trees;
  if (!Array.isArray(trees) || trees.length === 0) return false;
  return trees.some((tree) => tree && stripFileUri(tree.uri) === cwd);
}

function ampMessages(thread) {
  const out = [];
  if (Array.isArray(thread.messages)) out.push(...thread.messages);
  else if (thread.messages && typeof thread.messages === 'object') out.push(...Object.values(thread.messages));
  if (Array.isArray(thread.turns)) out.push(...thread.turns);
  return out;
}

function ampUsage(message) {
  if (message && message.usage && typeof message.usage === 'object') return message.usage;
  if (message && message.message && message.message.usage && typeof message.message.usage === 'object') {
    return message.message.usage;
  }
  return null;
}

function ampId(message) {
  return (
    (message && (message.messageId || message.toMessageId))
    || (message && message.message && (message.message.messageId || message.message.toMessageId || message.message.id))
    || null
  );
}

function ampInputTokens(usage) {
  if (usage.totalInputTokens != null) return numOrNull(usage.totalInputTokens);
  let has = false;
  let sum = 0;
  if (usage.inputTokens != null) {
    has = true;
    sum += numOrNull(usage.inputTokens) ?? 0;
  }
  if (usage.cacheCreationInputTokens != null) {
    has = true;
    sum += numOrNull(usage.cacheCreationInputTokens) ?? 0;
  }
  if (usage.cacheReadInputTokens != null) {
    has = true;
    sum += numOrNull(usage.cacheReadInputTokens) ?? 0;
  }
  return has ? sum : null;
}

function collectAmp({ cwd, windowStart, windowEnd, existing, env, homedir, notes }) {
  const root = ampRoot(env, homedir);
  const threadsDir = join(root, 'threads');
  const sources = [];
  if (!existsSync(threadsDir)) {
    notes.push('amp: threads folder missing');
    return sources;
  }
  let files;
  try {
    files = readdirSync(threadsDir).filter((name) => name.endsWith('.json'));
  } catch {
    notes.push('amp: cannot read threads');
    return sources;
  }
  for (const file of files) {
    let thread;
    try {
      thread = JSON.parse(readFileSync(join(threadsDir, file), 'utf-8'));
    } catch {
      continue;
    }
    if (!thread || typeof thread !== 'object') continue;
    if (!ampTreesMatch(thread, cwd)) continue;
    for (const message of ampMessages(thread)) {
      const usage = ampUsage(message);
      if (!usage) continue;
      const id = ampId(message);
      if (id == null || id === '') continue;
      if (existing.has(String(id))) continue;
      if (!inWindow(usage.timestamp, windowStart, windowEnd)) continue;
      sources.push(sourceRecord({
        id,
        platform: 'amp',
        model: usage.model,
        inputTokens: ampInputTokens(usage),
        outputTokens: usage.outputTokens,
        costUsd: null,
        ampCredits: null,
        at: usage.timestamp,
      }));
    }
  }
  return sources;
}

function cursorDbPath(env, homedir) {
  const home = homedir || env.HOME || osHomedir();
  if (env.XDG_CONFIG_HOME && String(env.XDG_CONFIG_HOME).trim()) {
    return join(String(env.XDG_CONFIG_HOME).trim(), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'win32') {
    const appdata = env.APPDATA && String(env.APPDATA).trim()
      ? String(env.APPDATA).trim()
      : join(home, 'AppData', 'Roaming');
    return join(appdata, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function sqlite3Ok() {
  try {
    execFileSync('sqlite3', ['-version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function isTokenColumn(name) {
  return /token|usage|costusd|cost_usd|input_tokens|output_tokens|inputtokens|outputtokens/i.test(String(name || ''));
}

function collectCursor({ env, homedir, notes }) {
  const dbPath = cursorDbPath(env, homedir);
  if (!existsSync(dbPath)) {
    notes.push('cursor: state.vscdb missing');
    return [];
  }
  if (!sqlite3Ok()) {
    notes.push('cursor: sqlite3 not available');
    return [];
  }
  const snapRoot = join(tmpdir(), `aok-vscdb-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(snapRoot, { recursive: true });
    const snapDb = join(snapRoot, 'state.vscdb');
    copyFileSync(dbPath, snapDb);
    for (const suffix of ['-wal', '-shm']) {
      const extra = `${dbPath}${suffix}`;
      if (existsSync(extra)) copyFileSync(extra, `${snapDb}${suffix}`);
    }
    let tables;
    try {
      tables = execFileSync('sqlite3', [snapDb, "SELECT name FROM sqlite_master WHERE type='table'"], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      notes.push('cursor: sqlite3 cannot read snapshot');
      return [];
    }
    let hasTokenCols = false;
    for (const table of tables) {
      let info;
      try {
        info = execFileSync('sqlite3', [snapDb, `PRAGMA table_info(${JSON.stringify(table).slice(1, -1)})`], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        continue;
      }
      if (String(info).split('\n').some((line) => {
        const cols = line.split('|');
        return cols[1] && isTokenColumn(cols[1]);
      })) {
        hasTokenCols = true;
        break;
      }
    }
    if (!hasTokenCols) {
      notes.push('cursor: schema has no token columns');
      return [];
    }
    notes.push('cursor: token columns present but no project workspace mapping');
    return [];
  } catch {
    notes.push('cursor: snapshot failed');
    return [];
  } finally {
    rmSync(snapRoot, { recursive: true, force: true });
  }
}

function aggregate(sources) {
  const byPlatform = emptyByPlatform();
  const byModel = new Map();
  for (const src of sources) {
    const platform = PLATFORMS.includes(src.platform) ? src.platform : null;
    if (platform) {
      const bucket = byPlatform[platform];
      bucket.inputTokens = addNullable(bucket.inputTokens, src.inputTokens);
      bucket.outputTokens = addNullable(bucket.outputTokens, src.outputTokens);
      bucket.totalTokens = addNullable(bucket.totalTokens, src.totalTokens);
      bucket.costUsd = addNullable(bucket.costUsd, src.costUsd);
      bucket.ampCredits = addNullable(bucket.ampCredits, src.ampCredits);
      if (platform === 'claude') bucket.source = 'claude-jsonl';
      else if (platform === 'amp') bucket.source = 'amp-thread';
      else bucket.source = 'cursor-vscdb';
    }
    const model = src.model;
    if (model) {
      const key = `${model}::${src.platform || ''}`;
      const row = byModel.get(key) || {
        model,
        platform: src.platform || null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        ampCredits: null,
      };
      row.inputTokens = addNullable(row.inputTokens, src.inputTokens);
      row.outputTokens = addNullable(row.outputTokens, src.outputTokens);
      row.totalTokens = addNullable(row.totalTokens, src.totalTokens);
      row.costUsd = addNullable(row.costUsd, src.costUsd);
      row.ampCredits = addNullable(row.ampCredits, src.ampCredits);
      byModel.set(key, row);
    }
  }
  return { byPlatform, byModel: [...byModel.values()] };
}

export function collectSpend(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd != null ? options.cwd : process.cwd();
  const homedir = options.homedir || env.HOME || osHomedir();
  const existing = new Set(
    Array.isArray(options.existingSourceIds)
      ? options.existingSourceIds
      : options.existingSourceIds instanceof Set
        ? [...options.existingSourceIds]
        : [],
  );
  const windowStart = options.windowStart;
  const windowEnd = options.windowEnd;
  const notes = [];
  const ctx = { cwd, windowStart, windowEnd, existing, env, homedir, notes };
  let sources = [];
  try {
    sources = sources.concat(collectClaude(ctx));
  } catch {
    notes.push('claude: adapter failed');
  }
  try {
    sources = sources.concat(collectAmp(ctx));
  } catch {
    notes.push('amp: adapter failed');
  }
  try {
    sources = sources.concat(collectCursor(ctx));
  } catch {
    notes.push('cursor: adapter failed');
  }
  const { byPlatform, byModel } = aggregate(sources);
  return { sources, byPlatform, byModel, notes };
}
