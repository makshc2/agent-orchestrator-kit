#!/usr/bin/env node
import { program } from 'commander';
import pc from 'picocolors';
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = join(__dirname, '..');
const KIT_VERSION = JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf-8')).version;

const VALID_PROFILES = ['generic', 'vue3', 'node', 'mvp'];

const KIT_SKILL_DIRS = [
  'agent-orchestration',
  'openspec-howto',
  'openspec-explore',
  'openspec-propose',
  'openspec-apply-change',
  'openspec-archive-change',
  'openspec-sync-specs',
  'spec-workflow-openspec',
];

const KIT_MANAGED_PATHS = [
  '.agents/commands',
  '.agents/rules',
  '.agents/subagents',
  ...KIT_SKILL_DIRS.map((s) => `.agents/skills/${s}`),
  'scripts/sync-local-agent-skills.sh',
];

// CI workflow files are provider-specific and chosen once at `init --ci`.
// `update` must only refresh them if already present — never resurrect a
// workflow file for a provider the project doesn't use (e.g. after switching
// from GitHub Actions to GitLab CI and deleting the GitHub workflow).
const CI_WORKFLOW_PATHS = ['.github/workflows/agent-verify.yml', '.gitlab/agent-verify.yml'];

// Opt-in AI Spec Verifier files, per CI provider. `scripts/verify-specs.sh` is
// shared — it is stack- and CI-agnostic already.
const GITLAB_SPEC_VERIFY_PATHS = [
  '.gitlab/spec-verify.yml',
  'scripts/verify-specs.sh',
  'scripts/post-mr-verdict.sh',
];
const GITHUB_SPEC_VERIFY_PATHS = [
  '.github/workflows/spec-verify.yml',
  'scripts/verify-specs.sh',
  'scripts/post-pr-verdict-github.sh',
];

// Opt-in files: refreshed by `update` only when already present in the project
const KIT_OPTIN_PATHS = [...new Set([...GITLAB_SPEC_VERIFY_PATHS, ...GITHUB_SPEC_VERIFY_PATHS])];

function specVerifyPathsFor(ci) {
  return ci === 'github' ? GITHUB_SPEC_VERIFY_PATHS : GITLAB_SPEC_VERIFY_PATHS;
}

const VALID_CI_PROVIDERS = ['gitlab', 'github', 'none'];
const VERIFY_OPENSPEC_SCRIPT = 'npx openspec validate --all --strict';

const GITIGNORE_LINES = [
  '.cursor',
  '.cursor/memory.json',
  '.amp/settings.json',
  '.claude',
  '.agents/figma.local.env',
];

const FIGMA_ENV_REL = join('.agents', 'figma.local.env');
const FIGMA_ENV_EXAMPLE_REL = join('.agents', 'figma.local.env.example');
const FIGMA_LAUNCHER_REL = join('scripts', 'figma-mcp-launcher.cjs');
const FIGMA_MANAGED_PATHS = [
  FIGMA_ENV_EXAMPLE_REL,
  FIGMA_LAUNCHER_REL,
  join('.agents', 'mcp.json.example'),
  join('.agents', 'amp.settings.json.example'),
];

const log = {
  info: (msg) => console.log(pc.cyan('  →'), msg),
  ok: (msg) => console.log(pc.green('  ✓'), msg),
  warn: (msg) => console.log(pc.yellow('  !'), msg),
  err: (msg) => console.log(pc.red('  ✗'), msg),
  title: (msg) => console.log(pc.bold(pc.white(`\n${msg}`))),
};

function copyDir(src, dest, opts = {}) {
  const { overwrite = true, skip = [], delete: deleteStale = false } = opts;
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  const srcEntries = readdirSync(src);
  for (const entry of srcEntries) {
    if (skip.includes(entry)) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath, opts);
    } else {
      if (!overwrite && existsSync(destPath)) {
        log.warn(`skip (exists): ${destPath}`);
        continue;
      }
      copyFileSync(srcPath, destPath);
      log.ok(destPath.replace(process.cwd() + '/', ''));
    }
  }

  // Remove entries that exist in dest but no longer exist in src (e.g. skills
  // removed by a kit `update`), keeping .cursor/.claude in sync with .agents/.
  if (deleteStale && existsSync(dest)) {
    for (const entry of readdirSync(dest)) {
      if (skip.includes(entry) || srcEntries.includes(entry)) continue;
      const destPath = join(dest, entry);
      rmSync(destPath, { recursive: true, force: true });
      log.warn(`removed stale: ${destPath.replace(process.cwd() + '/', '')}`);
    }
  }
}

function gitignoreLines(content) {
  return content.split('\n').map((l) => l.trim()).filter(Boolean);
}

