import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir as osHomedir } from 'os';
import { execFileSync } from 'child_process';
import { listRecentAmpThreadIds } from './session-client.js';
import { formatUtcIso, parseFlexibleIso } from './metrics-time.js';
import { describeCursorCostEstimate } from './cursor-cost-estimate.js';
import { ampAgentMode, matchAmpUsageModel, parseAmpUsageDetails } from './amp-usage.js';

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

export function cursorSpendFingerprint(row) {
  if (!row || typeof row !== 'object') return null;
  const input = numOrNull(row.inputTokens);
  const output = numOrNull(row.outputTokens);
  if (input == null && output == null) return null;
  const model = String(row.model || row.modelId || '');
  const cache = numOrNull(row.cacheReadTokens) ?? 0;
  return `${model}|${input ?? 0}|${output ?? 0}|${cache}`;
}

function preferCursorSource(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  if (next.event === 'stop' && previous.event !== 'stop') return next;
  if (previous.event === 'stop' && next.event !== 'stop') return previous;
  const prevAt = Date.parse(previous.at);
  const nextAt = Date.parse(next.at);
  if (Number.isFinite(nextAt) && Number.isFinite(prevAt) && nextAt !== prevAt) {
    return nextAt > prevAt ? next : previous;
  }
  return (next.totalTokens ?? 0) >= (previous.totalTokens ?? 0) ? next : previous;
}

function stripCursorCollectMeta(record) {
  if (!record || typeof record !== 'object') return record;
  const { event, ...rest } = record;
  return rest;
}

export function dedupeCursorSources(sources) {
  const best = new Map();
  const rest = [];
  for (const src of sources || []) {
    if (!src || src.platform !== 'cursor') {
      rest.push(src);
      continue;
    }
    const fp = cursorSpendFingerprint(src);
    if (!fp) {
      rest.push(src);
      continue;
    }
    best.set(fp, preferCursorSource(best.get(fp), src));
  }
  return [...rest, ...[...best.values()].map(stripCursorCollectMeta)];
}

