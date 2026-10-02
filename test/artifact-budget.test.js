import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parsePipelineConfig, artifactBudgetFindings } from '../bin/agent-orchestrator.js';

// Tier 1 (`gate-check --review`) measures proposal.md, design.md, tasks.md and
// the delta specs of a change in bytes and reports an `artifact budget`
// finding above 60 000 B (tasks.md) or 150 000 B (their total): a warning by
// default, an error under `pipeline.artifact_budget: strict`, nothing under `off`.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;

function isolatedEnv(dir) {
  const env = { ...process.env, HOME: join(dir, '.aok-home'), XDG_CONFIG_HOME: join(dir, '.aok-xdg-config'), XDG_DATA_HOME: join(dir, '.aok-xdg-data'), AMP_DATA_DIR: join(dir, '.aok-amp'), AOK_AMP_BIN: join(dir, '.no-amp-bin') };
  for (const key of ['AOK_MODEL', 'AOK_PLATFORM', 'CURSOR_AGENT', 'CURSOR_CONVERSATION_ID', 'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'AMP_CURRENT_THREAD', 'AMP_THREAD_ID']) delete env[key];
  for (const sub of ['.aok-home', '.aok-xdg-config', '.aok-xdg-data', '.aok-amp']) mkdirSync(join(dir, sub), { recursive: true });
  return env;
}

// Deterministic openspec stub: `validate` always passes, so only the kit's own
// checks decide the gate-check result.
const OPENSPEC_STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'validate') { console.log('valid (stub)'); process.exit(0); }
if (args[0] === 'status') { console.log('{}'); process.exit(0); }
process.exit(0);
`;

function installOpenspecStub(dir) {
  const pkgDir = join(dir, 'node_modules', 'openspec');
  const binDir = join(dir, 'node_modules', '.bin');
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'openspec', version: '0.0.0', bin: { openspec: './cli.js' } }));
  writeFileSync(join(pkgDir, 'cli.js'), OPENSPEC_STUB, { mode: 0o755 });
  writeFileSync(join(binDir, 'openspec'), '#!/bin/sh\nexec node "$(dirname "$0")/../openspec/cli.js" "$@"\n', { mode: 0o755 });
}

// Byte sizes (proposal / design / tasks / delta specs) of four archived changes.
const R4 = { proposal: 19209, design: 31479, tasks: 102718, delta: 50347 }; // total 203753
const DEDUP_WINDOW = { proposal: 18394, design: 11814, tasks: 22799, delta: 136420 }; // total 189427
const PREGATE = { proposal: 14298, design: 31916, tasks: 40679, delta: 29502 }; // total 116395
const HEADING_CHECK = { proposal: 8802, design: 6701, tasks: 9590, delta: 7314 }; // total 32407

const TASKS_FINDING = (bytes) => `artifact budget: tasks.md is ${bytes} B (limit 60000 B) — split the change into slices, each within budget`;
const TOTAL_FINDING = (bytes) => `artifact budget: proposal+design+tasks+delta specs total ${bytes} B (limit 150000 B) — split the change into slices, each within budget`;

const PROPOSAL = '# Proposal\n\n## Why\n\nBecause.\n\n## Non-goals\n\n- none\n\n## Acceptance criteria\n\n- works\n';
const DESIGN = '# Design\n\nOne decision.\n';
const TASKS = '# Tasks\n- [ ] 1.1 Do the thing\n  Files: src/thing.js\n  Do: implement the thing exactly as specified\n  Done-when: thing test passes\n';
const DELTA = '## ADDED Requirements\n\n### Requirement: New Req\n\nThe system SHALL do the new thing.\n\n#### Scenario: New Req works\n- WHEN it runs\n- THEN it works\n';

// Pads with `x` on a line of its own up to the exact size in bytes.
function padTo(content, bytes) {
  const missing = bytes - Buffer.byteLength(content);
  assert.ok(missing >= 0, `fixture is already larger than ${bytes} B`);
  return content + 'x'.repeat(missing);
}

// A change that passes every other Tier 1 check, so the budget alone decides.
function makeChange(dir, name, sizes) {
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(join(changeDir, 'specs/auth'), { recursive: true });
  writeFileSync(join(changeDir, 'proposal.md'), padTo(PROPOSAL, sizes.proposal));
  writeFileSync(join(changeDir, 'design.md'), padTo(DESIGN, sizes.design));
  writeFileSync(join(changeDir, 'tasks.md'), padTo(TASKS, sizes.tasks));
  writeFileSync(join(changeDir, 'specs/auth/spec.md'), padTo(DELTA, sizes.delta));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/thing.js'), 'export const thing = 1;\n');
  return changeDir;
}

// A temp project without `init`; `orchestratorYaml` is written only when given.
function withProject(prefix, orchestratorYaml, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    installOpenspecStub(dir);
    if (orchestratorYaml) {
      mkdirSync(join(dir, '.agents'), { recursive: true });
      writeFileSync(join(dir, '.agents/orchestrator.yaml'), orchestratorYaml);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const budgetMode = (mode) => `pipeline:\n  artifact_budget: ${mode}\n`;

function gateCheckReview(dir, name, extraArgs = []) {
  const res = spawnSync(process.execPath, [CLI, 'gate-check', '--review', name, ...extraArgs], { cwd: dir, encoding: 'utf-8', env: isolatedEnv(dir) });
  return { status: res.status, stdout: String(res.stdout).replace(ANSI_RE, ''), stderr: String(res.stderr) };
}

test('parsePipelineConfig reads pipeline.artifact_budget like the other pipeline keys', () => {
  assert.equal(parsePipelineConfig(budgetMode('strict')).artifactBudget, 'strict');
  assert.equal(parsePipelineConfig(budgetMode('off')).artifactBudget, 'off');
  assert.equal(parsePipelineConfig(budgetMode('warn')).artifactBudget, 'warn');
  assert.equal(parsePipelineConfig(budgetMode('loud')).artifactBudget, 'warn');
  assert.equal(parsePipelineConfig('pipeline:\n  task_contract: strict\n').artifactBudget, 'warn');
  assert.equal(parsePipelineConfig('').artifactBudget, 'warn');

  // A commented-out key and the same key under another section are ignored.
  const config = parsePipelineConfig(
    [
      'pipeline:',
      '  # artifact_budget: off',
      '  artifact_budget: strict',
      'roles:',
      '  verifier:',
      '    artifact_budget: off',
      '',
    ].join('\n'),
  );
  assert.equal(config.artifactBudget, 'strict');
  assert.equal(parsePipelineConfig('pipeline:\n  # artifact_budget: strict\n  task_contract: warn\n').artifactBudget, 'warn');
  assert.equal(parsePipelineConfig('pipeline:\n  task_contract: warn\nroles:\n  artifact_budget: strict\n').artifactBudget, 'warn');

  // Legacy reader: no pipeline: block, the first occurrence anywhere wins.
  assert.equal(parsePipelineConfig('version: 1\nartifact_budget: off\n').artifactBudget, 'off');
});

test('gate-check --review warns about an R4-sized change and still exits 0 when the key is not set', () => {
  withProject('aok-budget-r4-', null, (dir) => {
    makeChange(dir, 'big-change', R4);
    const res = gateCheckReview(dir, 'big-change');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('tasks.md is 102718 B (limit 60000 B)'), res.stdout);
    assert.ok(res.stdout.includes('total 203753 B (limit 150000 B)'), res.stdout);
    assert.ok(res.stdout.includes(TASKS_FINDING(102718)), res.stdout);
    assert.ok(res.stdout.includes(TOTAL_FINDING(203753)), res.stdout);
    assert.ok(res.stdout.includes('split the change into slices'), res.stdout);
    assert.ok(res.stdout.includes('Tier 1 review passed'), res.stdout);
  });
});

test('gate-check --review reports only the total when tasks.md is within its own limit', () => {
  // A pipeline: block without the key is the same as no key at all.
  withProject('aok-budget-dedup-', 'pipeline:\n  task_contract: warn\n', (dir) => {
    makeChange(dir, 'wide-change', DEDUP_WINDOW);
    const res = gateCheckReview(dir, 'wide-change');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('total 189427 B (limit 150000 B)'), res.stdout);
    assert.ok(!res.stdout.includes('tasks.md is'), res.stdout);
    assert.equal(res.stdout.split('artifact budget').length - 1, 1, res.stdout);
  });
});

test('gate-check --review stays silent for changes within the budget', () => {
  withProject('aok-budget-quiet-', null, (dir) => {
    makeChange(dir, 'pregate-sized', PREGATE);
    makeChange(dir, 'small-change', HEADING_CHECK);
    for (const name of ['pregate-sized', 'small-change']) {
      const res = gateCheckReview(dir, name);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.ok(!res.stdout.includes('artifact budget'), res.stdout);
      assert.ok(res.stdout.includes('Tier 1 review passed'), res.stdout);
    }
  });
});

test('artifact_budget: strict turns the findings into errors (exit 1) and leaves a change within budget alone', () => {
  withProject('aok-budget-strict-', budgetMode('strict'), (dir) => {
    makeChange(dir, 'big-change', R4);
    makeChange(dir, 'pregate-sized', PREGATE);

    const text = gateCheckReview(dir, 'big-change');
    assert.equal(text.status, 1, text.stdout + text.stderr);
    assert.ok(text.stdout.includes('Tier 1 review failed — 2 error(s)'), text.stdout);
    // Each finding is printed once: as an error, not again as a warning.
    assert.equal(text.stdout.split('artifact budget').length - 1, 2, text.stdout);

    const json = gateCheckReview(dir, 'big-change', ['--json']);
    assert.equal(json.status, 1, json.stdout + json.stderr);
    const report = JSON.parse(json.stdout);
    assert.deepEqual(report, { pass: false, errors: [TASKS_FINDING(102718), TOTAL_FINDING(203753)] });

    const within = gateCheckReview(dir, 'pregate-sized');
    assert.equal(within.status, 0, within.stdout + within.stderr);
    assert.ok(!within.stdout.includes('artifact budget'), within.stdout);
  });
});

test('artifact_budget: off does not measure: an R4-sized change passes without a message', () => {
  withProject('aok-budget-off-', budgetMode('off'), (dir) => {
    makeChange(dir, 'big-change', R4);
    const res = gateCheckReview(dir, 'big-change');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(!res.stdout.includes('artifact budget'), res.stdout);
    assert.ok(res.stdout.includes('Tier 1 review passed'), res.stdout);
  });
});

test('artifactBudgetFindings compares strictly: the limit itself is within budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-budget-limits-'));
  try {
    // tasks.md alone: the total stays far below its limit.
    const atTasksLimit = makeChange(dir, 'tasks-at-limit', { proposal: 1000, design: 1000, tasks: 60000, delta: 1000 });
    assert.deepEqual(artifactBudgetFindings(atTasksLimit), []);
    const overTasksLimit = makeChange(dir, 'tasks-over-limit', { proposal: 1000, design: 1000, tasks: 60001, delta: 1000 });
    assert.deepEqual(artifactBudgetFindings(overTasksLimit), [TASKS_FINDING(60001)]);

    // The total alone: tasks.md sits exactly on its own limit.
    const atTotalLimit = makeChange(dir, 'total-at-limit', { proposal: 30000, design: 30000, tasks: 60000, delta: 30000 });
    assert.deepEqual(artifactBudgetFindings(atTotalLimit), []);
    const overTotalLimit = makeChange(dir, 'total-over-limit', { proposal: 30000, design: 30000, tasks: 60000, delta: 30001 });
    assert.deepEqual(artifactBudgetFindings(overTotalLimit), [TOTAL_FINDING(150001)]);

    // A missing file counts as 0 bytes.
    const tasksOnly = join(dir, 'openspec/changes/tasks-only');
    mkdirSync(tasksOnly, { recursive: true });
    assert.deepEqual(artifactBudgetFindings(tasksOnly), []);
    writeFileSync(join(tasksOnly, 'tasks.md'), padTo(TASKS, 60001));
    assert.deepEqual(artifactBudgetFindings(tasksOnly), [TASKS_FINDING(60001)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review.md and apply-notes.md are not part of the budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-budget-other-files-'));
  try {
    // Exactly on both limits: one more counted byte would produce a finding.
    const changeDir = makeChange(dir, 'reviewed-change', { proposal: 30000, design: 30000, tasks: 60000, delta: 30000 });
    writeFileSync(join(changeDir, 'review.md'), padTo('# Spec Review\n\n**Verdict:** APPROVE\n', 200000));
    writeFileSync(join(changeDir, 'apply-notes.md'), padTo('# Apply notes\n', 200000));
    assert.deepEqual(artifactBudgetFindings(changeDir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
