import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { resolveSessionSpend, sessionSpendIsFrozen, attachLeftoverSources } from '../bin/agent-orchestrator.js';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

function stripAnsi(value) {
  return typeof value === 'string' ? value.replace(/\x1B\[[0-9;]*m/g, '') : value;
}

function isolatedEnv(dir, extra = {}) {
  const env = {
    ...process.env,
    HOME: join(dir, '.aok-home'),
    XDG_CONFIG_HOME: join(dir, '.aok-xdg-config'),
    XDG_DATA_HOME: join(dir, '.aok-xdg-data'),
    AMP_DATA_DIR: join(dir, '.aok-amp'),
    AOK_AMP_BIN: join(dir, '.no-amp-bin'),
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
    delete env[key];
  }
  return { ...env, ...extra };
}

function cliSpawn(dir, args, extra) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: isolatedEnv(dir, extra),
  });
  return {
    status: res.status,
    stdout: stripAnsi(res.stdout),
    stderr: stripAnsi(res.stderr),
  };
}

function runInit(dir) {
  execSync(`node "${CLI}" init --profile generic --name RemoveMetrics --lang en`, {
    cwd: dir,
    stdio: 'pipe',
  });
}

const HANDOFF = `# Session Handoff

## Closed role
Architect

## Done
specs ready

## Next command
\`/opsx:review add-thing\`

## Next role
spec-reviewer
`;

function legacyMetrics(platform) {
  return `\n## Metrics\n- platform: ${platform}\n- model: claude-opus-5\n- input_tokens: 128,000\n- output_tokens: 9400\n- cost_usd: $1.25\n- amp_credits: 12\n- spend_source: self-report\n`;
}

function makeChange(dir, handoffText) {
  const changeDir = join(dir, 'openspec/changes/add-thing');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n- [ ] 1.2 todo\n');
  writeFileSync(join(changeDir, 'handoff.md'), handoffText);
  return changeDir;
}

function sessionsOf(changeDir) {
  return JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions;
}

