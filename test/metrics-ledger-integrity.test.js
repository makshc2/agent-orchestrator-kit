import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  canonicalRole,
  isCanonicalRole,
  CANONICAL_ROLE_TOKENS,
  metricsSessionInvariantIssues,
  metricsLedgerInvariantIssues,
  normalizeMetricsV2,
  recomputeMetricsAggregates,
  renderMetricsSummary,
} from '../bin/agent-orchestrator.js';
import { ratesForModel, estimateClaudeCostUsd } from '../bin/claude-cost-estimate.js';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

// Archives created before this date predate the ledger contract and are not
// migrated ("historical archives are not migrated", decision 2026-08-29); they
// are exempt by createdAt, never rewritten.
const KIT_METRICS_CONTRACT_SINCE = '2026-09-25T00:00:00.000Z';

function isolatedEnv(dir, extra = {}) {
  const home = join(dir, '.aok-home');
  const xdgConfig = join(dir, '.aok-xdg-config');
  const xdgData = join(dir, '.aok-xdg-data');
  const amp = join(dir, '.aok-amp');
  for (const p of [home, xdgConfig, xdgData, amp]) mkdirSync(p, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    AMP_DATA_DIR: amp,
    AOK_AMP_BIN: join(dir, '.no-amp-bin'),
    ...extra,
  };
  for (const key of [
    'AOK_MODEL',
    'AOK_PLATFORM',
    'CURSOR_AGENT',
    'CURSOR_CONVERSATION_ID',
    'CLAUDECODE',
    'CLAUDE_CODE',
    'CLAUDE_CODE_ENTRYPOINT',
    'AMP_CURRENT_THREAD',
    'AMP_THREAD_ID',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(extra, key)) delete env[key];
  }
  return env;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;
const stripAnsi = (value) => (typeof value === 'string' ? value.replace(ANSI_RE, '') : value);

function cliSpawn(dir, args, extraEnv) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: isolatedEnv(dir, extraEnv),
  });
  return { ...res, stdout: stripAnsi(res.stdout), stderr: stripAnsi(res.stderr) };
}

function runInit(dir, args) {
  execSync(`node "${CLI}" init ${args}`, { cwd: dir, stdio: 'pipe', env: isolatedEnv(dir) });
}

