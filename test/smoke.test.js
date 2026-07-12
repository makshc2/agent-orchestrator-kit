import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

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