test('persist ignores a legacy ## Metrics section and drops it from handoff.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-rmsr-'));
  try {
    runInit(dir);
    const changeDir = makeChange(dir, HANDOFF + legacyMetrics('cursor'));
    const first = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /^\/opsx:review add-thing/m);
    assert.doesNotMatch(first.stderr, /## Metrics|Metrics section|invalid platform|unparsable/i);
    const session0 = sessionsOf(changeDir)[0];
    for (const key of ['model', 'platform', 'inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'ampCredits']) {
      assert.equal(session0[key], null, key);
    }
    assert.equal(session0.spendSource, 'unreported');
    const rewritten = readFileSync(join(changeDir, 'handoff.md'), 'utf-8');
    assert.doesNotMatch(rewritten, /## Metrics/);
    assert.match(rewritten, /## Runtime/);
    assert.match(rewritten, /## Prompt/);

    writeFileSync(join(changeDir, 'handoff.md'), HANDOFF + legacyMetrics('chatgpt'));
    const second = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(second.status, 0);
    assert.doesNotMatch(second.stderr, /chatgpt|invalid platform/i);
    assert.equal(sessionsOf(changeDir)[1].platform, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist without flags or adapter data is unreported and prints no Metrics hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-rmsr-'));
  try {
    runInit(dir);
    const changeDir = makeChange(dir, HANDOFF);
    const persisted = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(persisted.status, 0);
    assert.match(persisted.stdout, /^\/opsx:/m);
    assert.doesNotMatch(persisted.stderr, /## Metrics|spend is unreported/);
    assert.match(persisted.stderr, /session\.model is null/);
    const session0 = sessionsOf(changeDir)[0];
    assert.equal(session0.spendSource, 'unreported');
    assert.equal(session0.totalTokens, null);
    assert.doesNotMatch(readFileSync(join(changeDir, 'handoff.md'), 'utf-8'), /## Metrics/);
    const restored = cliSpawn(dir, ['handoff', 'add-thing', '--restore']);
    assert.match(restored.stdout, /unknown — pass --platform/);
    assert.doesNotMatch(restored.stdout, /fill ## Metrics/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model and platform resolve from flags, then env, never from a legacy section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-rmsr-'));
  try {
    runInit(dir);
    const changeDir = makeChange(dir, HANDOFF + legacyMetrics('amp'));
    const env = { AOK_MODEL: 'gpt-5.6-sol', AOK_PLATFORM: 'cursor' };
    const first = cliSpawn(dir, ['handoff', 'add-thing'], env);
    assert.equal(first.status, 0);
    let sessions = sessionsOf(changeDir);
    assert.equal(sessions[0].model, 'gpt-5.6-sol');
    assert.equal(sessions[0].platform, 'cursor');

    writeFileSync(join(changeDir, 'handoff.md'), HANDOFF + legacyMetrics('amp'));
    const second = cliSpawn(dir, ['handoff', 'add-thing', '--model', 'cursor-grok-4.6', '--platform', 'claude'], env);
    assert.equal(second.status, 0);
    sessions = sessionsOf(changeDir);
    assert.equal(sessions[1].model, 'cursor-grok-4.6');
    assert.equal(sessions[1].platform, 'claude');

    writeFileSync(join(changeDir, 'handoff.md'), HANDOFF + legacyMetrics('amp'));
    const third = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(third.status, 0);
    sessions = sessionsOf(changeDir);
    assert.equal(sessions[2].model, null);
    assert.equal(sessions[2].platform, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist canonicalizes a bare Reviewer Closed role to Spec Reviewer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-rmsr-'));
  try {
    runInit(dir);
    const changeDir = makeChange(dir, HANDOFF.replace('## Closed role\nArchitect\n', '## Closed role\nReviewer\n'));
    const first = cliSpawn(dir, ['handoff', 'add-thing', '--model', 'claude-opus-5']);
    assert.equal(first.status, 0);
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions[0].role, 'Spec Reviewer');
    assert.equal(metrics.sessions[0].phase, 'review');
    assert.deepEqual(metrics.phases.review.agents, ['Spec Reviewer']);
    assert.doesNotMatch(first.stderr, /metrics: warning: role/);

    writeFileSync(
      join(changeDir, 'handoff.md'),
      HANDOFF.replace('## Closed role\nArchitect\n', '## Closed role\nCode Reviewer — LGTM\n'),
    );
    const second = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(second.status, 0);
    assert.equal(sessionsOf(changeDir)[1].role, 'Code Reviewer');
    assert.match(second.stderr, /metrics: warning: role "Code Reviewer" is not a canonical Closed role token/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function encodeClaudeProject(cwd) {
  return String(cwd).replace(/[/.]/g, '-');
}

function writeClaudeJsonl(home, cwd, rows) {
  const projectDir = join(home, '.claude', 'projects', encodeClaudeProject(cwd));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'session.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test('resolveSessionSpend ranks flags, Amp usage and adapter sources, and only a flag session is frozen', () => {
  const src = {
    id: 's1',
    platform: 'claude',
    model: 'claude-opus-4-7',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    costUsd: null,
    ampCredits: null,
  };
  const empty = resolveSessionSpend({}, []);
  assert.equal(empty.inputTokens, null);
  assert.equal(empty.costUsd, null);
  assert.equal(empty.ampCredits, null);
  assert.equal(empty.spendSource, 'unreported');

  const fromAdapter = resolveSessionSpend({}, [src]);
  assert.equal(fromAdapter.inputTokens, 100);
  assert.equal(fromAdapter.outputTokens, 50);
  assert.equal(fromAdapter.spendSource, 'adapter');

  const fromFlags = resolveSessionSpend({ inputTokens: 7, costUsd: 9.99 }, [src]);
  assert.equal(fromFlags.inputTokens, 7);
  assert.equal(fromFlags.outputTokens, 50);
  assert.equal(fromFlags.costUsd, 9.99);
  assert.equal(fromFlags.costUsdEstimated, null);
  assert.equal(fromFlags.spendSource, 'flag');

  const fromAmp = resolveSessionSpend({}, [], { ampThreads: [{ id: 'T-1', costUsd: 12.69 }] });
  assert.equal(fromAmp.costUsd, 12.69);
  assert.equal(fromAmp.spendSource, 'amp-usage');

  assert.equal(sessionSpendIsFrozen({ spendSource: 'flag' }), true);
  assert.equal(sessionSpendIsFrozen({ spendSource: 'self-report', inputTokens: 5 }), false);
  assert.equal(sessionSpendIsFrozen({ spendSource: 'amp-usage' }), false);
  assert.equal(sessionSpendIsFrozen({ spendSource: 'adapter' }), false);
  assert.equal(sessionSpendIsFrozen({ spendSource: 'unreported' }), false);
  assert.equal(sessionSpendIsFrozen(null), false);
});

test('leftover keeps a flag session frozen and resyncs a stored self-report session', () => {
  const root = mkdtempSync(join(tmpdir(), 'aok-rmsr-left-'));
  try {
    const cwd = join(root, 'project');
    const home = join(root, 'home');
    mkdirSync(cwd, { recursive: true });
    writeClaudeJsonl(home, cwd, [{
      type: 'assistant',
      cwd,
      timestamp: '2026-09-07T12:00:30.000Z',
      message: {
        id: 'msg-left',
        role: 'assistant',
        model: 'claude-opus-5',
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    }]);
    const buildSession = (overrides) => ({
      role: 'Implementer',
      phase: 'apply',
      platform: 'claude',
      threadId: null,
      startedAt: '2026-09-07T11:50:00.000Z',
      endedAt: '2026-09-07T12:00:00.000Z',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      costUsdEstimated: null,
      spendSource: 'unreported',
      sourceIds: [],
      sourceTotals: {},
      byModel: [],
      ...overrides,
    });
    const extra = { cwd, homedir: home, env: { HOME: home, AMP_DATA_DIR: join(root, 'amp') } };
    const flagSession = buildSession({ spendSource: 'flag', inputTokens: 7, outputTokens: 2, totalTokens: 9 });
    assert.equal(
      attachLeftoverSources({ sessions: [flagSession] }, flagSession, '2026-09-07T12:01:00.000Z', extra),
      1,
    );
    assert.equal(flagSession.inputTokens, 7);
    assert.equal(flagSession.outputTokens, 2);
    assert.equal(flagSession.spendSource, 'flag');
    assert.equal(flagSession.sourceIds.length, 1);

    const selfSession = buildSession({ spendSource: 'self-report', inputTokens: 5, outputTokens: 1, totalTokens: 6 });
    assert.equal(
      attachLeftoverSources({ sessions: [selfSession] }, selfSession, '2026-09-07T12:01:00.000Z', extra),
      1,
    );
    assert.equal(selfSession.inputTokens, 100);
    assert.equal(selfSession.outputTokens, 10);
    assert.equal(selfSession.spendSource, 'adapter');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('metrics --collect keeps the totals of a flag session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-rmsr-'));
  try {
    runInit(dir);
    const changeDir = makeChange(dir, HANDOFF);
    const persisted = cliSpawn(dir, ['handoff', 'add-thing', '--model', 'cursor-grok-4.6', '--input-tokens', '7', '--output-tokens', '2']);
    assert.equal(persisted.status, 0);
    const endedAt = sessionsOf(changeDir)[0].endedAt;
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({ id: 'backfill-1', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 300, outputTokens: 15, at: endedAt })}\n`,
    );
    const collected = cliSpawn(dir, ['metrics', 'add-thing', '--collect']);
    assert.equal(collected.status, 0);
    const session = sessionsOf(changeDir)[0];
    assert.equal(session.inputTokens, 7);
    assert.equal(session.totalTokens, 9);
    assert.equal(session.spendSource, 'flag');
    assert.ok(session.sourceIds.includes('backfill-1'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function read(rel) {
  return readFileSync(join(KIT_ROOT, rel), 'utf-8');
}

function sliceBetween(text, from, to) {
  const start = text.indexOf(from);
  return text.slice(start, text.indexOf(to, start + from.length));
}

test('protocol texts carry no Metrics self-report and keep the persist rules', () => {
  const paths = [
    'templates/.agents/rules/session-handoff.mdc',
    '.agents/rules/session-handoff.mdc',
    'templates/.agents/skills/agent-orchestration/SKILL.md',
    'templates/.agents/subagents/session-handoff.md',
    'templates/.agents/subagents/spec-archiver.md',
    'templates/AGENTS.md',
    'templates/CLAUDE.md',
  ];
  for (const rel of paths) {
    const text = read(rel);
    assert.doesNotMatch(text, /spend_source|amp_credits|self-report/);
    assert.doesNotMatch(text.replace('## Metrics (health check per change)', ''), /## Metrics/);
  }
  const rule = read('templates/.agents/rules/session-handoff.mdc');
  assert.equal(read('.agents/rules/session-handoff.mdc'), rule);
  const skill = read('templates/.agents/skills/agent-orchestration/SKILL.md');
  assert.match(skill, /## Metrics \(health check per change\)/);
  assert.match(rule, /The parent MUST NOT guess tokens/);
  assert.match(rule, /handoff <name> --no-metrics/);
  assert.match(rule, /Never run full persist twice/);
  assert.match(rule, /only the CLI writes `decisions.md`/);
  assert.equal(sliceBetween(rule, '## Session Exit', '\n## ').match(/^\d+\. /gm).length, 8);
  assert.match(skill, /family `cursor-grok-4.6` is only a fallback/);
  assert.equal(
    sliceBetween(read('templates/.agents/subagents/session-handoff.md'), '## Persist mode', '## Rules').match(/^\d+\. /gm).length,
    6,
  );
  assert.doesNotMatch(
    sliceBetween(read('README.md'), '### Change metrics', '### Skill inventory'),
    /self-report|spend_source|amp_credits|Fill `## Metrics`/,
  );
});
