#!/usr/bin/env node
// Cursor hook (sessionEnd): merge leftover hook rows into the last metrics
// session after `stop` has written `.agents/spend/cursor-usage.jsonl`.
// Fail-open and silent — never block the agent loop.
'use strict';

const { existsSync, readdirSync, readFileSync, writeFileSync, statSync } = require('fs');
const { join } = require('path');

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addNullable(a, b) {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

const GROK_46 = {
  inputPerM: 2,
  cachedPerM: 0.5,
  outputPerM: 6,
  longInputPerM: 4,
  longCachedPerM: 1,
  longOutputPerM: 12,
  longAt: 200000,
};

function ratesForModel(model) {
  const id = String(model || '').toLowerCase();
  if (!id) return null;
  let rates = null;
  if (id.includes('grok-4.6') || id.includes('grok-4-6')) rates = { ...GROK_46 };
  else if (id.includes('grok-4.5') || id.includes('grok-4-5')) {
    rates = { ...GROK_46, cachedPerM: 0.3, longCachedPerM: 0.6 };
  } else {
    return null;
  }
  if (id.includes('fast')) {
    for (const key of ['inputPerM', 'cachedPerM', 'outputPerM', 'longInputPerM', 'longCachedPerM', 'longOutputPerM']) {
      rates[key] *= 2;
    }
  }
  return rates;
}

function estimateCursorCostUsd({ model, inputTokens, outputTokens, cacheReadTokens, totalTokens } = {}) {
  const rates = ratesForModel(model);
  if (rates) {
    const input = numOrNull(inputTokens);
    const output = numOrNull(outputTokens) ?? 0;
    if (input == null && output == 0) return null;
    const totalInput = input ?? 0;
    const cached = Math.min(numOrNull(cacheReadTokens) ?? 0, totalInput);
    const fresh = Math.max(0, totalInput - cached);
    const long = totalInput >= rates.longAt;
    const inputRate = long ? rates.longInputPerM : rates.inputPerM;
    const cachedRate = long ? rates.longCachedPerM : rates.cachedPerM;
    const outputRate = long ? rates.longOutputPerM : rates.outputPerM;
    const usd = (fresh * inputRate + cached * cachedRate + output * outputRate) / 1e6;
    return Math.round(usd * 10000) / 10000;
  }
  const input = numOrNull(inputTokens);
  const output = numOrNull(outputTokens);
  if (input != null || output != null) {
    const usd = ((input ?? 0) * 3 + (output ?? 0) * 15) / 1e6;
    return Math.round(usd * 10000) / 10000;
  }
  const total = numOrNull(totalTokens);
  if (total != null) {
    const usd = total * 3.5 / 1e6;
    return Math.round(usd * 10000) / 10000;
  }
  return null;
}

function describeCursorCostEstimate(args) {
  const usd = estimateCursorCostUsd(args);
  if (usd == null) return null;
  return {
    usd,
    costSource: ratesForModel(args && args.model) != null ? 'api-estimate' : 'api-estimate-fallback',
  };
}

function resolveBaseDir(payload) {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'openspec', 'changes'))) return cwd;
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  for (const root of roots) {
    if (root && existsSync(join(String(root), 'openspec', 'changes'))) return String(root);
  }
  return cwd;
}

const CURSOR_LEFTOVER_GRACE_MS = 120000;