function mergeGitignore(projectDir, lines) {
  const gitignorePath = join(projectDir, '.gitignore');
  const raw = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  const existing = gitignoreLines(raw);
  const toAdd = lines.filter((line) => !existing.includes(line));
  if (toAdd.length === 0) return;
  const prefix = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
  writeFileSync(gitignorePath, raw + prefix + toAdd.join('\n') + '\n');
  log.ok('.gitignore updated');
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readFigmaToken(projectDir) {
  const envPath = join(projectDir, FIGMA_ENV_REL);
  const values = parseEnvFile(envPath);
  return values.FIGMA_ACCESS_TOKEN || values.FIGMA_API_KEY || '';
}

function isFigmaConfigured(projectDir) {
  return Boolean(readFigmaToken(projectDir));
}

function ensureFigmaEnvFile(projectDir) {
  const dest = join(projectDir, FIGMA_ENV_REL);
  const example = join(projectDir, FIGMA_ENV_EXAMPLE_REL);
  const kitExample = join(KIT_ROOT, 'templates', FIGMA_ENV_EXAMPLE_REL);

  if (existsSync(dest)) {
    return { created: false, path: dest };
  }

  const src = existsSync(example) ? example : kitExample;
  if (!existsSync(src)) {
    throw new Error(`Missing template: ${FIGMA_ENV_EXAMPLE_REL}`);
  }

  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return { created: true, path: dest };
}

function refreshFigmaManagedFiles(projectDir) {
  const templateDir = join(KIT_ROOT, 'templates');
  for (const rel of FIGMA_MANAGED_PATHS) {
    const src = join(templateDir, rel);
    const dest = join(projectDir, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    log.ok(rel);
  }
}

function ensureFigmaMcpEntry(projectDir) {
  const figmaServer = {
    command: 'node',
    args: ['scripts/figma-mcp-launcher.cjs'],
  };

  const cursorPath = join(projectDir, '.mcp.json');
  if (existsSync(cursorPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cursorPath, 'utf-8'));
      cfg.mcpServers = cfg.mcpServers || {};
      if (!cfg.mcpServers.figma) {
        cfg.mcpServers.figma = figmaServer;
        writeFileSync(cursorPath, `${JSON.stringify(cfg, null, 2)}\n`);
        log.ok('.mcp.json ← added figma server');
      } else {
        log.ok('.mcp.json already has figma server');
      }
    } catch {
      log.warn('.mcp.json present but invalid JSON — merge figma server manually from .agents/mcp.json.example');
    }
  }

  const ampPath = join(projectDir, '.amp', 'settings.json');
  if (existsSync(ampPath)) {
    try {
      const cfg = JSON.parse(readFileSync(ampPath, 'utf-8'));
      cfg['amp.mcpServers'] = cfg['amp.mcpServers'] || {};
      if (!cfg['amp.mcpServers'].figma) {
        cfg['amp.mcpServers'].figma = figmaServer;
        writeFileSync(ampPath, `${JSON.stringify(cfg, null, 2)}\n`);
        log.ok('.amp/settings.json ← added figma server');
      } else {
        log.ok('.amp/settings.json already has figma server');
      }
    } catch {
      log.warn('.amp/settings.json present but invalid JSON — merge figma server manually');
    }
  }
}

function parseFigmaUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const designIdx = parts.findIndex((p) => p === 'design' || p === 'file' || p === 'proto');
    const fileKey = designIdx >= 0 ? parts[designIdx + 1] : '';
    const nodeParam = parsed.searchParams.get('node-id') || '';
    const nodeId = nodeParam ? nodeParam.replace(/-/g, ':') : '';
    return { fileKey, nodeId };
  } catch {
    return { fileKey: '', nodeId: '' };
  }
}