function writeClaudeJsonl(home, cwd, rows) {
  const projectDir = join(home, '.claude', 'projects', String(cwd).replace(/[/.]/g, '-'));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'session.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

const METRICS_HANDOFF = `# Session Handoff

## Closed role
Architect

## Done
specs ready

## Next command
\`/opsx:review add-thing\`

## Next role
spec-reviewer
`;

function makeChange(dir) {
  runInit(dir, '--profile generic --name LedgerIntegrity --lang en');
  const changeDir = join(dir, 'openspec/changes/add-thing');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
  return changeDir;
}

// --- contract test over the kit's own archived ledgers ---------------------

test('archived metrics.json created since the contract date satisfy every ledger invariant', () => {
  const archiveRoot = join(KIT_ROOT, 'openspec', 'changes', 'archive');
  const since = Date.parse(KIT_METRICS_CONTRACT_SINCE);
  let checked = 0;
  for (const entry of readdirSync(archiveRoot).sort()) {
    const filePath = join(archiveRoot, entry, 'metrics.json');
    if (!existsSync(filePath)) continue;
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const createdAt = Date.parse(raw.createdAt || '');
    if (!Number.isFinite(createdAt) || createdAt < since) continue;
    const metrics = normalizeMetricsV2(raw);
    const issues = metricsLedgerInvariantIssues(metrics);
    assert.deepEqual(issues, [], `${entry}/metrics.json violates the ledger contract:\n  ${issues.join('\n  ')}`);
    for (const session of metrics.sessions) {
      assert.ok(isCanonicalRole(session.role), `${entry}: role "${session.role}" is not canonical`);
    }
    checked += 1;
  }
  assert.ok(checked >= 1, 'at least one archive since the contract date must exist (propose-review-pregate)');
});

test('pre-contract archives are exempt by createdAt, not rewritten', () => {
  const archiveRoot = join(KIT_ROOT, 'openspec', 'changes', 'archive');
  const legacy = join(archiveRoot, '2026-09-07-fix-metrics-dedup-window-compact-schema', 'metrics.json');
  const metrics = normalizeMetricsV2(JSON.parse(readFileSync(legacy, 'utf-8')));
  assert.ok(Date.parse(metrics.createdAt) < Date.parse(KIT_METRICS_CONTRACT_SINCE));
  const issues = metricsLedgerInvariantIssues(metrics);
  assert.ok(issues.some((issue) => /exceeds 24h/.test(issue)), 'the 1643h row is still in the historical archive');
  assert.ok(issues.some((issue) => /Spec Architect/.test(issue)), 'historical non-canonical roles are untouched');
});

// --- invariant function ------------------------------------------------------

test('metricsSessionInvariantIssues names every violated invariant and nothing on a sane row', () => {
  const metrics = { createdAt: '2026-09-01T10:00:00.000Z', archivedAt: '2026-09-02T10:00:00.000Z' };
  const bad = {
    role: 'Conductor',
    startedAt: '2026-08-31T09:00:00.000Z',
    endedAt: '2026-09-02T12:00:00.000Z',
    durationMs: 25 * 60 * 60 * 1000,
    spendSource: 'adapter',
    sourceIds: [],
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: 1.5,
    costUsdEstimated: null,
    costUsdTotal: 2,
  };
  const issues = metricsSessionInvariantIssues(bad, metrics);
  assert.match(issues.join('\n'), /role "Conductor" is not a canonical/);
  assert.match(issues.join('\n'), /durationMs 90000000 exceeds 24h/);
  assert.match(issues.join('\n'), /more than 12h before createdAt/);
  assert.match(issues.join('\n'), /after archivedAt/);
  assert.match(issues.join('\n'), /spendSource "adapter" without sourceIds and without tokens/);
  assert.match(issues.join('\n'), /costUsdTotal 2 does not equal .* = 1\.5/);
  assert.equal(issues.length, 6);

  const sane = {
    role: 'Architect',
    startedAt: '2026-09-01T04:00:00.000Z', // propose chat started before the change dir existed: fine
    endedAt: '2026-09-01T11:00:00.000Z',
    durationMs: 7 * 60 * 60 * 1000,
    spendSource: 'adapter',
    sourceIds: ['msg-1'],
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    costUsd: null,
    costUsdEstimated: 0.12345,
    costUsdTotal: 0.1235,
  };
  assert.deepEqual(metricsSessionInvariantIssues(sane, metrics), []);
  const unreported = { role: 'Implementer', durationMs: 1000, spendSource: 'unreported', costUsdTotal: null };
  assert.deepEqual(metricsSessionInvariantIssues(unreported, metrics), []);
});

test('metricsLedgerInvariantIssues checks version and spend.costUsdTotal against the session sum', () => {
  const metrics = normalizeMetricsV2({
    version: 2,
    change: 'x',
    createdAt: '2026-09-01T10:00:00.000Z',
    archivedAt: null,
    sessions: [
      { role: 'Architect', durationMs: 1, spendSource: 'self-report', costUsd: 1.00005, costUsdEstimated: null },
      { role: 'Implementer', durationMs: 1, spendSource: 'adapter', sourceIds: ['a'], costUsd: null, costUsdEstimated: 2.5 },
    ],
  });
  recomputeMetricsAggregates(metrics);
  assert.equal(metrics.sessions[0].costUsdTotal, 1.0001);
  assert.equal(metrics.spend.costUsdTotal, 3.5001);
  assert.deepEqual(metricsLedgerInvariantIssues(metrics), []);

  metrics.spend.costUsdTotal = 9;
  metrics.version = 1;
  const issues = metricsLedgerInvariantIssues(metrics);
  assert.match(issues.join('\n'), /version 1 is not 2/);
  assert.match(issues.join('\n'), /spend\.costUsdTotal 9 does not equal/);
});

// --- canonical roles -----------------------------------------------------------

test('canonicalRole maps the spec-architect subagent to Architect and leaves unknown roles raw', () => {
  assert.equal(canonicalRole('Spec Architect'), 'Architect');
  assert.equal(canonicalRole('Spec Architect — propose complete, ready for Spec Reviewer'), 'Architect');
  assert.equal(canonicalRole('spec architect'), 'Architect');
  assert.equal(canonicalRole('Architect'), 'Architect');
  assert.equal(canonicalRole('Spec Reviewer — APPROVE'), 'Spec Reviewer');
  assert.equal(canonicalRole('Conductor'), 'Conductor');
  assert.equal(canonicalRole('Code Reviewer — LGTM'), 'Code Reviewer');
  assert.equal(isCanonicalRole('Conductor'), false);
  assert.equal(isCanonicalRole('Code Reviewer'), false);
  assert.deepEqual(CANONICAL_ROLE_TOKENS, ['Explorer', 'Architect', 'Spec Reviewer', 'Implementer', 'Archiver', 'Design Intake']);
});

// --- claude cost estimator -----------------------------------------------------

test('ratesForModel knows claude-opus-5-5 and the unknown-model fallback bills cache reads at 0.1x', () => {
  assert.deepEqual(ratesForModel('claude-opus-5-5'), { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 });
  assert.deepEqual(ratesForModel('claude-opus-5'), { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 });
  assert.deepEqual(ratesForModel('claude-opus-4-8'), { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 });
  assert.equal(ratesForModel('gpt-6-astra'), null);
  // 1M input + 9M cache reads + 100k output on Opus 5.5
  assert.equal(estimateClaudeCostUsd({
    model: 'claude-opus-5-5',
    inputTokens: 1000000,
    cacheReadTokens: 9000000,
    cacheCreationTokens: 0,
    outputTokens: 100000,
  }), 7.8);
  // unknown model: 1M cache reads cost $0.30, not the full $3 input rate
  assert.equal(estimateClaudeCostUsd({ model: 'gpt-6-astra', cacheReadTokens: 1000000 }), 0.3);
  assert.equal(estimateClaudeCostUsd({ model: 'gpt-6-astra', inputTokens: 1000000, outputTokens: 10000 }), 3.15);
});

// --- adapter notes reach stderr, stdout stays prompt-only --------------------

test('persist on a cursor client without the spend hook prints the adapter note to stderr only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-ledger-notes-'));
  try {
    const changeDir = makeChange(dir);
    const cursorEnv = { CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'conv-1' };
    const restore = cliSpawn(dir, ['handoff', 'add-thing', '--restore'], cursorEnv);
    assert.equal(restore.status, 0, restore.stderr);
    const pending = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).pending;
    assert.equal(pending.platform, 'cursor');
    assert.ok(!existsSync(join(dir, '.agents/spend/cursor-usage.jsonl')));

    const persist = cliSpawn(dir, ['handoff', 'add-thing'], cursorEnv);
    assert.equal(persist.status, 0, persist.stderr);
    assert.match(persist.stderr, /metrics: cursor: usage file missing/);
    assert.match(persist.stdout, /^\/opsx:/m, 'stdout stays a clean next-thread prompt');
    assert.doesNotMatch(persist.stdout, /usage file missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- write-time invariant warnings are fail-open -------------------------------

test('persist with an implausible --started-at warns on stderr, records session.notes and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-ledger-warn-'));
  try {
    const changeDir = makeChange(dir);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const persist = cliSpawn(dir, ['handoff', 'add-thing', '--started-at', tenDaysAgo]);
    assert.equal(persist.status, 0, persist.stderr);
    assert.match(persist.stderr, /metrics: warning: durationMs \d+ exceeds 24h/);
    assert.match(persist.stderr, /metrics: warning: startedAt .* is more than 12h before createdAt/);
    assert.match(persist.stdout, /^\/opsx:/m);
    assert.doesNotMatch(persist.stdout, /metrics: warning/);
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const session = metrics.sessions[0];
    assert.equal(session.startedAt, tenDaysAgo, 'raw value is kept, not clamped');
    assert.equal(session.role, 'Architect');
    assert.ok(Array.isArray(session.notes));
    assert.equal(session.notes.length, 2);
    assert.match(session.notes[0], /exceeds 24h/);
    assert.match(session.notes[1], /more than 12h before createdAt/);

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    const clean = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(clean.status, 0, clean.stderr);
    assert.doesNotMatch(clean.stderr, /metrics: warning/);
    const after = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal('notes' in after.sessions[1], false, 'a sane session carries no notes key');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- cache columns through session, phase, platform, model and the summary ---

test('Claude cache split lands on session, phase, platform and model rows and the summary prints cache hit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-ledger-cache-'));
  try {
    const changeDir = makeChange(dir);
    const restore = cliSpawn(dir, ['handoff', 'add-thing', '--restore']);
    assert.equal(restore.status, 0, restore.stderr);
    const at = new Date().toISOString();
    writeClaudeJsonl(join(dir, '.aok-home'), dir, [
      {
        type: 'assistant',
        cwd: dir,
        timestamp: at,
        message: {
          id: 'msg-cache-1',
          role: 'assistant',
          model: 'claude-opus-5-5',
          usage: { input_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 100, output_tokens: 5 },
        },
      },
    ]);
    const persist = cliSpawn(dir, ['handoff', 'add-thing', '--collect']);
    assert.equal(persist.status, 0, persist.stderr);
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.version, 2, 'schema stays v2');
    const session = metrics.sessions[0];
    assert.equal(session.spendSource, 'adapter');
    assert.equal(session.inputTokens, 1000, 'inputTokens keeps including cache tokens (spec semantics)');
    assert.equal(session.cacheReadTokens, 800);
    assert.equal(session.cacheCreationTokens, 100);
    assert.equal(session.byModel[0].cacheReadTokens, 800);
    assert.equal(session.byModel[0].cacheCreationTokens, 100);
    assert.equal(metrics.phases.spec.cacheReadTokens, 800);
    assert.equal(metrics.phases.spec.cacheCreationTokens, 100);
    assert.equal(metrics.spend.cacheReadTokens, 800);
    assert.equal(metrics.spend.cacheCreationTokens, 100);
    assert.equal(metrics.spendByPlatform.claude.cacheReadTokens, 800);
    assert.equal(metrics.spendByPlatform.cursor.cacheReadTokens, null, 'platforms without data stay null-honest');
    assert.equal(metrics.spendByModel[0].model, 'claude-opus-5-5');
    assert.equal(metrics.spendByModel[0].cacheReadTokens, 800);
    assert.equal(metrics.spendByModel[0].cacheCreationTokens, 100);
    // Opus 5.5 rates: 100*4 + 800*0.2 + 100*5 + 5*20 = 1160 µ$ → 0.0012
    assert.equal(session.costUsdEstimated, 0.0012);
    assert.equal(session.costUsdTotal, 0.0012);
    assert.deepEqual(metricsLedgerInvariantIssues(metrics), []);

    const summary = cliSpawn(dir, ['metrics', 'add-thing']);
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /^cache hit: 80\.0% \(800 cache-read of 1000 input tokens\)$/m);
    const lines = renderMetricsSummary(metrics);
    assert.ok(lines.some((line) => line.startsWith('cache hit: 80.0%')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('summary omits the cache hit line when no cache data was collected', () => {
  const metrics = normalizeMetricsV2({
    version: 2,
    change: 'x',
    createdAt: '2026-09-01T10:00:00.000Z',
    sessions: [{ role: 'Implementer', durationMs: 1000, spendSource: 'unreported' }],
  });
  recomputeMetricsAggregates(metrics);
  assert.equal(metrics.spend.cacheReadTokens, null);
  assert.ok(!renderMetricsSummary(metrics).some((line) => line.startsWith('cache hit:')));
});

// --- dead config keys are gone from what consumers receive --------------------

test('templates and profiles no longer ship the unread roles.*.model_hint key', () => {
  const files = [
    'templates/orchestrator.yaml',
    'profiles/generic/orchestrator.yaml',
    'profiles/node/orchestrator.yaml',
    'profiles/vue3/orchestrator.yaml',
    'profiles/mvp/orchestrator.yaml',
  ];
  for (const rel of files) {
    const content = readFileSync(join(KIT_ROOT, rel), 'utf-8');
    assert.doesNotMatch(content, /model_hint/, `${rel} still has model_hint`);
    assert.match(content, /design_intake:\n\s+command: \/opsx:design\n\s+mode: brief-only\n/, `${rel} keeps the design_intake role`);
  }
});