function cursorSpendFingerprint(row) {
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

function dedupeCursorSources(sources) {
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

function leftoverWindowEnd(metrics, last) {
  if (metrics.pending && metrics.pending.startedAt) return metrics.pending.startedAt;
  if (!last || !last.endedAt) return null;
  const end = Date.parse(last.endedAt);
  if (!Number.isFinite(end)) return null;
  return new Date(end + CURSOR_LEFTOVER_GRACE_MS).toISOString();
}

function leftoverEndExclusive(metrics) {
  return Boolean(metrics.pending && metrics.pending.startedAt);
}

function existingIds(metrics) {
  const ids = new Set();
  for (const session of metrics.sessions || []) {
    for (const src of session.sources || []) {
      if (src && src.id != null && src.id !== '') ids.add(String(src.id));
    }
  }
  return ids;
}

function loadCursorUsageById(cwd) {
  const filePath = join(cwd, '.agents', 'spend', 'cursor-usage.jsonl');
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

function applyCursorEstimate(record) {
  const described = describeCursorCostEstimate({
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    totalTokens: record.totalTokens,
  });
  if (!described) return false;
  let changed = false;
  if (record.costUsdEstimated !== described.usd) {
    record.costUsdEstimated = described.usd;
    changed = true;
  }
  if (record.costSource !== described.costSource) {
    record.costSource = described.costSource;
    changed = true;
  }
  return changed;
}

function attachCursorEstimates(sources, byId) {
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
    if (applyCursorEstimate(src)) changed = true;
  }
  return changed;
}

function sourceTotals(sources) {
  let inputTokens = null;
  let outputTokens = null;
  let totalTokens = null;
  let costUsd = null;
  let costUsdEstimated = null;
  for (const src of sources || []) {
    inputTokens = addNullable(inputTokens, numOrNull(src.inputTokens));
    outputTokens = addNullable(outputTokens, numOrNull(src.outputTokens));
    totalTokens = addNullable(totalTokens, numOrNull(src.totalTokens));
    if (src.costUsd != null) costUsd = addNullable(costUsd, numOrNull(src.costUsd));
    costUsdEstimated = addNullable(costUsdEstimated, numOrNull(src.costUsdEstimated));
  }
  return { inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated };
}

function looksOverridden(session) {
  const fromSources = sourceTotals(session.sources || []);
  return ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd'].some((key) => {
    const sessionVal = numOrNull(session[key]);
    const sourceVal = numOrNull(fromSources[key]);
    if (sessionVal == null) return false;
    if (sourceVal == null) return true;
    return sessionVal !== sourceVal;
  });
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

function recompute(metrics) {
  const phases = {};
  const totals = { sessions: 0, durationMs: null, leadTimeMs: null, cloudSessions: 0 };
  const spend = { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, costUsdEstimated: null };
  const byPlatform = {
    cursor: emptyPlatform(),
    claude: emptyPlatform(),
    amp: emptyPlatform(),
  };
  const byModel = new Map();
  let firstStart = null;
  let lastEnd = null;

  for (const session of metrics.sessions || []) {
    totals.sessions += 1;
    if (session.runtime === 'cloud') totals.cloudSessions += 1;
    totals.durationMs = addNullable(totals.durationMs, numOrNull(session.durationMs));
    if (session.startedAt && (firstStart == null || session.startedAt < firstStart)) firstStart = session.startedAt;
    if (session.endedAt && (lastEnd == null || session.endedAt > lastEnd)) lastEnd = session.endedAt;

    const key = session.phase || 'other';
    const phase = phases[key] || {
      sessions: 0,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      costUsdEstimated: null,
      agents: [],
      models: [],
    };
    phase.sessions += 1;
    phase.durationMs = addNullable(phase.durationMs, numOrNull(session.durationMs));
    for (const spendKey of ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'costUsdEstimated']) {
      const fromSession = numOrNull(session[spendKey]);
      let value = fromSession;
      if (value == null) {
        let sum = null;
        for (const src of session.sources || []) sum = addNullable(sum, numOrNull(src[spendKey]));
        value = sum;
      }
      phase[spendKey] = addNullable(phase[spendKey], value);
      spend[spendKey] = addNullable(spend[spendKey], value);
    }
    if (session.role && !phase.agents.includes(session.role)) phase.agents.push(session.role);
    if (session.model && !phase.models.includes(session.model)) phase.models.push(session.model);
    if (Array.isArray(session.models)) {
      for (const model of session.models) {
        if (model && !phase.models.includes(model)) phase.models.push(model);
      }
    }
    phases[key] = phase;

    for (const src of session.sources || []) {
      const platform = src.platform;
      if (platform && byPlatform[platform]) {
        const bucket = byPlatform[platform];
        bucket.inputTokens = addNullable(bucket.inputTokens, numOrNull(src.inputTokens));
        bucket.outputTokens = addNullable(bucket.outputTokens, numOrNull(src.outputTokens));
        bucket.totalTokens = addNullable(bucket.totalTokens, numOrNull(src.totalTokens));
        bucket.costUsd = addNullable(bucket.costUsd, numOrNull(src.costUsd));
        bucket.ampCredits = addNullable(bucket.ampCredits, numOrNull(src.ampCredits));
        bucket.costUsdEstimated = addNullable(bucket.costUsdEstimated, numOrNull(src.costUsdEstimated));
        if (platform === 'claude') bucket.source = 'claude-jsonl';
        else if (platform === 'amp') bucket.source = 'amp-thread';
        else if (platform === 'cursor') bucket.source = 'cursor-hook';
      }
      if (src.model) {
        const modelKey = `${src.model}::${src.platform || ''}`;
        const row = byModel.get(modelKey) || {
          model: src.model,
          platform: src.platform || null,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: null,
          ampCredits: null,
          costUsdEstimated: null,
        };
        row.inputTokens = addNullable(row.inputTokens, numOrNull(src.inputTokens));
        row.outputTokens = addNullable(row.outputTokens, numOrNull(src.outputTokens));
        row.totalTokens = addNullable(row.totalTokens, numOrNull(src.totalTokens));
        row.costUsd = addNullable(row.costUsd, numOrNull(src.costUsd));
        row.ampCredits = addNullable(row.ampCredits, numOrNull(src.ampCredits));
        row.costUsdEstimated = addNullable(row.costUsdEstimated, numOrNull(src.costUsdEstimated));
        byModel.set(modelKey, row);
      }
    }
  }

  if (firstStart && lastEnd) {
    totals.leadTimeMs = Math.max(0, Date.parse(lastEnd) - Date.parse(firstStart));
  }
  metrics.phases = phases;
  metrics.totals = totals;
  metrics.spend = spend;
  metrics.spendByPlatform = byPlatform;
  metrics.spendByModel = [...byModel.values()];
}