async function figmaApiGet(token, path) {
  const response = await fetch(`https://api.figma.com/v1${path}`, {
    headers: { 'X-Figma-Token': token },
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      (data && (data.err || data.message)) || response.statusText || `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  if (!data) {
    throw new Error('Figma API returned non-JSON response');
  }
  return { data, text };
}

function resolveTemplate(templateName, profile) {
  const profilePath = join(KIT_ROOT, 'profiles', profile, templateName);
  if (existsSync(profilePath)) return profilePath;
  return join(KIT_ROOT, 'templates', templateName);
}

function applyPlaceholders(filePath, vars) {
  if (!existsSync(filePath)) return;
  let content = readFileSync(filePath, 'utf-8');
  for (const [key, val] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, val);
  }
  writeFileSync(filePath, content);
}

function resolveProfile(profile) {
  if (VALID_PROFILES.includes(profile)) return profile;
  log.warn(`Unknown profile "${profile}". Valid: ${VALID_PROFILES.join(', ')}. Using generic.`);
  return 'generic';
}

function detectPackageManager(projectDir) {
  if (existsSync(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function pmCommands(pm) {
  const map = {
    npm: { install: 'npm ci', lint: 'npm run lint', build: 'npm run build', test: 'npm test' },
    yarn: { install: 'yarn install --frozen-lockfile', lint: 'yarn lint', build: 'yarn build', test: 'yarn test' },
    pnpm: { install: 'pnpm install --frozen-lockfile', lint: 'pnpm run lint', build: 'pnpm run build', test: 'pnpm test' },
  };
  return map[pm] || map.npm;
}

function hasOpenSpec(projectDir) {
  return existsSync(join(projectDir, 'openspec', 'config.yaml'));
}

function listActiveChanges(projectDir) {
  const changesDir = join(projectDir, 'openspec', 'changes');
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir)
    .filter((name) => name !== 'archive' && statSync(join(changesDir, name)).isDirectory())
    .sort();
}

function parseTasksProgress(changeDir) {
  const tasksPath = join(changeDir, 'tasks.md');
  if (!existsSync(tasksPath)) return null;
  const content = readFileSync(tasksPath, 'utf-8');
  const total = (content.match(/^\s*- \[[ xX]\]/gm) || []).length;
  const done = (content.match(/^\s*- \[[xX]\]/gm) || []).length;
  return { total, done };
}

function parseReviewVerdict(changeDir) {
  const reviewPath = join(changeDir, 'review.md');
  if (!existsSync(reviewPath)) return null;
  const content = readFileSync(reviewPath, 'utf-8');
  const match = content.match(/\*\*Verdict:\*\*\s*(.+)/);
  return match ? match[1].trim() : 'unknown';
}

function parseDesignBrief(changeDir) {
  return existsSync(join(changeDir, 'design-brief.md'));
}

function hasDesignOptOut(changeDir) {
  const proposalPath = join(changeDir, 'proposal.md');
  if (!existsSync(proposalPath)) return false;
  const content = readFileSync(proposalPath, 'utf-8');
  return /^Design:\s*none/mi.test(content);
}

function readPipelineConfig(projectDir) {
  const orchPath = join(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(orchPath)) return null;
  const content = readFileSync(orchPath, 'utf-8');
  const requireReviewMatch = content.match(/require_spec_review:\s*(true|false)/);
  const requireBriefMatch = content.match(/require_design_brief:\s*(true|false)/);
  const maxActiveMatch = content.match(/max_active_changes:\s*(\d+)/);
  return {
    requireSpecReview: requireReviewMatch ? requireReviewMatch[1] === 'true' : true,
    requireDesignBrief: requireBriefMatch ? requireBriefMatch[1] === 'true' : false,
    maxActiveChanges: maxActiveMatch ? parseInt(maxActiveMatch[1], 10) : null,
  };
}

// Returns true/false when the diff is known, or null when it could not be
// determined (no git repo, invalid base ref, shallow clone, etc.) — callers
// must treat null as "skip gracefully", never as "block".
function gitDiffTouchesGlob(projectDir, base, srcGlob) {
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD -- "${srcGlob}"`, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

function installOpenspecConfigExample(projectDir, profile, vars, force) {
  const src = resolveTemplate('openspec-config.yaml.example', profile);
  if (!existsSync(src)) return;

  const openspecDir = join(projectDir, 'openspec');
  const configPath = join(openspecDir, 'config.yaml');
  const examplePath = join(openspecDir, 'config.yaml.example');

  mkdirSync(openspecDir, { recursive: true });

  if (existsSync(configPath) && !force) {
    log.warn('skip (exists): openspec/config.yaml');
    return;
  }

  if (!existsSync(configPath)) {
    copyFileSync(src, examplePath);
    applyPlaceholders(examplePath, vars);
    log.ok('openspec/config.yaml.example');
    return;
  }

  if (force) {
    copyFileSync(src, configPath);
    applyPlaceholders(configPath, vars);
    log.ok('openspec/config.yaml');
  }
}

function resolveCiProvider(ci) {
  if (VALID_CI_PROVIDERS.includes(ci)) return ci;
  log.warn(`Unknown --ci value "${ci}". Valid: ${VALID_CI_PROVIDERS.join(', ')}. Using github.`);
  return 'github';
}

function injectVerifyScripts(projectDir, { pm }) {
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    log.warn('skip script injection: no package.json');
    return;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  if (!pkg.scripts) pkg.scripts = {};

  if (pkg.scripts['verify:openspec']) {
    log.warn('skip (exists): verify:openspec script');
  } else {
    pkg.scripts['verify:openspec'] = VERIFY_OPENSPEC_SCRIPT;
    log.ok('verify:openspec script added');
  }

  const runCmd = `${pm} run verify:openspec`;
  const existingPrebuild = pkg.scripts.prebuild;

  if (existingPrebuild && existingPrebuild.includes('verify:openspec')) {
    log.warn('skip (exists): prebuild already chains verify:openspec');
  } else if (existingPrebuild) {
    pkg.scripts.prebuild = `${runCmd} && ${existingPrebuild}`;
    log.ok('prebuild script chained');
  } else {
    pkg.scripts.prebuild = runCmd;
    log.ok('prebuild script added');
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function installCi(projectDir, templateDir, ci, force) {
  if (ci === 'none') {
    log.info('CI install skipped (--ci none)');
    return;
  }

  if (ci === 'github') {
    const githubWorkflow = join(templateDir, '.github', 'workflows', 'agent-verify.yml');
    const githubDest = join(projectDir, '.github', 'workflows', 'agent-verify.yml');
    if (!existsSync(githubWorkflow)) return;
    if (!force && existsSync(githubDest)) {
      log.warn('skip (exists): .github/workflows/agent-verify.yml');
      return;
    }
    mkdirSync(dirname(githubDest), { recursive: true });
    copyFileSync(githubWorkflow, githubDest);
    log.ok('.github/workflows/agent-verify.yml');
    return;
  }

  if (ci === 'gitlab') {
    const gitlabFragment = join(templateDir, '.gitlab', 'agent-verify.yml');
    const gitlabDest = join(projectDir, '.gitlab', 'agent-verify.yml');
    if (!existsSync(gitlabFragment)) return;
    if (!force && existsSync(gitlabDest)) {
      log.warn('skip (exists): .gitlab/agent-verify.yml');
      return;
    }
    mkdirSync(dirname(gitlabDest), { recursive: true });
    copyFileSync(gitlabFragment, gitlabDest);
    log.ok('.gitlab/agent-verify.yml');
  }
}

function installSpecVerify(projectDir, templateDir, force, ci) {
  const paths = specVerifyPathsFor(ci);
  for (const rel of paths) {
    const src = join(templateDir, rel);
    const dest = join(projectDir, rel);
    if (!existsSync(src)) continue;
    if (!force && existsSync(dest)) {
      log.warn(`skip (exists): ${rel}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    log.ok(rel);
  }
  const scripts = paths.filter((rel) => rel.startsWith('scripts/')).map((rel) => join(projectDir, rel));
  try {
    execSync(`chmod +x ${scripts.join(' ')}`);
  } catch {}
}

function patchOrchestratorSpecVerify(projectDir) {
  const orchPath = join(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(orchPath)) return;

  let content = readFileSync(orchPath, 'utf-8');
  if (content.includes('spec-verify-blocking')) return;

  const anchor = /^(\s*)- openspec-validate-strict\s*$/m;
  if (!anchor.test(content)) {
    log.warn('could not add spec-verify-blocking gate: openspec-validate-strict anchor not found in orchestrator.yaml');
    return;
  }
  content = content.replace(anchor, '$1- openspec-validate-strict\n$1- spec-verify-blocking');
  writeFileSync(orchPath, content);
  log.ok('spec-verify-blocking gate added to orchestrator.yaml');
}

function patchOrchestratorVerifier(projectDir, pm) {
  const orchPath = join(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(orchPath)) return;

  const cmds = pmCommands(pm);
  let content = readFileSync(orchPath, 'utf-8');

  content = content.replace(/^(\s*package_manager:\s*).+$/m, `$1${pm}`);
  if (!/^package_manager:/m.test(content)) {
    content = content.replace(
      /^(project:\n(?:  .+\n)+)/m,
      `$1\npackage_manager: ${pm}\n`,
    );
  }

  content = content.replace(/^(\s*lint_command:\s*).+$/m, `$1"${cmds.lint}"`);
  content = content.replace(/^(\s*build_command:\s*).+$/m, `$1"${cmds.build}"`);
  content = content.replace(/^(\s*test_command:\s*).+$/m, `$1"${cmds.test}"`);

  writeFileSync(orchPath, content);
}

function printNextSteps(profile, projectDir, ci = 'github', specVerify = false) {
  const pm = detectPackageManager(projectDir);
  const openspecReady = hasOpenSpec(projectDir);
  const lines = [`${pc.bold('Next steps:')}`];

  if (!openspecReady) {
    lines.push(`  0. Install OpenSpec (required — kit does not install it):`);
    lines.push(`     ${pc.cyan('npm i -D @fission-ai/openspec && npx openspec init')}`);
    lines.push(`     Then copy ${pc.cyan('openspec/config.yaml.example')} → ${pc.cyan('openspec/config.yaml')} if present`);
  } else {
    lines.push(`  0. OpenSpec detected ✓ — run ${pc.cyan('npx openspec validate --all --strict')} to verify`);
  }

  lines.push(`  1. Review ${pc.cyan('AGENTS.md')} and ${pc.cyan('.agents/orchestrator.yaml')}`);
  lines.push(`  2. Sync to your IDE:`);
  lines.push(`     ${pc.cyan('./scripts/sync-local-agent-skills.sh')}`);

  if (profile === 'vue3') {
    lines.push(`  3. Install Vue/JS stack skills:`);
    lines.push(`     ${pc.cyan('npx frontend-agent-skills install --agent all --yes')}`);
    lines.push(`  4. MCP: copy .mcp.json (Cursor) / .amp/settings.json (Amp) from *.example files`);
    lines.push(`  5. Optional Figma: ${pc.cyan('npx agent-orchestrator-kit figma-setup')} then paste token into ${pc.cyan('.agents/figma.local.env')} (never in chat)`);
    lines.push(`  6. Start your first change:`);
  } else if (profile === 'mvp') {
    lines.push(`  3. For quick demos use ${pc.cyan('/opsx:quick <name>')} (propose + apply, no review gate)`);
    lines.push(`  4. MCP: copy .mcp.json (Cursor) / .amp/settings.json (Amp) from *.example files`);
    lines.push(`  5. Optional Figma: ${pc.cyan('npx agent-orchestrator-kit figma-setup')} then paste token into ${pc.cyan('.agents/figma.local.env')} (never in chat)`);
    lines.push(`  6. Start exploring:`);
  } else {
    lines.push(`  3. MCP: copy .mcp.json (Cursor) / .amp/settings.json (Amp) from *.example files`);
    lines.push(`  4. Optional Figma: ${pc.cyan('npx agent-orchestrator-kit figma-setup')} then paste token into ${pc.cyan('.agents/figma.local.env')} (never in chat)`);
    lines.push(`  5. Start your first change:`);
  }

  const startCmd = profile === 'mvp' ? '/opsx:quick' : '/opsx:explore';
  lines.push(`     ${pc.cyan(startCmd)}`);

  if (pm !== 'npm') {
    lines.push(`  ${pc.dim(`Detected package manager: ${pm} (verifier commands updated in orchestrator.yaml)`)}`);
  }

  if (ci === 'gitlab') {
    lines.push(`  ${pc.dim(`GitLab verify: ${pm} run build triggers prebuild → verify:openspec automatically`)}`);
    lines.push(`  ${pc.dim('Optional dev CI: include local .gitlab/agent-verify.yml (see kit templates/.gitlab-ci.starter.yml.example)')}`);
  }

  if (specVerify) {
    lines.push(`  ${pc.bold('AI Spec Verifier:')}`);
    if (ci === 'gitlab') {
      lines.push(`    - include ${pc.cyan(".gitlab/spec-verify.yml")} from your .gitlab-ci.yml`);
      lines.push(`    - add CI/CD variables: ${pc.cyan('AMP_API_KEY')}, ${pc.cyan('GITLAB_VERIFIER_TOKEN')} (masked)`);
      lines.push(`    - BLOCKED verdict fails the MR pipeline (uncomment allow_failure for warning-only rollout)`);
    } else if (ci === 'github') {
      lines.push(`    - workflow ${pc.cyan('.github/workflows/spec-verify.yml')} runs automatically on pull_request`);
      lines.push(`    - add repo secret: ${pc.cyan('AMP_API_KEY')} (Settings → Secrets and variables → Actions)`);
      lines.push(`    - BLOCKED verdict fails the PR pipeline (remove continue-on-error for warning-only rollout)`);
    }
  }

  console.log('\n' + lines.join('\n') + '\n');
}

// Amp has no file-based custom subagents (only skills and plugin agents), but
// it natively loads skills from .agents/skills/ with the same description-driven
// delegation. Each .agents/subagents/<name>.md therefore gets a committed skill
// wrapper .agents/skills/subagent-<name>/SKILL.md so subagents work in Amp with
// zero local setup. Wrappers are regenerated on init/update/sync and stale ones
// are removed when their source subagent is deleted.
const AMP_SUBAGENT_SKILL_PREFIX = 'subagent-';

function listAmpSubagentWrappers(projectDir) {
  const skillsDir = join(projectDir, '.agents', 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir).filter((entry) => entry.startsWith(AMP_SUBAGENT_SKILL_PREFIX));
}

function generateAmpSubagentSkills(projectDir) {
  const subagentsDir = join(projectDir, '.agents', 'subagents');
  const skillsDir = join(projectDir, '.agents', 'skills');
  const expected = new Set();

  if (existsSync(subagentsDir)) {
    for (const file of readdirSync(subagentsDir).filter((f) => f.endsWith('.md'))) {
      const content = readFileSync(join(subagentsDir, file), 'utf-8');
      const parsed = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const name = parsed?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const description = parsed?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
      if (!name || !description) {
        log.warn(`skip Amp wrapper (missing name/description frontmatter): .agents/subagents/${file}`);
        continue;
      }

      const skillName = `${AMP_SUBAGENT_SKILL_PREFIX}${name}`;
      expected.add(skillName);
      mkdirSync(join(skillsDir, skillName), { recursive: true });
      const skill = [
        '---',
        `name: ${skillName}`,
        `description: ${description}`,
        '---',
        '',
        `<!-- AUTO-GENERATED from .agents/subagents/${file} — edit the source file, then run: npx agent-orchestrator-kit sync -->`,
        '',
        parsed[2].trim(),
        '',
      ].join('\n');
      writeFileSync(join(skillsDir, skillName, 'SKILL.md'), skill);
      log.ok(`.agents/skills/${skillName}/SKILL.md (Amp wrapper)`);
    }
  }

  for (const entry of listAmpSubagentWrappers(projectDir)) {
    if (!expected.has(entry)) {
      rmSync(join(projectDir, '.agents', 'skills', entry), { recursive: true, force: true });
      log.warn(`removed stale Amp wrapper: .agents/skills/${entry}`);
    }
  }
}

function syncAmp(projectDir) {
  log.info('Amp Code reads .agents/ natively — subagents exposed via skill wrappers');
  mkdirSync(join(projectDir, '.amp'), { recursive: true });
  const ampExample = join(projectDir, '.agents', 'amp.settings.json.example');
  const ampDest = join(projectDir, '.amp', 'settings.json');
  if (existsSync(ampExample) && !existsSync(ampDest)) {
    copyFileSync(ampExample, ampDest);
    log.ok('.amp/settings.json created from example');
  } else if (existsSync(ampDest)) {
    log.ok('.amp/settings.json already present');
  } else {
    log.warn('.amp/settings.json missing — copy from .agents/amp.settings.json.example');
  }
}

program
  .name('agent-orchestrator')
  .description('Universal AI agent orchestration kit for Cursor, Claude Code, and Amp Code')
  .version(KIT_VERSION);

program
  .command('init')
  .description('Install orchestrator kit into the current project')
  .option('--profile <profile>', `Stack profile: ${VALID_PROFILES.join(' | ')}`, 'generic')
  .option('--lang <lang>', 'Agent response language (en | uk | ...)', 'en')
  .option('--name <name>', 'Project name (defaults to directory name)')
  .option('--force', 'Overwrite existing files', false)
  .option('--ci <provider>', 'CI provider: gitlab | github | none', 'github')
  .option('--spec-verify', 'Install AI Spec Verifier blocking gate (GitLab or GitHub)', false)
  .action((opts) => {
    const projectDir = process.cwd();
    const projectName = opts.name || basename(projectDir);
    const profile = resolveProfile(opts.profile);
    const pm = detectPackageManager(projectDir);
    const ci = resolveCiProvider(opts.ci);

    log.title(`agent-orchestrator init  v${KIT_VERSION}`);
    log.info(`Project: ${projectName}`);
    log.info(`Profile: ${profile}`);
    log.info(`Language: ${opts.lang}`);
    log.info(`Package manager: ${pm}`);
    log.info(`CI provider: ${ci}`);

    const templateDir = join(KIT_ROOT, 'templates');
    const profileDir = join(KIT_ROOT, 'profiles', profile);
    const vars = { PROJECT_NAME: projectName, LANG: opts.lang, KIT_VERSION, PACKAGE_MANAGER: pm };

    log.title('Installing .agents/');
    copyDir(join(templateDir, '.agents'), join(projectDir, '.agents'), { overwrite: opts.force });
    if (existsSync(join(profileDir, '.agents'))) {
      copyDir(join(profileDir, '.agents'), join(projectDir, '.agents'), { overwrite: opts.force });
    }
    generateAmpSubagentSkills(projectDir);

    log.title('Installing scripts/');
    copyDir(join(templateDir, 'scripts'), join(projectDir, 'scripts'), {
      overwrite: opts.force,
      skip: ['verify-specs.sh', 'post-mr-verdict.sh'],
    });
    try {
      execSync(`chmod +x ${join(projectDir, 'scripts', 'sync-local-agent-skills.sh')}`);
    } catch {}

    log.title('Installing CI workflow');
    installCi(projectDir, templateDir, ci, opts.force);
    if (ci === 'gitlab') {
      injectVerifyScripts(projectDir, { pm });
    }

    const specVerify = Boolean(opts.specVerify) && (ci === 'gitlab' || ci === 'github');
    if (opts.specVerify && !specVerify) {
      log.warn('--spec-verify requires --ci gitlab or --ci github — skipping AI Spec Verifier install');
    }
    if (specVerify) {
      log.title('Installing AI Spec Verifier (opt-in)');
      installSpecVerify(projectDir, templateDir, opts.force, ci);
    }

    log.title('Installing root files');
    for (const f of ['AGENTS.md', 'CLAUDE.md']) {
      const src = resolveTemplate(f, profile);
      const dest = join(projectDir, f);
      if (!opts.force && existsSync(dest)) {
        log.warn(`skip (exists): ${f}`);
        continue;
      }
      if (existsSync(src)) {
        copyFileSync(src, dest);
        applyPlaceholders(dest, vars);
        log.ok(f);
      }
    }

    const orchSrc = resolveTemplate('orchestrator.yaml', profile);
    const orchDest = join(projectDir, '.agents', 'orchestrator.yaml');
    if (!opts.force && existsSync(orchDest)) {
      log.warn('skip (exists): .agents/orchestrator.yaml');
    } else if (existsSync(orchSrc)) {
      copyFileSync(orchSrc, orchDest);
      applyPlaceholders(orchDest, vars);
      patchOrchestratorVerifier(projectDir, pm);
      log.ok('.agents/orchestrator.yaml');
    }
    if (specVerify) {
      patchOrchestratorSpecVerify(projectDir);
    }

    log.title('OpenSpec config template');
    installOpenspecConfigExample(projectDir, profile, vars, opts.force);

    log.title('Updating .gitignore');
    mergeGitignore(projectDir, GITIGNORE_LINES);

    log.title('Done');
    log.ok(`agent-orchestrator-kit v${KIT_VERSION} installed`);
    printNextSteps(profile, projectDir, ci, specVerify);
  });

program
  .command('update')
  .description('Update kit files without overwriting project overlay (orchestrator.yaml, project-conventions)')
  .action(() => {
    const projectDir = process.cwd();
    const templateDir = join(KIT_ROOT, 'templates');

    log.title(`agent-orchestrator update  v${KIT_VERSION}`);

    for (const rel of KIT_MANAGED_PATHS) {
      const src = join(templateDir, rel);
      const dest = join(projectDir, rel);
      if (!existsSync(src)) continue;
      if (statSync(src).isDirectory()) {
        copyDir(src, dest, { overwrite: true });
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        log.ok(rel);
      }
    }

    generateAmpSubagentSkills(projectDir);

    for (const rel of CI_WORKFLOW_PATHS) {
      const src = join(templateDir, rel);
      const dest = join(projectDir, rel);
      if (!existsSync(src) || !existsSync(dest)) continue;
      copyFileSync(src, dest);
      log.ok(rel);
    }

    for (const rel of KIT_OPTIN_PATHS) {
      const src = join(templateDir, rel);
      const dest = join(projectDir, rel);
      if (!existsSync(src) || !existsSync(dest)) continue;
      copyFileSync(src, dest);
      log.ok(`${rel} (opt-in)`);
    }

    try {
      execSync(`chmod +x ${join(projectDir, 'scripts', 'sync-local-agent-skills.sh')}`);
    } catch {}

    log.title('Refreshing Figma setup templates');
    refreshFigmaManagedFiles(projectDir);
    mergeGitignore(projectDir, GITIGNORE_LINES);

    log.ok(`Updated to v${KIT_VERSION}`);
    log.info('Run ./scripts/sync-local-agent-skills.sh to sync to local IDE');
    log.info('Optional Figma: npx agent-orchestrator-kit figma-setup');
  });

program
  .command('sync')
  .description('Sync .agents/ to local IDE directories (Cursor, Claude Code, Amp)')
  .option('--target <target>', 'cursor | claude | amp | all', 'all')
  .action((opts) => {
    const projectDir = process.cwd();

    log.title('agent-orchestrator sync');

    const syncCursor = ['cursor', 'all'].includes(opts.target);
    const syncClaude = ['claude', 'all'].includes(opts.target);
    const syncAmpTarget = ['amp', 'all'].includes(opts.target);

    generateAmpSubagentSkills(projectDir);

    // Amp skill wrappers are redundant in Cursor/Claude (they get native
    // subagents from .agents/subagents/), so exclude them from skill sync.
    const ampWrappers = listAmpSubagentWrappers(projectDir);

    if (syncCursor) {
      log.info('Syncing .agents/ → .cursor/');
      copyDir(join(projectDir, '.agents', 'skills'), join(projectDir, '.cursor', 'skills'), { overwrite: true, delete: true, skip: ampWrappers });
      for (const wrapper of ampWrappers) {
        rmSync(join(projectDir, '.cursor', 'skills', wrapper), { recursive: true, force: true });
      }
      copyDir(join(projectDir, '.agents', 'rules'), join(projectDir, '.cursor', 'rules'), { overwrite: true, delete: true });
      copyDir(join(projectDir, '.agents', 'subagents'), join(projectDir, '.cursor', 'agents'), { overwrite: true, delete: true });

      const mcpExample = join(projectDir, '.agents', 'mcp.json.example');
      const mcpDest = join(projectDir, '.mcp.json');
      if (existsSync(mcpExample) && !existsSync(mcpDest)) {
        copyFileSync(mcpExample, mcpDest);
        log.ok('.mcp.json created from example');
      }
    }

    if (syncClaude) {
      log.info('Syncing .agents/ → .claude/');
      copyDir(join(projectDir, '.agents', 'skills'), join(projectDir, '.claude', 'skills'), { overwrite: true, delete: true, skip: ampWrappers });
      for (const wrapper of ampWrappers) {
        rmSync(join(projectDir, '.claude', 'skills', wrapper), { recursive: true, force: true });
      }
      copyDir(join(projectDir, '.agents', 'subagents'), join(projectDir, '.claude', 'agents'), { overwrite: true, delete: true });

      const claudeMd = join(projectDir, 'CLAUDE.md');
      const claudeDir = join(projectDir, '.claude');
      if (existsSync(claudeMd)) {
        mkdirSync(claudeDir, { recursive: true });
        copyFileSync(claudeMd, join(claudeDir, 'CLAUDE.md'));
        log.ok('.claude/CLAUDE.md');
      }
    }

    if (syncAmpTarget) {
      syncAmp(projectDir);
    }

    mergeGitignore(projectDir, GITIGNORE_LINES);

    log.ok('Sync complete');
    log.warn('.cursor/, .claude/, .amp/ are local only — not committed to git');
  });

program
  .command('status')
  .description('Show status of active OpenSpec changes (tasks progress, review verdict, archive readiness)')
  .action(() => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator status');

    const changes = listActiveChanges(projectDir);
    if (changes.length === 0) {
      log.info('No active changes');
      return;
    }

    for (const name of changes) {
      const changeDir = join(projectDir, 'openspec', 'changes', name);
      const progress = parseTasksProgress(changeDir);
      const verdict = parseReviewVerdict(changeDir);
      const hasBrief = parseDesignBrief(changeDir);
      const progressStr = progress ? `${progress.done}/${progress.total} tasks` : 'no tasks.md';
      const verdictStr = verdict || 'none';
      const readyToArchive = Boolean(progress && progress.total > 0 && progress.done === progress.total);

      console.log(`\n${pc.bold(name)}`);
      console.log(`  tasks:  ${progressStr}`);
      console.log(`  review: ${verdictStr}`);
      console.log(`  brief:  ${hasBrief ? 'yes' : 'no'}`);
      if (readyToArchive) log.ok('ready to archive');
    }
    console.log('');
  });

program
  .command('gate-check [change-name]')
  .description('Deterministically check the review gate before apply/merge (exit non-zero if unmet)')
  .option('--src-glob <glob>', 'source path filter used to detect code changes', 'src/')
  .option('--base <ref>', 'git ref to diff against', 'HEAD~1')
  .action((changeName, opts) => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator gate-check');

    const config = readPipelineConfig(projectDir);
    if (!config) {
      log.info('.agents/orchestrator.yaml not found — nothing to gate');
      return;
    }

    if (!config.requireSpecReview && !config.requireDesignBrief) {
      log.ok('review not required (pipeline.require_spec_review: false)');
      return;
    }

    const touchesSrc = gitDiffTouchesGlob(projectDir, opts.base, opts.srcGlob);
    if (touchesSrc === false) {
      log.ok(`no changes under ${opts.srcGlob} — nothing to gate`);
      return;
    }
    if (touchesSrc === null) {
      log.warn('could not compute git diff — skipping gate-check');
      return;
    }

    const changes = listActiveChanges(projectDir);
    if (config.maxActiveChanges && changes.length > config.maxActiveChanges) {
      log.warn(`${changes.length} active changes exceed pipeline.max_active_changes (${config.maxActiveChanges})`);
    }

    let target = changeName;
    if (!target) {
      if (changes.length === 0) {
        log.warn(`${opts.srcGlob} changed but no active OpenSpec change found — cannot verify review gate`);
        return;
      }
      target = changes
        .map((name) => ({ name, mtime: statSync(join(projectDir, 'openspec', 'changes', name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0].name;
      log.info(`auto-selected change: ${target} (override: gate-check <name>)`);
    }

    const changeDir = join(projectDir, 'openspec', 'changes', target);
    if (!existsSync(changeDir)) {
      log.err(`change not found: ${target}`);
      process.exitCode = 1;
      return;
    }

    if (config.requireSpecReview) {
      const verdict = parseReviewVerdict(changeDir);
      if (!(verdict && /^APPROVE/i.test(verdict))) {
        log.err(`review gate failed — change "${target}" has ${verdict ? `verdict "${verdict}"` : 'no review.md'}`);
        log.err(`Run /opsx:review ${target} and get an explicit APPROVE before apply/merge.`);
        process.exitCode = 1;
        return;
      }
      log.ok(`review gate passed — ${target}: APPROVE`);
    } else {
      log.ok('review not required (pipeline.require_spec_review: false)');
    }

    if (config.requireDesignBrief) {
      if (parseDesignBrief(changeDir) || hasDesignOptOut(changeDir)) {
        log.ok(`design brief gate passed — ${target}`);
      } else {
        log.err(`design brief gate failed — change "${target}" has no design-brief.md`);
        log.err(`Run /opsx:design ${target} (or add "Design: none" to proposal.md for non-UI changes).`);
        process.exitCode = 1;
      }
    }
  });

program
  .command('figma-setup')
  .description('Create local Figma token env file (never prints the token)')
  .action(() => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator figma-setup');

    refreshFigmaManagedFiles(projectDir);
    mergeGitignore(projectDir, GITIGNORE_LINES);

    const result = ensureFigmaEnvFile(projectDir);
    if (result.created) {
      log.ok(`Created ${FIGMA_ENV_REL}`);
    } else {
      log.ok(`${FIGMA_ENV_REL} already exists`);
    }

    ensureFigmaMcpEntry(projectDir);

    if (isFigmaConfigured(projectDir)) {
      log.ok('Figma token: configured');
    } else {
      log.warn('Figma token: missing — open .agents/figma.local.env and set FIGMA_ACCESS_TOKEN locally (do not paste into chat)');
    }

    log.info('Restart Cursor / Amp after saving the token');
    log.info('Check: npx agent-orchestrator-kit figma-status');
  });

program
  .command('figma-status')
  .description('Report whether a local Figma token is configured (never prints the token)')
  .action(() => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator figma-status');

    const envPath = join(projectDir, FIGMA_ENV_REL);
    if (!existsSync(envPath)) {
      log.err(`Figma token: not configured (missing ${FIGMA_ENV_REL})`);
      log.info('Run: npx agent-orchestrator-kit figma-setup');
      process.exitCode = 1;
      return;
    }

    if (!isFigmaConfigured(projectDir)) {
      log.err('Figma token: not configured (FIGMA_ACCESS_TOKEN is empty)');
      log.info('Edit .agents/figma.local.env locally — never paste the token into chat');
      process.exitCode = 1;
      return;
    }

    log.ok('Figma token: configured');
    if (existsSync(join(projectDir, FIGMA_LAUNCHER_REL))) {
      log.ok(`MCP launcher: ${FIGMA_LAUNCHER_REL}`);
    } else {
      log.warn(`MCP launcher missing — run npx agent-orchestrator-kit update`);
    }
  });

program
  .command('figma-fetch')
  .description('Fetch Figma file/nodes JSON via REST API using the local token')
  .option('--url <url>', 'Figma design URL (file key + optional node-id)')
  .option('--file <key>', 'Figma file key')
  .option('--nodes <ids>', 'Comma-separated node ids (1:2 or 1-2)')
  .option('--depth <n>', 'Limit node tree depth (use for large frames; omit = full tree)')
  .option('--out <path>', 'Output JSON path', 'figma-nodes.json')
  .action(async (opts) => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator figma-fetch');

    const token = readFigmaToken(projectDir);
    if (!token) {
      log.err('Figma token: not configured');
      log.info('Run: npx agent-orchestrator-kit figma-setup');
      process.exitCode = 1;
      return;
    }

    let fileKey = opts.file || '';
    let nodes = opts.nodes || '';
    if (opts.url) {
      const parsed = parseFigmaUrl(opts.url);
      fileKey = fileKey || parsed.fileKey;
      nodes = nodes || parsed.nodeId;
    }

    if (!fileKey) {
      log.err('Missing --file <key> or --url <figma-url>');
      process.exitCode = 1;
      return;
    }

    const nodeIds = String(nodes || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => id.replace(/-/g, ':'));

    const query = [];
    if (nodeIds.length) {
      query.push(`ids=${encodeURIComponent(nodeIds.join(','))}`);
    }
    if (opts.depth != null && String(opts.depth).trim() !== '') {
      const depth = Number(opts.depth);
      if (!Number.isInteger(depth) || depth < 1) {
        log.err('--depth must be a positive integer');
        process.exitCode = 1;
        return;
      }
      query.push(`depth=${depth}`);
    }

    try {
      const apiPath = nodeIds.length
        ? `/files/${encodeURIComponent(fileKey)}/nodes${query.length ? `?${query.join('&')}` : ''}`
        : `/files/${encodeURIComponent(fileKey)}${query.length ? `?${query.join('&')}` : ''}`;
      log.info(
        nodeIds.length
          ? `Fetching ${nodeIds.length} node(s)${opts.depth ? ` (depth ${opts.depth})` : ''}…`
          : `Fetching full file${opts.depth ? ` (depth ${opts.depth})` : ''}…`
      );
      const { data, text } = await figmaApiGet(token, apiPath);
      const outPath = join(projectDir, opts.out);
      mkdirSync(dirname(outPath), { recursive: true });
      // Write API payload as-is — pretty-print of huge trees can throw "Invalid string length"
      writeFileSync(outPath, text.endsWith('\n') ? text : `${text}\n`);
      const nodeCount = data.nodes ? Object.keys(data.nodes).length : 0;
      log.ok(`Wrote ${opts.out}${nodeCount ? ` (${nodeCount} node key(s))` : ''}`);
    } catch (error) {
      log.err(`Figma API error: ${error.message}`);
      process.exitCode = 1;
    }
  });

program.parse();
