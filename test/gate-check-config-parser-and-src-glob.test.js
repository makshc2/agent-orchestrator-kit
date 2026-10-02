import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parsePipelineConfig, splitSrcGlob } from '../bin/agent-orchestrator.js';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;

function runInit(dir, args = '') {
  execSync(`node "${CLI}" init ${args}`, { cwd: dir, stdio: 'pipe' });
}

function initGit(dir) {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync('git add -A && git commit -q -m "initial"', { cwd: dir });
}

function cliSpawn(dir, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8' });
  return { ...res, stdout: String(res.stdout).replace(ANSI_RE, ''), stderr: String(res.stderr).replace(ANSI_RE, '') };
}

function writeOrchestrator(dir, content) {
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(join(dir, '.agents/orchestrator.yaml'), content);
}

function writeMinimalChange(dir, name) {
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
  return changeDir;
}

// A project with a src/ change committed on top of the initial commit and one
// active change without review.md — the state in which the review gate must
// fire whenever require_spec_review resolves to true.
function projectWithSrcChange(dir, orchestratorYaml) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-parser', scripts: {} }, null, 2));
  runInit(dir, '--profile generic --name GateParser --lang en');
  writeOrchestrator(dir, orchestratorYaml);
  initGit(dir);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
  writeMinimalChange(dir, 'add-thing');
  execSync('git add -A && git commit -q -m "add src"', { cwd: dir });
}

// ── parsePipelineConfig: section-aware reader ───────────────────────────

test('parsePipelineConfig ignores a commented-out key placed before the real one', () => {
  const config = parsePipelineConfig(
    'pipeline:\n  # require_spec_review: false\n  require_spec_review: true\n  task_contract: warn\n',
  );
  assert.equal(config.requireSpecReview, true);
});

test('parsePipelineConfig ignores pipeline keys that live under another section', () => {
  const config = parsePipelineConfig(
    'pipeline:\n  require_spec_review: true\n  max_active_changes: 1\nverifier:\n  require_spec_review: false\n  max_active_changes: 9\n',
  );
  assert.equal(config.requireSpecReview, true);
  assert.equal(config.maxActiveChanges, 1);
});

test('parsePipelineConfig reads only direct children of pipeline: and strips comment tails', () => {
  const config = parsePipelineConfig(
    [
      'pipeline:',
      '  require_spec_review: true # keep the gate',
      '  require_design_brief: true',
      '  max_active_changes: 2 # two',
      '  task_contract: strict',
      '  nested:',
      '    require_spec_review: false',
      '    task_contract: off',
      '  src_glob: "bin/, scripts/ templates/" # three roots',
      'roles:',
      '  verifier:',
      '    task_contract: off',
      '',
    ].join('\n'),
  );
  assert.deepEqual(config, {
    requireSpecReview: true,
    requireDesignBrief: true,
    maxActiveChanges: 2,
    taskContract: 'strict',
    srcGlob: 'bin/, scripts/ templates/',
    archiveAfterMerge: true,
    artifactBudget: 'warn',
  });
});

test('parsePipelineConfig does not close the pipeline: block on a column-0 comment line', () => {
  const config = parsePipelineConfig(
    [
      'pipeline:',
      '  require_spec_review: true',
      '# require_spec_review: false',
      '#  src_glob: "app/"',
      '  src_glob: "lib/"',
      '',
      '  max_active_changes: 1',
      'roles: {}',
      '',
    ].join('\n'),
  );
  assert.deepEqual(config, {
    requireSpecReview: true,
    requireDesignBrief: false,
    maxActiveChanges: 1,
    taskContract: 'warn',
    srcGlob: 'lib/',
    archiveAfterMerge: true,
    artifactBudget: 'warn',
  });
});

test('parsePipelineConfig falls back to the legacy whole-file regex when no pipeline: block exists', () => {
  const legacy = parsePipelineConfig(
    'version: 1\nrequire_spec_review: false\nmax_active_changes: 3\ntask_contract: off\nsrc_glob: lib/ app/ # legacy list\n',
  );
  assert.deepEqual(legacy, {
    requireSpecReview: false,
    requireDesignBrief: false,
    maxActiveChanges: 3,
    taskContract: 'off',
    srcGlob: 'lib/ app/',
    archiveAfterMerge: true,
    artifactBudget: 'warn',
  });
  const defaults = parsePipelineConfig('version: 1\nroles: {}\n');
  assert.deepEqual(defaults, {
    requireSpecReview: true,
    requireDesignBrief: false,
    maxActiveChanges: null,
    taskContract: 'warn',
    srcGlob: null,
    archiveAfterMerge: true,
    artifactBudget: 'warn',
  });
});

test('parsePipelineConfig reads the shipped template and every profile the same way as before', () => {
  const template = parsePipelineConfig(readFileSync(join(KIT_ROOT, 'templates/orchestrator.yaml'), 'utf-8'));
  assert.deepEqual(template, {
    requireSpecReview: true,
    requireDesignBrief: false,
    maxActiveChanges: 1,
    taskContract: 'warn',
    srcGlob: 'src/',
    archiveAfterMerge: true,
    artifactBudget: 'warn',
  });
  const mvp = parsePipelineConfig(readFileSync(join(KIT_ROOT, 'profiles/mvp/orchestrator.yaml'), 'utf-8'));
  assert.equal(mvp.requireSpecReview, false);
  assert.equal(mvp.maxActiveChanges, 3);
  assert.equal(mvp.taskContract, 'off');
  assert.equal(mvp.srcGlob, 'src/');
  for (const profile of ['generic', 'node', 'vue3']) {
    const parsed = parsePipelineConfig(readFileSync(join(KIT_ROOT, `profiles/${profile}/orchestrator.yaml`), 'utf-8'));
    assert.equal(parsed.requireSpecReview, true, profile);
    assert.equal(parsed.srcGlob, 'src/', profile);
  }
});