function incomingCursorSources(cwd, existing, fingerprints, windowStart, windowEnd, byId, exclusiveEnd) {
  const startMs = windowStart ? Date.parse(windowStart) : NaN;
  const endMs = windowEnd ? Date.parse(windowEnd) : NaN;
  const bestById = new Map();
  for (const [id, row] of byId) {
    if (existing.has(id)) continue;
    const atMs = Date.parse(row.at);
    if (Number.isFinite(startMs) && Number.isFinite(atMs) && atMs < startMs) continue;
    if (Number.isFinite(endMs) && Number.isFinite(atMs)) {
      if (exclusiveEnd) {
        if (atMs >= endMs) continue;
      } else if (atMs > endMs) continue;
    }
    const inputTokens = numOrNull(row.inputTokens);
    const outputTokens = numOrNull(row.outputTokens);
    if (inputTokens == null && outputTokens == null) continue;
    const fp = cursorSpendFingerprint(row);
    if (fp && fingerprints.has(fp)) continue;
    const cacheReadTokens = numOrNull(row.cacheReadTokens);
    const record = {
      id,
      platform: 'cursor',
      model: row.model || row.modelId || null,
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      costUsd: null,
      ampCredits: null,
      at: row.at == null ? null : String(row.at),
      event: row.event || null,
    };
    if (cacheReadTokens != null) record.cacheReadTokens = cacheReadTokens;
    applyCursorEstimate(record);
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

function existingFingerprints(metrics) {
  const set = new Set();
  for (const session of metrics.sessions || []) {
    for (const src of session.sources || []) {
      const fp = cursorSpendFingerprint(src);
      if (fp) set.add(fp);
    }
  }
  return set;
}

function sessionHasSpendNumbers(session) {
  return (
    numOrNull(session.inputTokens) != null
    || numOrNull(session.outputTokens) != null
    || numOrNull(session.totalTokens) != null
    || numOrNull(session.costUsd) != null
    || numOrNull(session.ampCredits) != null
  );
}

function sessionSpendFrozen(session) {
  if (!session) return false;
  if (session.spendSource === 'flag') return true;
  if (!sessionHasSpendNumbers(session)) return false;
  if (!session.spendSource || session.spendSource === 'adapter' || session.spendSource === 'unreported') return false;
  return true;
}

function syncAdapterSessionTotals(session) {
  if (sessionSpendFrozen(session)) return false;
  const totals = sourceTotals(session.sources || []);
  let changed = false;
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'costUsdEstimated']) {
    if (session[key] !== totals[key]) {
      session[key] = totals[key];
      changed = true;
    }
  }
  if ((session.sources || []).length > 0 && session.spendSource !== 'adapter') {
    session.spendSource = 'adapter';
    changed = true;
  }
  return changed;
}

