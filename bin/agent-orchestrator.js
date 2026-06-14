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

function mergeGitignore(projectDir, lines) {
  const gitignorePath = join(projectDir, '.gitignore');
  let content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  let changed = false;
  for (const line of lines) {
    if (!content.includes(line)) {
      content += `\n${line}`;
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(gitignorePath, content.trimStart());
    log.ok('.gitignore updated');
  }
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

program
  .name('agent-orchestrator')
  .description('Universal AI agent orchestration kit for Cursor, Claude Code, and Amp Code')
  .version(KIT_VERSION);

program
  .command('init')
  .description('Install orchestrator kit into the current project')
  .option('--profile <profile>', 'Stack profile: generic | vue3 | node | python', 'generic')
  .option('--lang <lang>', 'Agent response language (en | uk | ...)', 'en')
  .option('--name <name>', 'Project name (defaults to directory name)')
  .option('--force', 'Overwrite existing files', false)
  .action((opts) => {
    const projectDir = process.cwd();
    const projectName = opts.name || basename(projectDir);

    log.title(`agent-orchestrator init  v${KIT_VERSION}`);
    log.info(`Project: ${projectName}`);
    log.info(`Profile: ${opts.profile}`);
    log.info(`Language: ${opts.lang}`);

    const templateDir = join(KIT_ROOT, 'templates');
    const profileDir = join(KIT_ROOT, 'profiles', opts.profile);
    const vars = { PROJECT_NAME: projectName, LANG: opts.lang, KIT_VERSION };

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
      const src = resolveTemplate(f, opts.profile);
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

    const orchSrc = resolveTemplate('orchestrator.yaml', opts.profile);
    const orchDest = join(projectDir, '.agents', 'orchestrator.yaml');
    if (!opts.force && existsSync(orchDest)) {
      log.warn('skip (exists): .agents/orchestrator.yaml');
    } else if (existsSync(orchSrc)) {
      copyFileSync(orchSrc, orchDest);
      applyPlaceholders(orchDest, vars);
      log.ok('.agents/orchestrator.yaml');
    }

    log.title('Updating .gitignore');
    mergeGitignore(projectDir, ['.cursor', '.cursor/memory.json', '.amp/settings.json']);

    log.title('Done');
    log.ok(`agent-orchestrator-kit v${KIT_VERSION} installed`);
    console.log(`
${pc.bold('Next steps:')}
  1. Review ${pc.cyan('AGENTS.md')} and ${pc.cyan('.agents/orchestrator.yaml')}
  2. Sync to your IDE:
     ${pc.cyan('./scripts/sync-local-agent-skills.sh')}
  3. Copy MCP config: .mcp.json (Cursor) / .amp/settings.json (Amp) from *.example files
  4. Start your first change:
     ${pc.cyan('/opsx:explore')}
`);
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
  .description('Sync .agents/ to local IDE directories (Cursor, Claude Code)')
  .option('--target <target>', 'cursor | claude | amp | all', 'all')
  .action((opts) => {
    const projectDir = process.cwd();

    log.title('agent-orchestrator sync');

    const syncCursor = ['cursor', 'all'].includes(opts.target);
    const syncClaude = ['claude', 'all'].includes(opts.target);

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

    log.ok('Sync complete');
    log.warn('.cursor/ and .claude/ are local only — not committed to git');
  });

program.parse();
