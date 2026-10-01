import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { archiveCommandLine, archiveReadinessBlockers, findArchivedMarker, isGreenApplyExit, parsePipelineConfig } from '../bin/agent-orchestrator.js';

// archive-from-terminal: green-apply exit prints the archive command, `archive` gets
// Gate 0 and `--if-ready`, `pipeline.archive_after_merge` is read, /opsx:archive is a
// fallback, and CI archive is opt-in.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;
const ARCHIVE_LINE = (name) => `npx agent-orchestrator-kit archive ${name} --sync`;

function isolatedEnv(dir) {
  const env = {
    ...process.env,
    HOME: join(dir, '.aok-home'),
    XDG_CONFIG_HOME: join(dir, '.aok-xdg-config'),
    XDG_DATA_HOME: join(dir, '.aok-xdg-data'),
    AMP_DATA_DIR: join(dir, '.aok-amp'),
    AOK_AMP_BIN: join(dir, '.no-amp-bin'),
  };
  for (const key of ['AOK_MODEL', 'AOK_PLATFORM', 'CURSOR_AGENT', 'CURSOR_CONVERSATION_ID', 'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'AMP_CURRENT_THREAD', 'AMP_THREAD_ID']) delete env[key];
  for (const sub of ['.aok-home', '.aok-xdg-config', '.aok-xdg-data', '.aok-amp']) mkdirSync(join(dir, sub), { recursive: true });
  return env;
}

function cli(dir, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', env: isolatedEnv(dir) });
  return { status: res.status, stdout: res.stdout.replace(ANSI_RE, ''), stderr: res.stderr.replace(ANSI_RE, '') };
}

function runInit(dir, profile = 'generic', lang = 'en') {
  execSync(`node "${CLI}" init --profile ${profile} --name ArchiveFromTerminal --lang ${lang}`, { cwd: dir, stdio: 'pipe' });
}

// Deterministic openspec stub (same contract as test/smoke.test.js): `status --change <n> --json`
// reports changeRoot and the tasks.md path, `validate` always passes.
const OPENSPEC_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'status') {
  const name = args[args.indexOf('--change') + 1];
  const changesDir = path.join(process.cwd(), 'openspec', 'changes');
  const changeRoot = path.join(changesDir, name);
  if (!fs.existsSync(changeRoot)) { console.error('Change not found: ' + name); process.exit(1); }
  const tasksPath = path.join(changeRoot, 'tasks.md');
  console.log(JSON.stringify({ schemaName: 'spec-driven', changeRoot, planningHome: { changesDir }, artifactPaths: { tasks: { existingOutputPaths: fs.existsSync(tasksPath) ? [tasksPath] : [] } } }));
  process.exit(0);
}
if (args[0] === 'validate') { console.log('valid (stub)'); process.exit(0); }
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

function withProject(prefix, fn, { profile = 'generic', lang = 'en' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    runInit(dir, profile, lang);
    installOpenspecStub(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TASKS_DONE = '- [x] 1.1 Do the thing\n';
const TASKS_OPEN = '- [x] 1.1 Do the thing\n- [ ] 1.2 Still open\n';
const APPROVE = '# Spec Review\n\n**Verdict:** APPROVE\n';

// A change that every archive gate accepts (APPROVE, all tasks done, no delta specs).
// `tasks: null` / `review: null` leave the file out.
function makeChange(dir, name, { review = APPROVE, tasks = TASKS_DONE } = {}) {
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n');
  if (tasks !== null) writeFileSync(join(changeDir, 'tasks.md'), tasks);
  if (review !== null) writeFileSync(join(changeDir, 'review.md'), review);
  return changeDir;
}

// Flip a `pipeline:` flag (`  <key>: true|false`) in the project's .agents/orchestrator.yaml.
function setPipelineFlag(dir, key, value) {
  const orchPath = join(dir, '.agents/orchestrator.yaml');
  const orch = readFileSync(orchPath, 'utf-8');
  assert.match(orch, new RegExp(`^  ${key}: (true|false)$`, 'm'));
  writeFileSync(orchPath, orch.replace(new RegExp(`^  ${key}: (true|false)$`, 'm'), `  ${key}: ${value}`));
}

// Dated archive folders of one change name under openspec/changes/archive/.
function archiveEntries(dir, name) {
  const root = join(dir, 'openspec/changes/archive');
  return existsSync(root) ? readdirSync(root).filter((d) => d.endsWith(`-${name}`)) : [];
}

const AUTH_MAIN = '## Purpose\n\nAuth.\n\n## Requirements\n\n### Requirement: Old Req\n\nThe system SHALL use the original behavior.\n\n#### Scenario: original\n- WHEN it runs\n- THEN it is original\n';
const AUTH_ADDED = '## ADDED Requirements\n\n### Requirement: Fresh Req\n\nThe system SHALL be fresh.\n\n#### Scenario: fresh\n- WHEN created\n- THEN fresh\n';
const AUTH_GHOST = '## MODIFIED Requirements\n\n### Requirement: Ghost Req\n\nThe system SHALL exist.\n\n#### Scenario: ghost\n- WHEN it runs\n- THEN it fails\n';

// Delta spec for capability `auth` in the change plus a matching main spec.
function addDelta(dir, changeDir, delta) {
  mkdirSync(join(changeDir, 'specs/auth'), { recursive: true });
  writeFileSync(join(changeDir, 'specs/auth/spec.md'), delta);
  mkdirSync(join(dir, 'openspec/specs/auth'), { recursive: true });
  writeFileSync(join(dir, 'openspec/specs/auth/spec.md'), AUTH_MAIN);
}

// Persist a handoff for `name` through the CLI flags (no handoff.md needed).
// Defaults describe the green-apply case: Implementer, the archive line as Next command.
function persist(dir, name, { role = 'Implementer — all tasks done', next = ARCHIVE_LINE(name), blocked, metrics = false } = {}) {
  const args = ['handoff', name, '--closed-role', role, '--done', 'all tasks done; build and lint green', '--next-command', next, '--next-role', 'none'];
  if (blocked !== undefined) args.push('--blocked', blocked);
  if (!metrics) args.push('--no-metrics');
  return cli(dir, args);
}

// Change dir with only a tasks.md (`tasks: null` leaves it out).
function makeApplyChange(dir, name, tasks = TASKS_DONE) {
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(changeDir, { recursive: true });
  if (tasks !== null) writeFileSync(join(changeDir, 'tasks.md'), tasks);
  return changeDir;
}

const readKit = (rel) => readFileSync(join(KIT_ROOT, rel), 'utf-8');

test('config: parsePipelineConfig reads archive_after_merge with a true default', () => {
  assert.equal(parsePipelineConfig('pipeline:\n  archive_after_merge: false\n').archiveAfterMerge, false);
  assert.equal(parsePipelineConfig('pipeline:\n  archive_after_merge: true # keep\n').archiveAfterMerge, true);
  assert.equal(parsePipelineConfig('pipeline:\n  require_spec_review: true\n').archiveAfterMerge, true);
  assert.equal(parsePipelineConfig('pipeline:\n  archive_after_merge: maybe\n').archiveAfterMerge, true);
  assert.equal(parsePipelineConfig('').archiveAfterMerge, true);
});

test('config: a commented key and the same key under another section do not change archive_after_merge', () => {
  assert.equal(parsePipelineConfig('pipeline:\n  # archive_after_merge: false\n  archive_after_merge: true\n').archiveAfterMerge, true);
  assert.equal(parsePipelineConfig('pipeline:\n  # archive_after_merge: false\n  require_spec_review: true\n').archiveAfterMerge, true);
  assert.equal(parsePipelineConfig('pipeline:\n  require_spec_review: true\nverifier:\n  archive_after_merge: false\n').archiveAfterMerge, true);
});

test('config: a legacy file without a pipeline block still reads archive_after_merge', () => {
  assert.equal(parsePipelineConfig('version: 1\narchive_after_merge: false\n').archiveAfterMerge, false);
  assert.equal(parsePipelineConfig('version: 1\nroles: {}\n').archiveAfterMerge, true);
});

test('config: templates and profiles keep their archive_after_merge values and a policy comment', () => {
  const POLICY_COMMENT = '  # Policy: status prints it; "archive --if-ready" and the opt-in CI job honour it; a manual archive ignores it.';
  const expectations = [
    ['templates/orchestrator.yaml', true],
    ['profiles/generic/orchestrator.yaml', true],
    ['profiles/node/orchestrator.yaml', true],
    ['profiles/vue3/orchestrator.yaml', true],
    ['profiles/mvp/orchestrator.yaml', false],
  ];
  for (const [rel, expected] of expectations) {
    const text = readFileSync(join(KIT_ROOT, rel), 'utf-8');
    assert.equal(parsePipelineConfig(text).archiveAfterMerge, expected, `${rel}: archiveAfterMerge`);
    const lines = text.split('\n');
    const at = lines.findIndex((line) => /^  archive_after_merge: (true|false)$/.test(line));
    assert.ok(at > 0, `${rel}: has an archive_after_merge line`);
    assert.equal(lines[at - 1], POLICY_COMMENT, `${rel}: policy comment above archive_after_merge`);
  }
});

test('status: prints the archive_after_merge line only when orchestrator.yaml exists', () => {
  withProject('aok-afm-status-', (dir) => {
    const first = cli(dir, ['status']);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /archive_after_merge: true/);

    setPipelineFlag(dir, 'archive_after_merge', 'false');
    const second = cli(dir, ['status']);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /archive_after_merge: false/);

    rmSync(join(dir, '.agents/orchestrator.yaml'));
    const third = cli(dir, ['status']);
    assert.equal(third.status, 0, third.stderr);
    assert.ok(!third.stdout.includes('archive_after_merge'), third.stdout);
  });
});

test('status: archiveReadinessBlockers is the one definition status and archive --if-ready share', () => {
  withProject('aok-afm-ready-', (dir) => {
    const generic = parsePipelineConfig(readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8'));

    // A change folder with no file at all: both blockers, and `status` prints the same reasons.
    const emptyDir = join(dir, 'openspec/changes/empty');
    mkdirSync(emptyDir, { recursive: true });
    assert.deepEqual(archiveReadinessBlockers(emptyDir, generic), ['tasks incomplete', 'no review.md']);
    const emptyStatus = cli(dir, ['status']);
    assert.equal(emptyStatus.status, 0, emptyStatus.stderr);
    assert.ok(emptyStatus.stdout.includes('not ready to archive — tasks incomplete; no review.md'), emptyStatus.stdout);

    const openDir = makeChange(dir, 'open', { tasks: TASKS_OPEN, review: '# Review\n\n**Verdict:** REQUEST_CHANGES\n' });
    assert.deepEqual(archiveReadinessBlockers(openDir, generic), ['tasks incomplete', 'review verdict "REQUEST_CHANGES" (need APPROVE)']);

    // No orchestrator.yaml (config === null) still means: review required, design brief not.
    const readyDir = makeChange(dir, 'ready');
    assert.deepEqual(archiveReadinessBlockers(readyDir, generic), []);
    assert.deepEqual(archiveReadinessBlockers(readyDir, null), []);

    // A change without tasks.md is never ready, whatever the review setting says.
    const noTasksDir = makeChange(dir, 'no-tasks', { tasks: null });
    assert.deepEqual(archiveReadinessBlockers(noTasksDir, { ...generic, requireSpecReview: false }), ['tasks incomplete']);

    // The design brief gate, and its `Design: none` opt-out in proposal.md.
    const briefConfig = { ...generic, requireSpecReview: false, requireDesignBrief: true };
    assert.deepEqual(archiveReadinessBlockers(readyDir, briefConfig), ['no design-brief.md']);
    writeFileSync(join(readyDir, 'proposal.md'), '# Proposal\n\nDesign: none\n');
    assert.deepEqual(archiveReadinessBlockers(readyDir, briefConfig), []);
  });
});

test('gate0: archivedAt in the active metrics.json refuses and mutates nothing', () => {
  withProject('aok-gate0-metrics-', (dir) => {
    const changeDir = makeChange(dir, 'add-auth');
    addDelta(dir, changeDir, AUTH_ADDED);
    const metricsPath = join(changeDir, 'metrics.json');
    writeFileSync(metricsPath, JSON.stringify({ version: 2, change: 'add-auth', archivedAt: '2026-09-01T10:00:00.000Z', sessions: [], pending: null }));
    const mainSpecPath = join(dir, 'openspec/specs/auth/spec.md');
    const metricsBefore = readFileSync(metricsPath);
    const mainSpecBefore = readFileSync(mainSpecPath);

    const res = cli(dir, ['archive', 'add-auth', '--sync']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /already-archived gate failed/);
    assert.ok(res.stderr.includes('metrics.json archivedAt is set (2026-09-01T10:00:00.000Z)'), res.stderr);
    assert.ok(res.stderr.includes('clear "archivedAt"'), res.stderr);
    assert.ok(existsSync(changeDir), 'change folder stays');
    assert.ok(!existsSync(join(dir, 'openspec/changes/archive')), 'no archive folder created');
    assert.ok(readFileSync(metricsPath).equals(metricsBefore), 'metrics.json unchanged');
    assert.ok(readFileSync(mainSpecPath).equals(mainSpecBefore), 'main spec unchanged');
  });
});

test('gate0: a handoff Next command of none refuses (case and backticks ignored)', () => {
  for (const value of ['`none`', 'NONE', 'None']) {
    withProject('aok-gate0-handoff-', (dir) => {
      const changeDir = makeChange(dir, 'add-auth');
      writeFileSync(join(changeDir, 'handoff.md'), `# Session Handoff\n\n## Closed role\nArchiver\n\n## Next command\n${value}\n\n## Next role\nnone\n`);
      assert.equal(findArchivedMarker(changeDir), 'handoff.md Next command is none', value);

      const res = cli(dir, ['archive', 'add-auth']);
      assert.equal(res.status, 1, `${value}: ${res.stdout}${res.stderr}`);
      assert.match(res.stderr, /already-archived gate failed/);
      assert.ok(res.stderr.includes('handoff.md Next command is none'), res.stderr);
      assert.ok(res.stderr.includes('set a real "## Next command"'), res.stderr);
      assert.ok(existsSync(changeDir), `${value}: change folder stays`);
      assert.ok(!existsSync(join(dir, 'openspec/changes/archive')), `${value}: no archive folder created`);
    });
  }
});

test('gate0: reused names, absent or invalid metrics.json and empty markers never refuse', () => {
  const metricsWith = (archivedAt) => JSON.stringify({ version: 2, change: 'add-auth', archivedAt, sessions: [], pending: null });
  const variants = [
    [
      'an older archive folder with the same change name',
      (dir) => {
        const old = join(dir, 'openspec/changes/archive/2026-01-01-add-auth');
        mkdirSync(old, { recursive: true });
        writeFileSync(join(old, 'proposal.md'), '# Proposal\n');
      },
    ],
    ['invalid metrics.json', (dir, changeDir) => writeFileSync(join(changeDir, 'metrics.json'), '{not json')],
    ['archivedAt null', (dir, changeDir) => writeFileSync(join(changeDir, 'metrics.json'), metricsWith(null))],
    ['archivedAt empty string', (dir, changeDir) => writeFileSync(join(changeDir, 'metrics.json'), metricsWith(''))],
    [
      'Next command is the archive line',
      (dir, changeDir) =>
        writeFileSync(
          join(changeDir, 'handoff.md'),
          `# Session Handoff\n\n## Closed role\nImplementer\n\n## Next command\n\`${ARCHIVE_LINE('add-auth')}\`\n\n## Next role\nnone\n`,
        ),
    ],
  ];
  for (const [label, prepare] of variants) {
    withProject('aok-gate0-open-', (dir) => {
      const changeDir = makeChange(dir, 'add-auth');
      prepare(dir, changeDir);
      assert.equal(findArchivedMarker(changeDir), null, label);

      const res = cli(dir, ['archive', 'add-auth']);
      assert.equal(res.status, 0, `${label}: ${res.stdout}${res.stderr}`);
      assert.ok(!existsSync(changeDir), `${label}: change folder moved`);
      const fresh = archiveEntries(dir, 'add-auth').filter((d) => !d.startsWith('2026-01-01'));
      assert.equal(fresh.length, 1, `${label}: exactly one new archive folder`);
    });
  }
});

test('if-ready: skips with exit 0 and no mutation when archive_after_merge is false, a marker is set, or the change is not ready', () => {
  const cases = [
    ['archive_after_merge false', 'skip: archive_after_merge is false', (dir) => setPipelineFlag(dir, 'archive_after_merge', 'false')],
    [
      'archivedAt marker',
      'skip: already archived — metrics.json archivedAt is set',
      (dir, changeDir) =>
        writeFileSync(join(changeDir, 'metrics.json'), JSON.stringify({ version: 2, change: 'add-auth', archivedAt: '2026-09-01T10:00:00.000Z', sessions: [], pending: null })),
    ],
    ['no review.md', 'skip: not ready — no review.md', (dir, changeDir) => rmSync(join(changeDir, 'review.md'))],
    ['open tasks', 'skip: not ready — tasks incomplete', (dir, changeDir) => writeFileSync(join(changeDir, 'tasks.md'), TASKS_OPEN)],
    [
      'review not required but tasks.md missing',
      'skip: not ready — tasks incomplete',
      (dir, changeDir) => {
        setPipelineFlag(dir, 'require_spec_review', 'false');
        rmSync(join(changeDir, 'tasks.md'));
        rmSync(join(changeDir, 'review.md'));
      },
    ],
  ];
  for (const [label, expected, prepare] of cases) {
    withProject('aok-ifready-skip-', (dir) => {
      const changeDir = makeChange(dir, 'add-auth');
      addDelta(dir, changeDir, AUTH_ADDED);
      prepare(dir, changeDir);
      const metricsPath = join(changeDir, 'metrics.json');
      const mainSpecPath = join(dir, 'openspec/specs/auth/spec.md');
      const metricsBefore = existsSync(metricsPath) ? readFileSync(metricsPath) : null;
      const mainSpecBefore = readFileSync(mainSpecPath);

      const res = cli(dir, ['archive', 'add-auth', '--sync', '--if-ready']);
      assert.equal(res.status, 0, `${label}: ${res.stdout}${res.stderr}`);
      assert.ok(res.stdout.includes(expected), `${label}: ${res.stdout}`);
      assert.equal((res.stdout.match(/^skip: /gm) || []).length, 1, `${label}: exactly one skip line\n${res.stdout}`);
      assert.ok(existsSync(changeDir), `${label}: change folder stays`);
      assert.ok(!existsSync(join(dir, 'openspec/changes/archive')), `${label}: no archive folder created`);
      assert.ok(readFileSync(mainSpecPath).equals(mainSpecBefore), `${label}: main spec unchanged`);
      if (metricsBefore) assert.ok(readFileSync(metricsPath).equals(metricsBefore), `${label}: metrics.json unchanged`);
      else assert.ok(!existsSync(metricsPath), `${label}: metrics.json not created`);
    });
  }
});

test('if-ready: archives a ready change like a normal archive', () => {
  withProject('aok-ifready-run-', (dir) => {
    const changeDir = makeChange(dir, 'add-auth');
    addDelta(dir, changeDir, AUTH_ADDED);

    const res = cli(dir, ['archive', 'add-auth', '--sync', '--if-ready']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(!res.stdout.includes('skip: '), res.stdout);
    assert.ok(res.stdout.includes('archived add-auth'), res.stdout);
    assert.ok(!existsSync(changeDir), 'change folder moved');
    assert.equal(archiveEntries(dir, 'add-auth').length, 1);
    assert.ok(readFileSync(join(dir, 'openspec/specs/auth/spec.md'), 'utf-8').includes('Fresh Req'), 'delta merged into the main spec');
  });
});

test('if-ready: without the flag archive_after_merge is not consulted', () => {
  withProject('aok-ifready-manual-', (dir) => {
    setPipelineFlag(dir, 'archive_after_merge', 'false');
    const changeDir = makeChange(dir, 'add-auth');

    const res = cli(dir, ['archive', 'add-auth']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(!existsSync(changeDir), 'change folder moved');
    assert.equal(archiveEntries(dir, 'add-auth').length, 1);
  });
});

test('if-ready: real failures stay loud (sync conflict, existing target)', () => {
  withProject('aok-ifready-conflict-', (dir) => {
    const changeDir = makeChange(dir, 'add-auth');
    addDelta(dir, changeDir, AUTH_GHOST);

    const res = cli(dir, ['archive', 'add-auth', '--sync', '--if-ready']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stderr.includes('sync conflict: auth: MODIFIED requirement not found in main spec: "Ghost Req"'), res.stderr);
    assert.ok(!res.stdout.includes('skip: '), res.stdout);
    assert.ok(existsSync(changeDir), 'change folder stays');
  });

  withProject('aok-ifready-target-', (dir) => {
    const changeDir = makeChange(dir, 'add-auth');
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(dir, 'openspec/changes/archive', `${today}-add-auth`), { recursive: true });

    const res = cli(dir, ['archive', 'add-auth', '--sync', '--if-ready']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stderr.includes('archive gate failed — target already exists'), res.stderr);
    assert.ok(!res.stdout.includes('skip: '), res.stdout);
    assert.ok(existsSync(changeDir), 'change folder stays');
  });
});

test('terminal: archive without client env exits 0, sets archivedAt and records Archiver platform null', () => {
  withProject('aok-terminal-', (dir) => {
    const changeDir = makeChange(dir, 'add-auth');
    writeFileSync(
      join(changeDir, 'metrics.json'),
      JSON.stringify({
        version: 1,
        change: 'add-auth',
        sessions: [{ startedAt: '2026-08-29T06:00:00.000Z', endedAt: '2026-08-29T07:00:00.000Z', durationMs: 3600000, role: 'Implementer', phase: 'apply', runtime: 'local' }],
        pending: null,
      }),
    );

    // `cli` strips CURSOR_*, CLAUDE*, AMP_* and AOK_PLATFORM, so no client is detected.
    const res = cli(dir, ['archive', 'add-auth', '--sync']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stderr.includes('metrics: '), res.stderr);

    const [folder] = archiveEntries(dir, 'add-auth');
    assert.ok(folder, 'archive folder exists');
    const metrics = JSON.parse(readFileSync(join(dir, 'openspec/changes/archive', folder, 'metrics.json'), 'utf-8'));
    assert.ok(typeof metrics.archivedAt === 'string' && metrics.archivedAt.length > 0, 'archivedAt set');
    assert.equal(metrics.pending, null);
    const archiver = metrics.sessions.find((s) => s.role === 'Archiver');
    assert.ok(archiver, 'Archiver session recorded');
    assert.equal(archiver.platform, null);
    assert.equal(archiver.spendSource, 'unreported');
    assert.equal(archiver.inputTokens, null);
    const implementer = metrics.sessions.find((s) => s.role === 'Implementer');
    assert.ok(implementer, 'Implementer session kept');
    assert.equal(implementer.durationMs, 3600000);
  });
});

test('green-apply: Implementer with all tasks done and no blockers prints exactly the archive line', () => {
  withProject('aok-green-line-', (dir) => {
    makeApplyChange(dir, 'add-thing');
    const res = persist(dir, 'add-thing', { metrics: true });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout, `${ARCHIVE_LINE('add-thing')}\n`);
    assert.ok(res.stderr.includes('Run the line below in a terminal after the PR is merged'), res.stderr);
    assert.ok(!res.stderr.includes('Copy the prompt below'), res.stderr);
    assert.ok(!res.stderr.includes('green apply — Next command replaced'), res.stderr);

    const handoff = readFileSync(join(dir, 'openspec/changes/add-thing/handoff.md'), 'utf-8');
    assert.ok(handoff.includes(`## Next command\n\`${ARCHIVE_LINE('add-thing')}\``), handoff);
    assert.ok(handoff.includes('## Next role\nnone\n'), handoff);
    assert.ok(handoff.includes(`## Prompt\n\n\`\`\`text\n${ARCHIVE_LINE('add-thing')}\n\`\`\``), handoff);

    const metrics = JSON.parse(readFileSync(join(dir, 'openspec/changes/add-thing/metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions[metrics.sessions.length - 1].role, 'Implementer');
  });
});

test('green-apply: other roles, open tasks, blockers and missing tasks keep the normal prompt', () => {
  withProject('aok-green-normal-', (dir) => {
    const changeDir = makeApplyChange(dir, 'add-thing');
    const tasksPath = join(changeDir, 'tasks.md');

    // Another role, every task done.
    const architect = persist(dir, 'add-thing', { role: 'Architect', next: '/opsx:review add-thing' });
    assert.equal(architect.status, 0, architect.stdout + architect.stderr);
    assert.ok(architect.stdout.startsWith('/opsx:review add-thing\n'), architect.stdout);
    assert.ok(architect.stdout.includes('HARD STOP'), architect.stdout);

    // Implementer with an open task.
    writeFileSync(tasksPath, TASKS_OPEN);
    const open = persist(dir, 'add-thing', { next: '/opsx:apply add-thing' });
    assert.equal(open.status, 0, open.stdout + open.stderr);
    assert.ok(open.stdout.startsWith('/opsx:apply add-thing\n'), open.stdout);
    assert.ok(open.stdout.includes('HARD STOP'), open.stdout);
    assert.ok(!open.stderr.includes('Run the line below'), open.stderr);

    // Every task done, but something is blocked.
    writeFileSync(tasksPath, TASKS_DONE);
    const blockedRun = persist(dir, 'add-thing', { next: '/opsx:apply add-thing', blocked: 'waiting for CI on the PR' });
    assert.equal(blockedRun.status, 0, blockedRun.stdout + blockedRun.stderr);
    assert.ok(blockedRun.stdout.startsWith('/opsx:apply add-thing\n'), blockedRun.stdout);
    assert.ok(blockedRun.stdout.includes('HARD STOP'), blockedRun.stdout);

    // tasks.md without checkboxes. `blocked: 'none'` is explicit: persist keeps the previous `## Blocked`,
    // so without it this sub-case would stay non-green only because of the blocker above.
    writeFileSync(tasksPath, '# Tasks\n\nno checkboxes\n');
    const noBoxes = persist(dir, 'add-thing', { next: '/opsx:apply add-thing', blocked: 'none' });
    assert.equal(noBoxes.status, 0, noBoxes.stdout + noBoxes.stderr);
    assert.ok(noBoxes.stdout.startsWith('/opsx:apply add-thing\n'), noBoxes.stdout);
    assert.ok(noBoxes.stdout.includes('HARD STOP'), noBoxes.stdout);

    // No tasks.md at all (same explicit `blocked: 'none'`).
    rmSync(tasksPath);
    const noTasks = persist(dir, 'add-thing', { next: '/opsx:apply add-thing', blocked: 'none' });
    assert.equal(noTasks.status, 0, noTasks.stdout + noTasks.stderr);
    assert.ok(noTasks.stdout.startsWith('/opsx:apply add-thing\n'), noTasks.stdout);
    assert.ok(noTasks.stdout.includes('HARD STOP'), noTasks.stdout);
  });
});

test('green-apply: an agent-supplied Next command is replaced and the CLI says so on stderr', () => {
  withProject('aok-green-replaced-', (dir) => {
    makeApplyChange(dir, 'add-thing');
    const res = persist(dir, 'add-thing', { next: '/opsx:archive add-thing' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout, `${ARCHIVE_LINE('add-thing')}\n`);
    assert.ok(res.stderr.includes('green apply — Next command replaced with the archive command (was: /opsx:archive add-thing)'), res.stderr);

    const handoffPath = join(dir, 'openspec/changes/add-thing/handoff.md');
    const handoff = readFileSync(handoffPath, 'utf-8');
    assert.ok(handoff.includes(`## Next command\n\`${ARCHIVE_LINE('add-thing')}\``), handoff);

    // A Next role the agent named is replaced too (persist() above always passes `none`).
    const withRole = cli(dir, [
      'handoff', 'add-thing',
      '--closed-role', 'Implementer — all tasks done',
      '--done', 'all tasks done; build and lint green',
      '--next-command', '/opsx:archive add-thing',
      '--next-role', 'Archiver',
      '--no-metrics',
    ]);
    assert.equal(withRole.status, 0, withRole.stdout + withRole.stderr);
    assert.equal(withRole.stdout, `${ARCHIVE_LINE('add-thing')}\n`);
    assert.ok(readFileSync(handoffPath, 'utf-8').includes('## Next role\nnone\n'), 'Next role is none after a green apply');
  });
});

test('green-apply: --no-metrics regeneration is byte-identical', () => {
  withProject('aok-green-regen-', (dir) => {
    makeApplyChange(dir, 'add-thing');
    const handoffPath = join(dir, 'openspec/changes/add-thing/handoff.md');
    const first = persist(dir, 'add-thing');
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const handoffBefore = readFileSync(handoffPath, 'utf-8');

    const second = cli(dir, ['handoff', 'add-thing', '--no-metrics']);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.equal(readFileSync(handoffPath, 'utf-8'), handoffBefore);
  });
});

test('green-apply: a uk project and archive_after_merge false still get the same single line', () => {
  withProject(
    'aok-green-uk-',
    (dir) => {
      makeApplyChange(dir, 'add-thing');
      const res = persist(dir, 'add-thing');
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.equal(res.stdout, `${ARCHIVE_LINE('add-thing')}\n`);
    },
    { lang: 'uk' },
  );

  withProject('aok-green-optout-', (dir) => {
    setPipelineFlag(dir, 'archive_after_merge', 'false');
    makeApplyChange(dir, 'add-thing');
    const res = persist(dir, 'add-thing');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout, `${ARCHIVE_LINE('add-thing')}\n`);
  });
});

test('green-apply: isGreenApplyExit and archiveCommandLine follow the trigger table', () => {
  assert.equal(archiveCommandLine('add-thing'), ARCHIVE_LINE('add-thing'));
  const done = { total: 2, done: 2 };

  assert.equal(isGreenApplyExit({ closedRole: 'Implementer', blocked: 'none' }, done), true);
  assert.equal(isGreenApplyExit({ closedRole: 'implementer — apply complete', blocked: 'None.' }, done), true);
  for (const blocked of ['', '-', '- none', '—', 'n/a', 'N/A', 'немає', 'Немає.']) {
    assert.equal(isGreenApplyExit({ closedRole: 'Implementer', blocked }, done), true, `blocked ${JSON.stringify(blocked)} counts as empty`);
  }

  for (const blocked of ['waiting for CI', 'none yet', 'none\n- other']) {
    assert.equal(isGreenApplyExit({ closedRole: 'Implementer', blocked }, done), false, `blocked ${JSON.stringify(blocked)} is a real blocker`);
  }
  for (const closedRole of ['Architect', 'Spec Reviewer']) {
    assert.equal(isGreenApplyExit({ closedRole, blocked: 'none' }, done), false, closedRole);
  }
  for (const progress of [{ total: 2, done: 1 }, { total: 0, done: 0 }, null]) {
    assert.equal(isGreenApplyExit({ closedRole: 'Implementer', blocked: 'none' }, progress), false, JSON.stringify(progress));
  }
});

test('green-apply: handoff --restore is unchanged and prints no archive hint', () => {
  withProject('aok-green-restore-', (dir) => {
    makeApplyChange(dir, 'add-thing');
    const persisted = persist(dir, 'add-thing');
    assert.equal(persisted.status, 0, persisted.stdout + persisted.stderr);

    const restore = cli(dir, ['handoff', 'add-thing', '--restore', '--no-metrics']);
    assert.equal(restore.status, 0, restore.stdout + restore.stderr);
    assert.ok(restore.stdout.includes(`next_command: ${ARCHIVE_LINE('add-thing')}`), restore.stdout);
    assert.ok(restore.stdout.includes('next_role: none'), restore.stdout);
    const everything = restore.stdout + restore.stderr;
    assert.ok(!everything.includes('Run the line below'), everything);
    assert.ok(!everything.includes('green apply'), everything);
  });
});

test('templates: opsx-archive is a thin fallback within 1024 bytes and never names spec-archiver', () => {
  const rel = 'templates/.agents/commands/opsx-archive.md';
  assert.ok(statSync(join(KIT_ROOT, rel)).size <= 1024, `${rel} is at most 1024 bytes`);
  const text = readKit(rel);
  assert.ok(!text.includes('spec-archiver'), 'no spec-archiver mention');
  assert.ok(!/^## /m.test(text), 'no "## " heading lines');
  for (const phrase of [
    'Fallback',
    'Normal path: run `npx agent-orchestrator-kit archive <name> --sync` in a terminal',
    'npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]',
    'On exit ≠ 0, print the refusal from stderr and STOP',
    'no manual merge/move',
  ]) {
    assert.ok(text.includes(phrase), `opsx-archive.md contains: ${phrase}`);
  }
});

test('templates: apply command and skill name the archive line and Next role none', () => {
  const archiveLiteral = '`npx agent-orchestrator-kit archive <name> --sync`';
  const occurrences = (text, needle) => text.split(needle).length - 1;

  const applyCommand = readKit('templates/.agents/commands/opsx-apply.md');
  assert.ok(
    applyCommand.includes(
      '**Green apply** (every task `[x]`, build/lint green): write `## Blocked` as `none`, `## Next command` as the literal line `npx agent-orchestrator-kit archive <name> --sync` and `## Next role` as `none`',
    ),
    'green-apply sentence',
  );
  assert.ok(applyCommand.includes('Never start archive in this apply chat.'));
  assert.equal(occurrences(applyCommand, archiveLiteral), 3);
  assert.ok(!applyCommand.includes('suggest archive'));
  assert.ok(!applyCommand.includes('archive this change with `/opsx:archive`'));

  const applySkill = readKit('templates/.agents/skills/openspec-apply-change/SKILL.md');
  assert.equal(occurrences(applySkill, archiveLiteral), 2);
  assert.ok(applySkill.includes('`## Next command` with `## Blocked` `none` and `## Next role` `none`'));
  assert.ok(!applySkill.includes('suggest archive'));
});

test('templates: rules and AGENTS.md keep their budgets and describe terminal-first archive', () => {
  const sessionHandoff = readKit('templates/.agents/rules/session-handoff.mdc');
  assert.ok(sessionHandoff.includes('First line `/opsx:…` (green apply: the CLI prints one archive line for a terminal).'));
  assert.ok(sessionHandoff.includes('archive <name>` (terminal/CI; `/opsx:archive` = fallback) writes the final'));

  const orchestration = readKit('templates/.agents/rules/agent-orchestration.mdc');
  assert.ok(
    orchestration.includes(
      '| `/opsx:archive` (fallback) | — terminal/CI: `npx agent-orchestrator-kit archive <name>` | CLI; subagent forbidden (`spec-archiver` = CLI-failure fallback only) |',
    ),
    'routing-table row',
  );
  assert.ok(orchestration.includes('(green apply: the single archive line for a terminal)'));

  assert.equal(readKit('.agents/rules/session-handoff.mdc'), sessionHandoff, 'the kit root copy equals the template');

  const rulesDir = join(KIT_ROOT, 'templates/.agents/rules');
  let alwaysApplyChars = 0;
  for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.mdc'))) {
    const text = readFileSync(join(rulesDir, file), 'utf-8');
    if (/^alwaysApply:\s*true\s*$/m.test(text)) alwaysApplyChars += text.length;
  }
  assert.ok(alwaysApplyChars < 12000, `always-apply rules total ${alwaysApplyChars} chars (budget 12000)`);

  const agents = readKit('templates/AGENTS.md');
  assert.ok(agents.length < 4000, `AGENTS.md is ${agents.length} chars (budget 4000)`);
  for (const phrase of [
    '**archive is a CLI** run from a terminal or opted-in CI (`npx agent-orchestrator-kit archive <name> --sync`; `/opsx:archive` is the fallback), no subagent.',
    '| Archive | terminal/CI: `npx agent-orchestrator-kit archive <name> --sync` (fallback `/opsx:archive`) |',
    'after a green apply the CLI prints one archive line for a terminal instead',
    '- Archive after merge — from a terminal or CI (`/opsx:archive` is the fallback). Build/lint before PR.',
  ]) {
    assert.ok(agents.includes(phrase), `AGENTS.md contains: ${phrase}`);
  }

  assert.ok(
    readKit('templates/CLAUDE.md').includes(
      'archive runs from a terminal or opted-in CI as `npx agent-orchestrator-kit archive <name> --sync` (`/opsx:archive` is the fallback)',
    ),
  );
});

test('templates: skills and subagents tell the same terminal-first story', () => {
  const skill = readKit('templates/.agents/skills/agent-orchestration/SKILL.md');
  const start = skill.indexOf('### verify → archive');
  const end = skill.indexOf('## Session Rules');
  assert.ok(start >= 0 && end > start, 'verify → archive section is present');
  const section = skill.slice(start, end);
  assert.ok(section.includes('run it from a terminal — no chat needed:\n```\nnpx agent-orchestrator-kit archive <name> --sync\n```'), section);
  assert.ok(section.includes('Gate 0'));
  assert.ok(section.includes('--if-ready'));
  assert.ok(section.includes('`/opsx:archive <name>` in chat is only the fallback'));

  assert.ok(skill.includes('| `/opsx:archive` (fallback) | — terminal/CI:'));
  assert.ok(skill.includes('after a green apply the CLI prints only'));
  assert.ok(skill.includes('after a green apply: the single archive line instead'));
  assert.ok(/^- \[ \] `npx agent-orchestrator-kit archive <name> --sync` run after merge/m.test(skill), 'checklist item');
  assert.ok(!/^- \[ \] `\/opsx:archive` run after merge/m.test(skill), 'old checklist item is gone');

  const guide = readKit('templates/.agents/subagents/openspec-guide.md');
  assert.ok(guide.includes('suggest the terminal command `npx agent-orchestrator-kit archive <name> --sync` after the PR is merged'));
  assert.ok(guide.includes('AOK_ARCHIVE_ON_MERGE=true'));
  assert.ok(!guide.includes('CI auto-archives after merge if'));

  assert.ok(readKit('templates/.agents/subagents/session-handoff.md').includes('or the single `npx agent-orchestrator-kit archive <name> --sync` line after a green apply'));

  const archiveSkill = readKit('templates/.agents/skills/openspec-archive-change/SKILL.md');
  assert.ok(archiveSkill.includes('The normal path is a terminal after the PR is merged'));
  assert.ok(archiveSkill.includes('Gate 0: `archivedAt` in `metrics.json` or `Next command: none`'));
  assert.ok(archiveSkill.includes('npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]'));
});

test('ci: GitHub workflow keeps the verify job and adds an opt-in archive job', async () => {
  const { parse } = await import('yaml');
  const rel = 'templates/.github/workflows/agent-verify.yml';
  const text = readKit(rel);
  const doc = parse(text);

  const jobNames = Object.keys(doc.jobs);
  assert.ok(jobNames.includes('verify'), jobNames.join(', '));
  assert.ok(jobNames.includes('archive'), jobNames.join(', '));
  const verifySteps = doc.jobs.verify.steps.map((step) => step.name);
  for (const stepName of ['Detect package manager', 'OpenSpec validate', 'Gate check (review gate)', 'Lint (npm)', 'Build (npm)', 'Test (npm)', 'Test (pnpm)']) {
    assert.ok(verifySteps.includes(stepName), `verify job keeps the step "${stepName}"`);
  }
  assert.ok(doc.on.push.branches.includes('main'));

  const archive = doc.jobs.archive;
  assert.equal(archive.needs, 'verify');
  for (const part of ["github.event_name == 'push'", 'github.ref_name == github.event.repository.default_branch', "vars.AOK_ARCHIVE_ON_MERGE == 'true'"]) {
    assert.ok(archive.if.includes(part), `archive.if contains: ${part}`);
  }
  assert.deepEqual(archive.concurrency, { group: 'agent-archive', 'cancel-in-progress': false });
  assert.equal(archive.permissions.contents, 'write');

  const [checkout] = archive.steps;
  assert.equal(checkout.uses, 'actions/checkout@v5');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(checkout.with.token, '${{ secrets.AOK_ARCHIVE_TOKEN || github.token }}');

  const runs = archive.steps.map((step) => step.run || '').join('\n');
  for (const command of [
    'npx agent-orchestrator-kit archive "$name" --sync --if-ready',
    'git add -A openspec',
    'git diff --cached --quiet',
    'git commit -m "chore(openspec): archive merged change [skip ci]"',
    'git push origin HEAD:"$GITHUB_REF_NAME"',
  ]) {
    assert.ok(runs.includes(command), `archive job runs: ${command}`);
  }

  for (const phrase of ['AOK_ARCHIVE_TOKEN', '[skip ci]', 'a terminal stays the default']) {
    assert.ok(text.includes(phrase), `${rel} mentions: ${phrase}`);
  }
});

test('ci: GitLab fragment keeps the base and agent-verify jobs and adds an opt-in agent-archive job', async () => {
  const { parse } = await import('yaml');
  const rel = 'templates/.gitlab/agent-verify.yml';
  const text = readKit(rel);
  const doc = parse(text);
  const scriptText = (job) => [].concat(job.script || []).join('\n');

  const keys = Object.keys(doc);
  for (const key of ['.agent-verify-base', 'agent-verify', 'agent-archive']) {
    assert.ok(keys.includes(key), `${rel} defines ${key}`);
  }
  const base = doc['.agent-verify-base'];
  assert.equal(base.image, 'node:20');
  assert.ok(scriptText(base).includes('npx openspec validate --all --strict'));
  assert.ok(scriptText(base).includes('gate-check'));

  const verify = doc['agent-verify'];
  assert.equal(verify.extends, '.agent-verify-base');
  assert.ok(
    verify.rules.some((rule) => Object.keys(rule).length === 1 && rule.if === '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'),
    'agent-verify still runs on the default branch',
  );

  const archive = doc['agent-archive'];
  assert.equal(archive.extends, '.agent-verify-base');
  assert.deepEqual(archive.needs, ['agent-verify']);
  assert.deepEqual(archive.rules, [{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $AOK_ARCHIVE_ON_MERGE == "true"' }]);
  const script = scriptText(archive);
  for (const command of [
    'npx agent-orchestrator-kit archive "$name" --sync --if-ready',
    'git commit -m "chore(openspec): archive merged change [skip ci]"',
    'git push "https://oauth2:${AOK_ARCHIVE_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" "HEAD:${CI_DEFAULT_BRANCH}"',
  ]) {
    assert.ok(script.includes(command), `agent-archive runs: ${command}`);
  }
  assert.ok(text.includes('a terminal stays the default'));
});