// ── splitSrcGlob: multi-path src_glob ───────────────────────────────────

test('splitSrcGlob splits on commas and whitespace and drops empty entries', () => {
  assert.deepEqual(splitSrcGlob('bin/,scripts/,templates/'), ['bin/', 'scripts/', 'templates/']);
  assert.deepEqual(splitSrcGlob('src/ lib/'), ['src/', 'lib/']);
  assert.deepEqual(splitSrcGlob(' bin/ , templates/ '), ['bin/', 'templates/']);
  assert.deepEqual(splitSrcGlob('src/'), ['src/']);
  assert.deepEqual(splitSrcGlob(''), []);
  assert.deepEqual(splitSrcGlob(null), []);
});

// ── gate-check CLI: config parsing end to end ───────────────────────────

test('gate-check still blocks when a commented-out require_spec_review: false precedes the real key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-commented-'));
  try {
    projectWithSrcChange(
      dir,
      'version: 1\npipeline:\n  # require_spec_review: false\n  require_spec_review: true\n  src_glob: "src/"\n',
    );
    const res = cliSpawn(dir, ['gate-check', '--base', 'HEAD~1']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /review gate failed/);
    assert.doesNotMatch(res.stdout, /review not required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check still blocks when require_spec_review: false lives under verifier:, not pipeline:', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-nested-'));
  try {
    projectWithSrcChange(
      dir,
      'version: 1\npipeline:\n  require_spec_review: true\n  src_glob: "src/"\nroles:\n  verifier:\n    require_spec_review: false\n',
    );
    const res = cliSpawn(dir, ['gate-check', '--base', 'HEAD~1']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /review gate failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check honours a legacy orchestrator.yaml without a pipeline: block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-legacy-'));
  try {
    projectWithSrcChange(dir, 'version: 1\nrequire_spec_review: false\nsrc_glob: "src/"\n');
    const res = cliSpawn(dir, ['gate-check', '--base', 'HEAD~1']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /review not required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── gate-check CLI: multi-path src_glob ─────────────────────────────────

function projectWithPaths(dir, srcGlobValue, changedPaths) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-multi', scripts: {} }, null, 2));
  runInit(dir, '--profile generic --name GateMulti --lang en');
  writeOrchestrator(dir, `version: 1\npipeline:\n  require_spec_review: true\n  src_glob: ${srcGlobValue}\n`);
  initGit(dir);
  for (const rel of changedPaths) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), 'export const a = 1;\n');
  }
  writeMinimalChange(dir, 'add-thing');
  execSync('git add -A && git commit -q -m "change"', { cwd: dir });
}

test('gate-check with pipeline.src_glob "bin/,templates/" detects a change under templates/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-multi-'));
  try {
    projectWithPaths(dir, '"bin/,templates/"', ['templates/a.js']);
    const res = cliSpawn(dir, ['gate-check', '--base', 'HEAD~1']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /review gate failed/);
    assert.doesNotMatch(res.stdout, /nothing to gate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check with a space-separated src_glob gates the second entry too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-multi-space-'));
  try {
    projectWithPaths(dir, '"bin/ scripts/ templates/"', ['scripts/x.cjs']);
    const res = cliSpawn(dir, ['gate-check', '--base', 'HEAD~1']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /review gate failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check with a multi-path src_glob still reports nothing to gate outside the listed paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-multi-none-'));
  try {
    projectWithPaths(dir, '"bin/,templates/"', ['docs/a.md']);
    const res = cliSpawn(dir, ['gate-check', '--base', 'HEAD~1']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /no changes under bin\/,templates\/ — nothing to gate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check warns when an src_glob entry uses shell braces instead of a list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-multi-brace-'));
  try {
    projectWithPaths(dir, '"{src,lib}/"', ['lib/a.js']);
    const res = cliSpawn(dir, ['gate-check', '--base', 'HEAD~1']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /src_glob entries with braces are not expanded \({src,lib}\/\)/);
    assert.match(res.stdout, /nothing to gate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check --staged --src-glob accepts a comma list and blocks a staged change under its second entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-multi-staged-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-staged', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateStaged --lang en');
    writeMinimalChange(dir, 'add-thing');
    initGit(dir);
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib/a.js'), 'export const a = 1;\n');
    execSync('git add -A', { cwd: dir });

    const blocked = cliSpawn(dir, ['gate-check', '--staged', '--src-glob', 'bin/,lib/', 'add-thing']);
    assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
    assert.match(blocked.stdout, /review gate failed/);

    const single = cliSpawn(dir, ['gate-check', '--staged', '--src-glob', 'bin/', 'add-thing']);
    assert.equal(single.status, 0, single.stdout + single.stderr);
    assert.match(single.stdout, /nothing to gate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── scripts/ mirrors templates/scripts/ byte for byte ───────────────────

test('root scripts/*.cjs are byte-identical to templates/scripts/', () => {
  for (const name of ['cursor-spend-collect.cjs', 'cursor-spend-hook.cjs', 'memory-mcp-launcher.cjs']) {
    const root = readFileSync(join(KIT_ROOT, 'scripts', name));
    const template = readFileSync(join(KIT_ROOT, 'templates', 'scripts', name));
    assert.ok(root.equals(template), `scripts/${name} drifted from templates/scripts/${name}`);
  }
});
