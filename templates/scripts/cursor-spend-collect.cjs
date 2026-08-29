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

function resolveBaseDir(payload) {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'openspec', 'changes'))) return cwd;
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  for (const root of roots) {
    if (root && existsSync(join(String(root), 'openspec', 'changes'))) return String(root);
  }
  return cwd;
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

function sourceTotals(sources) {
  let inputTokens = null;
  let outputTokens = null;
  let totalTokens = null;
  let costUsd = null;
  for (const src of sources || []) {
    inputTokens = addNullable(inputTokens, numOrNull(src.inputTokens));
    outputTokens = addNullable(outputTokens, numOrNull(src.outputTokens));
    totalTokens = addNullable(totalTokens, numOrNull(src.totalTokens));
    if (src.costUsd != null) costUsd = addNullable(costUsd, numOrNull(src.costUsd));
  }
  return { inputTokens, outputTokens, totalTokens, costUsd };
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
    source,
  };
}

function recompute(metrics) {
  const phases = {};
  const totals = { sessions: 0, durationMs: null, leadTimeMs: null, cloudSessions: 0 };
  const spend = { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null };
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
      agents: [],
      models: [],
    };
    phase.sessions += 1;
    phase.durationMs = addNullable(phase.durationMs, numOrNull(session.durationMs));
    for (const spendKey of ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd']) {
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
        };
        row.inputTokens = addNullable(row.inputTokens, numOrNull(src.inputTokens));
        row.outputTokens = addNullable(row.outputTokens, numOrNull(src.outputTokens));
        row.totalTokens = addNullable(row.totalTokens, numOrNull(src.totalTokens));
        row.costUsd = addNullable(row.costUsd, numOrNull(src.costUsd));
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

function incomingCursorSources(cwd, existing, windowStart) {
  const filePath = join(cwd, '.agents', 'spend', 'cursor-usage.jsonl');
  if (!existsSync(filePath)) return [];
  const startMs = windowStart ? Date.parse(windowStart) : NaN;
  const bestById = new Map();
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const id = row.id == null || row.id === '' ? null : String(row.id);
    if (!id || existing.has(id)) continue;
    const atMs = Date.parse(row.at);
    if (Number.isFinite(startMs) && Number.isFinite(atMs) && atMs < startMs) continue;
    const inputTokens = numOrNull(row.inputTokens);
    const outputTokens = numOrNull(row.outputTokens);
    if (inputTokens == null && outputTokens == null) continue;
    const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
    const record = {
      id,
      platform: 'cursor',
      model: row.model || row.modelId || null,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd: null,
      ampCredits: null,
      at: row.at == null ? null : String(row.at),
    };
    const previous = bestById.get(id);
    if (!previous || (record.totalTokens ?? 0) >= (previous.totalTokens ?? 0)) {
      bestById.set(id, record);
    }
  }
  return [...bestById.values()];
}

function backfillChange(cwd, changeName) {
  const filePath = join(cwd, 'openspec', 'changes', changeName, 'metrics.json');
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
  const last = sessions[sessions.length - 1];
  const incoming = incomingCursorSources(
    cwd,
    existingIds(metrics),
    last.startedAt || last.endedAt || metrics.createdAt,
  );
  if (!incoming.length) return;
  const overridden = looksOverridden(last);
  last.sources = [...(last.sources || []), ...incoming];
  if (!overridden) {
    const totals = sourceTotals(last.sources);
    last.inputTokens = totals.inputTokens;
    last.outputTokens = totals.outputTokens;
    last.totalTokens = totals.totalTokens;
    last.costUsd = totals.costUsd;
  }
  metrics.updatedAt = new Date().toISOString();
  recompute(metrics);
  writeFileSync(filePath, `${JSON.stringify(metrics, null, 2)}\n`);
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
  for (const name of readdirSync(changesDir)) {
    if (name === 'archive') continue;
    const full = join(changesDir, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    backfillChange(cwd, name);
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