function enrichMetrics(metrics, cwd) {
  const byId = loadCursorUsageById(cwd);
  let changed = false;
  for (const session of metrics.sessions || []) {
    const deduped = dedupeCursorSources(session.sources || []);
    if (deduped.length !== (session.sources || []).length) {
      session.sources = deduped;
      changed = true;
    } else {
      session.sources = deduped;
    }
    if (attachCursorEstimates(session.sources || [], byId)) changed = true;
    if (syncAdapterSessionTotals(session)) changed = true;
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

function backfillMetricsFile(cwd, filePath) {
  if (!existsSync(filePath)) return;
  let metrics;
  try {
    metrics = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return;
  }
  if (!metrics || typeof metrics !== 'object') return;
  const sessions = Array.isArray(metrics.sessions) ? metrics.sessions : [];
  if (!sessions.length) return;
  let collapsed = false;
  for (const session of sessions) {
    const next = dedupeCursorSources(session.sources || []);
    if (next.length !== (session.sources || []).length) collapsed = true;
    session.sources = next;
  }
  const last = sessions[sessions.length - 1];
  const byId = loadCursorUsageById(cwd);
  const leftoverEnd = leftoverWindowEnd(metrics, last);
  const incoming = last.endedAt && leftoverEnd
    ? incomingCursorSources(
      cwd,
      existingIds(metrics),
      existingFingerprints(metrics),
      last.endedAt,
      leftoverEnd,
      byId,
      leftoverEndExclusive(metrics),
    )
    : [];
  if (incoming.length) {
    last.sources = [...(last.sources || []), ...incoming];
    if (!sessionSpendFrozen(last)) {
      const totals = sourceTotals(last.sources);
      last.inputTokens = totals.inputTokens;
      last.outputTokens = totals.outputTokens;
      last.totalTokens = totals.totalTokens;
      last.costUsd = totals.costUsd;
      last.costUsdEstimated = totals.costUsdEstimated;
      last.spendSource = 'adapter';
    }
  }
  const enriched = enrichMetrics(metrics, cwd);
  if (!incoming.length && !enriched && !collapsed) return;
  metrics.updatedAt = new Date().toISOString();
  recompute(metrics);
  writeFileSync(filePath, `${JSON.stringify(metrics, null, 2)}\n`);
}

function backfillChange(cwd, changeName) {
  backfillMetricsFile(cwd, join(cwd, 'openspec', 'changes', changeName, 'metrics.json'));
}

function archivedChangeName(dirName) {
  const match = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(dirName);
  return match ? match[2] : null;
}

function metricsArchivedAtMs(metricsPath) {
  try {
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    if (metrics && metrics.archivedAt) {
      const t = Date.parse(metrics.archivedAt);
      if (Number.isFinite(t)) return t;
    }
  } catch {}
  return null;
}

function newestArchiveDirForName(archiveDir, changeName) {
  let best = null;
  let bestKey = -Infinity;
  let names;
  try {
    names = readdirSync(archiveDir);
  } catch {
    return null;
  }
  for (const entry of names) {
    if (archivedChangeName(entry) !== changeName) continue;
    const full = join(archiveDir, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const fromMetrics = metricsArchivedAtMs(join(full, 'metrics.json'));
    let key = fromMetrics;
    if (key == null) {
      try {
        key = statSync(full).mtimeMs;
      } catch {
        key = 0;
      }
    }
    if (key >= bestKey) {
      bestKey = key;
      best = full;
    }
  }
  return best;
}

function main(raw) {
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  const cwd = resolveBaseDir(payload && typeof payload === 'object' ? payload : {});
  const changesDir = join(cwd, 'openspec', 'changes');
  if (!existsSync(changesDir)) return;
  const activeNames = new Set();
  for (const name of readdirSync(changesDir)) {
    if (name === 'archive') continue;
    const full = join(changesDir, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    activeNames.add(name);
    backfillChange(cwd, name);
  }
  const archiveDir = join(changesDir, 'archive');
  if (!existsSync(archiveDir)) return;
  let archiveEntries;
  try {
    archiveEntries = readdirSync(archiveDir);
  } catch {
    return;
  }
  const archivedNames = new Set();
  for (const entry of archiveEntries) {
    const changeName = archivedChangeName(entry);
    if (!changeName || activeNames.has(changeName)) continue;
    archivedNames.add(changeName);
  }
  for (const changeName of archivedNames) {
    const dir = newestArchiveDirForName(archiveDir, changeName);
    if (!dir) continue;
    backfillMetricsFile(cwd, join(dir, 'metrics.json'));
  }
}

if (process.stdin.isTTY) {
  try {
    main('');
  } catch {}
  process.exit(0);
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    main(input);
  } catch {}
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
