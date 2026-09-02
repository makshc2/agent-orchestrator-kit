import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

function isolatedEnv(dir, extra = {}) {
  const home = join(dir, '.aok-home');
  const xdgConfig = join(dir, '.aok-xdg-config');
  const xdgData = join(dir, '.aok-xdg-data');
  const amp = join(dir, '.aok-amp');
  mkdirSync(home, { recursive: true });
  mkdirSync(xdgConfig, { recursive: true });
  mkdirSync(xdgData, { recursive: true });
  mkdirSync(amp, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    AMP_DATA_DIR: amp,
    ...extra,
  };
  if (!Object.prototype.hasOwnProperty.call(extra, 'AOK_MODEL')) delete env.AOK_MODEL;
  if (!Object.prototype.hasOwnProperty.call(extra, 'AOK_PLATFORM')) delete env.AOK_PLATFORM;
  if (!Object.prototype.hasOwnProperty.call(extra, 'AOK_AMP_BIN')) env.AOK_AMP_BIN = join(dir, '.no-amp-bin');
  for (const key of [
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

function cliExec(dir, args, extraEnv) {
  return execSync(`node "${CLI}" ${args}`, {
    cwd: dir,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: isolatedEnv(dir, extraEnv),
  });
}

function cliSpawn(dir, args, extraEnv) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: isolatedEnv(dir, extraEnv),
  });
}

function encodeClaudeProject(cwd) {
  return String(cwd).replace(/[/.]/g, '-');
}

function writeClaudeJsonl(home, cwd, rows) {
  const projectDir = join(home, '.claude', 'projects', encodeClaudeProject(cwd));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'session.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function runInit(dir, args = '') {
  execSync(`node "${CLI}" init ${args}`, { cwd: dir, stdio: 'pipe' });
}

