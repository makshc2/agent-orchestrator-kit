import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
