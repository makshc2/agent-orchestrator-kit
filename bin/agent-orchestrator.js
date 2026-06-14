#!/usr/bin/env node
import { program } from 'commander';
import pc from 'picocolors';
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'fs';
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
  ...KIT_SKILL_DIRS.map((s) => `.agents/skills/${s}`),
  '.github/workflows/agent-verify.yml',
  'scripts/sync-local-agent-skills.sh',
];

const GITIGNORE_LINES = ['.cursor', '.cursor/memory.json', '.amp/settings.json', '.claude'];

const log = {
  info: (msg) => console.log(pc.cyan('  →'), msg),
  ok: (msg) => console.log(pc.green('  ✓'), msg),
  warn: (msg) => console.log(pc.yellow('  !'), msg),
  err: (msg) => console.log(pc.red('  ✗'), msg),
  title: (msg) => console.log(pc.bold(pc.white(`\n${msg}`))),
};

function copyDir(src, dest, opts = {}) {
  const { overwrite = true, skip = [] } = opts;
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
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

function printNextSteps(profile, projectDir) {
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
    lines.push(`  5. Start your first change:`);
  } else if (profile === 'mvp') {
    lines.push(`  3. For quick demos use ${pc.cyan('/opsx:quick <name>')} (propose + apply, no review gate)`);
    lines.push(`  4. MCP: copy .mcp.json (Cursor) / .amp/settings.json (Amp) from *.example files`);
    lines.push(`  5. Start exploring:`);
  } else {
    lines.push(`  3. MCP: copy .mcp.json (Cursor) / .amp/settings.json (Amp) from *.example files`);
    lines.push(`  4. Start your first change:`);
  }

  const startCmd = profile === 'mvp' ? '/opsx:quick' : '/opsx:explore';
  lines.push(`     ${pc.cyan(startCmd)}`);

  if (pm !== 'npm') {
    lines.push(`  ${pc.dim(`Detected package manager: ${pm} (verifier commands updated in orchestrator.yaml)`)}`);
  }

  console.log('\n' + lines.join('\n') + '\n');
}

function syncAmp(projectDir) {
  log.info('Amp Code reads .agents/ natively — no skill sync needed');
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
  .action((opts) => {
    const projectDir = process.cwd();
    const projectName = opts.name || basename(projectDir);
    const profile = resolveProfile(opts.profile);
    const pm = detectPackageManager(projectDir);

    log.title(`agent-orchestrator init  v${KIT_VERSION}`);
    log.info(`Project: ${projectName}`);
    log.info(`Profile: ${profile}`);
    log.info(`Language: ${opts.lang}`);
    log.info(`Package manager: ${pm}`);

    const templateDir = join(KIT_ROOT, 'templates');
    const profileDir = join(KIT_ROOT, 'profiles', profile);
    const vars = { PROJECT_NAME: projectName, LANG: opts.lang, KIT_VERSION, PACKAGE_MANAGER: pm };

    log.title('Installing .agents/');
    copyDir(join(templateDir, '.agents'), join(projectDir, '.agents'), { overwrite: opts.force });
    if (existsSync(join(profileDir, '.agents'))) {
      copyDir(join(profileDir, '.agents'), join(projectDir, '.agents'), { overwrite: opts.force });
    }

    log.title('Installing scripts/');
    copyDir(join(templateDir, 'scripts'), join(projectDir, 'scripts'), { overwrite: opts.force });
    try {
      execSync(`chmod +x ${join(projectDir, 'scripts', 'sync-local-agent-skills.sh')}`);
    } catch {}

    log.title('Installing CI workflow');
    const githubWorkflow = join(templateDir, '.github', 'workflows', 'agent-verify.yml');
    const githubDest = join(projectDir, '.github', 'workflows', 'agent-verify.yml');
    if (existsSync(githubWorkflow)) {
      if (!opts.force && existsSync(githubDest)) {
        log.warn('skip (exists): .github/workflows/agent-verify.yml');
      } else {
        mkdirSync(dirname(githubDest), { recursive: true });
        copyFileSync(githubWorkflow, githubDest);
        log.ok('.github/workflows/agent-verify.yml');
      }
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

    log.title('OpenSpec config template');
    installOpenspecConfigExample(projectDir, profile, vars, opts.force);

    log.title('Updating .gitignore');
    mergeGitignore(projectDir, GITIGNORE_LINES);

    log.title('Done');
    log.ok(`agent-orchestrator-kit v${KIT_VERSION} installed`);
    printNextSteps(profile, projectDir);
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

    log.ok(`Updated to v${KIT_VERSION}`);
    log.info('Run ./scripts/sync-local-agent-skills.sh to sync to local IDE');
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

    if (syncCursor) {
      log.info('Syncing .agents/ → .cursor/');
      copyDir(join(projectDir, '.agents', 'skills'), join(projectDir, '.cursor', 'skills'), { overwrite: true });
      copyDir(join(projectDir, '.agents', 'rules'), join(projectDir, '.cursor', 'rules'), { overwrite: true });

      const mcpExample = join(projectDir, '.agents', 'mcp.json.example');
      const mcpDest = join(projectDir, '.mcp.json');
      if (existsSync(mcpExample) && !existsSync(mcpDest)) {
        copyFileSync(mcpExample, mcpDest);
        log.ok('.mcp.json created from example');
      }
    }

    if (syncClaude) {
      log.info('Syncing .agents/ → .claude/');
      copyDir(join(projectDir, '.agents', 'skills'), join(projectDir, '.claude', 'skills'), { overwrite: true });

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

program.parse();