function gitignoreLines(dir) {
  const p = join(dir, '.gitignore');
  return readFileSync(p, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
}

test('init installs orchestration and openspec skills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-test-'));
  try {
    runInit(dir, '--profile generic --name SmokeTest --lang en');

    const expected = [
      'AGENTS.md',
      'CLAUDE.md',
      '.agents/orchestrator.yaml',
      '.agents/commands/opsx-review.md',
      '.agents/commands/opsx-design.md',
      '.agents/commands/opsx-quick.md',
      '.agents/skills/agent-orchestration/SKILL.md',
      '.agents/skills/openspec-howto/SKILL.md',
      '.agents/skills/openspec-apply-change/SKILL.md',
      '.agents/amp.settings.json.example',
      '.github/workflows/agent-verify.yml',
      'scripts/sync-local-agent-skills.sh',
    ];

    for (const rel of expected) {
      assert.ok(existsSync(join(dir, rel)), `missing: ${rel}`);
    }

    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /design_intake:/);
    assert.match(orch, /require_design_brief:\s*false/);
    assert.match(orch, /command:\s*\/opsx:design/);
    assert.match(orch, /restore_on_start:\s*true/);
    assert.match(orch, /persist_on_exit:\s*true/);
    assert.match(orch, /emit_next_session_prompt:\s*true/);

    const orchestrationRule = readFileSync(
      join(dir, '.agents/rules/agent-orchestration.mdc'),
      'utf-8',
    );
    for (const name of ['session-handoff', 'codebase-explorer', 'design-intake', 'spec-architect', 'spec-reviewer', 'spec-archiver']) {
      assert.match(orchestrationRule, new RegExp(`\\b${name}\\b`), `missing route: ${name}`);
    }
    assert.match(orch, /prompt_self_contained:\s*true/);
    assert.match(orch, /spawn_handoff_subagent:\s*false/);
    assert.match(orch, /task_contract:\s*warn/);
    assert.match(orch, /launcher:\s*scripts\/memory-mcp-launcher\.cjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update refreshes kit-managed skills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-update-'));
  try {
    runInit(dir, '--profile generic --name UpdateTest --lang en');
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    assert.ok(existsSync(join(dir, '.agents/skills/openspec-propose/SKILL.md')));
    assert.ok(existsSync(join(dir, '.github/workflows/agent-verify.yml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitignore uses exact line match — .cursor/memory.json adds .cursor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitignore-'));
  try {
    writeFileSync(join(dir, '.gitignore'), '.cursor/memory.json\n');
    runInit(dir, '--profile generic --name GIT --lang en');

    const lines = gitignoreLines(dir);
    assert.ok(lines.includes('.cursor'), 'expected .cursor line');
    assert.ok(lines.includes('.cursor/memory.json'));
    assert.ok(lines.includes('.claude'));
    assert.equal(lines.filter((l) => l === '.cursor').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown profile falls back to generic with warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-profile-'));
  try {
    const out = execSync(`node "${CLI}" init --profile python --name PyTest --lang en`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.match(out, /Unknown profile "python"/);
    assert.ok(existsSync(join(dir, '.agents/orchestrator.yaml')));
    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.doesNotMatch(orch, /stack: python/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mvp profile sets require_spec_review false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mvp-'));
  try {
    runInit(dir, '--profile mvp --name Demo --lang uk');
    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /require_spec_review: false/);
    assert.match(orch, /profile: mvp/);
    assert.ok(existsSync(join(dir, 'openspec/config.yaml.example')));
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    assert.match(agents, /\/opsx:quick/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vue3 profile installs openspec config example', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-vue3-'));
  try {
    runInit(dir, '--profile vue3 --name VueApp --lang uk');
    assert.ok(existsSync(join(dir, 'openspec/config.yaml.example')));
    const example = readFileSync(join(dir, 'openspec/config.yaml.example'), 'utf-8');
    assert.match(example, /Vue 3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects yarn and patches orchestrator verifier commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-yarn-'));
  try {
    writeFileSync(join(dir, 'yarn.lock'), '');
    runInit(dir, '--profile generic --name YarnProj --lang en');
    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /package_manager: yarn/);
    assert.match(orch, /lint_command: "yarn lint"/);
    assert.match(orch, /build_command: "yarn build"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync --target amp creates amp settings and reports native read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-amp-'));
  try {
    runInit(dir, '--profile generic --name AmpTest --lang en');
    const out = execSync(`node "${CLI}" sync --target amp`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.match(out, /Amp Code reads .agents\/ natively/);
    assert.ok(existsSync(join(dir, '.amp/settings.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init next steps mention OpenSpec when not installed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-next-'));
  try {
    const out = execSync(`node "${CLI}" init --profile vue3 --name Next --lang en`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.match(out, /OpenSpec \(required/);
    assert.match(out, /frontend-agent-skills/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CI workflow supports yarn and pnpm detection', () => {
  const workflow = readFileSync(
    join(KIT_ROOT, 'templates/.github/workflows/agent-verify.yml'),
    'utf-8',
  );
  assert.match(workflow, /Detect package manager/);
  assert.match(workflow, /yarn.lock/);
  assert.match(workflow, /pnpm-lock.yaml/);
});

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
}

test('init --ci gitlab creates GitLab fragment, not GitHub workflow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gitlab-test', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name GitLabTest --lang en');

    assert.ok(existsSync(join(dir, '.gitlab/agent-verify.yml')));
    assert.ok(!existsSync(join(dir, '.github/workflows/agent-verify.yml')));
    assert.ok(!existsSync(join(dir, '.gitlab-ci.yml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab injects verify:openspec and prebuild', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-scripts-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gitlab-scripts', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name Scripts --lang en');

    const pkg = readPkg(dir);
    assert.equal(pkg.scripts['verify:openspec'], 'npx openspec validate --all --strict');
    assert.equal(pkg.scripts.prebuild, 'npm run verify:openspec');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab chains existing prebuild', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-chain-'));
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'chain', scripts: { prebuild: 'node scripts/check.js' } }, null, 2),
    );
    runInit(dir, '--ci gitlab --profile generic --name Chain --lang en');

    const pkg = readPkg(dir);
    assert.equal(pkg.scripts.prebuild, 'npm run verify:openspec && node scripts/check.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitLab fragment contains PM detection', () => {
  const fragment = readFileSync(join(KIT_ROOT, 'templates/.gitlab/agent-verify.yml'), 'utf-8');
  assert.match(fragment, /\.agent-verify-base/);
  assert.match(fragment, /agent-verify:/);
  assert.match(fragment, /pnpm-lock\.yaml/);
  assert.match(fragment, /yarn\.lock/);
  assert.match(fragment, /npm ci/);
  assert.match(fragment, /openspec validate --all --strict/);
});

test('init --ci github default keeps backward compat without script injection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-github-default-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'github-default', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GitHubDefault --lang en');

    assert.ok(existsSync(join(dir, '.github/workflows/agent-verify.yml')));
    assert.ok(!existsSync(join(dir, '.gitlab/agent-verify.yml')));
    const pkg = readPkg(dir);
    assert.equal(pkg.scripts['verify:openspec'], undefined);
    assert.equal(pkg.scripts.prebuild, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab + update refreshes GitLab fragment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-update-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gitlab-update', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name UpdateGitLab --lang en');

    writeFileSync(join(dir, '.gitlab/agent-verify.yml'), '# stale\n');
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    const fragment = readFileSync(join(dir, '.gitlab/agent-verify.yml'), 'utf-8');
    assert.match(fragment, /\.agent-verify-base/);
    assert.doesNotMatch(fragment, /# stale/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci none skips CI files and script injection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-ci-none-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ci-none', scripts: {} }, null, 2));
    runInit(dir, '--ci none --profile generic --name None --lang en');

    assert.ok(!existsSync(join(dir, '.github/workflows/agent-verify.yml')));
    assert.ok(!existsSync(join(dir, '.gitlab/agent-verify.yml')));
    const pkg = readPkg(dir);
    assert.equal(pkg.scripts['verify:openspec'], undefined);
    assert.equal(pkg.scripts.prebuild, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab --force skips duplicate prebuild chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-force-'));
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'force',
          scripts: {
            'verify:openspec': 'npx openspec validate --all --strict',
            prebuild: 'npm run verify:openspec && node scripts/check.js',
          },
        },
        null,
        2,
      ),
    );
    const out = execSync(`node "${CLI}" init --ci gitlab --force --profile generic --name Force --lang en`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.match(out, /prebuild already chains verify:openspec/);

    const pkg = readPkg(dir);
    assert.equal(pkg.scripts.prebuild, 'npm run verify:openspec && node scripts/check.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab with yarn lockfile uses yarn in prebuild', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-yarn-'));
  try {
    writeFileSync(join(dir, 'yarn.lock'), '');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'yarn-gitlab', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name YarnGitLab --lang en');

    const pkg = readPkg(dir);
    assert.equal(pkg.scripts.prebuild, 'yarn run verify:openspec');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab next steps mention prebuild verify path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-next-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'next-gitlab', scripts: {} }, null, 2));
    const out = execSync(`node "${CLI}" init --ci gitlab --profile generic --name NextGitLab --lang en`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.match(out, /prebuild.*verify:openspec/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitLab starter example includes local fragment', () => {
  const starter = readFileSync(join(KIT_ROOT, 'templates/.gitlab-ci.starter.yml.example'), 'utf-8');
  assert.match(starter, /local: '\.gitlab\/agent-verify\.yml'/);
  assert.match(starter, /extends: \.agent-verify-base/);
});

test('init --ci gitlab npm run build runs prebuild verify hook', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gitlab-build-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'build-hook', scripts: { build: 'echo build-ok' } }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name BuildHook --lang en');

    const pkg = readPkg(dir);
    pkg.scripts['verify:openspec'] = 'node -e "require(\'fs\').writeFileSync(\'verify-ran\',\'1\')"';
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    execSync('npm run build', { cwd: dir, stdio: 'pipe' });
    assert.ok(existsSync(join(dir, 'verify-ran')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab --spec-verify installs verifier files and gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --spec-verify --profile generic --name SV --lang en');

    assert.ok(existsSync(join(dir, '.gitlab/spec-verify.yml')));
    assert.ok(existsSync(join(dir, 'scripts/verify-specs.sh')));
    assert.ok(existsSync(join(dir, 'scripts/post-mr-verdict.sh')));

    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /- openspec-validate-strict\n\s*- spec-verify-blocking/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci gitlab without flag does not install spec-verify files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-off-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv-off', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name SVOff --lang en');

    assert.ok(!existsSync(join(dir, '.gitlab/spec-verify.yml')));
    assert.ok(!existsSync(join(dir, 'scripts/verify-specs.sh')));
    assert.ok(!existsSync(join(dir, 'scripts/post-mr-verdict.sh')));
    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.doesNotMatch(orch, /spec-verify-blocking/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci none --spec-verify warns and skips verifier install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-none-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv-none', scripts: {} }, null, 2));
    const out = execSync(`node "${CLI}" init --ci none --spec-verify --profile generic --name SVNone --lang en`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.match(out, /--spec-verify requires --ci gitlab or --ci github/);
    assert.ok(!existsSync(join(dir, '.gitlab/spec-verify.yml')));
    assert.ok(!existsSync(join(dir, '.github/workflows/spec-verify.yml')));
    assert.ok(!existsSync(join(dir, 'scripts/verify-specs.sh')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init --ci github --spec-verify installs GitHub verifier files and gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-github-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv-gh', scripts: {} }, null, 2));
    runInit(dir, '--ci github --spec-verify --profile generic --name SVGH --lang en');

    assert.ok(existsSync(join(dir, '.github/workflows/spec-verify.yml')));
    assert.ok(existsSync(join(dir, 'scripts/verify-specs.sh')));
    assert.ok(existsSync(join(dir, 'scripts/post-pr-verdict-github.sh')));
    assert.ok(!existsSync(join(dir, '.gitlab/spec-verify.yml')));
    assert.ok(!existsSync(join(dir, 'scripts/post-mr-verdict.sh')));

    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /- openspec-validate-strict\n\s*- spec-verify-blocking/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update refreshes GitHub spec-verify files only when installed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-github-update-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv-gh-up', scripts: {} }, null, 2));
    runInit(dir, '--ci github --spec-verify --profile generic --name SVGHUp --lang en');

    writeFileSync(join(dir, '.github/workflows/spec-verify.yml'), '# stale\n');
    writeFileSync(join(dir, 'scripts/post-pr-verdict-github.sh'), '# stale\n');
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    assert.match(readFileSync(join(dir, '.github/workflows/spec-verify.yml'), 'utf-8'), /spec-verify/);
    assert.match(readFileSync(join(dir, 'scripts/post-pr-verdict-github.sh'), 'utf-8'), /gh pr comment/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitHub spec-verify workflow is blocking with src paths and artifacts', () => {
  const workflow = readFileSync(join(KIT_ROOT, 'templates/.github/workflows/spec-verify.yml'), 'utf-8');
  assert.match(workflow, /spec-verify:/);
  assert.match(workflow, /src\/\*\*/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /artifacts\/verdict\.json/);
  assert.doesNotMatch(workflow, /^\s*continue-on-error: true/m);
  assert.match(workflow, /#\s*continue-on-error: true/);
});

test('spec-verify fragment is blocking with src rules and artifacts', () => {
  const fragment = readFileSync(join(KIT_ROOT, 'templates/.gitlab/spec-verify.yml'), 'utf-8');
  assert.match(fragment, /\.spec-verify-base/);
  assert.match(fragment, /spec-verify:/);
  assert.match(fragment, /src\/\*\*\/\*/);
  assert.match(fragment, /artifacts\/verdict\.json/);
  assert.doesNotMatch(fragment, /^\s*allow_failure: true/m);
  assert.match(fragment, /#\s*allow_failure: true/);
});

test('update refreshes spec-verify files only when installed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-update-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv-up', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --spec-verify --profile generic --name SVUp --lang en');

    writeFileSync(join(dir, '.gitlab/spec-verify.yml'), '# stale\n');
    writeFileSync(join(dir, 'scripts/verify-specs.sh'), '# stale\n');
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    assert.match(readFileSync(join(dir, '.gitlab/spec-verify.yml'), 'utf-8'), /\.spec-verify-base/);
    assert.match(readFileSync(join(dir, 'scripts/verify-specs.sh'), 'utf-8'), /SPEC VERIFIER/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update does not create spec-verify files when not opted in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-noopt-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv-no', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name SVNo --lang en');
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    assert.ok(!existsSync(join(dir, '.gitlab/spec-verify.yml')));
    assert.ok(!existsSync(join(dir, 'scripts/verify-specs.sh')));
    assert.ok(!existsSync(join(dir, 'scripts/post-mr-verdict.sh')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-verify gate patch is idempotent on repeated init', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-specverify-idem-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sv-idem', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --spec-verify --profile generic --name SVIdem --lang en');
    runInit(dir, '--ci gitlab --spec-verify --profile generic --name SVIdem --lang en');

    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    const count = (orch.match(/spec-verify-blocking/g) || []).length;
    assert.equal(count, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifier script templates are stack-agnostic and secret-safe', () => {
  const verify = readFileSync(join(KIT_ROOT, 'templates/scripts/verify-specs.sh'), 'utf-8');
  assert.doesNotMatch(verify, /Vue 3/);
  assert.match(verify, /openspec\/config\.yaml/);
  assert.match(verify, /AMP_API_KEY/);
  assert.doesNotMatch(verify, /echo.*\$AMP_API_KEY/);
  assert.match(verify, /\*\.pem/);

  const post = readFileSync(join(KIT_ROOT, 'templates/scripts/post-mr-verdict.sh'), 'utf-8');
  assert.match(post, /GITLAB_VERIFIER_TOKEN/);
  assert.doesNotMatch(post, /echo.*\$\{?GITLAB_VERIFIER_TOKEN/);

  const postGithub = readFileSync(join(KIT_ROOT, 'templates/scripts/post-pr-verdict-github.sh'), 'utf-8');
  assert.match(postGithub, /GH_TOKEN/);
  assert.match(postGithub, /gh pr comment/);
  assert.doesNotMatch(postGithub, /echo.*\$\{?GH_TOKEN/);
  assert.doesNotMatch(postGithub, /echo.*\$\{?GITHUB_TOKEN/);
});

test('opsx-apply documents review gate', () => {
  const apply = readFileSync(join(KIT_ROOT, 'templates/.agents/commands/opsx-apply.md'), 'utf-8');
  assert.match(apply, /require_spec_review/);
  assert.match(apply, /review\.md/);
});

test('opsx-review writes review.md and vue3 checklist', () => {
  const review = readFileSync(join(KIT_ROOT, 'templates/.agents/commands/opsx-review.md'), 'utf-8');
  assert.match(review, /review\.md/);
  assert.match(review, /Vue 3/);
});

function initGit(dir) {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync('git add -A && git commit -q -m "initial"', { cwd: dir });
}

function runCli(dir, args) {
  return execSync(`node "${CLI}" ${args}`, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
}

test('status reports no active changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-status-empty-'));
  try {
    runInit(dir, '--profile generic --name StatusEmpty --lang en');
    const out = runCli(dir, 'status');
    assert.match(out, /No active changes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('status shows task progress and review verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-status-'));
  try {
    runInit(dir, '--profile generic --name Status --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n- [ ] 1.2 pending\n- [x] 1.3 done\n');
    writeFileSync(join(changeDir, 'review.md'), '# Spec Review\n\n**Verdict:** APPROVE\n');

    const out = runCli(dir, 'status');
    assert.match(out, /add-thing/);
    assert.match(out, /2\/3 tasks/);
    assert.match(out, /APPROVE/);
    assert.match(out, /brief:\s*no/);
    assert.doesNotMatch(out, /ready to archive/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('status shows brief: yes when design-brief.md exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-status-brief-'));
  try {
    runInit(dir, '--profile generic --name StatusBrief --lang en');
    const changeDir = join(dir, 'openspec/changes/ui-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 pending\n');
    writeFileSync(join(changeDir, 'design-brief.md'), '# Design Brief\n');

    const out = runCli(dir, 'status');
    assert.match(out, /ui-thing/);
    assert.match(out, /brief:\s*yes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('status marks a fully-completed change as ready to archive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-status-ready-'));
  try {
    runInit(dir, '--profile generic --name StatusReady --lang en');
    const changeDir = join(dir, 'openspec/changes/done-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n- [x] 1.2 done\n');

    const out = runCli(dir, 'status');
    assert.match(out, /done-thing/);
    assert.match(out, /2\/2 tasks/);
    assert.match(out, /ready to archive/);
    assert.match(out, /review: none/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check fails without an approved review when src/ changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-fail-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-fail', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateFail --lang en');
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
    execSync('git add -A && git commit -q -m "add src"', { cwd: dir });

    assert.throws(() => runCli(dir, 'gate-check --base HEAD~1'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check passes with an approved review.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-pass-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-pass', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GatePass --lang en');
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
    writeFileSync(join(changeDir, 'review.md'), '**Verdict:** APPROVE\n');
    execSync('git add -A && git commit -q -m "add src"', { cwd: dir });

    const out = runCli(dir, 'gate-check --base HEAD~1');
    assert.match(out, /review gate passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check skips when require_spec_review is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-mvp-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-mvp', scripts: {} }, null, 2));
    runInit(dir, '--profile mvp --name GateMvp --lang en');
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    execSync('git add -A && git commit -q -m "add src"', { cwd: dir });

    const out = runCli(dir, 'gate-check --base HEAD~1');
    assert.match(out, /review not required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check skips when the diff does not touch src/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-nosrc-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-nosrc', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateNoSrc --lang en');
    initGit(dir);

    writeFileSync(join(dir, 'README.md'), '# hello\n');
    execSync('git add -A && git commit -q -m "docs"', { cwd: dir });

    const out = runCli(dir, 'gate-check --base HEAD~1');
    assert.match(out, /nothing to gate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check is a no-op without .agents/orchestrator.yaml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-noconfig-'));
  try {
    mkdirSync(dir, { recursive: true });
    const out = runCli(dir, 'gate-check');
    assert.match(out, /orchestrator\.yaml not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function enableDesignBriefGate(dir) {
  const orchPath = join(dir, '.agents/orchestrator.yaml');
  const orch = readFileSync(orchPath, 'utf-8');
  writeFileSync(orchPath, orch.replace(/require_design_brief:\s*false/, 'require_design_brief: true'));
}

test('gate-check fails when require_design_brief and brief is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-brief-fail-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-brief-fail', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateBriefFail --lang en');
    enableDesignBriefGate(dir);
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    const changeDir = join(dir, 'openspec/changes/add-ui');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
    writeFileSync(join(changeDir, 'review.md'), '**Verdict:** APPROVE\n');
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\nUI change.\n');
    execSync('git add -A && git commit -q -m "add src"', { cwd: dir });

    assert.throws(() => runCli(dir, 'gate-check --base HEAD~1'));
    try {
      runCli(dir, 'gate-check --base HEAD~1');
      assert.fail('expected gate-check to fail');
    } catch (err) {
      assert.match(String(err.stdout || ''), /\/opsx:design/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check passes design brief opt-out via Design: none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-brief-optout-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-brief-optout', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateBriefOptOut --lang en');
    enableDesignBriefGate(dir);
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    const changeDir = join(dir, 'openspec/changes/add-api');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
    writeFileSync(join(changeDir, 'review.md'), '**Verdict:** APPROVE\n');
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\nDesign: none\n');
    execSync('git add -A && git commit -q -m "add src"', { cwd: dir });

    const out = runCli(dir, 'gate-check --base HEAD~1');
    assert.match(out, /review gate passed/);
    assert.match(out, /design brief gate passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check passes when design-brief.md exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-brief-ok-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-brief-ok', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateBriefOk --lang en');
    enableDesignBriefGate(dir);
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    const changeDir = join(dir, 'openspec/changes/add-ui');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
    writeFileSync(join(changeDir, 'review.md'), '**Verdict:** APPROVE\n');
    writeFileSync(join(changeDir, 'design-brief.md'), '# Design Brief\n');
    execSync('git add -A && git commit -q -m "add src"', { cwd: dir });

    const out = runCli(dir, 'gate-check --base HEAD~1');
    assert.match(out, /review gate passed/);
    assert.match(out, /design brief gate passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check skips design brief when require_design_brief is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-brief-off-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-brief-off', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateBriefOff --lang en');
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
    writeFileSync(join(changeDir, 'review.md'), '**Verdict:** APPROVE\n');
    execSync('git add -A && git commit -q -m "add src"', { cwd: dir });

    const out = runCli(dir, 'gate-check --base HEAD~1');
    assert.match(out, /review gate passed/);
    assert.doesNotMatch(out, /design brief/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync removes a skill directory that no longer exists in .agents/skills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-sync-delete-'));
  try {
    runInit(dir, '--profile generic --name SyncDelete --lang en');
    runCli(dir, 'sync --target cursor');
    assert.ok(existsSync(join(dir, '.cursor/skills/openspec-howto')));

    rmSync(join(dir, '.agents/skills/openspec-howto'), { recursive: true, force: true });
    runCli(dir, 'sync --target cursor');

    assert.ok(!existsSync(join(dir, '.cursor/skills/openspec-howto')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync --delete does not remove unrelated generated files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-sync-keep-'));
  try {
    runInit(dir, '--profile generic --name SyncKeep --lang en');
    runCli(dir, 'sync --target cursor');
    writeFileSync(join(dir, '.cursor/memory.json'), '{}');

    runCli(dir, 'sync --target cursor');

    assert.ok(existsSync(join(dir, '.cursor/memory.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init installs all routed subagents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-subagents-init-'));
  try {
    runInit(dir, '--profile generic --name SubagentsInit --lang en');

    const expected = [
      '.agents/subagents/openspec-guide.md',
      '.agents/subagents/code-writer.md',
      '.agents/subagents/code-reviewer.md',
      '.agents/subagents/test-writer.md',
      '.agents/subagents/setup-doctor.md',
      '.agents/subagents/design-implementer.md',
      '.agents/subagents/codebase-explorer.md',
      '.agents/subagents/design-intake.md',
      '.agents/subagents/spec-architect.md',
      '.agents/subagents/spec-reviewer.md',
      '.agents/subagents/spec-archiver.md',
      '.agents/subagents/session-handoff.md',
    ];
    for (const rel of expected) {
      assert.ok(existsSync(join(dir, rel)), `missing: ${rel}`);
    }

    const guide = readFileSync(join(dir, '.agents/subagents/openspec-guide.md'), 'utf-8');
    assert.match(guide, /^---\nname: openspec-guide\ndescription:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync copies subagents to .cursor/agents and .claude/agents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-subagents-sync-'));
  try {
    runInit(dir, '--profile generic --name SubagentsSync --lang en');
    runCli(dir, 'sync --target all');

    const stageSubagents = [
      'codebase-explorer',
      'design-intake',
      'spec-architect',
      'spec-reviewer',
      'spec-archiver',
    ];
    for (const name of stageSubagents) {
      assert.ok(existsSync(join(dir, `.cursor/agents/${name}.md`)), `missing Cursor agent: ${name}`);
      assert.ok(existsSync(join(dir, `.claude/agents/${name}.md`)), `missing Claude agent: ${name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync removes a subagent from .cursor/agents when deleted from .agents/subagents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-subagents-delete-'));
  try {
    runInit(dir, '--profile generic --name SubagentsDelete --lang en');
    runCli(dir, 'sync --target cursor');
    assert.ok(existsSync(join(dir, '.cursor/agents/test-writer.md')));

    rmSync(join(dir, '.agents/subagents/test-writer.md'), { force: true });
    runCli(dir, 'sync --target cursor');

    assert.ok(!existsSync(join(dir, '.cursor/agents/test-writer.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update refreshes subagents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-subagents-update-'));
  try {
    runInit(dir, '--profile generic --name SubagentsUpdate --lang en');
    writeFileSync(join(dir, '.agents/subagents/setup-doctor.md'), '# stale\n');
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    const content = readFileSync(join(dir, '.agents/subagents/setup-doctor.md'), 'utf-8');
    assert.doesNotMatch(content, /# stale/);
    assert.match(content, /name: setup-doctor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init generates Amp skill wrappers for every subagent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-amp-wrappers-'));
  try {
    runInit(dir, '--profile generic --name AmpWrappers --lang en');

    const wrapper = join(dir, '.agents/skills/subagent-design-implementer/SKILL.md');
    assert.ok(existsSync(wrapper), 'missing Amp wrapper for design-implementer');

    const content = readFileSync(wrapper, 'utf-8');
    assert.match(content, /^---\nname: subagent-design-implementer\ndescription: .+/);
    assert.match(content, /AUTO-GENERATED from \.agents\/subagents\/design-implementer\.md/);
    assert.match(content, /pixel|fidelity|design/i);

    const architectWrapper = readFileSync(
      join(dir, '.agents/skills/subagent-spec-architect/SKILL.md'),
      'utf-8',
    );
    assert.match(
      architectWrapper,
      /CRITICAL \(Amp \/ Cursor \/ Claude\): Parent MUST spawn this skill as an isolated subagent with fresh context/,
    );
    assert.match(architectWrapper, /If spawn is unavailable, STOP/);

    for (const name of ['openspec-guide', 'code-writer', 'code-reviewer', 'test-writer', 'setup-doctor', 'session-handoff']) {
      assert.ok(
        existsSync(join(dir, `.agents/skills/subagent-${name}/SKILL.md`)),
        `missing Amp wrapper for ${name}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync regenerates Amp wrappers and removes stale ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-amp-wrappers-stale-'));
  try {
    runInit(dir, '--profile generic --name AmpWrappersStale --lang en');
    assert.ok(existsSync(join(dir, '.agents/skills/subagent-test-writer/SKILL.md')));

    rmSync(join(dir, '.agents/subagents/test-writer.md'), { force: true });
    runCli(dir, 'sync --target amp');

    assert.ok(!existsSync(join(dir, '.agents/skills/subagent-test-writer')));
    assert.ok(existsSync(join(dir, '.agents/skills/subagent-code-writer/SKILL.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Amp wrappers are excluded from .cursor and .claude skill sync', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-amp-wrappers-exclude-'));
  try {
    runInit(dir, '--profile generic --name AmpWrappersExclude --lang en');
    runCli(dir, 'sync --target all');

    assert.ok(existsSync(join(dir, '.agents/skills/subagent-code-writer/SKILL.md')));
    assert.ok(!existsSync(join(dir, '.cursor/skills/subagent-code-writer')));
    assert.ok(!existsSync(join(dir, '.claude/skills/subagent-code-writer')));
    assert.ok(existsSync(join(dir, '.cursor/agents/code-writer.md')));
    assert.ok(existsSync(join(dir, '.claude/agents/code-writer.md')));
    assert.ok(existsSync(join(dir, '.cursor/skills/openspec-howto/SKILL.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell sync script generates Amp wrappers and excludes them from IDE dirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-amp-wrappers-shell-'));
  try {
    runInit(dir, '--profile generic --name AmpWrappersShell --lang en');
    rmSync(join(dir, '.agents/skills/subagent-code-writer'), { recursive: true, force: true });

    execSync('sh scripts/sync-local-agent-skills.sh', { cwd: dir, stdio: 'pipe' });

    const wrapper = join(dir, '.agents/skills/subagent-code-writer/SKILL.md');
    assert.ok(existsSync(wrapper), 'shell script did not regenerate wrapper');
    const content = readFileSync(wrapper, 'utf-8');
    assert.match(content, /^---\nname: subagent-code-writer\ndescription: .+/);

    assert.ok(!existsSync(join(dir, '.cursor/skills/subagent-code-writer')));
    assert.ok(!existsSync(join(dir, '.claude/skills/subagent-code-writer')));
    assert.ok(existsSync(join(dir, '.cursor/agents/code-writer.md')));
    assert.ok(existsSync(join(dir, '.claude/agents/code-writer.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('design-implementer subagent enforces design-brief priority and fidelity', () => {
  const content = readFileSync(
    join(KIT_ROOT, 'templates/.agents/subagents/design-implementer.md'),
    'utf-8',
  );
  assert.match(content, /name: design-implementer/);
  assert.match(content, /design-brief\.md/);
  assert.match(content, /Do NOT call live Figma MCP when a brief exists/i);
  assert.match(content, /get_design_context/);
  assert.match(content, /hover, focus, active, disabled/);
});

test('update does not resurrect a CI workflow file the project deleted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-ci-noresurrect-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ci-noresurrect', scripts: {} }, null, 2));
    runInit(dir, '--ci gitlab --profile generic --name CiNoResurrect --lang en');
    assert.ok(existsSync(join(dir, '.gitlab/agent-verify.yml')));
    assert.ok(!existsSync(join(dir, '.github/workflows/agent-verify.yml')));

    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    assert.ok(!existsSync(join(dir, '.github/workflows/agent-verify.yml')));
    assert.ok(existsSync(join(dir, '.gitlab/agent-verify.yml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update keeps sync-local-agent-skills.sh executable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-update-exec-'));
  try {
    runInit(dir, '--profile generic --name UpdateExec --lang en');
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });

    const mode = statSync(join(dir, 'scripts/sync-local-agent-skills.sh')).mode;
    assert.ok(mode & 0o111, 'expected sync script to remain executable after update');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync removes a skill directory from .claude/skills too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-sync-claude-delete-'));
  try {
    runInit(dir, '--profile generic --name SyncClaudeDelete --lang en');
    runCli(dir, 'sync --target claude');
    assert.ok(existsSync(join(dir, '.claude/skills/openspec-howto')));

    rmSync(join(dir, '.agents/skills/openspec-howto'), { recursive: true, force: true });
    runCli(dir, 'sync --target claude');

    assert.ok(!existsSync(join(dir, '.claude/skills/openspec-howto')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init installs figma token templates and gitignores local env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-figma-init-'));
  try {
    runInit(dir, '--profile generic --name FigmaInit --lang en');

    assert.ok(existsSync(join(dir, '.agents/figma.local.env.example')));
    assert.ok(existsSync(join(dir, 'scripts/figma-mcp-launcher.cjs')));
    assert.ok(existsSync(join(dir, '.agents/rules/figma-token-setup.mdc')));

    const mcp = JSON.parse(readFileSync(join(dir, '.agents/mcp.json.example'), 'utf-8'));
    assert.equal(mcp.mcpServers.figma.command, 'node');
    assert.deepEqual(mcp.mcpServers.figma.args, ['scripts/figma-mcp-launcher.cjs']);
    assert.ok(!JSON.stringify(mcp).includes('figd_'));

    const lines = gitignoreLines(dir);
    assert.ok(lines.includes('.agents/figma.local.env'));

    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /figma:/);
    assert.match(orch, /FIGMA_ACCESS_TOKEN/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('figma-setup and figma-status never print token value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-figma-cli-'));
  try {
    runInit(dir, '--profile generic --name FigmaCli --lang en');

    let failed = false;
    try {
      execSync(`node "${CLI}" figma-status`, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
    } catch (error) {
      failed = true;
      const out = `${error.stdout || ''}${error.stderr || ''}`;
      assert.match(out, /not configured/i);
      assert.doesNotMatch(out, /figd_/i);
    }
    assert.ok(failed, 'figma-status should exit non-zero without token');

    const setupOut = execSync(`node "${CLI}" figma-setup`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.ok(existsSync(join(dir, '.agents/figma.local.env')));
    assert.match(setupOut, /figma\.local\.env/);
    assert.doesNotMatch(setupOut, /figd_/i);

    writeFileSync(join(dir, '.agents/figma.local.env'), 'FIGMA_ACCESS_TOKEN=figd_test_secret_value\n');
    const statusOut = execSync(`node "${CLI}" figma-status`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    assert.match(statusOut, /configured/i);
    assert.doesNotMatch(statusOut, /figd_test_secret_value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init installs memory launcher and session-handoff assets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-handoff-init-'));
  try {
    runInit(dir, '--profile generic --name HandoffInit --lang uk');

    assert.ok(existsSync(join(dir, 'scripts/memory-mcp-launcher.cjs')));
    assert.ok(existsSync(join(dir, '.agents/subagents/session-handoff.md')));
    assert.ok(existsSync(join(dir, '.agents/rules/session-handoff.mdc')));
    assert.ok(existsSync(join(dir, '.agents/skills/subagent-session-handoff/SKILL.md')));

    const mcp = JSON.parse(readFileSync(join(dir, '.agents/mcp.json.example'), 'utf-8'));
    assert.equal(mcp.mcpServers.memory.command, 'node');
    assert.deepEqual(mcp.mcpServers.memory.args, ['scripts/memory-mcp-launcher.cjs']);
    assert.ok(!JSON.stringify(mcp.mcpServers.memory).includes('MEMORY_FILE_PATH'));

    const cursorMcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    assert.deepEqual(cursorMcp.mcpServers.memory.args, ['scripts/memory-mcp-launcher.cjs']);

    const rule = readFileSync(join(dir, '.agents/rules/session-handoff.mdc'), 'utf-8');
    assert.match(rule, /HARD STOP/);
    assert.match(rule, /[Ss]elf-contained/);
    assert.match(rule, /git-tracked/);
    assert.match(rule, /Runtime/);
    assert.match(rule, /cloud-check/);
    const skill = readFileSync(join(dir, '.agents/skills/agent-orchestration/SKILL.md'), 'utf-8');
    assert.match(skill, /git-tracked/);
    assert.match(skill, /## Runtime/);
    assert.match(skill, /cloud-check/);
    const sub = readFileSync(join(dir, '.agents/subagents/session-handoff.md'), 'utf-8');
    assert.match(sub, /git-tracked/);
    assert.match(sub, /Runtime/);
    assert.match(sub, /cloud-check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist writes memory json and expanded prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-handoff-cli-'));
  try {
    runInit(dir, '--profile generic --name HandoffCli --lang uk');
    const changeDir = join(dir, 'openspec/changes/add-bulk-export');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 pending\n- [ ] 1.2 pending\n');
    writeFileSync(
      join(changeDir, 'handoff.md'),
      `# Session Handoff

## Closed role
Architect — validate --strict passed

## Done
- Created proposal, design, specs, and tasks for bulk export.

## Decisions
- export-format: xlsx — matches existing reports

## Blocked
none

## Next command
\`/opsx:review add-bulk-export\`

## Next role
spec-reviewer

## Attach
- \`openspec/changes/add-bulk-export/\`

## Subagents to spawn
- \`spec-reviewer\` — /opsx:review (Amp: isolated \`subagent-spec-reviewer\`)
- \`session-handoff\` — persist/restore

## Constraints
- no src edits
`,
    );

    const out = cliExec(dir, 'handoff add-bulk-export');
    assert.match(out, /^\/opsx:review add-bulk-export/m);
    assert.match(out, /Ти — conductor/);
    assert.match(out, /subagent-spec-reviewer/);
    assert.match(out, /HARD STOP/);
    assert.match(out, /xlsx/);
    assert.doesNotMatch(out, /NEXT_SESSION_PROMPT/);
    assert.doesNotMatch(out, /handoff persist/);

    const memoryRaw = readFileSync(join(dir, '.cursor/memory.json'), 'utf-8');
    assert.match(memoryRaw, /Handoff:add-bulk-export/);
    assert.match(memoryRaw, /Change:add-bulk-export/);
    assert.match(memoryRaw, /Decision:export-format/);

    const restored = execSync(`node "${CLI}" handoff add-bulk-export --restore`, {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.match(restored, /next_command: \/opsx:review add-bulk-export/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist fails without required sections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-handoff-missing-'));
  try {
    runInit(dir, '--profile generic --name HandoffMissing --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), '# Session Handoff\n\n## Done\nonly done\n');

    let failed = false;
    try {
      cliExec(dir, 'handoff add-thing');
    } catch (error) {
      failed = true;
      const out = `${error.stdout || ''}${error.stderr || ''}`;
      assert.match(out, /incomplete/i);
    }
    assert.ok(failed, 'handoff should fail without Closed role and Next command');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

function handoffWithMetrics(overrides = {}) {
  const rows = {
    platform: 'unknown',
    model: 'unknown',
    input_tokens: 'unknown',
    output_tokens: 'unknown',
    cost_usd: 'unknown',
    amp_credits: 'unknown',
    spend_source: 'unknown',
    ...overrides,
  };
  return `${METRICS_HANDOFF}
## Metrics
- platform: ${rows.platform}
- model: ${rows.model}
- input_tokens: ${rows.input_tokens}
- output_tokens: ${rows.output_tokens}
- cost_usd: ${rows.cost_usd}
- amp_credits: ${rows.amp_credits}
- spend_source: ${rows.spend_source}
`;
}

test('handoff restore + persist records a session in metrics.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-'));
  try {
    runInit(dir, '--profile generic --name Metrics --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n- [ ] 1.2 todo\n');
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);

    cliExec(dir, 'handoff add-thing --restore');
    const pendingState = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.ok(pendingState.pending, 'restore writes a pending session marker');
    assert.equal(pendingState.pending.role, 'spec-reviewer');
    assert.equal(pendingState.sessions.length, 0);

    cliExec(dir, 'handoff add-thing --input-tokens 12000 --output-tokens 3000 --cost-usd 0.42 --model claude-sonnet');
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.pending, null, 'persist closes the pending session');
    assert.equal(metrics.sessions.length, 1);
    const session = metrics.sessions[0];
    assert.equal(session.role, 'Architect');
    assert.equal(session.phase, 'spec');
    assert.equal(session.tasks, '1/2');
    assert.ok(Number.isFinite(session.durationMs) && session.durationMs >= 0, 'duration computed from pending marker');
    assert.equal(session.totalTokens, 15000, 'total defaults to input + output');
    assert.equal(metrics.spend.totalTokens, 15000);
    assert.equal(metrics.spend.costUsd, 0.42);
    assert.equal(metrics.phases.spec.sessions, 1);
    assert.deepEqual(metrics.phases.spec.agents, ['Architect']);
    assert.deepEqual(metrics.phases.spec.models, ['claude-sonnet']);
    assert.equal(metrics.totals.sessions, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist without spend keeps metrics null-honest and --no-metrics skips recording', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-null-'));
  try {
    runInit(dir, '--profile generic --name MetricsNull --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);

    cliExec(dir, 'handoff add-thing --no-metrics');
    assert.ok(!existsSync(join(changeDir, 'metrics.json')), '--no-metrics must not create metrics.json');

    cliExec(dir, 'handoff add-thing');
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions.length, 1);
    assert.equal(metrics.sessions[0].durationMs, null, 'no restore marker → duration stays null');
    assert.equal(metrics.sessions[0].totalTokens, null);
    assert.equal(metrics.spend.totalTokens, null, 'unreported spend stays null, never 0');
    assert.equal(metrics.spend.costUsd, null);
    assert.equal(metrics.phases.spec.durationMs, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist and restore do not create .cursor/hooks.json; update installs four events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-spend-hook-'));
  try {
    runInit(dir, '--profile generic --name SpendHook --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);

    rmSync(join(dir, '.cursor/hooks.json'), { force: true });

    cliExec(dir, 'handoff add-thing --restore');
    assert.ok(!existsSync(join(dir, '.cursor/hooks.json')), 'restore must not create hooks.json');

    const persist = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(persist.status, 0);
    assert.match(persist.stdout, /^\/opsx:/m, 'stdout stays a clean next-thread prompt');
    assert.doesNotMatch(`${persist.stdout}\n${persist.stderr}`, /spend hook/i);
    assert.ok(!existsSync(join(dir, '.cursor/hooks.json')), 'persist must not create hooks.json');

    cliExec(dir, 'update');
    assert.ok(existsSync(join(dir, '.cursor/hooks.json')), 'update installs hooks.json');
    const hooksConfig = JSON.parse(readFileSync(join(dir, '.cursor/hooks.json'), 'utf-8'));
    for (const event of ['stop', 'subagentStop', 'afterAgentResponse']) {
      assert.ok(
        (hooksConfig.hooks[event] || []).some((entry) => String(entry.command || '').includes('cursor-spend-hook.cjs')),
        `hooks.json registers ${event}`,
      );
    }
    assert.ok(
      (hooksConfig.hooks.sessionEnd || []).some((entry) => String(entry.command || '').includes('cursor-spend-collect.cjs')),
      'hooks.json registers sessionEnd collect',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('next persist collects hook rows written after the previous persist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-spend-window-'));
  try {
    runInit(dir, '--profile generic --name SpendWindow --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);

    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6 --collect');
    const first = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(first.sessions.length, 1);
    const endedAt = first.sessions[0].endedAt;
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({ id: 'late-after-persist', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 800, outputTokens: 40, at: endedAt })}\n`,
    );

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --restore');
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6 --collect');

    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions.length, 2);
    assert.ok(
      metrics.sessions[0].sources.some((src) => src.id === 'late-after-persist'),
      'late hook row at previous endedAt leftover-attaches to the first session',
    );
    assert.equal(
      metrics.sessions[1].sources.some((src) => src.id === 'late-after-persist'),
      false,
      'late hook row at previous endedAt must not land on the next session',
    );
    assert.equal(metrics.spendByPlatform.cursor.source, 'cursor-hook');
    assert.equal(metrics.spendByPlatform.cursor.totalTokens, 840);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('metrics --collect backfills the last session without adding another session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-spend-collect-'));
  try {
    runInit(dir, '--profile generic --name SpendCollect --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6');

    const before = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const at = before.sessions[0].endedAt || before.sessions[0].startedAt || before.createdAt;
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({ id: 'backfill-1', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 300, outputTokens: 15, at })}\n`,
    );

    const out = cliExec(dir, 'metrics add-thing --collect');
    assert.match(out, /collect: 1 new source/);

    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions.length, 1);
    assert.ok(metrics.sessions[0].sources.some((src) => src.id === 'backfill-1'));
    assert.equal(metrics.sessions[0].totalTokens, 315);
    assert.equal(metrics.spendByPlatform.cursor.source, 'cursor-hook');

    const again = cliExec(dir, 'metrics add-thing --collect');
    assert.match(again, /collect: 0 new source/);
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist infers model from Amp sources and --collect backfills leftover Amp usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-amp-infer-'));
  try {
    runInit(dir, '--profile generic --name AmpInfer --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    const threadsDir = join(dir, '.aok-amp', 'threads');
    mkdirSync(threadsDir, { recursive: true });
    writeFileSync(join(threadsDir, 'T-live.json'), JSON.stringify({
      id: 'T-live',
      env: { initial: { cwd: dir } },
      messages: [{
        messageId: 'amp-live',
        usage: {
          inputTokens: 40,
          outputTokens: 6,
          model: 'amp-sonnet',
          timestamp: '2026-08-29T12:00:00.000Z',
        },
      }],
    }));

    cliExec(dir, 'handoff add-thing --started-at 2026-08-29T11:00:00Z --collect', { AMP_CURRENT_THREAD: 'T-live' });
    const afterPersist = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(afterPersist.sessions.length, 1);
    assert.equal(afterPersist.sessions[0].model, 'amp-sonnet');
    assert.equal(afterPersist.sessions[0].platform, 'amp');
    assert.ok(afterPersist.sessions[0].sources.some((src) => src.id === 'T-live:amp-live'));
    assert.equal(afterPersist.spendByPlatform.amp.source, 'amp-thread');
    assert.equal(afterPersist.spendByModel[0].model, 'amp-sonnet');

    const leftoverAt = afterPersist.sessions[0].endedAt;
    writeFileSync(join(threadsDir, 'T-live.json'), JSON.stringify({
      id: 'T-live',
      env: { initial: { cwd: dir } },
      messages: [
        {
          messageId: 'amp-live',
          usage: {
            inputTokens: 40,
            outputTokens: 6,
            model: 'amp-sonnet',
            timestamp: afterPersist.sessions[0].endedAt,
          },
        },
        {
          messageId: 'amp-late',
          usage: {
            inputTokens: 12,
            outputTokens: 3,
            model: 'amp-sonnet',
            timestamp: leftoverAt,
          },
        },
      ],
    }));

    const out = cliExec(dir, 'metrics add-thing --collect', { AMP_CURRENT_THREAD: 'T-live' });
    assert.match(out, /collect: 1 new source/);
    const afterCollect = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(afterCollect.sessions.length, 1);
    assert.ok(afterCollect.sessions[0].sources.some((src) => src.id === 'T-live:amp-late'));
    assert.equal(afterCollect.sessions[0].totalTokens, 61);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessionEnd collect script merges leftover hook rows into the last session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-spend-session-end-'));
  try {
    runInit(dir, '--profile generic --name SpendSessionEnd --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6');

    const before = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const startedAt = before.sessions[0].startedAt || before.createdAt;
    const at = new Date(Date.parse(startedAt) + 2000).toISOString();
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({ id: 'session-end-1', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 120, outputTokens: 8, at })}\n`,
    );

    execSync(`node "${join(dir, 'scripts/cursor-spend-collect.cjs')}"`, {
      cwd: dir,
      input: '{}\n',
      encoding: 'utf-8',
      env: isolatedEnv(dir),
    });

    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions.length, 1);
    assert.ok(metrics.sessions[0].sources.some((src) => src.id === 'session-end-1'));
    assert.equal(metrics.sessions[0].totalTokens, 128);
    assert.equal(metrics.sessions[0].costUsdEstimated, 0.0003);
    assert.equal(metrics.sessions[0].spendSource, 'adapter');
    assert.equal(metrics.sessions[0].sources[0].costSource, 'api-estimate');
    assert.equal(metrics.spend.costUsdEstimated, 0.0003);
    assert.equal(metrics.spendByPlatform.cursor.source, 'cursor-hook');
    assert.equal(metrics.spendByPlatform.cursor.costUsdEstimated, 0.0003);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessionEnd collect collapses duplicate stop/afterAgentResponse sources on the last session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-spend-session-end-dedupe-'));
  try {
    runInit(dir, '--profile generic --name SpendSessionEndDedupe --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6');

    const metricsPath = join(changeDir, 'metrics.json');
    const metricsBefore = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    const session = metricsBefore.sessions[0];
    session.sources = [
      {
        id: 'after-1',
        platform: 'cursor',
        model: 'cursor-grok-4.6-xhigh-fast',
        inputTokens: 1000,
        outputTokens: 10,
        totalTokens: 1010,
        cacheReadTokens: 800,
        costUsd: null,
        ampCredits: null,
        at: session.endedAt,
        costUsdEstimated: 0.0018,
        costSource: 'api-estimate',
      },
      {
        id: 'stop-1',
        platform: 'cursor',
        model: 'cursor-grok-4.6-xhigh-fast',
        inputTokens: 1000,
        outputTokens: 10,
        totalTokens: 1010,
        cacheReadTokens: 800,
        costUsd: null,
        ampCredits: null,
        at: session.endedAt,
        costUsdEstimated: 0.0018,
        costSource: 'api-estimate',
      },
    ];
    session.inputTokens = 2000;
    session.outputTokens = 20;
    session.totalTokens = 2020;
    session.costUsdEstimated = 0.0036;
    session.spendSource = 'adapter';
    writeFileSync(metricsPath, `${JSON.stringify(metricsBefore, null, 2)}\n`);

    execSync(`node "${join(dir, 'scripts/cursor-spend-collect.cjs')}"`, {
      cwd: dir,
      input: '{}\n',
      encoding: 'utf-8',
      env: isolatedEnv(dir),
    });

    const metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    assert.equal(metrics.sessions[0].sources.length, 1);
    assert.equal(metrics.sessions[0].inputTokens, 1000);
    assert.equal(metrics.sessions[0].costUsdEstimated, metrics.sessions[0].sources[0].costUsdEstimated);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessionEnd collect does not attach current pending session turns to the last closed session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-spend-pending-window-'));
  try {
    runInit(dir, '--profile generic --name SpendPendingWindow --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6');
    cliExec(dir, 'handoff add-thing --restore');

    const metricsBefore = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const pendingStart = metricsBefore.pending.startedAt;
    const afterPending = new Date(Date.parse(pendingStart) + 2000).toISOString();
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend', 'cursor-usage.jsonl'),
      `${JSON.stringify({
        id: 'current-session-turn',
        event: 'stop',
        model: 'cursor-grok-4.6',
        inputTokens: 900,
        outputTokens: 20,
        at: afterPending,
      })}\n`,
    );

    execSync(`node "${join(dir, 'scripts/cursor-spend-collect.cjs')}"`, {
      cwd: dir,
      input: '{}\n',
      encoding: 'utf-8',
      env: isolatedEnv(dir),
    });

    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions.length, 1);
    assert.equal(
      metrics.sessions[0].sources.some((src) => src.id === 'current-session-turn'),
      false,
      'turns after pending.startedAt belong to the open session, not the last closed one',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('metrics command prints a summary and raw --json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-cmd-'));
  try {
    runInit(dir, '--profile generic --name MetricsCmd --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --started-at 2026-08-29T06:00:00Z --input-tokens 1000 --cost-usd 0.1 --model claude-opus-5');

    const out = cliExec(dir, 'metrics add-thing');
    assert.match(out, /sessions: {2}1/);
    assert.match(out, /spec/);
    assert.match(out, /\$0\.10/);

    const raw = JSON.parse(cliExec(dir, 'metrics add-thing --json'));
    assert.equal(raw.sessions[0].startedAt, '2026-08-29T06:00:00.000Z', '--started-at overrides the marker');
    assert.ok(raw.sessions[0].durationMs > 0);

    assert.throws(
      () => cliExec(dir, 'metrics missing-change'),
      (err) => {
        assert.notEqual(err.status, 0);
        assert.match(`${err.stdout || ''}${err.stderr || ''}`, /No metrics\.json/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist resolves --model / AOK_MODEL and warns when model is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-model-'));
  try {
    runInit(dir, '--profile generic --name MetricsModel --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);

    cliExec(dir, 'handoff add-thing --model claude-opus-5');
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[0].model, 'claude-opus-5');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing', { AOK_MODEL: 'claude-fable-5' });
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[1].model, 'claude-fable-5');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    const missing = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(missing.status, 0);
    const third = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[2];
    assert.equal(third.model, null);
    assert.match(`${missing.stdout || ''}${missing.stderr || ''}`, /model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist resolves --platform / AOK_PLATFORM and infers host env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-platform-'));
  try {
    runInit(dir, '--profile generic --name MetricsPlatform --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);

    cliExec(dir, 'handoff add-thing --platform cursor --model claude-opus-5');
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[0].platform, 'cursor');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model claude-opus-5', { AOK_PLATFORM: 'amp' });
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[1].platform, 'amp');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    const before = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.length;
    const invalid = cliSpawn(dir, ['handoff', 'add-thing', '--platform', 'foo']);
    assert.notEqual(invalid.status, 0);
    const after = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(after.sessions.length, before);
    assert.ok(!after.sessions.some((session) => session.platform === 'foo'));

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model claude-opus-5', { CURSOR_AGENT: '1' });
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.at(-1).platform, 'cursor');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model claude-opus-5', { CLAUDECODE: '1' });
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.at(-1).platform, 'claude');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model claude-opus-5', { AMP_CURRENT_THREAD: 'T-archive' });
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.at(-1).platform, 'amp');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --platform cursor --model claude-opus-5', { AMP_CURRENT_THREAD: 'T-archive' });
    assert.equal(JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.at(-1).platform, 'cursor');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restore locks Amp client and persist collects Amp without host env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-lock-amp-'));
  try {
    runInit(dir, '--profile generic --name LockAmp --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    const restoreOut = cliExec(dir, 'handoff add-thing --restore', { AMP_CURRENT_THREAD: 'T-lock' });
    assert.match(restoreOut, /client amp T-lock/);
    const pending = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).pending;
    assert.equal(pending.platform, 'amp');
    assert.equal(pending.threadId, 'T-lock');

    const threadsDir = join(dir, '.aok-amp', 'threads');
    mkdirSync(threadsDir, { recursive: true });
    writeFileSync(join(threadsDir, 'T-lock.json'), JSON.stringify({
      id: 'T-lock',
      env: { initial: { cwd: dir } },
      messages: [{
        messageId: 'amp-lock',
        usage: {
          inputTokens: 20,
          outputTokens: 4,
          model: 'glm-5p2',
          timestamp: new Date().toISOString(),
        },
      }],
    }));

    cliExec(dir, 'handoff add-thing --model glm-5p2');
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.pending, null);
    assert.equal(metrics.sessions[0].platform, 'amp');
    assert.equal(metrics.sessions[0].threadId, 'T-lock');
    assert.ok(metrics.sessions[0].sources.some((src) => src.id === 'T-lock:amp-lock'));
    assert.equal(metrics.spendByPlatform.amp.totalTokens, 24);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restore locks Cursor client and persist does not ingest Amp disk threads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-lock-cursor-'));
  try {
    runInit(dir, '--profile generic --name LockCursor --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    const threadsDir = join(dir, '.aok-amp', 'threads');
    mkdirSync(threadsDir, { recursive: true });
    writeFileSync(join(threadsDir, 'T-other.json'), JSON.stringify({
      id: 'T-other',
      env: { initial: { cwd: dir } },
      messages: [{
        messageId: 'amp-other',
        usage: {
          inputTokens: 99,
          outputTokens: 1,
          model: 'glm-5p2',
          timestamp: new Date().toISOString(),
        },
      }],
    }));

    cliExec(dir, 'handoff add-thing --restore', { CURSOR_AGENT: '1' });
    const pending = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).pending;
    assert.equal(pending.platform, 'cursor');

    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6');
    const session = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[0];
    assert.equal(session.platform, 'cursor');
    assert.equal((session.sources || []).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('metrics human table prints roles and models columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-roles-'));
  try {
    runInit(dir, '--profile generic --name MetricsRoles --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --model claude-opus-5');
    const out = cliExec(dir, 'metrics add-thing');
    assert.match(out, /models/);
    assert.match(out, /roles/);
    assert.match(out, /claude-opus-5/);
    const specLine = out.split('\n').find((line) => line.startsWith('spec '));
    assert.ok(specLine, 'phase row for spec exists');
    assert.match(specLine, /Architect/);
    assert.match(specLine, /claude-opus-5/);
    assert.ok(specLine.indexOf('Architect') < specLine.indexOf('claude-opus-5'));
    assert.doesNotMatch(out, /phase      sessions  time      tokens    cost      agents/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory-setup rewrites relative MEMORY_FILE_PATH to launcher', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-memory-setup-'));
  try {
    runInit(dir, '--profile generic --name MemorySetup --lang en');
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            memory: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-memory'],
              env: { MEMORY_FILE_PATH: '.cursor/memory.json' },
            },
          },
        },
        null,
        2,
      ),
    );

    execSync(`node "${CLI}" memory-setup`, { cwd: dir, stdio: 'pipe' });

    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    assert.equal(mcp.mcpServers.memory.command, 'node');
    assert.deepEqual(mcp.mcpServers.memory.args, ['scripts/memory-mcp-launcher.cjs']);
    assert.ok(!mcp.mcpServers.memory.env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('english project gets english next-session prompt body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-handoff-en-'));
  try {
    runInit(dir, '--profile generic --name HandoffEn --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    const out = execSync(
      `node "${CLI}" handoff add-thing --closed-role architect --done "specs ready" --next-command "/opsx:review add-thing" --next-role spec-reviewer --spawn spec-reviewer`,
      { cwd: dir, encoding: 'utf-8' },
    );
    assert.match(out, /^\/opsx:review add-thing/m);
    assert.match(out, /You are the conductor/);
    assert.doesNotMatch(out, /Ти — conductor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('always-apply rules stay within a context budget', () => {
  const rulesDir = join(KIT_ROOT, 'templates/.agents/rules');
  let alwaysChars = 0;
  let figmaAlways = true;
  for (const name of readdirSync(rulesDir).filter((f) => f.endsWith('.mdc'))) {
    const text = readFileSync(join(rulesDir, name), 'utf-8');
    const always = /^alwaysApply:\s*true\s*$/m.test(text);
    if (name === 'figma-token-setup.mdc') {
      figmaAlways = always;
    }
    if (always) alwaysChars += text.length;
  }
  assert.equal(figmaAlways, false, 'figma-token-setup must not be alwaysApply');
  assert.ok(
    alwaysChars < 12_000,
    `always-apply rule bodies are ${alwaysChars} chars; keep under 12000`,
  );

  const agents = readFileSync(join(KIT_ROOT, 'templates/AGENTS.md'), 'utf-8');
  assert.ok(agents.length < 4_000, `AGENTS.md is ${agents.length} chars; keep under 4000`);
});

// --- lean-pipeline-v2: archive CLI, task-contract lint, tiered review ---

const OPENSPEC_STUB = `#!/usr/bin/env node
// Deterministic openspec stub for smoke tests (resolved by npx via PATH).
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'status') {
  const i = args.indexOf('--change');
  const name = args[i + 1];
  const changesDir = path.join(process.cwd(), 'openspec', 'changes');
  const changeRoot = path.join(changesDir, name);
  if (!fs.existsSync(changeRoot)) {
    console.error('Change not found: ' + name);
    process.exit(1);
  }
  const tasksPath = path.join(changeRoot, 'tasks.md');
  console.log(JSON.stringify({
    schemaName: 'spec-driven',
    changeRoot,
    planningHome: { changesDir },
    artifactPaths: { tasks: { existingOutputPaths: fs.existsSync(tasksPath) ? [tasksPath] : [] } },
  }));
  process.exit(0);
}
if (args[0] === 'validate') {
  if (fs.existsSync(path.join(process.cwd(), '.openspec-validate-fail'))) {
    console.error('Validation failed (stub)');
    process.exit(1);
  }
  console.log('valid (stub)');
  process.exit(0);
}
process.exit(0);
`;

function installOpenspecStub(dir) {
  // Install as a local package so `npx openspec` resolves it before any
  // real openspec from the registry or npx cache (deterministic, offline).
  const pkgDir = join(dir, 'node_modules', 'openspec');
  const binDir = join(dir, 'node_modules', '.bin');
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'openspec', version: '0.0.0', bin: { openspec: './cli.js' } }));
  writeFileSync(join(pkgDir, 'cli.js'), OPENSPEC_STUB, { mode: 0o755 });
  writeFileSync(join(binDir, 'openspec'), '#!/bin/sh\nexec node "$(dirname "$0")/../openspec/cli.js" "$@"\n', { mode: 0o755 });
  return binDir;
}

function runCliStub(dir, args) {
  return execSync(`node "${CLI}" ${args}`, {
    cwd: dir,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: isolatedEnv(dir),
  });
}

const CONTRACT_TASKS = `# Tasks
- [x] 1.1 Do the thing
  Files: src/thing.js
  Do: implement the thing exactly as specified
  Done-when: thing test passes
`;

const DELTA_SPEC = `## ADDED Requirements

### Requirement: New Req

The system SHALL support the new behavior.

#### Scenario: new works
- WHEN the new path runs
- THEN it succeeds

## MODIFIED Requirements

### Requirement: Old Req

The system SHALL use the updated behavior.

#### Scenario: updated works
- WHEN the old path runs
- THEN it uses the update

## REMOVED Requirements

### Requirement: Dead Req

**Reason**: obsolete
`;

const MAIN_SPEC = `## Purpose

Auth capability.

## Requirements

### Requirement: Old Req

The system SHALL use the original behavior.

#### Scenario: original works
- WHEN the old path runs
- THEN it stays original

### Requirement: Dead Req

The system SHALL do something obsolete.

#### Scenario: obsolete
- WHEN legacy runs
- THEN it is obsolete
`;

function makeArchiveFixture(dir, name, { approve = true, allChecked = true, withDelta = true } = {}) {
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\n## Why\n\nBecause.\n\n## Non-goals\n\n- none\n\n## Acceptance criteria\n\n- works\n');
  writeFileSync(join(changeDir, 'tasks.md'), allChecked ? CONTRACT_TASKS : CONTRACT_TASKS.replace('- [x]', '- [ ]'));
  if (approve) writeFileSync(join(changeDir, 'review.md'), '# Spec Review\n\n**Verdict:** APPROVE\n');
  if (withDelta) {
    mkdirSync(join(changeDir, 'specs/auth'), { recursive: true });
    writeFileSync(join(changeDir, 'specs/auth/spec.md'), DELTA_SPEC);
    mkdirSync(join(changeDir, 'specs/newcap'), { recursive: true });
    writeFileSync(join(changeDir, 'specs/newcap/spec.md'), '## ADDED Requirements\n\n### Requirement: Fresh Req\n\nThe system SHALL be fresh.\n\n#### Scenario: fresh\n- WHEN created\n- THEN fresh\n');
    mkdirSync(join(dir, 'openspec/specs/auth'), { recursive: true });
    writeFileSync(join(dir, 'openspec/specs/auth/spec.md'), MAIN_SPEC);
  }
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/thing.js'), 'export const thing = 1;\n');
  return changeDir;
}

test('archive refuses on an open gate (no APPROVE) with exit != 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-gate-'));
  try {
    runInit(dir, '--profile generic --name ArchiveGate --lang en');
    makeArchiveFixture(dir, 'add-auth', { approve: false });
    installOpenspecStub(dir);
    assert.throws(
      () => runCliStub(dir, 'archive add-auth --sync'),
      (err) => {
        assert.notEqual(err.status, 0);
        assert.match(String(err.stderr), /review gate/);
        return true;
      },
    );
    assert.ok(existsSync(join(dir, 'openspec/changes/add-auth')), 'change must stay in place');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive refuses unchecked tasks and a missing sync decision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-tasks-'));
  try {
    runInit(dir, '--profile generic --name ArchiveTasks --lang en');
    makeArchiveFixture(dir, 'add-auth', { allChecked: false });
    installOpenspecStub(dir);
    assert.throws(
      () => runCliStub(dir, 'archive add-auth --sync'),
      (err) => {
        assert.match(String(err.stderr), /tasks gate failed/);
        return true;
      },
    );
    writeFileSync(join(dir, 'openspec/changes/add-auth/tasks.md'), CONTRACT_TASKS);
    assert.throws(
      () => runCliStub(dir, 'archive add-auth'),
      (err) => {
        assert.match(String(err.stderr), /--sync/);
        return true;
      },
      'delta specs without a sync decision must refuse',
    );
    assert.throws(
      () => runCliStub(dir, 'archive add-auth --no-sync'),
      (err) => {
        assert.match(String(err.stderr), /--force/);
        return true;
      },
      '--no-sync without --force must refuse',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive --sync merges ADDED/MODIFIED/REMOVED and moves the change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-sync-'));
  try {
    runInit(dir, '--profile generic --name ArchiveSync --lang en');
    const changeDir = makeArchiveFixture(dir, 'add-auth');
    writeFileSync(
      join(changeDir, 'metrics.json'),
      JSON.stringify({
        version: 1,
        change: 'add-auth',
        sessions: [{ startedAt: '2026-08-29T06:00:00.000Z', endedAt: '2026-08-29T07:00:00.000Z', durationMs: 3600000, role: 'Implementer', phase: 'apply', runtime: 'local' }],
        pending: { startedAt: '2026-08-29T08:00:00.000Z', role: 'Archiver' },
      }),
    );
    installOpenspecStub(dir);
    const out = runCliStub(dir, 'archive add-auth --sync');
    assert.match(out, /archived add-auth/);

    assert.ok(!existsSync(join(dir, 'openspec/changes/add-auth')), 'change moved out of active changes');
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    assert.ok(entry, 'dated archive folder exists');
    assert.match(entry, /^\d{4}-\d{2}-\d{2}-add-auth$/);
    assert.ok(existsSync(join(archiveRoot, entry, 'handoff.md')), 'final handoff.md written');
    assert.match(readFileSync(join(archiveRoot, entry, 'handoff.md'), 'utf-8'), /## Next command\s*\n+`?none`?/i);

    const archivedMetrics = JSON.parse(readFileSync(join(archiveRoot, entry, 'metrics.json'), 'utf-8'));
    assert.ok(archivedMetrics.archivedAt, 'archive sets archivedAt in metrics.json');
    assert.equal(archivedMetrics.pending, null, 'archive clears the pending marker');
    assert.deepEqual(archivedMetrics.phases.apply.agents, ['Implementer']);
    const implementer = archivedMetrics.sessions.find((session) => session.role === 'Implementer');
    const archiver = archivedMetrics.sessions.find((session) => session.role === 'Archiver');
    assert.ok(implementer, 'existing Implementer session is preserved');
    assert.equal(implementer.phase, 'apply');
    assert.ok(archiver, 'archive appends an Archiver session');
    assert.equal(archiver.phase, 'archive');
    assert.equal(typeof archiver.durationMs, 'number');
    assert.notEqual(archiver.durationMs, null);
    assert.ok(archiver.durationMs > 0, 'Archiver duration is endedAt minus pending.startedAt');
    assert.equal(
      archivedMetrics.totals.durationMs,
      3600000 + archiver.durationMs,
      'aggregates include Implementer plus Archiver duration',
    );

    const mainSpec = readFileSync(join(dir, 'openspec/specs/auth/spec.md'), 'utf-8');
    assert.match(mainSpec, /New Req/, 'ADDED requirement appended');
    assert.match(mainSpec, /SHALL use the updated behavior/, 'MODIFIED requirement replaced');
    assert.doesNotMatch(mainSpec, /SHALL use the original behavior/, 'old body removed by MODIFIED');
    assert.doesNotMatch(mainSpec, /Dead Req/, 'REMOVED requirement deleted');
    assert.ok(existsSync(join(dir, 'openspec/specs/newcap/spec.md')), 'new capability spec created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive without metrics.json creates Archiver session and warns on null USD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-metrics-create-'));
  try {
    runInit(dir, '--profile generic --name ArchiveCreate --lang en');
    makeArchiveFixture(dir, 'add-auth');
    installOpenspecStub(dir);
    const result = cliSpawn(dir, ['archive', 'add-auth', '--sync']);
    assert.equal(result.status, 0);
    const combined = `${result.stdout || ''}${result.stderr || ''}`;
    assert.match(combined, /warning|null|costUsd|USD|spend/i);
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    assert.ok(existsSync(join(archiveRoot, entry, 'metrics.json')));
    const metrics = JSON.parse(readFileSync(join(archiveRoot, entry, 'metrics.json'), 'utf-8'));
    assert.ok(metrics.archivedAt);
    assert.equal(metrics.pending, null);
    const archiver = metrics.sessions.find((session) => session.role === 'Archiver');
    assert.ok(archiver);
    assert.equal(archiver.phase, 'archive');
    assert.equal(typeof archiver.durationMs, 'number');
    assert.notEqual(archiver.durationMs, null);
    assert.equal(archiver.costUsd, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive --platform foo fails before move', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-platform-'));
  try {
    runInit(dir, '--profile generic --name ArchivePlatform --lang en');
    makeArchiveFixture(dir, 'add-auth');
    installOpenspecStub(dir);
    const result = cliSpawn(dir, ['archive', 'add-auth', '--sync', '--platform', 'foo']);
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(join(dir, 'openspec/changes/add-auth')), 'change stays in place');
    assert.ok(!existsSync(join(dir, 'openspec/changes/archive')) || readdirSync(join(dir, 'openspec/changes/archive')).filter((d) => d.endsWith('-add-auth')).length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist Claude fixture fills session totals; flags override; default persist skips adapters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-collect-'));
  try {
    runInit(dir, '--profile generic --name MetricsCollect --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --restore');
    const at = new Date().toISOString();
    writeClaudeJsonl(join(dir, '.aok-home'), dir, [
      {
        type: 'assistant',
        cwd: dir,
        timestamp: at,
        message: {
          id: 'msg-1',
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 10, output_tokens: 5, total_cost_usd: 1.25 },
        },
      },
      {
        type: 'assistant',
        cwd: dir,
        timestamp: at,
        message: {
          id: 'msg-2',
          role: 'assistant',
          model: 'gpt-5.6-sol',
          usage: { input_tokens: 2, output_tokens: 1 },
        },
      },
    ]);

    cliExec(dir, 'handoff add-thing --collect');
    const collected = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(collected.sessions[0].sources.length, 2);
    assert.equal(collected.spendByPlatform.claude.source, 'claude-jsonl');
    const sourceTotal = collected.sessions[0].sources.reduce((sum, src) => sum + src.totalTokens, 0);
    assert.equal(collected.sessions[0].totalTokens, sourceTotal);
    assert.equal(collected.sessions[0].costUsd, 1.25);
    assert.equal(collected.spend.costUsd, 1.25);
    assert.ok(collected.sessions[0].models.includes('claude-opus-4-7'));
    assert.ok(collected.sessions[0].models.includes('gpt-5.6-sol'));
    assert.equal(collected.sessions[0].model, 'claude-opus-4-7');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --restore');
    writeClaudeJsonl(join(dir, '.aok-home'), dir, [
      {
        type: 'assistant',
        cwd: dir,
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg-3',
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 4, output_tokens: 1, total_cost_usd: 0.2 },
        },
      },
    ]);
    cliExec(dir, 'handoff add-thing --cost-usd 9.99 --collect');
    const overridden = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const second = overridden.sessions[1];
    assert.equal(second.costUsd, 9.99);
    assert.ok(second.sources.some((src) => src.id === 'msg-3'));
    assert.equal(overridden.spendByPlatform.claude.source, 'claude-jsonl');
    assert.ok(overridden.sessions.some((session) => session.sources && session.sources.length));

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --restore');
    writeClaudeJsonl(join(dir, '.aok-home'), dir, [
      {
        type: 'assistant',
        cwd: dir,
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg-4',
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 9, output_tokens: 3, total_cost_usd: 0.5 },
        },
      },
    ]);
    cliExec(dir, 'handoff add-thing');
    const skipped = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const last = skipped.sessions.at(-1);
    assert.deepEqual(last.sources, []);
    assert.equal(last.totalTokens, null);

    const unknownFlag = cliSpawn(dir, ['handoff', 'add-thing', '--no-collect']);
    assert.notEqual(unknownFlag.status, 0);
    assert.match(`${unknownFlag.stdout || ''}${unknownFlag.stderr || ''}`, /unknown option|--no-collect/i);

    const human = cliExec(dir, 'metrics add-thing');
    assert.match(human, /by platform/);
    assert.match(human, /by model/);
    assert.doesNotMatch(human, /21\.5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('metrics prints platform and model tables without a unified Amp+USD total', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-tables-'));
  try {
    runInit(dir, '--profile generic --name MetricsTables --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      join(changeDir, 'metrics.json'),
      `${JSON.stringify({
        version: 1,
        change: 'add-thing',
        spend: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: 1.5 },
        spendByPlatform: {
          cursor: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, ampCredits: null, source: 'none' },
          claude: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 1.5, ampCredits: null, source: 'claude-jsonl' },
          amp: { inputTokens: 8, outputTokens: 2, totalTokens: 10, costUsd: null, ampCredits: 20, source: 'amp-thread' },
        },
        spendByModel: [{ model: 'claude-opus-4-7', platform: 'claude', totalTokens: 15, costUsd: 1.5, ampCredits: null }],
        totals: { sessions: 1, durationMs: null, leadTimeMs: null, cloudSessions: 0 },
        phases: { spec: { sessions: 1, durationMs: null, totalTokens: 15, costUsd: 1.5, agents: ['Architect'], models: ['claude-opus-4-7'] } },
        sessions: [{ role: 'Architect', phase: 'spec', model: 'claude-opus-4-7', endedAt: '2026-08-29T07:00:00.000Z', durationMs: null }],
        pending: null,
      }, null, 2)}\n`,
    );
    const out = cliExec(dir, 'metrics add-thing');
    assert.match(out, /platform/);
    assert.match(out, /model/);
    assert.match(out, /\$1\.50/);
    assert.doesNotMatch(out, /21\.5/);
    assert.doesNotMatch(out, /\$21\.50/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive without --collect finalizes without Archiver sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-nocollect-'));
  try {
    runInit(dir, '--profile generic --name ArchiveNoCollect --lang en');
    makeArchiveFixture(dir, 'add-auth');
    writeClaudeJsonl(join(dir, '.aok-home'), dir, [
      {
        type: 'assistant',
        cwd: dir,
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg-arch',
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      },
    ]);
    installOpenspecStub(dir);
    runCliStub(dir, 'archive add-auth --sync');
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    const metrics = JSON.parse(readFileSync(join(archiveRoot, entry, 'metrics.json'), 'utf-8'));
    const archiver = metrics.sessions.find((session) => session.role === 'Archiver');
    assert.ok(archiver);
    assert.deepEqual(archiver.sources, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive collects Cursor hook into the Archiver session without --collect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-cursor-'));
  try {
    runInit(dir, '--profile generic --name ArchiveCursor --lang en');
    const changeDir = makeArchiveFixture(dir, 'add-auth');
    writeFileSync(
      join(changeDir, 'metrics.json'),
      `${JSON.stringify({
        version: 1,
        change: 'add-auth',
        createdAt: '2026-08-29T06:00:00.000Z',
        sessions: [{
          startedAt: '2026-08-29T06:00:00.000Z',
          endedAt: '2026-08-29T07:00:00.000Z',
          durationMs: 3600000,
          role: 'Implementer',
          phase: 'apply',
          runtime: 'local',
          platform: 'cursor',
          model: 'cursor-grok-4.6',
          inputTokens: 1000,
          outputTokens: 40,
          totalTokens: 1040,
          spendSource: 'adapter',
        }],
        pending: null,
      }, null, 2)}\n`,
    );
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({
        id: 'archive-hook-1',
        event: 'stop',
        model: 'cursor-grok-4.6',
        inputTokens: 80,
        outputTokens: 12,
        at: '2026-08-30T12:00:00.000Z',
      })}\n`,
    );
    installOpenspecStub(dir);
    const result = cliSpawn(dir, ['archive', 'add-auth', '--sync'], { CURSOR_AGENT: '1' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    const metrics = JSON.parse(readFileSync(join(archiveRoot, entry, 'metrics.json'), 'utf-8'));
    const implementer = metrics.sessions.find((session) => session.role === 'Implementer');
    const archiver = metrics.sessions.find((session) => session.role === 'Archiver');
    assert.ok(implementer);
    assert.ok(archiver);
    assert.equal(archiver.platform, 'cursor');
    assert.ok(
      implementer.sources.some((src) => src.id === 'archive-hook-1'),
      'hook between Implementer endedAt and archive start leftover-attaches to Implementer',
    );
    assert.equal(
      archiver.sources.some((src) => src.id === 'archive-hook-1'),
      false,
      'hook before archive start must not land on Archiver',
    );
    assert.equal(typeof archiver.durationMs, 'number');
    assert.notEqual(archiver.durationMs, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive collects Cursor hook written after archive start into the Archiver session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-cursor-after-'));
  try {
    runInit(dir, '--profile generic --name ArchiveCursorAfter --lang en');
    const changeDir = makeArchiveFixture(dir, 'add-auth');
    writeFileSync(
      join(changeDir, 'metrics.json'),
      `${JSON.stringify({
        version: 1,
        change: 'add-auth',
        createdAt: '2026-08-29T06:00:00.000Z',
        sessions: [{
          startedAt: '2026-08-29T06:00:00.000Z',
          endedAt: '2026-08-29T07:00:00.000Z',
          durationMs: 3600000,
          role: 'Implementer',
          phase: 'apply',
          runtime: 'local',
          platform: 'cursor',
          model: 'cursor-grok-4.6',
          inputTokens: 1000,
          outputTokens: 40,
          totalTokens: 1040,
          spendSource: 'adapter',
        }],
        pending: {
          startedAt: '2026-08-29T08:00:00.000Z',
          role: 'Archiver',
          platform: 'cursor',
        },
      }, null, 2)}\n`,
    );
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({
        id: 'archive-hook-after-start',
        event: 'stop',
        model: 'cursor-grok-4.6',
        inputTokens: 80,
        outputTokens: 12,
        at: new Date().toISOString(),
      })}\n`,
    );
    installOpenspecStub(dir);
    const result = cliSpawn(dir, ['archive', 'add-auth', '--sync'], { CURSOR_AGENT: '1' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    const metrics = JSON.parse(readFileSync(join(archiveRoot, entry, 'metrics.json'), 'utf-8'));
    const implementer = metrics.sessions.find((session) => session.role === 'Implementer');
    const archiver = metrics.sessions.find((session) => session.role === 'Archiver');
    assert.ok(implementer);
    assert.ok(archiver);
    assert.ok(
      archiver.sources.some((src) => src.id === 'archive-hook-after-start'),
      'hook after archive pending.startedAt must land on Archiver',
    );
    assert.equal(
      (implementer.sources || []).some((src) => src.id === 'archive-hook-after-start'),
      false,
    );
    assert.equal(typeof archiver.durationMs, 'number');
    assert.notEqual(archiver.durationMs, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive ignores leftover apply ## Metrics that would double-count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-stale-metrics-'));
  try {
    runInit(dir, '--profile generic --name ArchiveStale --lang en');
    const changeDir = makeArchiveFixture(dir, 'add-auth');
    writeFileSync(
      join(changeDir, 'handoff.md'),
      handoffWithMetrics({
        platform: 'cursor',
        model: 'cursor-grok-4.6',
        input_tokens: '1000',
        output_tokens: '40',
        cost_usd: 'unknown',
        amp_credits: 'unknown',
        spend_source: 'self-report',
      }),
    );
    writeFileSync(
      join(changeDir, 'metrics.json'),
      `${JSON.stringify({
        version: 1,
        change: 'add-auth',
        createdAt: '2026-08-29T06:00:00.000Z',
        sessions: [{
          startedAt: '2026-08-29T06:00:00.000Z',
          endedAt: '2026-08-29T07:00:00.000Z',
          durationMs: 3600000,
          role: 'Implementer',
          phase: 'apply',
          runtime: 'local',
          platform: 'cursor',
          model: 'cursor-grok-4.6',
          inputTokens: 1000,
          outputTokens: 40,
          totalTokens: 1040,
          spendSource: 'self-report',
        }],
        pending: null,
      }, null, 2)}\n`,
    );
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({
        id: 'archive-hook-stale',
        event: 'stop',
        model: 'cursor-grok-4.6',
        inputTokens: 50,
        outputTokens: 5,
        at: '2026-08-30T12:00:00.000Z',
      })}\n`,
    );
    installOpenspecStub(dir);
    const result = cliSpawn(dir, ['archive', 'add-auth', '--sync'], { CURSOR_AGENT: '1' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    const metrics = JSON.parse(readFileSync(join(archiveRoot, entry, 'metrics.json'), 'utf-8'));
    const implementer = metrics.sessions.find((session) => session.role === 'Implementer');
    const archiver = metrics.sessions.find((session) => session.role === 'Archiver');
    assert.ok(implementer);
    assert.ok(archiver);
    assert.notEqual(archiver.inputTokens, 1000);
    assert.ok(
      implementer.sources.some((src) => src.id === 'archive-hook-stale'),
      'stale apply hook leftover-attaches to Implementer',
    );
    assert.equal(
      archiver.sources.some((src) => src.id === 'archive-hook-stale'),
      false,
      'Archiver must not steal leftover apply hook tokens',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist canonicalizes Closed role sentence to Architect spec phase', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-role-canonical-'));
  try {
    runInit(dir, '--profile generic --name RoleCanonical --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      join(changeDir, 'handoff.md'),
      METRICS_HANDOFF.replace(
        '## Closed role\nArchitect\n',
        '## Closed role\nArchitect — propose complete, ready for Spec Reviewer\n',
      ),
    );
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6');
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const session = metrics.sessions[metrics.sessions.length - 1];
    assert.equal(session.role, 'Architect');
    assert.equal(session.phase, 'spec');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist prefers hook product id over --model family in session and spendByModel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-model-product-'));
  try {
    runInit(dir, '--profile generic --name ModelProduct --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({
        id: 'product-id-1',
        event: 'stop',
        model: 'cursor-grok-4.6-low',
        inputTokens: 10,
        outputTokens: 2,
        at: '2026-08-29T12:00:00.000Z',
      })}\n`,
    );
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6 --collect');
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const session = metrics.sessions[0];
    assert.equal(session.model, 'cursor-grok-4.6-low');
    assert.ok((metrics.spendByModel || []).some((row) => row.model === 'cursor-grok-4.6-low'));
    assert.equal(
      (metrics.spendByModel || []).some((row) => row.model === 'cursor-grok-4.6'),
      false,
      'spendByModel must not add the --model family when sources have a product id',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leftover sources resync placeholder self-report totals to adapter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-leftover-resync-'));
  try {
    runInit(dir, '--profile generic --name LeftoverResync --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      join(changeDir, 'handoff.md'),
      handoffWithMetrics({ spend_source: 'self-report' }),
    );
    cliExec(dir, 'handoff add-thing --model cursor-grok-4.6');
    const before = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const at = before.sessions[0].endedAt;
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${[
        { id: 'leftover-a', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 954984, outputTokens: 0, at },
        { id: 'leftover-b', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 508064, outputTokens: 0, at },
      ].map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    execSync(`node "${join(dir, 'scripts/cursor-spend-collect.cjs')}"`, {
      cwd: dir,
      input: '{}\n',
      encoding: 'utf-8',
      env: isolatedEnv(dir),
    });
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const session = metrics.sessions[0];
    assert.ok(session.sources.some((src) => src.id === 'leftover-a'));
    assert.ok(session.sources.some((src) => src.id === 'leftover-b'));
    assert.equal(session.inputTokens, 1463048);
    assert.equal(session.totalTokens, 1463048);
    assert.equal(session.spendSource, 'adapter');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessionEnd leftover after archive attaches hook to archived metrics.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-session-end-'));
  try {
    runInit(dir, '--profile generic --name ArchiveSessionEnd --lang en');
    makeArchiveFixture(dir, 'add-auth');
    installOpenspecStub(dir);
    const archived = cliSpawn(dir, ['archive', 'add-auth', '--sync'], { CURSOR_AGENT: '1' });
    assert.equal(archived.status, 0, `${archived.stdout}\n${archived.stderr}`);
    assert.ok(!existsSync(join(dir, 'openspec/changes/add-auth')));
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    const metricsPath = join(archiveRoot, entry, 'metrics.json');
    const before = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    const last = before.sessions[before.sessions.length - 1];
    const at = new Date(Date.parse(last.endedAt) + 5000).toISOString();
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${JSON.stringify({
        id: 'archive-session-end-plus5',
        event: 'stop',
        model: 'cursor-grok-4.6',
        inputTokens: 21,
        outputTokens: 3,
        at,
      })}\n`,
    );
    execSync(`node "${join(KIT_ROOT, 'scripts/cursor-spend-collect.cjs')}"`, {
      cwd: dir,
      input: '{}\n',
      encoding: 'utf-8',
      env: isolatedEnv(dir),
    });
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    const lastAfter = metrics.sessions[metrics.sessions.length - 1];
    assert.ok(
      (lastAfter.sources || []).some((src) => src.id === 'archive-session-end-plus5'),
      'sessionEnd leftover must attach +5s hook to archived metrics.json',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessionEnd leftover after empty archive attaches late +35s hook', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-late-35s-'));
  try {
    runInit(dir, '--profile generic --name ArchiveLate35 --lang en');
    makeArchiveFixture(dir, 'add-auth');
    installOpenspecStub(dir);
    const archived = cliSpawn(dir, ['archive', 'add-auth', '--sync'], { CURSOR_AGENT: '1' });
    assert.equal(archived.status, 0, `${archived.stdout}\n${archived.stderr}`);
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    const metricsPath = join(archiveRoot, entry, 'metrics.json');
    const before = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    const archiver = before.sessions.find((session) => session.role === 'Archiver');
    const atMs = Date.parse(archiver.endedAt) + 35000;
    assert.ok(atMs <= Date.parse(archiver.endedAt) + 120000);
    const at = new Date(atMs).toISOString();
    const row = {
      id: 'archive-late-35s',
      event: 'stop',
      model: 'cursor-grok-4.6',
      inputTokens: 33,
      outputTokens: 4,
      at,
    };
    if (archiver.threadId) row.conversationId = archiver.threadId;
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(join(dir, '.agents/spend/cursor-usage.jsonl'), `${JSON.stringify(row)}\n`);
    execSync(`node "${join(KIT_ROOT, 'scripts/cursor-spend-collect.cjs')}"`, {
      cwd: dir,
      input: '{}\n',
      encoding: 'utf-8',
      env: isolatedEnv(dir),
    });
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    const last = metrics.sessions.find((session) => session.role === 'Archiver');
    assert.ok((last.sources || []).some((src) => src.id === 'archive-late-35s'));
    assert.equal(last.spendSource, 'adapter');
    const inputSum = (last.sources || []).reduce((sum, src) => sum + (src.inputTokens ?? 0), 0);
    assert.equal(last.inputTokens, inputSum);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('phase aggregates keep own clock and do not clone totals.leadTimeMs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-phase-clock-'));
  try {
    runInit(dir, '--profile generic --name PhaseClock --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    const specStart = '2026-09-02T16:00:00.000Z';
    const specEnd = '2026-09-02T16:05:00.000Z';
    const reviewStart = '2026-09-02T16:15:00.000Z';
    const reviewEnd = '2026-09-02T16:17:00.000Z';
    writeFileSync(join(changeDir, 'metrics.json'), `${JSON.stringify({
      version: 1,
      change: 'add-thing',
      sessions: [
        {
          startedAt: specStart,
          endedAt: specEnd,
          durationMs: 300000,
          role: 'Architect',
          phase: 'spec',
          platform: 'cursor',
          threadId: null,
          sources: [{ id: 'phase-clock-dummy', platform: 'cursor' }],
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: null,
          costUsdEstimated: null,
          spendSource: 'unreported',
        },
        {
          startedAt: reviewStart,
          endedAt: reviewEnd,
          durationMs: 120000,
          role: 'Spec Reviewer',
          phase: 'review',
          platform: 'cursor',
          threadId: null,
          sources: [],
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: null,
          costUsdEstimated: null,
          spendSource: 'unreported',
        },
      ],
      pending: null,
    }, null, 2)}\n`);
    execSync(`node "${join(KIT_ROOT, 'scripts/cursor-spend-collect.cjs')}"`, {
      cwd: dir,
      input: '{}\n',
      encoding: 'utf-8',
      env: isolatedEnv(dir),
    });
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.phases.spec.startedAt, specStart);
    assert.equal(metrics.phases.spec.endedAt, specEnd);
    assert.equal(metrics.phases.spec.durationMs, 300000);
    assert.equal(metrics.phases.spec.leadTimeMs, Date.parse(specEnd) - Date.parse(specStart));
    assert.equal(metrics.phases.review.startedAt, reviewStart);
    assert.equal(metrics.phases.review.endedAt, reviewEnd);
    assert.equal(metrics.phases.review.durationMs, 120000);
    assert.equal(metrics.phases.review.leadTimeMs, Date.parse(reviewEnd) - Date.parse(reviewStart));
    assert.notEqual(metrics.phases.review.startedAt, metrics.phases.spec.startedAt);
    assert.notEqual(metrics.phases.review.endedAt, metrics.phases.spec.endedAt);
    assert.notEqual(metrics.phases.review.durationMs, metrics.phases.spec.durationMs);
    assert.equal(metrics.totals.leadTimeMs, Date.parse(reviewEnd) - Date.parse(specStart));
    assert.notEqual(metrics.phases.spec.durationMs, metrics.totals.leadTimeMs);
    assert.notEqual(metrics.phases.review.durationMs, metrics.totals.leadTimeMs);
    assert.notEqual(metrics.phases.spec.leadTimeMs, metrics.totals.leadTimeMs);
    const printed = cliExec(dir, 'metrics add-thing');
    assert.match(printed, /spec\s+1\s+5m\b/);
    assert.match(printed, /review\s+1\s+2m\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist without pending uses earliest source.at as startedAt and keeps two sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-earliest-start-'));
  try {
    runInit(dir, '--profile generic --name EarliestStart --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    const t1 = '2026-08-29T10:00:00.000Z';
    const t2 = '2026-08-29T11:00:00.000Z';
    const t3 = '2026-08-29T12:00:00.000Z';
    const t4 = '2026-08-29T13:00:00.000Z';
    mkdirSync(join(dir, '.agents/spend'), { recursive: true });
    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${[
        { id: 'ac6-a', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 10, outputTokens: 1, at: t1 },
        { id: 'ac6-b', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 20, outputTokens: 2, at: t2 },
      ].map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --collect');
    const first = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(first.pending, null);
    assert.equal(first.sessions[0].startedAt, t1);
    assert.equal(first.sessions[0].durationMs, Date.parse(first.sessions[0].endedAt) - Date.parse(t1));

    writeFileSync(
      join(dir, '.agents/spend/cursor-usage.jsonl'),
      `${[
        { id: 'ac6-a', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 10, outputTokens: 1, at: t1 },
        { id: 'ac6-b', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 20, outputTokens: 2, at: t2 },
        { id: 'ac6-c', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 30, outputTokens: 3, at: t3 },
        { id: 'ac6-d', event: 'stop', model: 'cursor-grok-4.6', inputTokens: 40, outputTokens: 4, at: t4 },
      ].map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --collect');
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.sessions.length, 2);
    assert.equal(metrics.sessions[0].startedAt, t1);
    assert.equal(metrics.sessions[0].durationMs, Date.parse(metrics.sessions[0].endedAt) - Date.parse(t1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive unique ## Metrics still fills Archiver self-report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-self-report-'));
  try {
    runInit(dir, '--profile generic --name ArchiveSelf --lang en');
    const changeDir = makeArchiveFixture(dir, 'add-auth');
    writeFileSync(
      join(changeDir, 'handoff.md'),
      handoffWithMetrics({
        platform: 'amp',
        model: 'claude-fable-5',
        input_tokens: '4000',
        output_tokens: '10',
        cost_usd: 'unknown',
        amp_credits: 'unknown',
        spend_source: 'self-report',
      }),
    );
    installOpenspecStub(dir);
    const result = cliSpawn(dir, ['archive', 'add-auth', '--sync']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    const metrics = JSON.parse(readFileSync(join(archiveRoot, entry, 'metrics.json'), 'utf-8'));
    const archiver = metrics.sessions.find((session) => session.role === 'Archiver');
    assert.equal(archiver.platform, 'amp');
    assert.equal(archiver.model, 'claude-fable-5');
    assert.equal(archiver.inputTokens, 4000);
    assert.equal(archiver.spendSource, 'self-report');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive rolls back move and main specs when strict validation fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-rollback-'));
  try {
    runInit(dir, '--profile generic --name ArchiveRollback --lang en');
    makeArchiveFixture(dir, 'add-auth');
    writeFileSync(join(dir, '.openspec-validate-fail'), '1');
    installOpenspecStub(dir);
    assert.throws(
      () => runCliStub(dir, 'archive add-auth --sync'),
      (err) => {
        assert.match(String(err.stderr), /rolled back/);
        return true;
      },
    );
    assert.ok(existsSync(join(dir, 'openspec/changes/add-auth')), 'change restored to original path');
    const archiveRoot = join(dir, 'openspec/changes/archive');
    if (existsSync(archiveRoot)) {
      assert.equal(readdirSync(archiveRoot).filter((d) => d.endsWith('-add-auth')).length, 0, 'no archived copy left');
    }
    assert.equal(readFileSync(join(dir, 'openspec/specs/auth/spec.md'), 'utf-8'), MAIN_SPEC, 'main spec restored to pre-sync content');
    assert.ok(!existsSync(join(dir, 'openspec/specs/newcap')), 'newly created spec file removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check --tasks strict fails on a task without Done-when or with a missing path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-tasks-strict-'));
  try {
    runInit(dir, '--profile generic --name TasksStrict --lang en');
    const orchPath = join(dir, '.agents/orchestrator.yaml');
    writeFileSync(orchPath, readFileSync(orchPath, 'utf-8').replace('task_contract: warn', 'task_contract: strict'));
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });

    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 No done-when\n  Files: new file: src/a.js\n  Do: implement exactly one function\n');
    assert.throws(
      () => runCli(dir, 'gate-check --tasks add-thing'),
      (err) => {
        assert.match(String(err.stderr), /task contract gate failed/);
        assert.match(String(err.stdout), /missing Done-when/);
        return true;
      },
    );

    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 Bad path\n  Files: src/does-not-exist.js\n  Do: implement exactly one function\n  Done-when: tests pass\n');
    assert.throws(
      () => runCli(dir, 'gate-check --tasks add-thing'),
      (err) => {
        assert.match(String(err.stdout), /path does not exist/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check --tasks warn mode exits 0 with a warning for a non-contract task', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-tasks-warn-'));
  try {
    runInit(dir, '--profile generic --name TasksWarn --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 Vague task with no fields\n- [ ] 1.2 Update code as needed\n  Files: new file: src/b.js\n  Do: refactor helpers as needed\n  Done-when: build passes\n');
    const out = runCli(dir, 'gate-check --tasks add-thing');
    assert.match(out, /warn mode, not blocking/);
    assert.match(out, /missing Files/);
    assert.match(out, /vague wording/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check --review returns pass true on a valid fixture and pass false without Non-goals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-review-tier1-'));
  try {
    runInit(dir, '--profile generic --name ReviewTier1 --lang en');
    makeArchiveFixture(dir, 'add-auth');
    installOpenspecStub(dir);

    const ok = JSON.parse(runCliStub(dir, 'gate-check --review add-auth --json'));
    assert.equal(ok.pass, true);
    assert.deepEqual(ok.errors, []);

    writeFileSync(join(dir, 'openspec/changes/add-auth/proposal.md'), '# Proposal\n\n## Why\n\nBecause.\n\n## Acceptance criteria\n\n- works\n');
    assert.throws(
      () => runCliStub(dir, 'gate-check --review add-auth --json'),
      (err) => {
        const report = JSON.parse(String(err.stdout));
        assert.equal(report.pass, false);
        assert.ok(report.errors.some((e) => /Non-goals/.test(e)), 'error names the missing Non-goals section');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init installs the lean archive command and apply/config defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-lean-init-'));
  try {
    runInit(dir, '--profile generic --name LeanInit --lang en');

    const archiveCmd = join(dir, '.agents/commands/opsx-archive.md');
    assert.ok(statSync(archiveCmd).size <= 1536, `opsx-archive.md is ${statSync(archiveCmd).size} bytes; keep <= 1536`);
    const archiveText = readFileSync(archiveCmd, 'utf-8');
    assert.doesNotMatch(archiveText, /spec-archiver/);
    assert.match(archiveText, /agent-orchestrator-kit archive/);

    const applyText = readFileSync(join(dir, '.agents/commands/opsx-apply.md'), 'utf-8');
    assert.doesNotMatch(applyText, /delegation is mandatory/i);
    assert.match(applyText, /apply-notes\.md/);

    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /task_contract:/);
    assert.match(orch, /spawn_handoff_subagent:\s*false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mcpServersOf(dir) {
  return JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8')).mcpServers;
}

function ampServersOf(dir) {
  return JSON.parse(readFileSync(join(dir, '.amp/settings.json'), 'utf-8'))['amp.mcpServers'];
}

function setOrigin(dir, url) {
  try {
    execSync('git remote remove origin', { cwd: dir, stdio: 'pipe' });
  } catch {}
  execSync(`git remote add origin ${url}`, { cwd: dir, stdio: 'pipe' });
}

test('init without --hooks installs the gate script but does not wire hooks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-hooks-off-'));
  try {
    runInit(dir, '--profile generic --name HooksOff --lang en');
    assert.ok(existsSync(join(dir, 'scripts/pre-commit-gate-check.sh')));
    assert.ok(!existsSync(join(dir, '.githooks')));
    assert.ok(!existsSync(join(dir, '.husky')));
    const script = readFileSync(join(dir, 'scripts/pre-commit-gate-check.sh'), 'utf-8');
    assert.match(script, /gate-check --staged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks-setup with husky appends a marked line idempotently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-hooks-husky-'));
  try {
    runInit(dir, '--profile generic --name HooksHusky --lang en');
    initGit(dir);
    mkdirSync(join(dir, '.husky'), { recursive: true });
    writeFileSync(join(dir, '.husky/pre-commit'), '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\necho existing\n');
    const beforeHooksPath = execSync('git config --get core.hooksPath || true', { cwd: dir, encoding: 'utf-8' }).trim();

    const out = runCli(dir, 'hooks-setup');
    assert.match(out, /pre-commit/);
    const first = readFileSync(join(dir, '.husky/pre-commit'), 'utf-8');
    assert.match(first, /echo existing/);
    assert.match(first, /# agent-orchestrator-kit gate/);
    assert.match(first, /scripts\/pre-commit-gate-check\.sh/);
    assert.equal((first.match(/pre-commit-gate-check\.sh/g) || []).length, 1);
    assert.ok(!existsSync(join(dir, '.githooks/pre-commit')));

    runCli(dir, 'hooks-setup');
    const second = readFileSync(join(dir, '.husky/pre-commit'), 'utf-8');
    assert.equal((second.match(/pre-commit-gate-check\.sh/g) || []).length, 1);
    const afterHooksPath = execSync('git config --get core.hooksPath || true', { cwd: dir, encoding: 'utf-8' }).trim();
    assert.equal(afterHooksPath, beforeHooksPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks-setup without husky writes .githooks and sets core.hooksPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-hooks-git-'));
  try {
    runInit(dir, '--profile generic --name HooksGit --lang en');
    initGit(dir);
    runCli(dir, 'hooks-setup');
    assert.ok(existsSync(join(dir, '.githooks/pre-commit')));
    const hook = readFileSync(join(dir, '.githooks/pre-commit'), 'utf-8');
    assert.match(hook, /pre-commit-gate-check\.sh/);
    const mode = statSync(join(dir, '.githooks/pre-commit')).mode;
    assert.ok(mode & 0o111, 'expected .githooks/pre-commit to be executable');
    const hooksPath = execSync('git config --get core.hooksPath', { cwd: dir, encoding: 'utf-8' }).trim();
    assert.equal(hooksPath, '.githooks');
    runCli(dir, 'hooks-setup');
    assert.equal((readFileSync(join(dir, '.githooks/pre-commit'), 'utf-8').match(/pre-commit-gate-check\.sh/g) || []).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks-setup refuses to overwrite a foreign core.hooksPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-hooks-foreign-'));
  try {
    runInit(dir, '--profile generic --name HooksForeign --lang en');
    initGit(dir);
    execSync('git config core.hooksPath .lefthook', { cwd: dir, stdio: 'pipe' });
    assert.throws(
      () => runCli(dir, 'hooks-setup'),
      (err) => {
        assert.match(String(err.stdout || err.stderr || ''), /refusing to overwrite core\.hooksPath/);
        return true;
      },
    );
    assert.ok(!existsSync(join(dir, '.githooks')));
    assert.equal(execSync('git config --get core.hooksPath', { cwd: dir, encoding: 'utf-8' }).trim(), '.lefthook');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check --staged blocks src/ without APPROVE and passes with APPROVE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-staged-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-staged', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateStaged --lang en');
    initGit(dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
    execSync('git add src/index.js openspec/changes/add-thing/tasks.md', { cwd: dir, stdio: 'pipe' });

    assert.throws(() => runCli(dir, 'gate-check --staged'));

    writeFileSync(join(changeDir, 'review.md'), '**Verdict:** APPROVE\n');
    execSync('git add openspec/changes/add-thing/review.md', { cwd: dir, stdio: 'pipe' });
    const out = runCli(dir, 'gate-check --staged');
    assert.match(out, /review gate passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check --staged skips when staged files are outside src/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-staged-nosrc-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-staged-nosrc', scripts: {} }, null, 2));
    runInit(dir, '--profile generic --name GateStagedNoSrc --lang en');
    initGit(dir);
    writeFileSync(join(dir, 'README.md'), '# hello\n');
    execSync('git add README.md', { cwd: dir, stdio: 'pipe' });
    const out = runCli(dir, 'gate-check --staged');
    assert.match(out, /nothing to gate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate-check --staged is a no-op when require_spec_review is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-gate-staged-mvp-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate-staged-mvp', scripts: {} }, null, 2));
    runInit(dir, '--profile mvp --name GateStagedMvp --lang en');
    initGit(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.js'), 'console.log(1);\n');
    execSync('git add src/index.js', { cwd: dir, stdio: 'pipe' });
    const out = runCli(dir, 'gate-check --staged');
    assert.match(out, /review not required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp examples list five servers with matching launcher paths', () => {
  const cursor = JSON.parse(readFileSync(join(KIT_ROOT, 'templates/.agents/mcp.json.example'), 'utf-8'));
  const amp = JSON.parse(readFileSync(join(KIT_ROOT, 'templates/.agents/amp.settings.json.example'), 'utf-8'));
  for (const name of ['memory', 'figma', 'github', 'gitlab', 'browser']) {
    assert.equal(cursor.mcpServers[name].command, 'node');
    assert.deepEqual(cursor.mcpServers[name].args, [`scripts/${name}-mcp-launcher.cjs`]);
    assert.deepEqual(amp['amp.mcpServers'][name].args, cursor.mcpServers[name].args);
  }
  assert.doesNotMatch(JSON.stringify(cursor), /ghp_|glpat-|figd_/);
  assert.doesNotMatch(JSON.stringify(amp), /ghp_|glpat-|figd_/);
});

test('init live MCP configs omit optional github/gitlab/browser until mcp-setup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mcp-init-live-'));
  try {
    runInit(dir, '--profile generic --name McpInitLive --lang en');
    const servers = mcpServersOf(dir);
    assert.ok(servers.memory);
    assert.ok(servers.figma);
    assert.equal(servers.github, undefined);
    assert.equal(servers.gitlab, undefined);
    assert.equal(servers.browser, undefined);
    const lines = gitignoreLines(dir);
    assert.ok(lines.includes('.agents/github.local.env'));
    assert.ok(lines.includes('.agents/gitlab.local.env'));
    const orch = readFileSync(join(dir, '.agents/orchestrator.yaml'), 'utf-8');
    assert.match(orch, /-\s+gitlab/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp-setup with GitHub origin installs github+browser and not gitlab', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mcp-github-'));
  try {
    runInit(dir, '--profile generic --name McpGithub --lang en');
    initGit(dir);
    setOrigin(dir, 'https://github.com/acme/app.git');
    const out = runCli(dir, 'mcp-setup');
    assert.match(out, /VCS MCP: github/);
    assert.doesNotMatch(out, /ghp_/);
    const servers = mcpServersOf(dir);
    const amp = ampServersOf(dir);
    assert.ok(servers.github);
    assert.ok(servers.browser);
    assert.equal(servers.gitlab, undefined);
    assert.ok(amp.github);
    assert.equal(amp.gitlab, undefined);
    assert.ok(existsSync(join(dir, '.agents/github.local.env')));
    assert.ok(!existsSync(join(dir, '.agents/gitlab.local.env')));
    assert.deepEqual(servers.github.args, ['scripts/github-mcp-launcher.cjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp-setup detects ssh GitHub, GitLab.com, self-hosted GitLab, and missing origin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mcp-detect-'));
  try {
    runInit(dir, '--ci github --profile generic --name McpDetect --lang en');
    initGit(dir);

    setOrigin(dir, 'git@github.com:acme/app.git');
    runCli(dir, 'mcp-setup');
    assert.ok(mcpServersOf(dir).github);
    assert.equal(mcpServersOf(dir).gitlab, undefined);

    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: 'node', args: ['scripts/memory-mcp-launcher.cjs'] } } }, null, 2));
    writeFileSync(join(dir, '.amp/settings.json'), JSON.stringify({ 'amp.mcpServers': {} }, null, 2));
    setOrigin(dir, 'https://gitlab.com/group/repo.git');
    runCli(dir, 'mcp-setup');
    assert.ok(mcpServersOf(dir).gitlab);
    assert.equal(mcpServersOf(dir).github, undefined);
    const gitlabComEnv = readFileSync(join(dir, '.agents/gitlab.local.env'), 'utf-8');
    assert.match(gitlabComEnv, /GITLAB_API_URL=https:\/\/gitlab\.com\/api\/v4/);

    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: 'node', args: ['scripts/memory-mcp-launcher.cjs'] } } }, null, 2));
    writeFileSync(join(dir, '.amp/settings.json'), JSON.stringify({ 'amp.mcpServers': {} }, null, 2));
    setOrigin(dir, 'git@gitlab.np.work:group/repo.git');
    const selfOut = runCli(dir, 'mcp-setup');
    assert.match(selfOut, /VCS MCP: gitlab \(gitlab\.np\.work\)/);
    assert.doesNotMatch(selfOut, /git@gitlab/);
    assert.ok(mcpServersOf(dir).gitlab);
    assert.equal(mcpServersOf(dir).github, undefined);
    assert.match(readFileSync(join(dir, '.agents/gitlab.local.env'), 'utf-8'), /GITLAB_API_URL=https:\/\/gitlab\.np\.work\/api\/v4/);

    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: 'node', args: ['scripts/memory-mcp-launcher.cjs'] } } }, null, 2));
    writeFileSync(join(dir, '.amp/settings.json'), JSON.stringify({ 'amp.mcpServers': {} }, null, 2));
    execSync('git remote remove origin', { cwd: dir, stdio: 'pipe' });
    const noneOut = runCli(dir, 'mcp-setup');
    assert.match(noneOut, /skipped \(no origin match\)/);
    assert.equal(mcpServersOf(dir).github, undefined);
    assert.equal(mcpServersOf(dir).gitlab, undefined);
    assert.ok(mcpServersOf(dir).browser);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp-setup --vcs overrides origin and --ci does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mcp-override-'));
  try {
    runInit(dir, '--ci github --profile generic --name McpOverride --lang en');
    initGit(dir);
    setOrigin(dir, 'git@gitlab.company.com:group/repo.git');
    runCli(dir, 'mcp-setup');
    assert.ok(mcpServersOf(dir).gitlab);
    assert.equal(mcpServersOf(dir).github, undefined);

    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: 'node', args: ['scripts/memory-mcp-launcher.cjs'] } } }, null, 2));
    runCli(dir, 'mcp-setup --vcs github --no-browser');
    assert.ok(mcpServersOf(dir).github);
    assert.equal(mcpServersOf(dir).gitlab, undefined);
    assert.equal(mcpServersOf(dir).browser, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('status prints MCP health without token values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mcp-status-'));
  try {
    runInit(dir, '--profile generic --name McpStatus --lang en');
    initGit(dir);
    setOrigin(dir, 'https://github.com/acme/app.git');
    writeFileSync(join(dir, '.agents/figma.local.env'), 'FIGMA_ACCESS_TOKEN=figd_secret_value\n');
    const out = runCli(dir, 'status');
    assert.match(out, /MCP health/);
    assert.match(out, /memory/);
    assert.match(out, /figma/);
    assert.match(out, /github/);
    assert.match(out, /gitlab\s+skipped \(no origin match\)/);
    assert.match(out, /browser/);
    assert.doesNotMatch(out, /figd_secret_value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('github and gitlab launchers fail without a token and never print secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mcp-launchers-'));
  try {
    runInit(dir, '--profile generic --name McpLaunchers --lang en');
    let failed = false;
    try {
      execSync(`node "${join(dir, 'scripts/github-mcp-launcher.cjs')}"`, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
    } catch (error) {
      failed = true;
      const out = `${error.stdout || ''}${error.stderr || ''}`;
      assert.match(out, /github\.local\.env/);
      assert.doesNotMatch(out, /ghp_/);
    }
    assert.ok(failed, 'github launcher should exit non-zero without env');

    failed = false;
    writeFileSync(join(dir, '.agents/github.local.env'), 'GITHUB_PERSONAL_ACCESS_TOKEN=\n');
    try {
      execSync(`node "${join(dir, 'scripts/github-mcp-launcher.cjs')}"`, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
    } catch (error) {
      failed = true;
      const out = `${error.stdout || ''}${error.stderr || ''}`;
      assert.match(out, /empty/);
      assert.doesNotMatch(out, /ghp_secret_value/);
    }
    assert.ok(failed, 'github launcher should exit non-zero with empty token');

    failed = false;
    try {
      execSync(`node "${join(dir, 'scripts/gitlab-mcp-launcher.cjs')}"`, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
    } catch (error) {
      failed = true;
      const out = `${error.stdout || ''}${error.stderr || ''}`;
      assert.match(out, /gitlab\.local\.env/);
      assert.doesNotMatch(out, /glpat-/);
    }
    assert.ok(failed, 'gitlab launcher should exit non-zero without env');

    const browser = readFileSync(join(dir, 'scripts/browser-mcp-launcher.cjs'), 'utf-8');
    assert.match(browser, /@playwright\/mcp/);
    assert.doesNotMatch(browser, /local\.env/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update installs new MCP launchers, hook script, and env gitignore lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mcp-update-'));
  try {
    runInit(dir, '--profile generic --name McpUpdate --lang en');
    rmSync(join(dir, 'scripts/github-mcp-launcher.cjs'), { force: true });
    rmSync(join(dir, 'scripts/pre-commit-gate-check.sh'), { force: true });
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });
    assert.ok(existsSync(join(dir, 'scripts/github-mcp-launcher.cjs')));
    assert.ok(existsSync(join(dir, 'scripts/gitlab-mcp-launcher.cjs')));
    assert.ok(existsSync(join(dir, 'scripts/browser-mcp-launcher.cjs')));
    assert.ok(existsSync(join(dir, 'scripts/pre-commit-gate-check.sh')));
    assert.ok(existsSync(join(dir, '.agents/github.local.env.example')));
    const lines = gitignoreLines(dir);
    assert.ok(lines.includes('.agents/github.local.env'));
    assert.ok(lines.includes('.agents/gitlab.local.env'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function localIsoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseSkillsInventoryFixture(content) {
  const kit = [];
  const stack = [];
  let external = '';
  let found = false;
  let inSkills = false;
  let section = null;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (/^skills:\s*$/.test(line)) {
      found = true;
      inSkills = true;
      section = null;
      continue;
    }
    if (inSkills && /^\S/.test(line)) break;
    if (!inSkills) continue;
    if (/^\s+kit:\s*$/.test(line) || /^\s+kit:\s*\[\s*\]\s*$/.test(line)) {
      section = 'kit';
      continue;
    }
    if (/^\s+stack:\s*$/.test(line) || /^\s+stack:\s*\[\s*\]\s*$/.test(line)) {
      section = 'stack';
      continue;
    }
    const ext = line.match(/^\s+external:\s*(.*?)\s*$/);
    if (ext) {
      section = null;
      let raw = ext[1];
      if (
        (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
        (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
      ) {
        raw = raw.slice(1, -1);
      }
      external = raw;
      continue;
    }
    const item = line.match(/^\s+-\s+([A-Za-z0-9_-]+)\s*$/);
    if (item && section === 'kit') kit.push(item[1]);
    else if (item && section === 'stack') stack.push(item[1]);
  }
  return { kit, stack, external, found };
}

function stripSkillsSection(yaml) {
  const out = [];
  let skip = false;
  for (const line of yaml.split('\n')) {
    if (/^skills:\s*$/.test(line)) {
      skip = true;
      continue;
    }
    if (skip) {
      if (line === '' || /^\s/.test(line) || line.startsWith('#')) continue;
      skip = false;
    }
    out.push(line);
  }
  return out.join('\n');
}

function writeHandoffFixture(changeDir, name, decisions) {
  writeFileSync(
    join(changeDir, 'handoff.md'),
    `# Session Handoff

## Closed role
Architect — validate --strict passed

## Done
- Created proposal, design, specs, and tasks.

## Decisions
${decisions}

## Blocked
none

## Next command
\`/opsx:review ${name}\`

## Next role
spec-reviewer

## Attach
- \`openspec/changes/${name}/\`

## Subagents to spawn
- \`spec-reviewer\`

## Constraints
- no src edits
`,
  );
}

function memoryEntities(dir) {
  const raw = readFileSync(join(dir, '.cursor/memory.json'), 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function setHandoffDecisions(handoffPath, decisions) {
  const body = readFileSync(handoffPath, 'utf-8');
  const next = body.replace(/## Decisions\n[\s\S]*?\n## Blocked/, `## Decisions\n${decisions}\n\n## Blocked`);
  writeFileSync(handoffPath, next);
}

test('handoff persist appends decisions.md without duplicates and keeps topic history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-decisions-append-'));
  try {
    runInit(dir, '--profile generic --name DecisionsAppend --lang en');
    const name = 'add-bulk-export';
    const changeDir = join(dir, 'openspec/changes', name);
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] 1.1 pending\n');
    writeHandoffFixture(changeDir, name, '- foo-topic: variant A');

    cliExec(dir, `handoff ${name}`);
    const decisionsPath = join(changeDir, 'decisions.md');
    assert.ok(existsSync(decisionsPath));
    const first = readFileSync(decisionsPath, 'utf-8');
    assert.match(first, new RegExp(`# Decisions — ${name}`));
    assert.match(first, /append-only/);
    assert.match(first, new RegExp(`- ${localIsoDate()} foo-topic: variant A`));

    cliExec(dir, `handoff ${name}`);
    assert.equal(readFileSync(decisionsPath, 'utf-8'), first);

    setHandoffDecisions(join(changeDir, 'handoff.md'), '- foo-topic: variant B');
    cliExec(dir, `handoff ${name}`);
    const second = readFileSync(decisionsPath, 'utf-8');
    assert.match(second, /foo-topic: variant A/);
    assert.match(second, /foo-topic: variant B/);
    assert.equal(second.split('foo-topic: variant A').length - 1, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist does not create decisions.md when Decisions is none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-decisions-none-'));
  try {
    runInit(dir, '--profile generic --name DecisionsNone --lang en');
    const name = 'add-thing';
    const changeDir = join(dir, 'openspec/changes', name);
    mkdirSync(changeDir, { recursive: true });
    writeHandoffFixture(changeDir, name, 'none');
    cliExec(dir, `handoff ${name}`);
    assert.ok(!existsSync(join(changeDir, 'decisions.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persistMemoryFromHandoff mirrors Decision:* from decisions.md last topic wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-decisions-mirror-'));
  try {
    runInit(dir, '--profile generic --name DecisionsMirror --lang en');
    const name = 'add-bulk-export';
    const changeDir = join(dir, 'openspec/changes', name);
    mkdirSync(changeDir, { recursive: true });
    writeHandoffFixture(changeDir, name, '- foo-topic: variant A');
    cliExec(dir, `handoff ${name}`);
    setHandoffDecisions(join(changeDir, 'handoff.md'), '- foo-topic: variant B');
    cliExec(dir, `handoff ${name}`);

    const entities = memoryEntities(dir);
    const decision = entities.find((item) => item.name === 'Decision:foo-topic');
    assert.ok(decision);
    assert.match(decision.observations.join('\n'), /variant B/);
    assert.doesNotMatch(decision.observations.join('\n'), /variant A/);
    assert.ok(entities.find((item) => item.name === `Change:${name}`));
    assert.ok(entities.find((item) => item.name === `Handoff:${name}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff --restore prints decisions.md or decisions: none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-decisions-restore-'));
  try {
    runInit(dir, '--profile generic --name DecisionsRestore --lang en');
    const missing = 'add-thing';
    const missingDir = join(dir, 'openspec/changes', missing);
    mkdirSync(missingDir, { recursive: true });
    writeHandoffFixture(missingDir, missing, 'none');
    cliExec(dir, `handoff ${missing}`);
    const noneOut = execSync(`node "${CLI}" handoff ${missing} --restore`, {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.match(noneOut, /decisions: none/);
    assert.equal(noneOut.includes('Memory entities') || noneOut.includes('Memory JSON'), true);

    const name = 'add-bulk-export';
    const changeDir = join(dir, 'openspec/changes', name);
    mkdirSync(changeDir, { recursive: true });
    writeHandoffFixture(changeDir, name, '- export-format: xlsx — matches existing reports');
    cliExec(dir, `handoff ${name}`);
    const restored = execSync(`node "${CLI}" handoff ${name} --restore`, {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.match(restored, /decisions\.md:/);
    assert.match(restored, /export-format: xlsx/);
    assert.doesNotMatch(restored, /decisions: none/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSkillsInventory parses a full skills section and falls back without one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-skills-parse-'));
  try {
    runInit(dir, '--profile vue3 --name SkillsParse --lang en');
    const orchPath = join(dir, '.agents/orchestrator.yaml');
    let orch = readFileSync(orchPath, 'utf-8');
    const parsed = parseSkillsInventoryFixture(orch);
    assert.equal(parsed.found, true);
    assert.ok(parsed.kit.includes('agent-orchestration'));
    assert.deepEqual(parsed.stack, ['vue-core', 'vue-pinia', 'vue-axios', 'vue-router']);
    assert.equal(parsed.external, 'frontend-agent-skills');
    assert.doesNotMatch(orch, /notes:\s*"Use vue-core/);

    orch = orch.replace(/^(\s+kit:\s*)$/m, '$1\n    - sentinel-kit-skill');
    writeFileSync(orchPath, orch);
    const withSentinel = execSync(`node "${CLI}" status`, { cwd: dir, encoding: 'utf-8' });
    assert.match(withSentinel, /sentinel-kit-skill/);
    assert.match(withSentinel, /vue-core\s+missing/);
    assert.match(withSentinel, /npx frontend-agent-skills install --agent all --yes/);

    writeFileSync(orchPath, stripSkillsSection(readFileSync(orchPath, 'utf-8')));
    const fallback = execSync(`node "${CLI}" status`, { cwd: dir, encoding: 'utf-8' });
    assert.doesNotMatch(fallback, /sentinel-kit-skill/);
    assert.doesNotMatch(fallback, /vue-core/);
    assert.match(fallback, /agent-orchestration/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills.kit in template and profiles matches templates/.agents/skills/', () => {
  const skillsDir = join(KIT_ROOT, 'templates/.agents/skills');
  const dirs = readdirSync(skillsDir)
    .filter((name) => {
      if (name.startsWith('subagent-')) return false;
      return statSync(join(skillsDir, name)).isDirectory();
    })
    .sort();
  const yamlFiles = [
    'templates/orchestrator.yaml',
    'profiles/generic/orchestrator.yaml',
    'profiles/vue3/orchestrator.yaml',
    'profiles/node/orchestrator.yaml',
    'profiles/mvp/orchestrator.yaml',
  ];
  for (const rel of yamlFiles) {
    const parsed = parseSkillsInventoryFixture(readFileSync(join(KIT_ROOT, rel), 'utf-8'));
    assert.equal(parsed.found, true, `${rel} missing skills:`);
    assert.deepEqual([...parsed.kit].sort(), dirs, `${rel} skills.kit drifted from templates/.agents/skills/`);
  }
});

test('status Skill health reports missing and stale without failing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-skill-health-'));
  try {
    runInit(dir, '--profile generic --name SkillHealth --lang en');
    execSync(`node "${CLI}" sync`, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });

    let out = execSync(`node "${CLI}" status`, { cwd: dir, encoding: 'utf-8' });
    assert.match(out, /Skill health/);
    assert.match(out, /openspec-howto\s+ok/);
    assert.match(out, /subagent wrappers: ok \(/);

    rmSync(join(dir, '.cursor/skills/openspec-howto'), { recursive: true, force: true });
    out = execSync(`node "${CLI}" status`, { cwd: dir, encoding: 'utf-8' });
    assert.match(out, /openspec-howto\s+stale/);

    rmSync(join(dir, '.agents/skills/openspec-howto'), { recursive: true, force: true });
    out = execSync(`node "${CLI}" status`, { cwd: dir, encoding: 'utf-8' });
    assert.match(out, /openspec-howto\s+missing/);
    assert.doesNotMatch(out, /npx frontend-agent-skills install/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init and update still ship the eight kit skills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-kit-skills-'));
  try {
    runInit(dir, '--profile generic --name KitSkills --lang en');
    const expected = [
      'agent-orchestration',
      'openspec-howto',
      'openspec-explore',
      'openspec-propose',
      'openspec-apply-change',
      'openspec-archive-change',
      'openspec-sync-specs',
      'spec-workflow-openspec',
    ];
    for (const name of expected) {
      assert.ok(existsSync(join(dir, `.agents/skills/${name}/SKILL.md`)), `init missing ${name}`);
    }
    rmSync(join(dir, '.agents/skills/openspec-sync-specs'), { recursive: true, force: true });
    execSync(`node "${CLI}" update`, { cwd: dir, stdio: 'pipe' });
    assert.ok(existsSync(join(dir, '.agents/skills/openspec-sync-specs/SKILL.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function cliEnv(extra = {}) {
  const env = { ...process.env };
  delete env.AOK_RUNTIME;
  delete env.AOK_AGENT_ID;
  delete env.CURSOR_BACKGROUND_AGENT;
  return { ...env, ...extra };
}

function runSpawn(dir, args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: cliEnv(extraEnv),
  });
}

function prepareHandoffChange(dir, name = 'add-thing') {
  runInit(dir, '--profile generic --name Phase3 --lang en');
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(changeDir, { recursive: true });
  writeHandoffFixture(changeDir, name, 'none');
  return changeDir;
}

function addBareUpstream(dir) {
  const remoteDir = mkdtempSync(join(tmpdir(), 'aok-bare-'));
  execSync('git init --bare -q', { cwd: remoteDir });
  execSync(`git remote add origin "${remoteDir}"`, { cwd: dir });
  execSync('git push -q -u origin HEAD', { cwd: dir });
  return remoteDir;
}

test('handoff persist writes Runtime local/none by default and repairs legacy files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-runtime-default-'));
  try {
    const changeDir = prepareHandoffChange(dir);
    const before = readFileSync(join(changeDir, 'handoff.md'), 'utf-8');
    assert.doesNotMatch(before, /## Runtime/);

    const result = runSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(result.status, 0, result.stderr);
    const after = readFileSync(join(changeDir, 'handoff.md'), 'utf-8');
    assert.match(after, /## Runtime/);
    assert.match(after, /runtime: local/);
    assert.match(after, /agent_id: none/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist honors --runtime, AOK_RUNTIME, and rejects invalid runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-runtime-flag-'));
  try {
    const changeDir = prepareHandoffChange(dir, 'add-thing');
    let result = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'cloud']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(changeDir, 'handoff.md'), 'utf-8'), /runtime: cloud/);

    writeHandoffFixture(changeDir, 'add-thing', 'none');
    result = runSpawn(dir, ['handoff', 'add-thing'], { AOK_RUNTIME: 'cloud' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(changeDir, 'handoff.md'), 'utf-8'), /runtime: cloud/);

    result = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'foo']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /invalid --runtime/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist with --runtime cloud prints next steps on stderr and keeps stdout as the prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-runtime-stderr-'));
  try {
    prepareHandoffChange(dir);
    const result = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'cloud']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\/opsx:review add-thing/m);
    assert.match(result.stderr, /git add openspec\/changes\/add-thing\//);
    assert.match(result.stderr, /git commit/);
    assert.match(result.stderr, /git push/);
    assert.match(result.stderr, /handoff add-thing --cloud-check/);
    assert.doesNotMatch(result.stdout, /git add openspec\/changes\/add-thing\//);

    const local = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'local']);
    assert.equal(local.status, 0, local.stderr);
    assert.doesNotMatch(local.stderr, /--cloud-check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff --cloud-check fails on dirty change artifacts when runtime is cloud', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-cloud-dirty-'));
  try {
    const changeDir = prepareHandoffChange(dir);
    initGit(dir);
    writeFileSync(join(changeDir, 'extra.md'), 'untracked\n');
    const result = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'cloud', '--cloud-check']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /extra\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff --cloud-check fails without upstream when runtime is cloud', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-cloud-unpushed-'));
  try {
    prepareHandoffChange(dir);
    initGit(dir);
    const result = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'cloud', '--cloud-check']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /git push -u origin HEAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff --cloud-check passes when cloud artifacts are committed and pushed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-cloud-clean-'));
  let remoteDir;
  try {
    prepareHandoffChange(dir);
    initGit(dir);
    remoteDir = addBareUpstream(dir);
    const result = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'cloud', '--cloud-check']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /cloud-check passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
  }
});

test('handoff --cloud-check warns and exits 0 on dirty local runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-local-dirty-'));
  try {
    const changeDir = prepareHandoffChange(dir);
    initGit(dir);
    writeFileSync(join(changeDir, 'extra.md'), 'untracked\n');
    const result = runSpawn(dir, ['handoff', 'add-thing', '--runtime', 'local', '--cloud-check']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /extra\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive writes Runtime into the final handoff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-archive-runtime-'));
  try {
    runInit(dir, '--profile generic --name ArchiveRuntime --lang en');
    const changeDir = makeArchiveFixture(dir, 'add-auth');
    writeHandoffFixture(changeDir, 'add-auth', 'none');
    const handoffPath = join(changeDir, 'handoff.md');
    writeFileSync(
      handoffPath,
      `${readFileSync(handoffPath, 'utf-8').trimEnd()}\n\n## Runtime\n- runtime: cloud\n- agent_id: archive-agent\n`,
    );
    installOpenspecStub(dir);
    const result = runSpawn(dir, ['archive', 'add-auth', '--sync']);
    assert.equal(result.status, 0, result.stderr);
    const archiveRoot = join(dir, 'openspec/changes/archive');
    const entry = readdirSync(archiveRoot).find((d) => d.endsWith('-add-auth'));
    assert.ok(entry, 'dated archive folder exists');
    const finalHandoff = readFileSync(join(archiveRoot, entry, 'handoff.md'), 'utf-8');
    assert.match(finalHandoff, /## Runtime/);
    assert.match(finalHandoff, /runtime: cloud/);
    assert.match(finalHandoff, /agent_id: archive-agent/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseMetricsSection normalizes values and persist sums totalTokens without a section key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-parse-'));
  try {
    runInit(dir, '--profile generic --name MetricsParse --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'handoff.md'), handoffWithMetrics({
      platform: 'cursor',
      model: 'unknown',
      input_tokens: '128,000',
      output_tokens: '9400',
      cost_usd: '$1.25',
      amp_credits: 'none',
      spend_source: 'self-report',
    }).replace('- spend_source: self-report', '- spend_source: self-report\n- duration_ms: 999'));

    const result = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(result.status, 0);
    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const session = metrics.sessions[0];
    assert.equal(session.inputTokens, 128000);
    assert.equal(session.outputTokens, 9400);
    assert.equal(session.totalTokens, 137400);
    assert.equal(session.costUsd, 1.25);
    assert.equal(session.model, null);
    assert.equal(session.spendSource, 'self-report');
    assert.ok(!Object.prototype.hasOwnProperty.call(session, 'durationMs') || session.durationMs !== 999);

    writeFileSync(join(changeDir, 'handoff.md'), handoffWithMetrics({ platform: 'chatgpt', model: 'claude-opus-5' }));
    const invalid = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(invalid.status, 0);
    const second = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[1];
    assert.equal(second.platform, null);
    assert.match(`${invalid.stderr || ''}`, /invalid platform|chatgpt/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist resolve chains: flags beat self-report; self-report beats env; empty is unreported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-chain-'));
  try {
    runInit(dir, '--profile generic --name MetricsChain --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });

    writeFileSync(join(changeDir, 'handoff.md'), handoffWithMetrics({
      platform: 'cursor',
      model: 'claude-opus-5',
      input_tokens: '100',
      output_tokens: '50',
      cost_usd: '0.10',
    }));
    cliExec(dir, 'handoff add-thing --input-tokens 7 --output-tokens 2 --cost-usd 9.99 --model cursor-grok-4.6');
    const flagged = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[0];
    assert.equal(flagged.inputTokens, 7);
    assert.equal(flagged.outputTokens, 2);
    assert.equal(flagged.costUsd, 9.99);
    assert.equal(flagged.model, 'cursor-grok-4.6');
    assert.equal(flagged.spendSource, 'flag');
    const afterFlag = readFileSync(join(changeDir, 'handoff.md'), 'utf-8');
    assert.match(afterFlag, /input_tokens: 100/);
    assert.doesNotMatch(afterFlag, /input_tokens: 7/);

    writeFileSync(join(changeDir, 'handoff.md'), handoffWithMetrics({
      platform: 'amp',
      model: 'claude-opus-5',
      input_tokens: '40',
      output_tokens: '6',
      spend_source: 'self-report',
    }));
    cliExec(dir, 'handoff add-thing', { AOK_MODEL: 'gpt-5.6-sol', AOK_PLATFORM: 'cursor', CURSOR_AGENT: '1' });
    const self = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[1];
    assert.equal(self.model, 'claude-opus-5');
    assert.equal(self.platform, 'amp');
    assert.equal(self.inputTokens, 40);
    assert.equal(self.spendSource, 'self-report');

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    const empty = cliSpawn(dir, ['handoff', 'add-thing']);
    assert.equal(empty.status, 0);
    assert.match(empty.stdout, /^\/opsx:/);
    assert.match(empty.stderr, /unreported/);
    const third = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions[2];
    assert.equal(third.spendSource, 'unreported');
    assert.equal(third.totalTokens, null);
    const skeleton = readFileSync(join(changeDir, 'handoff.md'), 'utf-8');
    assert.match(skeleton, /## Metrics/);
    assert.match(skeleton, /input_tokens: unknown/);

    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing --restore');
    writeClaudeJsonl(join(dir, '.aok-home'), dir, [
      {
        type: 'assistant',
        cwd: dir,
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg-skip',
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 9, output_tokens: 3 },
        },
      },
    ]);
    cliExec(dir, 'handoff add-thing');
    const skipped = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.at(-1);
    assert.deepEqual(skipped.sources, []);

    writeFileSync(join(changeDir, 'handoff.md'), handoffWithMetrics({
      platform: 'claude',
      model: 'claude-opus-5',
      input_tokens: '1000',
      output_tokens: '0',
      spend_source: 'self-report',
    }));
    cliExec(dir, 'handoff add-thing --restore');
    writeClaudeJsonl(join(dir, '.aok-home'), dir, [
      {
        type: 'assistant',
        cwd: dir,
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg-keep',
          role: 'assistant',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      },
    ]);
    cliExec(dir, 'handoff add-thing --collect --model cursor-grok-4.6');
    const collected = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8')).sessions.at(-1);
    assert.ok(collected.sources.length >= 1);
    assert.equal(collected.inputTokens, 1000);
    assert.equal(collected.model, 'claude-opus-4-7');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spendByPlatform uses self-report without doubling matching sources; metrics shows unreported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-agg-'));
  try {
    runInit(dir, '--profile generic --name MetricsAgg --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });

    writeFileSync(join(changeDir, 'handoff.md'), handoffWithMetrics({
      platform: 'cursor',
      model: 'cursor-grok-4.6',
      input_tokens: '800',
      output_tokens: '200',
      cost_usd: '0.30',
      spend_source: 'self-report',
    }));
    cliExec(dir, 'handoff add-thing');

    writeFileSync(join(changeDir, 'handoff.md'), handoffWithMetrics({
      platform: 'amp',
      model: 'amp-sonnet',
      input_tokens: '400',
      output_tokens: '100',
      amp_credits: '12',
      spend_source: 'self-report',
    }));
    cliExec(dir, 'handoff add-thing');

    const metrics = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(metrics.spendByPlatform.cursor.totalTokens, 1000);
    assert.equal(metrics.spendByPlatform.cursor.costUsd, 0.30);
    assert.equal(metrics.spendByPlatform.cursor.source, 'none');
    assert.equal(metrics.spendByPlatform.amp.totalTokens, 500);
    assert.equal(metrics.spendByPlatform.amp.ampCredits, 12);
    assert.equal(metrics.spendByPlatform.amp.source, 'none');

    writeFileSync(
      join(changeDir, 'metrics.json'),
      `${JSON.stringify({
        version: 1,
        change: 'add-thing',
        spend: { inputTokens: 1000, outputTokens: 0, totalTokens: 1000, costUsd: null },
        spendByPlatform: defaultLikePlatforms(),
        spendByModel: [],
        totals: { sessions: 3, durationMs: null, leadTimeMs: null, cloudSessions: 0 },
        phases: { spec: { sessions: 3, durationMs: null, totalTokens: 1000, costUsd: null, agents: ['Architect'], models: [] } },
        sessions: [
          {
            role: 'Architect',
            phase: 'spec',
            platform: 'claude',
            model: 'claude-opus-5',
            inputTokens: 1000,
            outputTokens: 0,
            totalTokens: 1000,
            spendSource: 'self-report',
            sources: [{ id: 's1', platform: 'claude', model: 'claude-opus-5', inputTokens: 1000, outputTokens: 0, totalTokens: 1000 }],
            endedAt: '2026-08-30T08:00:00.000Z',
            durationMs: null,
          },
        ],
        pending: null,
      }, null, 2)}\n`,
    );
    cliExec(dir, 'handoff add-thing --restore');
    writeFileSync(join(changeDir, 'handoff.md'), METRICS_HANDOFF);
    cliExec(dir, 'handoff add-thing');
    const after = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    assert.equal(after.spendByPlatform.claude.totalTokens, 1000);

    const human = cliExec(dir, 'metrics add-thing');
    assert.match(human, /unreported/);
    assert.match(human, /by platform/);
    assert.match(human, /by model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('metrics treats legacy sessions without spendSource as unreported without rewriting the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-legacy-'));
  try {
    runInit(dir, '--profile generic --name MetricsLegacy --lang en');
    const changeDir = join(dir, 'openspec/changes/add-thing');
    mkdirSync(changeDir, { recursive: true });
    const payload = {
      version: 1,
      change: 'add-thing',
      spend: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
      spendByPlatform: {
        cursor: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, ampCredits: null, source: 'none' },
        claude: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, ampCredits: null, source: 'none' },
        amp: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, ampCredits: null, source: 'none' },
      },
      spendByModel: [],
      totals: { sessions: 2, durationMs: null, leadTimeMs: null, cloudSessions: 0 },
      phases: {},
      sessions: [
        { role: 'Architect', phase: 'spec', endedAt: '2026-08-29T07:00:00.000Z', durationMs: null },
        { role: 'Implementer', phase: 'apply', endedAt: '2026-08-29T08:00:00.000Z', durationMs: null, spendSource: 'self-report' },
      ],
      pending: null,
    };
    const filePath = join(changeDir, 'metrics.json');
    const before = `${JSON.stringify(payload, null, 2)}\n`;
    writeFileSync(filePath, before);
    const out = cliExec(dir, 'metrics add-thing');
    assert.match(out, /unreported: 1/);
    assert.match(out, /\(unreported\)/);
    assert.equal(readFileSync(filePath, 'utf-8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff and archive help show --collect and not --no-collect; archive stdout has tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-metrics-help-'));
  try {
    runInit(dir, '--profile generic --name MetricsHelp --lang en');
    const handoffHelp = cliExec(dir, 'handoff --help');
    assert.match(handoffHelp, /--collect/);
    assert.doesNotMatch(handoffHelp, /--no-collect/);
    const archiveHelp = cliExec(dir, 'archive --help');
    assert.match(archiveHelp, /--collect/);
    assert.doesNotMatch(archiveHelp, /--no-collect/);

    makeArchiveFixture(dir, 'add-auth');
    installOpenspecStub(dir);
    const archived = runSpawn(dir, ['archive', 'add-auth', '--sync']);
    assert.equal(archived.status, 0, archived.stderr);
    assert.match(archived.stdout, /by platform/);
    assert.match(archived.stdout, /by model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function defaultLikePlatforms() {
  return {
    cursor: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, ampCredits: null, source: 'none' },
    claude: { inputTokens: 1000, outputTokens: 0, totalTokens: 1000, costUsd: null, ampCredits: null, source: 'none' },
    amp: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, ampCredits: null, source: 'none' },
  };
}
