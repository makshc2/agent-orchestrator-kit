#!/usr/bin/env node
// Cursor hook (stop / subagentStop / afterAgentResponse): appends per-turn token usage from the hook
// payload to .agents/spend/cursor-usage.jsonl so `agent-orchestrator-kit handoff`
// can collect real Cursor spend offline. Silent and fail-open by design: a hook
// must never block the agent loop, so every failure path exits 0 with no output.
'use strict';

const { existsSync, mkdirSync, appendFileSync } = require('fs');
const { join } = require('path');

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveBaseDir(payload) {
  const cwd = process.cwd();
  if (existsSync(join(cwd, '.agents'))) return cwd;
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  for (const root of roots) {
    if (root && existsSync(join(String(root), '.agents'))) return String(root);
  }
  return cwd;
}

function main(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;

  const inputTokens = numOrNull(payload.input_tokens);
  const outputTokens = numOrNull(payload.output_tokens);
  // Token fields are optional in Cursor hook payloads. No numbers -> no record;
  // never write zeros for turns that did not report usage.
  if (inputTokens == null && outputTokens == null) return;

  const generationId = payload.generation_id ? String(payload.generation_id) : '';
  const conversationId = payload.conversation_id ? String(payload.conversation_id) : '';
  const cacheReadTokens = numOrNull(payload.cache_read_tokens);
  const id = generationId || [
    conversationId || 'none',
    inputTokens ?? 0,
    outputTokens ?? 0,
    cacheReadTokens ?? 0,
  ].join(':');

  const record = {
    id,
    event: payload.hook_event_name ? String(payload.hook_event_name) : null,
    conversationId: conversationId || null,
    model: payload.model ? String(payload.model) : null,
    modelId: payload.model_id ? String(payload.model_id) : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: numOrNull(payload.cache_write_tokens),
    at: new Date().toISOString(),
  };

  const spendDir = join(resolveBaseDir(payload), '.agents', 'spend');
  mkdirSync(spendDir, { recursive: true });
  appendFileSync(join(spendDir, 'cursor-usage.jsonl'), `${JSON.stringify(record)}\n`);
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
