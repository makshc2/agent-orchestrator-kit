#!/usr/bin/env node
// Cursor hook (sessionEnd): merge leftover hook rows into the last metrics
// session after `stop` has written `.agents/spend/cursor-usage.jsonl`.
// Fail-open and silent — never block the agent loop.
'use strict';

const { existsSync, readdirSync, readFileSync, writeFileSync, statSync } = require('fs');
const { join, resolve } = require('path');

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addNullable(a, b) {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function roundUsd4(x) {
  if (x == null) return null;
  return Math.round(Number(x) * 10000) / 10000;
}

function timestampMs(value) {
  if (value == null || value === '') return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
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

function uniqueExistingAbsPaths(payload) {
  const seen = new Set();
  const out = [];
  const add = (value) => {
    if (value == null || value === '') return;
    let abs;
    try {
      abs = resolve(String(value));
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    try {
      if (!existsSync(abs)) return;
    } catch {
      return;
    }
    seen.add(abs);
    out.push(abs);
  };
  add(process.cwd());
  const roots = payload && Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  for (const root of roots) add(root);
  return out;
}

function leftoverCandidateRoots(payload) {
  return uniqueExistingAbsPaths(payload).filter((root) => existsSync(join(root, 'openspec', 'changes')));
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function metricsHasConversationThread(metrics, conversationId) {
  if (!metrics || typeof metrics !== 'object' || !conversationId) return false;
  const pendingId = metrics.pending && metrics.pending.threadId != null && metrics.pending.threadId !== ''
    ? String(metrics.pending.threadId).trim()
    : '';
  if (pendingId && pendingId === conversationId) return true;
  const sessions = Array.isArray(metrics.sessions) ? metrics.sessions : [];
  const last = sessions[sessions.length - 1];
  const lastId = last && last.threadId != null && last.threadId !== ''
    ? String(last.threadId).trim()
    : '';
  return Boolean(lastId && lastId === conversationId);
}

function activeChangeNames(changesDir) {
  const names = [];
  let entries;
  try {
    entries = readdirSync(changesDir);
  } catch {
    return names;
  }
  for (const name of entries) {
    if (name === 'archive') continue;
    const full = join(changesDir, name);
    try {
      if (statSync(full).isDirectory()) names.push(name);
    } catch {
      continue;
    }
  }
  return names;
}

function rootHasMatchingThread(root, conversationId) {
  const changesDir = join(root, 'openspec', 'changes');
  if (!existsSync(changesDir)) return false;
  for (const name of activeChangeNames(changesDir)) {
    if (metricsHasConversationThread(readJsonSafe(join(changesDir, name, 'metrics.json')), conversationId)) {
      return true;
    }
  }
  const archiveDir = join(changesDir, 'archive');
  if (!existsSync(archiveDir)) return false;
  const seen = new Set();
  let entries;
  try {
    entries = readdirSync(archiveDir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const changeName = archivedChangeName(entry);
    if (!changeName || seen.has(changeName)) continue;
    seen.add(changeName);
    const dir = newestArchiveDirForName(archiveDir, changeName);
    if (!dir) continue;
    if (metricsHasConversationThread(readJsonSafe(join(dir, 'metrics.json')), conversationId)) return true;
  }
  return false;
}

function rootHasActiveChange(root) {
  return activeChangeNames(join(root, 'openspec', 'changes')).length > 0;
}

function jsonlHasConversationId(root, conversationId) {
  if (!conversationId) return false;
  const filePath = join(root, '.agents', 'spend', 'cursor-usage.jsonl');
  if (!existsSync(filePath)) return false;
  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const id = row && row.conversationId != null && row.conversationId !== ''
      ? String(row.conversationId).trim()
      : '';
    if (id && id === conversationId) return true;
  }
  return false;
}

function resolveBaseDir(payload) {
  const candidates = uniqueExistingAbsPaths(payload && typeof payload === 'object' ? payload : {});
  const conversationId = String((payload && payload.conversation_id) || '').trim();
  if (conversationId) {
    for (const root of candidates) {
      if (rootHasMatchingThread(root, conversationId)) return root;
    }
  }
  for (const root of candidates) {
    if (rootHasActiveChange(root)) return root;
  }
  if (conversationId) {
    for (const root of candidates) {
      if (jsonlHasConversationId(root, conversationId)) return root;
    }
  }
  const cwd = resolve(process.cwd());
  if (
    candidates.includes(cwd)
    && (existsSync(join(cwd, 'openspec', 'changes')) || existsSync(join(cwd, '.agents')))
  ) {
    return cwd;
  }
  if (!candidates.length) return cwd;
  return [...candidates].sort()[0];
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
  return { inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated: roundUsd4(costUsdEstimated) };
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
    const sessionStartMs = timestampMs(session.startedAt);
    if (Number.isFinite(sessionStartMs) && (firstStart == null || sessionStartMs < timestampMs(firstStart))) {
      firstStart = session.startedAt;
    }
    const sessionEndMs = timestampMs(session.endedAt);
    if (Number.isFinite(sessionEndMs) && (lastEnd == null || sessionEndMs > timestampMs(lastEnd))) {
      lastEnd = session.endedAt;
    }

    const key = session.phase || 'other';
    const phase = phases[key] || {
      sessions: 0,
      durationMs: null,
      startedAt: null,
      endedAt: null,
      leadTimeMs: null,
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
    if (Number.isFinite(sessionStartMs) && (phase.startedAt == null || sessionStartMs < timestampMs(phase.startedAt))) {
      phase.startedAt = session.startedAt;
    }
    if (Number.isFinite(sessionEndMs) && (phase.endedAt == null || sessionEndMs > timestampMs(phase.endedAt))) {
      phase.endedAt = session.endedAt;
    }
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

    let sessionSourceCostUsd = null;
    for (const src of session.sources || []) {
      sessionSourceCostUsd = addNullable(sessionSourceCostUsd, numOrNull(src.costUsd));
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
    const sessionCostUsd = numOrNull(session.costUsd);
    if (sessionSourceCostUsd == null && sessionCostUsd != null) {
      const billedBucket = session.platform && byPlatform[session.platform];
      if (billedBucket) billedBucket.costUsd = addNullable(billedBucket.costUsd, sessionCostUsd);
    }
  }

  if (firstStart && lastEnd) {
    totals.leadTimeMs = Math.max(0, Date.parse(lastEnd) - Date.parse(firstStart));
  }
  for (const phase of Object.values(phases)) {
    const startMs = timestampMs(phase.startedAt);
    const endMs = timestampMs(phase.endedAt);
    phase.leadTimeMs = Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, endMs - startMs)
      : null;
    phase.costUsdEstimated = roundUsd4(phase.costUsdEstimated);
  }
  spend.costUsdEstimated = roundUsd4(spend.costUsdEstimated);
  for (const bucket of Object.values(byPlatform)) {
    bucket.costUsdEstimated = roundUsd4(bucket.costUsdEstimated);
  }
  for (const row of byModel.values()) {
    row.costUsdEstimated = roundUsd4(row.costUsdEstimated);
  }
  metrics.phases = phases;
  metrics.totals = totals;
  metrics.spend = spend;
  metrics.spendByPlatform = byPlatform;
  metrics.spendByModel = [...byModel.values()];
}

function incomingCursorSources(cwd, existing, fingerprints, windowStart, windowEnd, byId, exclusiveEnd, filterConversationId) {
  const startMs = windowStart ? Date.parse(windowStart) : NaN;
  const endMs = windowEnd ? Date.parse(windowEnd) : NaN;
  const filterId = String(filterConversationId || '').trim();
  const bestById = new Map();
  for (const [id, row] of byId) {
    if (existing.has(id)) continue;
    if (filterId) {
      const rowConversationId = row.conversationId == null || row.conversationId === ''
        ? ''
        : String(row.conversationId).trim();
      if (rowConversationId !== filterId) continue;
    }
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
      last.threadId,
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

function backfillRoot(cwd) {
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

function parsePayload(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function main(raw) {
  const payload = parsePayload(raw);
  const candidates = leftoverCandidateRoots(payload && typeof payload === 'object' ? payload : {});
  for (const cwd of candidates) {
    try {
      backfillRoot(cwd);
    } catch {}
  }
}

if (require.main === module) {
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
}

module.exports = {
  main,
  backfillLeftover: main,
  resolveBaseDir,
};