function emptyPlatform(source = 'none') {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
    ampCredits: null,
    costUsdEstimated: null,
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

function normalizeFsPath(value) {
  const stripped = stripFileUri(value).trim();
  if (!stripped) return '';
  if (stripped.length > 1 && stripped.endsWith('/')) return stripped.replace(/\/+$/, '');
  return stripped;
}

function pathsEqual(a, b) {
  const left = normalizeFsPath(a);
  const right = normalizeFsPath(b);
  return Boolean(left) && left === right;
}

function parseTime(value) {
  return parseFlexibleIso(value);
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

function sourceRecord({
  id,
  platform,
  model,
  inputTokens,
  outputTokens,
  costUsd,
  ampCredits,
  at,
  cacheReadTokens,
  costUsdEstimated,
  costSource,
  agentMode,
}) {
  const input = numOrNull(inputTokens);
  const output = numOrNull(outputTokens);
  let total = null;
  if (input != null || output != null) total = (input ?? 0) + (output ?? 0);
  const record = {
    id: String(id),
    platform,
    model: model == null || model === '' ? null : String(model),
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    costUsd: numOrNull(costUsd),
    ampCredits: numOrNull(ampCredits),
    at: at == null || at === '' ? null : (formatUtcIso(at) || String(at)),
  };
  const cache = numOrNull(cacheReadTokens);
  if (cache != null) record.cacheReadTokens = cache;
  const estimated = numOrNull(costUsdEstimated);
  if (estimated != null) record.costUsdEstimated = estimated;
  if (costSource) record.costSource = String(costSource);
  if (agentMode) record.agentMode = String(agentMode);
  return record;
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

function ampTrees(thread) {
  const trees = thread && thread.env && thread.env.initial && thread.env.initial.trees;
  return Array.isArray(trees) ? trees : [];
}

function ampCwdCandidates(thread) {
  const out = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) out.push(value);
  };
  push(thread && thread.cwd);
  push(thread && thread.workdir);
  const env = thread && thread.env;
  if (env && typeof env === 'object') {
    push(env.cwd);
    push(env.PWD);
    push(env.pwd);
    if (env.initial && typeof env.initial === 'object') {
      push(env.initial.cwd);
      push(env.initial.PWD);
      push(env.initial.workdir);
      push(env.initial.workspace);
    }
  }
  const meta = thread && thread.meta;
  if (meta && typeof meta === 'object') {
    push(meta.cwd);
    push(meta.workdir);
  }
  return out;
}

function ampCurrentThreadId(env) {
  if (!env || typeof env !== 'object') return '';
  for (const key of ['AMP_CURRENT_THREAD', 'AMP_THREAD_ID']) {
    const value = env[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function ampThreadMentionsCwd(thread, cwd) {
  const target = normalizeFsPath(cwd);
  if (!target || target.length < 2) return false;
  let blob;
  try {
    blob = JSON.stringify(thread);
  } catch {
    return false;
  }
  return blob.includes(target) || blob.includes(`file://${target}`);
}

function ampThreadMatches(thread, cwd, env, fileName) {
  const trees = ampTrees(thread);
  if (trees.length > 0) {
    return trees.some((tree) => tree && pathsEqual(tree.uri, cwd));
  }
  if (ampCwdCandidates(thread).some((candidate) => pathsEqual(candidate, cwd))) return true;
  const threadKey = thread && thread.id ? String(thread.id) : basename(fileName, '.json');
  const current = ampCurrentThreadId(env);
  if (current && current === threadKey) return true;
  return ampThreadMentionsCwd(thread, cwd);
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

export function sourcesFromAmpThread(thread, ctx, fileName = '', via = null) {
  const sources = [];
  if (!thread || typeof thread !== 'object') return sources;
  const { cwd, windowStart, windowEnd, existing, env } = ctx;
  if (!ampThreadMatches(thread, cwd, env, fileName)) return sources;
  const threadKey = thread.id ? String(thread.id) : basename(fileName || 'thread', '.json');
  for (const message of ampMessages(thread)) {
    const usage = ampUsage(message);
    if (!usage) continue;
    const rawId = ampId(message);
    if (rawId == null || rawId === '') continue;
    const id = `${threadKey}:${rawId}`;
    if (existing.has(id)) continue;
    if (!inWindow(usage.timestamp, windowStart, windowEnd)) continue;
    const record = sourceRecord({
      id,
      platform: 'amp',
      model: usage.model,
      inputTokens: ampInputTokens(usage),
      outputTokens: usage.outputTokens,
      costUsd: null,
      ampCredits: null,
      at: usage.timestamp,
      agentMode: ampAgentMode(thread),
    });
    if (via) record.via = via;
    sources.push(record);
  }
  return sources;
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
  const ctx = { cwd, windowStart, windowEnd, existing, env, homedir, notes };
  for (const file of files) {
    let thread;
    try {
      thread = JSON.parse(readFileSync(join(threadsDir, file), 'utf-8'));
    } catch {
      continue;
    }
    sources.push(...sourcesFromAmpThread(thread, ctx, file));
  }
  return sources;
}

export function exportAmpThread(threadId, options = {}) {
  const id = threadId == null ? '' : String(threadId).trim();
  if (!id) return null;
  if (typeof options.exportAmpThread === 'function') {
    try {
      return options.exportAmpThread(id);
    } catch {
      return null;
    }
  }
  const bin = options.ampBin || (options.env && options.env.AOK_AMP_BIN) || 'amp';
  if (bin !== 'amp' && !existsSync(bin)) return null;
  try {
    const out = execFileSync(bin, ['threads', 'export', id], {
      encoding: 'utf-8',
      timeout: options.timeoutMs != null ? Number(options.timeoutMs) : 15000,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(out);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function fetchAmpThreadUsage(threadId, options = {}) {
  const id = threadId == null ? '' : String(threadId).trim();
  if (!id) return null;
  if (typeof options.usageAmpThread === 'function') {
    try {
      const injected = options.usageAmpThread(id);
      if (injected == null) return null;
      if (typeof injected === 'string') return parseAmpUsageDetails(injected);
      if (typeof injected === 'object') {
        if (injected.text && injected.costUsd == null) return { ...parseAmpUsageDetails(injected.text), ...injected };
        return injected;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof options.exportAmpThread === 'function') return null;
  const bin = options.ampBin || (options.env && options.env.AOK_AMP_BIN) || 'amp';
  if (bin !== 'amp' && !existsSync(bin)) return null;
  try {
    const out = execFileSync(bin, ['threads', 'usage', id, '--details'], {
      encoding: 'utf-8',
      timeout: options.timeoutMs != null ? Number(options.timeoutMs) : 25000,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseAmpUsageDetails(out);
  } catch {
    return null;
  }
}

function collectAmpCli(ctx) {
  const { env, notes, ampThreadId } = ctx;
  const ids = [];
  const push = (value) => {
    const id = value == null ? '' : String(value).trim();
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(ampThreadId);
  push(ampCurrentThreadId(env));
  if (!ids.length) {
    for (const id of listRecentAmpThreadIds(ctx)) push(id);
  }
  const sources = [];
  const threads = [];
  for (const id of ids) {
    const thread = exportAmpThread(id, ctx);
    if (!thread) {
      notes.push(`amp: export failed for ${id}`);
      continue;
    }
    const agentMode = ampAgentMode(thread);
    const extracted = sourcesFromAmpThread(thread, ctx, `${id}.json`, 'amp-cli');
    if (!extracted.length) notes.push(`amp: export ${id} had no matching usage`);
    sources.push(...extracted);
    const usage = fetchAmpThreadUsage(id, ctx);
    if (!usage) notes.push(`amp: usage failed for ${id}`);
    const sourceModels = extracted.map((src) => src.model).filter(Boolean);
    const usageModels = (usage && Array.isArray(usage.models) ? usage.models : []).map((row) => ({
      ...row,
      model: matchAmpUsageModel(row.model, sourceModels),
    }));
    if (usage && usage.costUsd != null) {
      for (const src of extracted) {
        src.costSource = 'amp-usage';
      }
    }
    threads.push({
      id,
      agentMode,
      costUsd: usage ? numOrNull(usage.costUsd) : null,
      inputTokens: usage ? numOrNull(usage.inputTokens) : null,
      outputTokens: usage ? numOrNull(usage.outputTokens) : null,
      totalTokens: usage ? numOrNull(usage.totalTokens) : null,
      cacheReadTokens: usage ? numOrNull(usage.cacheReadTokens) : null,
      models: usageModels,
    });
  }
  return { sources, threads };
}

export const CURSOR_USAGE_FILE_REL = join('.agents', 'spend', 'cursor-usage.jsonl');

function loadCursorUsageById(cwd) {
  const filePath = join(cwd, CURSOR_USAGE_FILE_REL);
  const bestById = new Map();
  if (!existsSync(filePath)) return bestById;
  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return bestById;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const id = row.id == null || row.id === '' ? null : String(row.id);
    if (!id) continue;
    const inputTokens = numOrNull(row.inputTokens);
    const outputTokens = numOrNull(row.outputTokens);
    if (inputTokens == null && outputTokens == null) continue;
    const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
    const previous = bestById.get(id);
    const previousTotal = previous
      ? (numOrNull(previous.inputTokens) ?? 0) + (numOrNull(previous.outputTokens) ?? 0)
      : -1;
    if (!previous || totalTokens >= previousTotal) bestById.set(id, row);
  }
  return bestById;
}

export function attachCursorEstimates(sources, cwd) {
  const byId = loadCursorUsageById(cwd);
  let changed = false;
  for (const src of sources || []) {
    if (!src || src.platform !== 'cursor') continue;
    const row = src.id ? byId.get(String(src.id)) : null;
    if (row) {
      const cache = numOrNull(row.cacheReadTokens);
      if (src.cacheReadTokens == null && cache != null) {
        src.cacheReadTokens = cache;
        changed = true;
      }
      if (!src.model && (row.model || row.modelId)) {
        src.model = row.model || row.modelId;
        changed = true;
      }
    }
    const described = describeCursorCostEstimate({
      model: src.model,
      inputTokens: src.inputTokens,
      outputTokens: src.outputTokens,
      cacheReadTokens: src.cacheReadTokens,
      totalTokens: src.totalTokens,
    });
    if (!described) continue;
    if (src.costUsdEstimated !== described.usd) {
      src.costUsdEstimated = described.usd;
      changed = true;
    }
    if (src.costSource !== described.costSource) {
      src.costSource = described.costSource;
      changed = true;
    }
  }
  return changed;
}

export function enrichMetricsCursorEstimates(metrics, cwd) {
  let changed = false;
  for (const session of metrics.sessions || []) {
    const deduped = dedupeCursorSources(session.sources || []);
    if (deduped.length !== (session.sources || []).length) {
      session.sources = deduped;
      changed = true;
    } else {
      session.sources = deduped;
    }
    if (attachCursorEstimates(session.sources || [], cwd)) changed = true;
    let estimated = null;
    for (const src of session.sources || []) {
      estimated = addNullable(estimated, numOrNull(src.costUsdEstimated));
    }
    if (estimated != null && session.costUsdEstimated !== estimated) {
      session.costUsdEstimated = estimated;
      changed = true;
    }
    if (!session.spendSource || session.spendSource === 'adapter' || session.spendSource === 'unreported') {
      let inputTokens = null;
      let outputTokens = null;
      let totalTokens = null;
      for (const src of session.sources || []) {
        inputTokens = addNullable(inputTokens, numOrNull(src.inputTokens));
        outputTokens = addNullable(outputTokens, numOrNull(src.outputTokens));
        totalTokens = addNullable(totalTokens, numOrNull(src.totalTokens));
      }
      if (session.inputTokens !== inputTokens) {
        session.inputTokens = inputTokens;
        changed = true;
      }
      if (session.outputTokens !== outputTokens) {
        session.outputTokens = outputTokens;
        changed = true;
      }
      if (session.totalTokens !== totalTokens) {
        session.totalTokens = totalTokens;
        changed = true;
      }
    }
    if (
      session.spendSource === 'unreported'
      && (session.inputTokens != null || session.totalTokens != null || (session.sources || []).length)
    ) {
      session.spendSource = 'adapter';
      changed = true;
    }
  }
  return changed;
}

function collectCursor({ cwd, windowStart, windowEnd, existing, existingSources, notes, env, cursorConversationId }) {
  const filePath = join(cwd, CURSOR_USAGE_FILE_REL);
  if (!existsSync(filePath)) {
    notes.push('cursor: usage file missing (spend hook not installed or no turns recorded yet)');
    return [];
  }
  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    notes.push('cursor: cannot read usage file');
    return [];
  }
  const filterId = String((env && env.CURSOR_CONVERSATION_ID) || cursorConversationId || '').trim();
  const existingFingerprints = new Set();
  for (const src of existingSources || []) {
    const fp = cursorSpendFingerprint(src);
    if (fp) existingFingerprints.add(fp);
  }
  // stop / afterAgentResponse / loop follow-ups may write the same generation_id
  // several times with cumulative turn totals; keep the largest record per id.
  // Cursor sometimes omits generation_id, so stop + afterAgentResponse get two
  // ids for one turn — collapse those by token fingerprint.
  const bestById = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const id = row.id == null || row.id === '' ? null : String(row.id);
    if (!id) continue;
    if (existing.has(id)) continue;
    if (filterId) {
      const rowConversationId = row.conversationId == null || row.conversationId === ''
        ? ''
        : String(row.conversationId).trim();
      if (rowConversationId !== filterId) continue;
    }
    if (!inWindow(row.at, windowStart, windowEnd)) continue;
    const inputTokens = numOrNull(row.inputTokens);
    const outputTokens = numOrNull(row.outputTokens);
    if (inputTokens == null && outputTokens == null) continue;
    const fp = cursorSpendFingerprint(row);
    if (fp && existingFingerprints.has(fp)) continue;
    const model = row.model || row.modelId;
    const cacheReadTokens = numOrNull(row.cacheReadTokens);
    const described = describeCursorCostEstimate({
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
    });
    const record = sourceRecord({
      id,
      platform: 'cursor',
      model,
      inputTokens,
      outputTokens,
      costUsd: null,
      ampCredits: null,
      at: row.at,
      cacheReadTokens,
      costUsdEstimated: described?.usd ?? null,
      costSource: described?.costSource ?? null,
    });
    record.event = row.event || null;
    const previous = bestById.get(id);
    if (!previous || (record.totalTokens ?? 0) >= (previous.totalTokens ?? 0)) {
      bestById.set(id, record);
    }
  }
  const bestByFingerprint = new Map();
  for (const record of bestById.values()) {
    const fp = cursorSpendFingerprint(record) || record.id;
    bestByFingerprint.set(fp, preferCursorSource(bestByFingerprint.get(fp), record));
  }
  return [...bestByFingerprint.values()].map(stripCursorCollectMeta);
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
      bucket.costUsdEstimated = addNullable(bucket.costUsdEstimated, src.costUsdEstimated);
      if (platform === 'claude') bucket.source = 'claude-jsonl';
      else if (platform === 'amp') bucket.source = src.via === 'amp-cli' ? 'amp-cli' : 'amp-thread';
      else bucket.source = 'cursor-hook';
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
        costUsdEstimated: null,
      };
      row.inputTokens = addNullable(row.inputTokens, src.inputTokens);
      row.outputTokens = addNullable(row.outputTokens, src.outputTokens);
      row.totalTokens = addNullable(row.totalTokens, src.totalTokens);
      row.costUsd = addNullable(row.costUsd, src.costUsd);
      row.ampCredits = addNullable(row.ampCredits, src.ampCredits);
      row.costUsdEstimated = addNullable(row.costUsdEstimated, src.costUsdEstimated);
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
  const wanted = Array.isArray(options.platforms)
    ? options.platforms.filter((name) => PLATFORMS.includes(name))
    : PLATFORMS;
  const run = (name) => !wanted.length || wanted.includes(name);
  const existingSources = Array.isArray(options.existingSources) ? options.existingSources : [];
  const ctx = {
    cwd,
    windowStart,
    windowEnd,
    existing,
    existingSources,
    env,
    homedir,
    notes,
    ampThreadId: options.ampThreadId,
    cursorConversationId: options.cursorConversationId,
    exportAmpThread: options.exportAmpThread,
    listAmpThreads: options.listAmpThreads,
    usageAmpThread: options.usageAmpThread,
    ampBin: options.ampBin,
    timeoutMs: options.timeoutMs,
  };
  let sources = [];
  const ampThreads = [];
  if (run('claude')) {
    try {
      sources = sources.concat(collectClaude(ctx));
    } catch {
      notes.push('claude: adapter failed');
    }
  }
  if (run('amp')) {
    if (options.ampCli === true || typeof options.exportAmpThread === 'function') {
      try {
        const cli = collectAmpCli(ctx);
        sources = sources.concat(cli.sources || []);
        if (Array.isArray(cli.threads)) ampThreads.push(...cli.threads);
      } catch {
        notes.push('amp: cli export failed');
      }
    }
    try {
      sources = sources.concat(collectAmp(ctx));
    } catch {
      notes.push('amp: adapter failed');
    }
  }
  if (run('cursor')) {
    try {
      sources = sources.concat(collectCursor(ctx));
    } catch {
      notes.push('cursor: adapter failed');
    }
  }
  const { byPlatform, byModel } = aggregate(sources);
  applyAmpThreadSpend(byPlatform, byModel, ampThreads);
  return { sources, byPlatform, byModel, notes, ampThreads };
}

function applyAmpThreadSpend(byPlatform, byModel, threads) {
  if (!threads || !threads.length) return;
  let cost = null;
  for (const thread of threads) {
    cost = addNullable(cost, numOrNull(thread.costUsd));
    for (const row of thread.models || []) {
      if (!row.model) continue;
      const key = `${row.model}::amp`;
      const existing = byModel.find((item) => `${item.model}::${item.platform || ''}` === key)
        || byModel.find((item) => item.platform === 'amp' && item.model === row.model);
      if (existing && row.costUsd != null) existing.costUsd = addNullable(existing.costUsd, row.costUsd);
    }
  }
  if (cost != null) byPlatform.amp.costUsd = addNullable(byPlatform.amp.costUsd, cost);
}
