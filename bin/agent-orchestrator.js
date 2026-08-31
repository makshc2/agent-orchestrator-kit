#!/usr/bin/env node
import { program } from 'commander';
import pc from 'picocolors';
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync, rmSync, renameSync, chmodSync, realpathSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { collectSpend, enrichMetricsCursorEstimates } from './spend-collect.js';
import { resolveRestoreClient, ampThreadIdFromEnv } from './session-client.js';
import {
  earlierTimestamp,
  formatKyivDisplay,
  isoOrNull,
  laterTimestamp,
  nowUtcIso,
  parseFlexibleIso,
} from './metrics-time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = join(__dirname, '..');
const KIT_VERSION = JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf-8')).version;

const VALID_PROFILES = ['generic', 'vue3', 'node', 'mvp'];

function listTemplateKitSkillDirs() {
  const skillsDir = join(KIT_ROOT, 'templates', '.agents', 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((name) => {
      if (name.startsWith('subagent-')) return false;
      const full = join(skillsDir, name);
      return existsSync(full) && statSync(full).isDirectory();
    })
    .sort();
}

const KIT_MANAGED_PATHS = [
  '.agents/commands',
  '.agents/rules',
  '.agents/subagents',
  ...listTemplateKitSkillDirs().map((s) => `.agents/skills/${s}`),
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
  '.agents/github.local.env',
  '.agents/gitlab.local.env',
  '.agents/spend/',
];

const FIGMA_ENV_REL = join('.agents', 'figma.local.env');
const FIGMA_ENV_EXAMPLE_REL = join('.agents', 'figma.local.env.example');
const FIGMA_LAUNCHER_REL = join('scripts', 'figma-mcp-launcher.cjs');
const MEMORY_LAUNCHER_REL = join('scripts', 'memory-mcp-launcher.cjs');
const MEMORY_FILE_REL = join('.cursor', 'memory.json');
const GITHUB_ENV_REL = join('.agents', 'github.local.env');
const GITHUB_ENV_EXAMPLE_REL = join('.agents', 'github.local.env.example');
const GITHUB_LAUNCHER_REL = join('scripts', 'github-mcp-launcher.cjs');
const GITLAB_ENV_REL = join('.agents', 'gitlab.local.env');
const GITLAB_ENV_EXAMPLE_REL = join('.agents', 'gitlab.local.env.example');
const GITLAB_LAUNCHER_REL = join('scripts', 'gitlab-mcp-launcher.cjs');
const BROWSER_LAUNCHER_REL = join('scripts', 'browser-mcp-launcher.cjs');
const HOOK_SCRIPT_REL = join('scripts', 'pre-commit-gate-check.sh');
const CURSOR_SPEND_HOOK_REL = join('scripts', 'cursor-spend-hook.cjs');
const CURSOR_SPEND_COLLECT_REL = join('scripts', 'cursor-spend-collect.cjs');
const CURSOR_HOOKS_JSON_REL = join('.cursor', 'hooks.json');
const CURSOR_SPEND_HOOK_COMMAND = 'node scripts/cursor-spend-hook.cjs';
const CURSOR_SPEND_COLLECT_COMMAND = 'node scripts/cursor-spend-collect.cjs';
const CURSOR_SPEND_HOOK_EVENTS = ['stop', 'subagentStop', 'afterAgentResponse'];
const CURSOR_SPEND_COLLECT_EVENTS = ['sessionEnd'];
const CURSOR_USAGE_FILE_REL = join('.agents', 'spend', 'cursor-usage.jsonl');
const MCP_EXAMPLE_REL = join('.agents', 'mcp.json.example');
const AMP_EXAMPLE_REL = join('.agents', 'amp.settings.json.example');
const OPTIONAL_MCP_SEED_STRIP = ['github', 'gitlab', 'browser'];
const HOOK_MARKER = '# agent-orchestrator-kit gate';
const HOOK_LINE = 'sh scripts/pre-commit-gate-check.sh';
const DEFAULT_GITLAB_API_URL = 'https://gitlab.com/api/v4';
const DEFAULT_MCP_INVENTORY = {
  baseline: ['memory'],
  optional: ['figma', 'github', 'gitlab', 'browser'],
};
const FIGMA_MANAGED_PATHS = [
  FIGMA_ENV_EXAMPLE_REL,
  FIGMA_LAUNCHER_REL,
  MCP_EXAMPLE_REL,
  AMP_EXAMPLE_REL,
];
const MEMORY_MANAGED_PATHS = [
  MEMORY_LAUNCHER_REL,
  MCP_EXAMPLE_REL,
  AMP_EXAMPLE_REL,
];
const OPTIONAL_MCP_MANAGED_PATHS = [
  GITHUB_ENV_EXAMPLE_REL,
  GITHUB_LAUNCHER_REL,
  GITLAB_ENV_EXAMPLE_REL,
  GITLAB_LAUNCHER_REL,
  BROWSER_LAUNCHER_REL,
  HOOK_SCRIPT_REL,
  MCP_EXAMPLE_REL,
  AMP_EXAMPLE_REL,
];
const MCP_SERVER_CONFIGS = {
  github: { command: 'node', args: [GITHUB_LAUNCHER_REL.replace(/\\/g, '/')] },
  gitlab: { command: 'node', args: [GITLAB_LAUNCHER_REL.replace(/\\/g, '/')] },
  browser: { command: 'node', args: [BROWSER_LAUNCHER_REL.replace(/\\/g, '/')] },
};
const MCP_TOOL_META = {
  memory: { launcher: MEMORY_LAUNCHER_REL, envRel: null, tokenKeys: [] },
  figma: { launcher: FIGMA_LAUNCHER_REL, envRel: FIGMA_ENV_REL, tokenKeys: ['FIGMA_ACCESS_TOKEN', 'FIGMA_API_KEY'] },
  github: {
    launcher: GITHUB_LAUNCHER_REL,
    envRel: GITHUB_ENV_REL,
    tokenKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOKEN'],
    vcs: 'github',
  },
  gitlab: {
    launcher: GITLAB_LAUNCHER_REL,
    envRel: GITLAB_ENV_REL,
    tokenKeys: ['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_TOKEN'],
    vcs: 'gitlab',
  },
  browser: { launcher: BROWSER_LAUNCHER_REL, envRel: null, tokenKeys: [] },
};
const AMP_SPAWN_PREAMBLE =
  'CRITICAL (Amp / Cursor / Claude): Parent MUST spawn this skill as an isolated subagent with fresh context. Do not execute it in the main thread. If spawn is unavailable, STOP and report blocked — do not perform this specialist\'s work in the parent. Return only the structured subagent report.';
const HANDOFF_REQUIRED_SECTIONS = ['Closed role', 'Done', 'Next command'];
const HANDOFF_SECTIONS = [
  'Closed role',
  'Change',
  'Done',
  'Decisions',
  'Blocked',
  'Next command',
  'Next role',
  'Attach',
  'Subagents to spawn',
  'Constraints',
  'Runtime',
  'Metrics',
  'Prompt',
];
const CLOUD_ENV_MARKERS = ['CURSOR_BACKGROUND_AGENT'];
const VALID_RUNTIMES = new Set(['local', 'cloud']);
const CLOUD_PUSH_HINT = 'git push -u origin HEAD';

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

function memoryServerConfig() {
  return { command: 'node', args: [MEMORY_LAUNCHER_REL.replace(/\\/g, '/')] };
}

function isMemoryLauncher(server) {
  const args = server?.args || [];
  return server?.command === 'node' && args.some((arg) => String(arg).includes('memory-mcp-launcher.cjs'));
}

function refreshMemoryManagedFiles(projectDir) {
  const templateDir = join(KIT_ROOT, 'templates');
  for (const rel of MEMORY_MANAGED_PATHS) {
    const src = join(templateDir, rel);
    const dest = join(projectDir, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    log.ok(rel);
  }
}

function chmodX(filePath) {
  try {
    chmodSync(filePath, 0o755);
  } catch {}
}

function refreshManagedRelPaths(projectDir, rels) {
  const templateDir = join(KIT_ROOT, 'templates');
  for (const rel of rels) {
    const src = join(templateDir, rel);
    const dest = join(projectDir, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    if (rel.endsWith('.sh')) chmodX(dest);
    log.ok(rel);
  }
}

function refreshOptionalMcpManagedFiles(projectDir) {
  refreshManagedRelPaths(projectDir, OPTIONAL_MCP_MANAGED_PATHS);
}

function hookEventHasCommand(hooks, event, needle) {
  const entries = hooks[event];
  return Array.isArray(entries)
    && entries.some((entry) => entry && String(entry.command || '').includes(needle));
}

function cursorSpendHookEntryOk(projectDir) {
  const hooksPath = join(projectDir, CURSOR_HOOKS_JSON_REL);
  if (!existsSync(hooksPath)) return false;
  let config;
  try {
    config = JSON.parse(readFileSync(hooksPath, 'utf-8'));
  } catch {
    return false;
  }
  const hooks = config && typeof config === 'object' ? config.hooks : null;
  if (!hooks || typeof hooks !== 'object') return false;
  const writesOk = CURSOR_SPEND_HOOK_EVENTS.every((event) => hookEventHasCommand(hooks, event, 'cursor-spend-hook.cjs'));
  const collectOk = CURSOR_SPEND_COLLECT_EVENTS.every((event) => hookEventHasCommand(hooks, event, 'cursor-spend-collect.cjs'));
  return writesOk && collectOk;
}

// Mandatory spend capture: every kit project must record Cursor token usage
// locally so handoff/archive can collect real spend without manual flags.
function ensureManagedScript(projectDir, rel) {
  const src = join(KIT_ROOT, 'templates', rel);
  const dest = join(projectDir, rel);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

function mergeHookCommands(config, events, command, needle) {
  let changed = false;
  for (const event of events) {
    const entries = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    if (!entries.some((entry) => entry && String(entry.command || '').includes(needle))) {
      entries.push({ command });
      config.hooks[event] = entries;
      changed = true;
    }
  }
  return changed;
}

function ensureCursorSpendHook(projectDir) {
  const result = { script: false, hooksJson: false, error: null };
  if (ensureManagedScript(projectDir, CURSOR_SPEND_HOOK_REL)) result.script = true;
  ensureManagedScript(projectDir, CURSOR_SPEND_COLLECT_REL);

  const hooksPath = join(projectDir, CURSOR_HOOKS_JSON_REL);
  let config = { version: 1, hooks: {} };
  if (existsSync(hooksPath)) {
    try {
      config = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    } catch {
      result.error = `${CURSOR_HOOKS_JSON_REL} is not valid JSON — fix it, then re-run any kit command`;
      return result;
    }
  }
  if (!config || typeof config !== 'object') config = { version: 1, hooks: {} };
  if (config.version == null) config.version = 1;
  if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
  let changed = !existsSync(hooksPath);
  changed = mergeHookCommands(config, CURSOR_SPEND_HOOK_EVENTS, CURSOR_SPEND_HOOK_COMMAND, 'cursor-spend-hook.cjs') || changed;
  changed = mergeHookCommands(config, CURSOR_SPEND_COLLECT_EVENTS, CURSOR_SPEND_COLLECT_COMMAND, 'cursor-spend-collect.cjs') || changed;
  if (changed) {
    mkdirSync(dirname(hooksPath), { recursive: true });
    writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`);
    result.hooksJson = true;
  }
  return result;
}

function reportCursorSpendHook(projectDir, emit) {
  const result = ensureCursorSpendHook(projectDir);
  if (result.error) {
    emit.warn(`Cursor spend hook: ${result.error}`);
    return result;
  }
  if (result.script) emit.ok(CURSOR_SPEND_HOOK_REL);
  if (result.hooksJson) emit.ok(`${CURSOR_HOOKS_JSON_REL} (stop / subagentStop / afterAgentResponse + sessionEnd collect)`);
  return result;
}

function countCursorUsageRecords(projectDir) {
  const filePath = join(projectDir, CURSOR_USAGE_FILE_REL);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8').split('\n').filter((line) => line.trim()).length;
  } catch {
    return null;
  }
}

function printSpendHealth(projectDir) {
  console.log(pc.bold('\nSpend capture'));
  const scriptOk = existsSync(join(projectDir, CURSOR_SPEND_HOOK_REL));
  const entryOk = cursorSpendHookEntryOk(projectDir);
  const records = countCursorUsageRecords(projectDir);
  const cursorState = scriptOk && entryOk
    ? `ok${records != null ? ` (${records} records)` : ' (no turns recorded yet)'}`
    : 'optional — not configured (init/update/sync/mcp-setup)';
  console.log(`  cursor   ${cursorState}`);
  const home = process.env.HOME || '';
  const claudeOk = home && existsSync(join(home, '.claude', 'projects'));
  console.log(`  claude   ${claudeOk ? 'ok (~/.claude/projects)' : 'no local Claude data'}`);
  const ampDir = process.env.AMP_DATA_DIR && String(process.env.AMP_DATA_DIR).trim()
    ? String(process.env.AMP_DATA_DIR).trim()
    : join(home, '.local', 'share', 'amp');
  const ampOk = existsSync(join(ampDir, 'threads'));
  console.log(`  amp      ${ampOk ? 'ok (threads found)' : 'no local Amp data'}; locked client + amp threads export`);
  console.log('');
}

function parseGitRemoteHostname(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    if (/^(https?|ssh|git):\/\//i.test(raw)) {
      return new URL(raw).hostname.replace(/^www\./i, '').toLowerCase();
    }
  } catch {}
  const scp = raw.match(/^(?:[^@\s]+@)?([^:/\s]+)[:/]/);
  return scp ? scp[1].replace(/^www\./i, '').toLowerCase() : '';
}

function detectVcsHostFromRemoteUrl(url) {
  const hostname = parseGitRemoteHostname(url);
  if (!hostname) return { kind: 'none', hostname: '', apiUrl: '' };
  if (hostname === 'github.com') return { kind: 'github', hostname, apiUrl: '' };
  if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
    return { kind: 'gitlab', hostname, apiUrl: `https://${hostname}/api/v4` };
  }
  return { kind: 'none', hostname, apiUrl: '' };
}

function readGitOriginUrl(projectDir) {
  try {
    return execSync('git remote get-url origin', {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function detectVcsHost(projectDir) {
  return detectVcsHostFromRemoteUrl(readGitOriginUrl(projectDir));
}

function gitConfigGet(projectDir, key) {
  try {
    return execSync(`git config --get ${key}`, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

function isGitRepo(projectDir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function isKitHooksPath(value) {
  const v = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return v === '.githooks' || v.endsWith('/.githooks');
}

function ensureHookLine(filePath, { shebang = false } = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  let content = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : shebang ? '#!/usr/bin/env sh\n' : '';
  if (content.includes('pre-commit-gate-check.sh')) {
    chmodX(filePath);
    return { added: false };
  }
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  writeFileSync(filePath, `${content}${prefix}${HOOK_MARKER}\n${HOOK_LINE}\n`);
  chmodX(filePath);
  return { added: true };
}

function runHooksSetup(projectDir) {
  refreshManagedRelPaths(projectDir, [HOOK_SCRIPT_REL]);
  const huskyDir = join(projectDir, '.husky');
  if (existsSync(huskyDir) && statSync(huskyDir).isDirectory()) {
    const result = ensureHookLine(join(huskyDir, 'pre-commit'));
    if (result.added) log.ok('.husky/pre-commit ← gate line');
    else log.ok('.husky/pre-commit already has gate line');
    return { ok: true, mode: 'husky' };
  }

  if (!isGitRepo(projectDir)) {
    log.err('not a git repository — run git init, then re-run hooks-setup');
    return { ok: false, mode: 'none' };
  }

  const current = gitConfigGet(projectDir, 'core.hooksPath');
  if (current && !isKitHooksPath(current)) {
    log.err(`refusing to overwrite core.hooksPath (${current})`);
    log.info('Add this line to your existing pre-commit hook:');
    log.info(`  ${HOOK_LINE}`);
    log.info('Or reset: git config --unset core.hooksPath  then re-run hooks-setup');
    return { ok: false, mode: 'foreign' };
  }

  const result = ensureHookLine(join(projectDir, '.githooks', 'pre-commit'), { shebang: true });
  if (result.added) log.ok('.githooks/pre-commit');
  else log.ok('.githooks/pre-commit already present');
  if (!isKitHooksPath(current)) {
    execSync('git config core.hooksPath .githooks', { cwd: projectDir, stdio: 'pipe' });
    log.ok('core.hooksPath = .githooks');
  } else {
    log.ok('core.hooksPath already .githooks');
  }
  return { ok: true, mode: 'githooks' };
}

function ensureEnvFromExample(projectDir, destRel, exampleRel) {
  const dest = join(projectDir, destRel);
  const example = join(projectDir, exampleRel);
  const kitExample = join(KIT_ROOT, 'templates', exampleRel);
  if (existsSync(dest)) return { created: false, path: dest };
  const src = existsSync(example) ? example : kitExample;
  if (!existsSync(src)) throw new Error(`Missing template: ${exampleRel}`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return { created: true, path: dest };
}

function upsertEnvKey(filePath, key, value) {
  const raw = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  const next = re.test(raw)
    ? raw.replace(re, line)
    : `${raw}${raw && !raw.endsWith('\n') ? '\n' : ''}${line}\n`;
  writeFileSync(filePath, next.endsWith('\n') ? next : `${next}\n`);
}

function envHasAnyKey(projectDir, envRel, keys) {
  if (!envRel || !keys.length) return true;
  const values = parseEnvFile(join(projectDir, envRel));
  return keys.some((key) => Boolean(values[key]));
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function stripMcpServers(filePath, serversKey, names) {
  if (!existsSync(filePath) || !names.length) return;
  const cfg = readJsonFile(filePath);
  if (!cfg) return;
  const servers = cfg[serversKey] || {};
  let changed = false;
  for (const name of names) {
    if (servers[name]) {
      delete servers[name];
      changed = true;
    }
  }
  if (!changed) return;
  cfg[serversKey] = servers;
  writeJsonFile(filePath, cfg);
}

function seedLiveMcpFromExample(livePath, examplePath, serversKey, stripNames, label) {
  if (existsSync(livePath) || !existsSync(examplePath)) return false;
  copyFileSync(examplePath, livePath);
  stripMcpServers(livePath, serversKey, stripNames);
  log.ok(`${label} created from example`);
  return true;
}

function upsertMcpServer(cfg, key, name, server, label) {
  const servers = cfg[key] || {};
  if (servers[name]) {
    log.ok(`${label} already has ${name} server`);
  } else {
    servers[name] = server;
    log.ok(`${label} ← added ${name} server`);
  }
  cfg[key] = servers;
  return cfg;
}

function writeMcpServerEntry(filePath, serversKey, name, server, label) {
  if (!existsSync(filePath)) return;
  const cfg = readJsonFile(filePath);
  if (!cfg) {
    log.warn(`${label} present but invalid JSON — merge ${name} server manually from .agents/mcp.json.example`);
    return;
  }
  writeJsonFile(filePath, upsertMcpServer(cfg, serversKey, name, server, label));
}

function liveMcpHasServer(projectDir, name) {
  const cursor = readJsonFile(join(projectDir, '.mcp.json'));
  const amp = readJsonFile(join(projectDir, '.amp', 'settings.json'));
  return Boolean(cursor?.mcpServers?.[name] || amp?.['amp.mcpServers']?.[name]);
}

function undetectedVcsNames(kind) {
  if (kind === 'github') return ['gitlab'];
  if (kind === 'gitlab') return ['github'];
  return ['github', 'gitlab'];
}

function parseMcpInventory(content) {
  const baseline = [];
  const optional = [];
  let inMcp = false;
  let section = null;
  for (const line of String(content || '').split('\n')) {
    if (/^mcp:\s*$/.test(line)) {
      inMcp = true;
      section = null;
      continue;
    }
    if (inMcp && /^\S/.test(line)) break;
    if (!inMcp) continue;
    if (/^\s+baseline:\s*$/.test(line)) {
      section = 'baseline';
      continue;
    }
    if (/^\s+optional:\s*$/.test(line)) {
      section = 'optional';
      continue;
    }
    const item = line.match(/^\s+-\s+([A-Za-z0-9_-]+)\s*$/);
    if (item && section === 'baseline') baseline.push(item[1]);
    else if (item && section === 'optional') optional.push(item[1]);
  }
  return { baseline, optional };
}

function readMcpInventory(projectDir) {
  const orchPath = join(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(orchPath)) return { ...DEFAULT_MCP_INVENTORY };
  const parsed = parseMcpInventory(readFileSync(orchPath, 'utf-8'));
  if (!parsed.baseline.length && !parsed.optional.length) return { ...DEFAULT_MCP_INVENTORY };
  return parsed;
}

function parseSkillsInventory(content) {
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

function readSkillsInventory(projectDir) {
  const fallback = { kit: listTemplateKitSkillDirs(), stack: [], external: '' };
  const orchPath = join(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(orchPath)) return fallback;
  const parsed = parseSkillsInventory(readFileSync(orchPath, 'utf-8'));
  if (!parsed.found) return fallback;
  return { kit: parsed.kit, stack: parsed.stack, external: parsed.external };
}

function printMcpHealth(projectDir) {
  const inventory = readMcpInventory(projectDir);
  const tools = [...new Set([...inventory.baseline, ...inventory.optional])];
  if (!tools.length) return;
  const detected = detectVcsHost(projectDir);
  console.log(pc.bold('\nMCP health'));
  for (const name of tools) {
    const meta = MCP_TOOL_META[name] || { launcher: join('scripts', `${name}-mcp-launcher.cjs`), envRel: null, tokenKeys: [] };
    if (meta.vcs && detected.kind !== meta.vcs) {
      console.log(`  ${name.padEnd(8)} skipped (no origin match)`);
      continue;
    }
    const launcherOk = existsSync(join(projectDir, meta.launcher));
    const tokenOk = envHasAnyKey(projectDir, meta.envRel, meta.tokenKeys);
    const entryOk = liveMcpHasServer(projectDir, name);
    const ok = launcherOk && tokenOk && entryOk;
    console.log(`  ${name.padEnd(8)} ${ok ? 'ok' : 'not configured'}`);
  }
  console.log('');
}

function resolveMcpSetupVcs(projectDir, override) {
  const detected = detectVcsHost(projectDir);
  if (override === 'github' || override === 'gitlab') {
    if (override === 'gitlab') {
      const apiUrl = detected.kind === 'gitlab' && detected.apiUrl ? detected.apiUrl : DEFAULT_GITLAB_API_URL;
      return { kind: 'gitlab', hostname: detected.kind === 'gitlab' ? detected.hostname : 'gitlab.com', apiUrl, overridden: true };
    }
    return { kind: 'github', hostname: detected.hostname || 'github.com', apiUrl: '', overridden: true };
  }
  return { ...detected, overridden: false };
}

function runMcpSetup(projectDir, { vcs = '', browser = true } = {}) {
  refreshFigmaManagedFiles(projectDir);
  refreshMemoryManagedFiles(projectDir);
  refreshOptionalMcpManagedFiles(projectDir);
  reportCursorSpendHook(projectDir, log);
  mergeGitignore(projectDir, GITIGNORE_LINES);

  const selected = resolveMcpSetupVcs(projectDir, vcs);
  if (selected.kind === 'github') log.info('VCS MCP: github');
  else if (selected.kind === 'gitlab') log.info(`VCS MCP: gitlab (${selected.hostname})`);
  else log.info('VCS MCP: skipped (no origin match)');

  if (selected.kind === 'github') {
    const env = ensureEnvFromExample(projectDir, GITHUB_ENV_REL, GITHUB_ENV_EXAMPLE_REL);
    log.ok(env.created ? `Created ${GITHUB_ENV_REL}` : `${GITHUB_ENV_REL} already exists`);
    if (!envHasAnyKey(projectDir, GITHUB_ENV_REL, ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOKEN'])) {
      log.warn('GitHub token: missing — set GITHUB_PERSONAL_ACCESS_TOKEN in .agents/github.local.env (do not paste into chat)');
    }
  } else if (selected.kind === 'gitlab') {
    const env = ensureEnvFromExample(projectDir, GITLAB_ENV_REL, GITLAB_ENV_EXAMPLE_REL);
    log.ok(env.created ? `Created ${GITLAB_ENV_REL}` : `${GITLAB_ENV_REL} already exists`);
    upsertEnvKey(env.path, 'GITLAB_API_URL', selected.apiUrl || DEFAULT_GITLAB_API_URL);
    log.ok(`GITLAB_API_URL host: ${selected.hostname || 'gitlab.com'}`);
    if (!envHasAnyKey(projectDir, GITLAB_ENV_REL, ['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_TOKEN'])) {
      log.warn('GitLab token: missing — set GITLAB_PERSONAL_ACCESS_TOKEN in .agents/gitlab.local.env (do not paste into chat)');
    }
  }

  const cursorPath = join(projectDir, '.mcp.json');
  const ampPath = join(projectDir, '.amp', 'settings.json');
  const cursorExample = join(projectDir, MCP_EXAMPLE_REL);
  const ampExample = join(projectDir, AMP_EXAMPLE_REL);
  const stripOnCreate = [...undetectedVcsNames(selected.kind), ...(browser ? [] : ['browser'])];
  seedLiveMcpFromExample(cursorPath, cursorExample, 'mcpServers', stripOnCreate, '.mcp.json');
  mkdirSync(join(projectDir, '.amp'), { recursive: true });
  seedLiveMcpFromExample(ampPath, ampExample, 'amp.mcpServers', stripOnCreate, '.amp/settings.json');

  const namesToAdd = [];
  if (selected.kind === 'github' || selected.kind === 'gitlab') namesToAdd.push(selected.kind);
  if (browser) namesToAdd.push('browser');
  for (const name of namesToAdd) {
    const server = MCP_SERVER_CONFIGS[name];
    writeMcpServerEntry(cursorPath, 'mcpServers', name, server, '.mcp.json');
    writeMcpServerEntry(ampPath, 'amp.mcpServers', name, server, '.amp/settings.json');
  }

  if (!existsSync(cursorPath)) {
    log.warn('.mcp.json missing — copy from .agents/mcp.json.example then re-run mcp-setup');
  }
  if (!existsSync(ampPath)) {
    log.warn('.amp/settings.json missing — copy from .agents/amp.settings.json.example then re-run mcp-setup');
  }

  log.info('Restart Cursor / Amp after saving tokens');
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function upsertMemoryServer(cfg, key, label) {
  const servers = cfg[key] || {};
  const current = servers.memory;
  if (isMemoryLauncher(current)) {
    log.ok(`${label} already uses memory launcher`);
    cfg[key] = servers;
    return cfg;
  }
  servers.memory = memoryServerConfig();
  cfg[key] = servers;
  log.ok(`${label} ← memory launcher (absolute MEMORY_FILE_PATH)`);
  return cfg;
}

function ensureMemoryMcpEntry(projectDir) {
  mkdirSync(join(projectDir, '.cursor'), { recursive: true });
  const memoryFile = join(projectDir, MEMORY_FILE_REL);
  if (!existsSync(memoryFile)) {
    writeFileSync(memoryFile, '');
    log.ok('.cursor/memory.json created');
  }

  const examplePath = join(projectDir, MCP_EXAMPLE_REL);
  const cursorPath = join(projectDir, '.mcp.json');
  seedLiveMcpFromExample(cursorPath, examplePath, 'mcpServers', OPTIONAL_MCP_SEED_STRIP, '.mcp.json');
  if (existsSync(cursorPath)) {
    try {
      const cfg = upsertMemoryServer(JSON.parse(readFileSync(cursorPath, 'utf-8')), 'mcpServers', '.mcp.json');
      writeJsonFile(cursorPath, cfg);
    } catch {
      log.warn('.mcp.json present but invalid JSON — merge memory launcher from .agents/mcp.json.example');
    }
  }

  mkdirSync(join(projectDir, '.amp'), { recursive: true });
  const ampExample = join(projectDir, AMP_EXAMPLE_REL);
  const ampPath = join(projectDir, '.amp', 'settings.json');
  seedLiveMcpFromExample(ampPath, ampExample, 'amp.mcpServers', OPTIONAL_MCP_SEED_STRIP, '.amp/settings.json');
  if (existsSync(ampPath)) {
    try {
      const cfg = upsertMemoryServer(JSON.parse(readFileSync(ampPath, 'utf-8')), 'amp.mcpServers', '.amp/settings.json');
      writeJsonFile(ampPath, cfg);
    } catch {
      log.warn('.amp/settings.json present but invalid JSON — merge memory launcher manually');
    }
  }
}

function readOrchestratorMeta(projectDir) {
  const orchPath = join(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(orchPath)) return { agentLanguage: 'en' };
  const content = readFileSync(orchPath, 'utf-8');
  const lang = content.match(/agent_language:\s*["']?([A-Za-z_-]+)/);
  return { agentLanguage: lang ? lang[1] : 'en' };
}

function parseHandoffMarkdown(content) {
  const sections = {};
  const parts = String(content || '').split(/^## /m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = nl === -1 ? '' : part.slice(nl + 1).trim();
    sections[title] = body;
  }
  return sections;
}

function firstLineCommand(value) {
  const match = String(value || '').match(/\/opsx:[^\s`]+(?:\s+[^\s`]+)?/);
  if (match) return match[0].trim();
  return String(value || '').replace(/^[`\s]+|[`\s]+$/g, '').split('\n')[0].trim();
}

function firstSpawnName(value) {
  const tick = String(value || '').match(/`([a-z0-9-]+)`/i);
  if (tick) return tick[1];
  const word = String(value || '').match(/\b([a-z][a-z0-9-]{2,})\b/i);
  return word ? word[1] : '';
}

function sectionOr(sections, title, fallback = '') {
  const value = sections[title];
  return value && value.trim() ? value.trim() : fallback;
}

function parseRuntimeBulletFields(body) {
  const text = String(body || '');
  const runtimeMatch = text.match(/(?:^|\n)\s*[-*]?\s*runtime:\s*(\S+)/i);
  const agentMatch = text.match(/(?:^|\n)\s*[-*]?\s*agent_id:\s*(\S+)/i);
  return {
    runtime: runtimeMatch ? runtimeMatch[1].trim() : '',
    agentId: agentMatch ? agentMatch[1].trim() : '',
  };
}

function normalizeRuntimeToken(value) {
  const v = String(value || '').trim().toLowerCase();
  return VALID_RUNTIMES.has(v) ? v : '';
}

function resolveRuntime(opts, env, existingFields) {
  const flag = opts && opts.runtime != null ? String(opts.runtime).trim() : '';
  if (flag) {
    const normalized = normalizeRuntimeToken(flag);
    if (!normalized) return { error: 'invalid --runtime (use local or cloud)' };
    return { value: normalized };
  }
  const fromEnv = normalizeRuntimeToken(env && env.AOK_RUNTIME);
  if (fromEnv) return { value: fromEnv };
  for (const key of CLOUD_ENV_MARKERS) {
    const raw = env && env[key];
    if (raw != null && String(raw).trim() !== '') return { value: 'cloud' };
  }
  const existing = normalizeRuntimeToken(existingFields && existingFields.runtime);
  if (existing) return { value: existing };
  return { value: 'local' };
}

function resolveAgentId(opts, env, existingFields) {
  const flag = opts && opts.agentId != null ? String(opts.agentId).trim() : '';
  if (flag) return flag;
  const fromEnv = env && env.AOK_AGENT_ID != null ? String(env.AOK_AGENT_ID).trim() : '';
  if (fromEnv) return fromEnv;
  const existing = existingFields && existingFields.agentId != null ? String(existingFields.agentId).trim() : '';
  if (existing) return existing;
  return 'none';
}

function applyRuntimeToFields(fields, opts, env) {
  const resolved = resolveRuntime(opts, env, fields);
  if (resolved.error) {
    log.err(resolved.error);
    return false;
  }
  fields.runtime = resolved.value;
  fields.agentId = resolveAgentId(opts, env, fields);
  return true;
}

const VALID_PLATFORMS = new Set(['cursor', 'claude', 'amp']);
const METRICS_NULL_TOKENS = new Set(['unknown', 'none', 'n/a', 'na', '-', '—', '–', 'null']);

function emptyMetricsFields(warnings = []) {
  return {
    platform: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
    ampCredits: null,
    spendSource: null,
    warnings,
  };
}

function normalizeMetricsBlank(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (METRICS_NULL_TOKENS.has(lower) || METRICS_NULL_TOKENS.has(raw)) return null;
  return raw;
}

function parseMetricsNumber(raw, key, warnings) {
  const normalized = normalizeMetricsBlank(raw);
  if (normalized == null) return null;
  const cleaned = normalized.replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    warnings.push(`metrics: unparsable ${key} in ## Metrics: ${raw}`);
    return null;
  }
  return n;
}

function parseMetricsSection(body) {
  const warnings = [];
  const values = {};
  const present = new Set();
  for (const line of String(body || '').split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    values[key] = match[2].trim();
    present.add(key);
  }
  const result = emptyMetricsFields(warnings);
  const platformRaw = normalizeMetricsBlank(values.platform);
  if (platformRaw) {
    const lower = platformRaw.toLowerCase();
    if (VALID_PLATFORMS.has(lower)) result.platform = lower;
    else {
      result.platform = null;
      warnings.push(`metrics: invalid platform in ## Metrics: ${platformRaw}`);
    }
  }
  result.model = normalizeMetricsBlank(values.model);
  result.inputTokens = parseMetricsNumber(values.input_tokens, 'input_tokens', warnings);
  result.outputTokens = parseMetricsNumber(values.output_tokens, 'output_tokens', warnings);
  result.totalTokens = present.has('total_tokens')
    ? parseMetricsNumber(values.total_tokens, 'total_tokens', warnings)
    : null;
  result.costUsd = parseMetricsNumber(values.cost_usd, 'cost_usd', warnings);
  result.ampCredits = parseMetricsNumber(values.amp_credits, 'amp_credits', warnings);
  result.spendSource = normalizeMetricsBlank(values.spend_source);
  return result;
}

function formatMetricsField(value) {
  return value == null || value === '' ? 'unknown' : String(value);
}

function renderMetricsSection(metrics) {
  const m = metrics || emptyMetricsFields();
  return `## Metrics
- platform: ${formatMetricsField(m.platform)}
- model: ${formatMetricsField(m.model)}
- input_tokens: ${formatMetricsField(m.inputTokens)}
- output_tokens: ${formatMetricsField(m.outputTokens)}
- cost_usd: ${formatMetricsField(m.costUsd)}
- amp_credits: ${formatMetricsField(m.ampCredits)}
- spend_source: ${formatMetricsField(m.spendSource)}`;
}

function printMetricsSectionWarnings(metrics, platformAlreadyWarned) {
  for (const warning of (metrics && metrics.warnings) || []) {
    if (platformAlreadyWarned && /invalid platform/i.test(warning)) continue;
    console.error(warning);
  }
}

function firstNonNull(...values) {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

function isPlaceholderModel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['unknown', 'none', 'n/a', '-', '—', 'null', 'amp-default'].includes(normalized);
}

function resolveModel(opts, env, reported) {
  const pick = (value) => {
    const text = value == null ? '' : String(value).trim();
    if (!text || isPlaceholderModel(text)) return '';
    return text;
  };
  const flag = pick(opts && opts.model);
  if (flag) return flag;
  const fromReport = pick(reported && reported.model);
  if (fromReport) return fromReport;
  const fromEnv = pick(env && env.AOK_MODEL);
  if (fromEnv) return fromEnv;
  return null;
}

function envFlagOn(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

function inferPlatformFromHost(env) {
  if (!env) return null;
  if (env.AMP_CURRENT_THREAD != null && String(env.AMP_CURRENT_THREAD).trim()) return 'amp';
  if (env.AMP_THREAD_ID != null && String(env.AMP_THREAD_ID).trim()) return 'amp';
  if (envFlagOn(env.CURSOR_AGENT) || (env.CURSOR_CONVERSATION_ID != null && String(env.CURSOR_CONVERSATION_ID).trim())) {
    return 'cursor';
  }
  if (envFlagOn(env.CLAUDECODE) || envFlagOn(env.CLAUDE_CODE) || (env.CLAUDE_CODE_ENTRYPOINT != null && String(env.CLAUDE_CODE_ENTRYPOINT).trim())) {
    return 'claude';
  }
  return null;
}

function resolvePlatform(opts, env, reported, pending) {
  const flag = opts && opts.platform != null ? String(opts.platform).trim() : '';
  if (flag) {
    const lower = flag.toLowerCase();
    if (!VALID_PLATFORMS.has(lower)) {
      return { error: 'invalid --platform (use cursor, claude, or amp)' };
    }
    return { value: lower };
  }
  const fromReport = reported && reported.platform != null ? String(reported.platform).trim() : '';
  if (fromReport) {
    const lower = fromReport.toLowerCase();
    if (VALID_PLATFORMS.has(lower)) return { value: lower };
    return { value: null, warn: 'invalid platform in ## Metrics (use cursor, claude, or amp)' };
  }
  const fromEnv = env && env.AOK_PLATFORM != null ? String(env.AOK_PLATFORM).trim() : '';
  if (fromEnv) {
    const lower = fromEnv.toLowerCase();
    if (VALID_PLATFORMS.has(lower)) return { value: lower };
    return { value: null, warn: 'invalid AOK_PLATFORM (use cursor, claude, or amp)' };
  }
  const pendingPlatform = pending && pending.platform != null ? String(pending.platform).trim() : '';
  if (pendingPlatform && VALID_PLATFORMS.has(pendingPlatform)) {
    return { value: pendingPlatform };
  }
  return { value: inferPlatformFromHost(env) };
}

function warnMissingModel() {
  console.error('metrics: session.model is null — pass --model <llm-product-id> or set AOK_MODEL');
}

function warnMissingUsd() {
  console.error('metrics: spend.costUsd is null — USD spend was not collected');
}

function warnUnreportedSelfReport() {
  console.error(
    'metrics: session spend is unreported — fill ## Metrics in handoff.md with platform, model, input_tokens, output_tokens, cost_usd, amp_credits, spend_source (use unknown when a value is missing)',
  );
}

function gitTry(projectDir, command) {
  try {
    const stdout = execSync(command, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return { ok: true, stdout: String(stdout || '') };
  } catch (e) {
    return {
      ok: false,
      stdout: String((e && e.stdout) || ''),
      stderr: String((e && e.stderr) || (e && e.message) || ''),
    };
  }
}

function porcelainChangePaths(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim());
}

function collectCloudCheckFindings(projectDir, name) {
  const findings = [];
  const rel = `openspec/changes/${name}/`;
  const status = gitTry(projectDir, `git status --porcelain -- ${rel}`);
  if (!status.ok) {
    const detail = status.stderr.trim().split('\n')[0];
    findings.push(detail ? `git status failed for ${rel}: ${detail}` : `git status failed for ${rel}`);
    findings.push(CLOUD_PUSH_HINT);
  } else {
    findings.push(...porcelainChangePaths(status.stdout));
  }

  const upstream = gitTry(projectDir, "git rev-parse --abbrev-ref '@{upstream}'");
  if (!upstream.ok) {
    findings.push(CLOUD_PUSH_HINT);
  } else {
    const count = gitTry(projectDir, "git rev-list --count '@{upstream}..HEAD'");
    if (!count.ok) {
      findings.push(CLOUD_PUSH_HINT);
    } else {
      const n = Number.parseInt(String(count.stdout).trim(), 10);
      if (!Number.isFinite(n) || n > 0) findings.push(CLOUD_PUSH_HINT);
    }
  }

  return [...new Set(findings)];
}

function printCloudPersistNextSteps(name) {
  console.error('Cloud session exit is incomplete until artifacts are on the remote:');
  console.error(`  git add openspec/changes/${name}/`);
  console.error('  git commit');
  console.error('  git push');
  console.error(`  npx agent-orchestrator-kit handoff ${name} --cloud-check`);
  console.error('Require --cloud-check exit 0 before closing.');
}

function buildHandoffMarkdown(fields) {
  const prompt = fields.prompt ? `\n\n## Prompt\n\n\`\`\`text\n${fields.prompt}\n\`\`\`` : '';
  const runtime = fields.runtime || 'local';
  const agentId = fields.agentId || 'none';
  return `# Session Handoff

## Closed role
${fields.closedRole}

## Change
${fields.change}

## Done
${fields.done}

## Decisions
${fields.decisions}

## Blocked
${fields.blocked}

## Next command
\`${fields.nextCommand}\`

## Next role
${fields.nextRole}

## Attach
${fields.attach}

## Subagents to spawn
${fields.spawn}

## Constraints
${fields.constraints}

## Runtime
- runtime: ${runtime}
- agent_id: ${agentId}

${renderMetricsSection(fields.metrics)}${prompt}
`;
}

function fieldsFromSections(changeName, sections, extra = {}) {
  const nextCommand = extra.nextCommand || firstLineCommand(sectionOr(sections, 'Next command'));
  const runtimeParsed = parseRuntimeBulletFields(sectionOr(sections, 'Runtime', ''));
  return {
    changeName,
    closedRole: extra.closedRole || sectionOr(sections, 'Closed role', extra.closedRole || ''),
    change: extra.change || sectionOr(sections, 'Change', `- name: ${changeName}`),
    done: extra.done || extra.summary || sectionOr(sections, 'Done', extra.done || ''),
    decisions: extra.decisions || sectionOr(sections, 'Decisions', 'none'),
    blocked: extra.blocked || sectionOr(sections, 'Blocked', 'none'),
    nextCommand,
    nextRole: extra.nextRole || sectionOr(sections, 'Next role', ''),
    attach: extra.attach || sectionOr(sections, 'Attach', `- \`openspec/changes/${changeName}/\``),
    spawn: extra.spawn || sectionOr(sections, 'Subagents to spawn', ''),
    constraints: extra.constraints || sectionOr(sections, 'Constraints', ''),
    runtime: extra.runtime || runtimeParsed.runtime,
    agentId: extra.agentId || runtimeParsed.agentId,
    metrics: extra.metrics || parseMetricsSection(sectionOr(sections, 'Metrics', '')),
    status: extra.status || '',
    tasks: extra.tasks || '',
    review: extra.review || '',
    sessionCount: extra.sessionCount || '',
    summary: extra.summary || extra.done || sectionOr(sections, 'Done', ''),
  };
}

function missingHandoffFields(fields) {
  const missing = [];
  if (!fields.closedRole) missing.push('Closed role');
  if (!fields.done) missing.push('Done');
  if (!fields.nextCommand) missing.push('Next command');
  return missing;
}

function isUkLang(lang) {
  const value = String(lang || 'en').toLowerCase();
  return value === 'uk' || value.startsWith('uk');
}

function buildNextSessionPrompt(fields, agentLanguage) {
  const name = fields.changeName;
  const cmd = firstLineCommand(fields.nextCommand);
  const spawnName = firstSpawnName(fields.spawn) || firstSpawnName(fields.nextRole);
  const ampWrapper = spawnName ? `subagent-${spawnName}` : 'subagent-<phase-specialist>';
  const uk = isUkLang(agentLanguage);
  const languageName = uk ? 'українська' : 'English';

  if (uk) {
    return `${cmd}

Ти — conductor наступної рольової сесії для зміни \`${name}\`.
Мова відповіді: ${languageName} (\`project.agent_language: ${agentLanguage}\`).
НЕ змішуй фази. НЕ починай наступну роль у цьому ж чаті, доки ця фаза не закрита за HARD STOP.

## Хто ти і що робити
- Команда цієї сесії: \`${cmd}\`
- Наступна роль / субагент фази: \`${spawnName || fields.nextRole || 'див. таблицю маршрутизації'}\`
- Amp: заспавни isolated skill \`${ampWrapper}\` зі свіжим контекстом. Виконувати тіло спеціаліста в головному треді Amp — порушення протоколу.
- Cursor / Claude: заспавни \`.cursor/agents/${spawnName || '<name>'}.md\` / \`.claude/agents/${spawnName || '<name>'}.md\`.
- Батьківська сесія — лише conductor: перевіряє звіт, не виконує роботу спеціаліста.

## Обов'язковий старт (до будь-якої роботи спеціаліста)
1. Виконай pasted-команду \`${cmd}\` і оголоси роль.
2. \`npx agent-orchestrator-kit status\`
3. \`npx agent-orchestrator-kit handoff ${name} --restore\`
4. Прочитай Memory MCP: \`Change:${name}\`, \`Handoff:${name}\`, \`Decision:*\`.
5. Якщо Memory порожнє або MCP недоступний — прочитай \`openspec/changes/${name}/handoff.md\`. Відсутність Memory НЕ блокує сесію, коли є файл.
6. Заспавни \`session-handoff\` у режимі restore, якщо брифінг неповний (Amp: isolated \`subagent-session-handoff\`).
7. Лише після цього заспавни субагента фази. Free-form «продовжуй» / «далі» при одній активній зміні = \`Handoff.next_command\`.

## Повний контекст попередньої сесії (самодостатній — не покладайся лише на Memory)
- Закрита роль: ${fields.closedRole || 'не вказано'}
- Зміна: ${fields.change || name}
- Зроблено:
${fields.done || 'не вказано'}
- Рішення:
${fields.decisions || 'none'}
- Блокери:
${fields.blocked || 'none'}
- Attach:
${fields.attach || `- \`openspec/changes/${name}/\``}
- Субагенти цієї сесії:
${fields.spawn || `- \`${spawnName || 'phase specialist'}\``}
- Обмеження:
${fields.constraints || 'не змішувати фази; не писати поза дозволеними шляхами ролі'}
${fields.status ? `- status: ${fields.status}` : ''}
${fields.tasks ? `- tasks: ${fields.tasks}` : ''}
${fields.review ? `- review: ${fields.review}` : ''}

## HARD STOP на виході (ти НЕ закінчив, поки це не виконано)
1. Заспавни \`session-handoff\` у режимі persist (Amp: isolated \`subagent-session-handoff\`). Якщо spawn недоступний — зроби persist сам, ніколи не пропускай.
2. Запиши \`openspec/changes/${name}/handoff.md\` з усіма секціями шаблону.
3. \`npx agent-orchestrator-kit handoff ${name}\` — exit 0 обов'язковий. CLI записує Memory JSON абсолютним шляхом і друкує розширений промпт у stdout.
4. Якщо Memory MCP живий — онови \`Change:${name}\`, \`Handoff:${name}\`, \`Decision:*\` відповідно до файлу.
5. Встав stdout CLI у чат одним fenced-блоком. Не скорочуй. Без службового ярлика. Перший рядок — \`/opsx:…\`.
6. Зупинись. Наступна роль починається в НОВОМУ чаті з цим промптом.

OpenSpec-файли — source of truth для вимог і тасків. Memory і handoff.md — індекс фази. Цей промпт — повний операційний бриф наступного треду, навіть якщо Amp проігнорує Memory MCP.`;
  }

  return `${cmd}

You are the conductor for the next role session of change \`${name}\`.
Reply language: ${languageName} (\`project.agent_language: ${agentLanguage}\`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: \`${cmd}\`
- Next role / phase subagent: \`${spawnName || fields.nextRole || 'see routing table'}\`
- Amp: spawn isolated skill \`${ampWrapper}\` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn \`.cursor/agents/${spawnName || '<name>'}.md\` / \`.claude/agents/${spawnName || '<name>'}.md\`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted \`${cmd}\` command and announce the role.
2. \`npx agent-orchestrator-kit status\`
3. \`npx agent-orchestrator-kit handoff ${name} --restore\`
4. Read Memory MCP: \`Change:${name}\`, \`Handoff:${name}\`, \`Decision:*\`.
5. If Memory is empty or MCP is down, read \`openspec/changes/${name}/handoff.md\`. Missing Memory does not block the session when the file exists.
6. Spawn \`session-handoff\` in restore mode if the briefing is incomplete (Amp: isolated \`subagent-session-handoff\`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means \`Handoff.next_command\`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: ${fields.closedRole || 'not set'}
- Change: ${fields.change || name}
- Done:
${fields.done || 'not set'}
- Decisions:
${fields.decisions || 'none'}
- Blocked:
${fields.blocked || 'none'}
- Attach:
${fields.attach || `- \`openspec/changes/${name}/\``}
- Subagents for this session:
${fields.spawn || `- \`${spawnName || 'phase specialist'}\``}
- Constraints:
${fields.constraints || 'do not mix phases; do not write outside the role allowed paths'}
${fields.status ? `- status: ${fields.status}` : ''}
${fields.tasks ? `- tasks: ${fields.tasks}` : ''}
${fields.review ? `- review: ${fields.review}` : ''}

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn \`session-handoff\` in persist mode (Amp: isolated \`subagent-session-handoff\`). If spawn is unavailable, persist yourself — never skip.
2. Write \`openspec/changes/${name}/handoff.md\` with every template section.
3. \`npx agent-orchestrator-kit handoff ${name}\` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update \`Change:${name}\`, \`Handoff:${name}\`, \`Decision:*\` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is \`/opsx:…\`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.`;
}

function loadMemoryItems(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const entities = (parsed.entities || []).map((entity) => ({ type: 'entity', ...entity }));
      const relations = (parsed.relations || []).map((relation) => ({ type: 'relation', ...relation }));
      return [...entities, ...relations];
    } catch {
      return [];
    }
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function saveMemoryItems(filePath, items) {
  mkdirSync(dirname(filePath), { recursive: true });
  const body = items.map((item) => JSON.stringify(item)).join('\n');
  writeFileSync(filePath, body ? `${body}\n` : '');
}

function upsertMemoryEntity(items, name, entityType, observations) {
  const entity = { type: 'entity', name, entityType, observations };
  const idx = items.findIndex((item) => item.type === 'entity' && item.name === name);
  if (idx >= 0) items[idx] = entity;
  else items.push(entity);
}

function parseDecisionItems(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter((line) => line && !/^none$/i.test(line));
}

function decisionTopic(text) {
  const value = String(text || '');
  const topicMatch = value.match(/^([^:]+):/);
  return (topicMatch ? topicMatch[1] : value).trim().slice(0, 80) || value.slice(0, 80);
}

function normalizeDecisionText(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function localIsoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function decisionsFilePath(projectDir, changeName) {
  return join(projectDir, 'openspec', 'changes', changeName, 'decisions.md');
}

function parseDecisionsFileEntries(content) {
  const entries = [];
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = line.match(/^- (\d{4}-\d{2}-\d{2}) (.+)$/);
    if (match) entries.push({ date: match[1], text: match[2] });
  }
  return entries;
}

function appendDecisionsFromHandoff(projectDir, changeName, decisionsText) {
  const items = parseDecisionItems(decisionsText);
  if (!items.length) return;
  const filePath = decisionsFilePath(projectDir, changeName);
  const header = `# Decisions — ${changeName}\n\n<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->\n\n`;
  let body = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : header;
  const seen = new Set(parseDecisionsFileEntries(body).map((entry) => normalizeDecisionText(entry.text)));
  const date = localIsoDate();
  const additions = [];
  for (const item of items) {
    const norm = normalizeDecisionText(item);
    if (seen.has(norm)) continue;
    seen.add(norm);
    additions.push(`- ${date} ${item}`);
  }
  if (!additions.length) return;
  if (!body.endsWith('\n')) body += '\n';
  writeFileSync(filePath, `${body}${additions.join('\n')}\n`);
}

function persistMemoryFromHandoff(projectDir, fields) {
  const filePath = resolve(projectDir, MEMORY_FILE_REL);
  const items = loadMemoryItems(filePath);
  const name = fields.changeName;
  const changeObs = [
    fields.status ? `status: ${fields.status}` : null,
    fields.tasks ? `tasks: ${fields.tasks}` : null,
    fields.closedRole ? `last_role: ${fields.closedRole}` : null,
    fields.review ? `review: ${fields.review}` : null,
    fields.summary ? `summary: ${fields.summary}` : null,
  ].filter(Boolean);
  if (changeObs.length) upsertMemoryEntity(items, `Change:${name}`, 'Change', changeObs);

  const handoffObs = [
    fields.nextRole ? `next_role: ${fields.nextRole}` : null,
    fields.nextCommand ? `next_command: ${fields.nextCommand}` : null,
    fields.sessionCount ? `session_count: ${fields.sessionCount}` : null,
    fields.summary ? `summary: ${fields.summary}` : null,
    fields.blocked ? `blocked: ${fields.blocked}` : null,
  ].filter(Boolean);
  if (handoffObs.length) upsertMemoryEntity(items, `Handoff:${name}`, 'Handoff', handoffObs);

  const decisionsPath = decisionsFilePath(projectDir, name);
  if (existsSync(decisionsPath)) {
    for (const entry of parseDecisionsFileEntries(readFileSync(decisionsPath, 'utf-8'))) {
      upsertMemoryEntity(items, `Decision:${decisionTopic(entry.text)}`, 'Decision', [`chosen: ${entry.text}`]);
    }
  }

  saveMemoryItems(filePath, items);
  return filePath;
}

function resolveHandoffChange(projectDir, requested) {
  if (requested) return requested;
  const changes = listActiveChanges(projectDir);
  if (changes.length === 1) return changes[0];
  if (changes.length === 0) return null;
  return { ambiguous: changes };
}

function readHandoffFields(projectDir, changeName) {
  const filePath = join(projectDir, 'openspec', 'changes', changeName, 'handoff.md');
  if (!existsSync(filePath)) return { filePath, fields: null };
  const sections = parseHandoffMarkdown(readFileSync(filePath, 'utf-8'));
  return { filePath, fields: fieldsFromSections(changeName, sections) };
}

const METRICS_VERSION = 1;
const METRICS_SPEND_KEYS = ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'costUsdEstimated'];
const LEFTOVER_GRACE_MS = 120000;

function metricsFilePath(projectDir, changeName) {
  return join(projectDir, 'openspec', 'changes', changeName, 'metrics.json');
}

function emptySpendTotals() {
  return { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, costUsdEstimated: null };
}

function emptyPlatformSpend(source = 'none') {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
    ampCredits: null,
    costUsdEstimated: null,
    source,
  };
}

function defaultSpendByPlatform() {
  return {
    cursor: emptyPlatformSpend(),
    claude: emptyPlatformSpend(),
    amp: emptyPlatformSpend(),
  };
}

function mergeSpendByPlatform(raw) {
  const base = defaultSpendByPlatform();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  for (const key of ['cursor', 'claude', 'amp']) {
    const row = raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]) ? raw[key] : {};
    base[key] = { ...base[key], ...row };
  }
  return base;
}

function defaultMetrics(changeName, nowIso) {
  return {
    version: METRICS_VERSION,
    change: changeName,
    createdAt: nowIso,
    updatedAt: nowIso,
    archivedAt: null,
    spend: emptySpendTotals(),
    spendByPlatform: defaultSpendByPlatform(),
    spendByModel: [],
    totals: { sessions: 0, durationMs: null, leadTimeMs: null, cloudSessions: 0 },
    phases: {},
    sessions: [],
    pending: null,
  };
}

function loadMetricsFile(filePath, changeName, nowIso) {
  if (!existsSync(filePath)) return defaultMetrics(changeName, nowIso);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return defaultMetrics(changeName, nowIso);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaultMetrics(changeName, nowIso);
  }
  const base = defaultMetrics(changeName, parsed.createdAt || nowIso);
  return {
    ...base,
    ...parsed,
    version: METRICS_VERSION,
    change: changeName,
    spend: { ...base.spend, ...(parsed.spend && typeof parsed.spend === 'object' ? parsed.spend : {}) },
    spendByPlatform: mergeSpendByPlatform(parsed.spendByPlatform),
    spendByModel: Array.isArray(parsed.spendByModel) ? parsed.spendByModel : [],
    totals: { ...base.totals, ...(parsed.totals && typeof parsed.totals === 'object' ? parsed.totals : {}) },
    phases: parsed.phases && typeof parsed.phases === 'object' && !Array.isArray(parsed.phases) ? parsed.phases : {},
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  };
}

function saveMetricsFile(filePath, metrics) {
  mkdirSync(dirname(filePath), { recursive: true });
  const out = { ...metrics };
  delete out.timezone;
  writeFileSync(filePath, `${JSON.stringify(out, null, 2)}\n`);
}

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addNullable(a, b) {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function canonicalRole(role) {
  const raw = String(role || '').trim();
  if (!raw) return '';
  const segment = raw.split(/[—,]/)[0].trim();
  const known = (text) => {
    const value = String(text || '').trim();
    if (/^spec\s+reviewer\b/i.test(value)) return 'Spec Reviewer';
    if (/^design\s+intake\b/i.test(value)) return 'Design Intake';
    if (/^explorer\b/i.test(value)) return 'Explorer';
    if (/^architect\b/i.test(value)) return 'Architect';
    if (/^implementer\b/i.test(value)) return 'Implementer';
    if (/^archiver\b/i.test(value)) return 'Archiver';
    return '';
  };
  return known(segment) || known(raw) || segment;
}

function phaseForRole(role) {
  const value = String(role || '').toLowerCase();
  if (/explor/.test(value)) return 'explore';
  if (/architect|propose/.test(value)) return 'spec';
  if (/review/.test(value)) return 'review';
  if (/implement|apply|code-writer|test-writer/.test(value)) return 'apply';
  if (/design/.test(value)) return 'design';
  if (/archiv/.test(value)) return 'archive';
  return 'other';
}

function sessionFieldOrSources(session, key) {
  if (session[key] != null && session[key] !== '') return numOrNull(session[key]);
  let sum = null;
  for (const src of session.sources || []) {
    sum = addNullable(sum, numOrNull(src[key]));
  }
  return sum;
}

function lastSessionEndedAt(metrics) {
  let last = null;
  for (const session of metrics.sessions || []) {
    if (session.endedAt) last = last == null ? session.endedAt : laterTimestamp(last, session.endedAt);
  }
  return last;
}

function collectWindowStart(metrics, extra) {
  return (extra && extra.startedAt) || (metrics.pending && metrics.pending.startedAt) || null;
}

function leftoverGraceEnd(endedAt) {
  const ms = parseFlexibleIso(endedAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + LEFTOVER_GRACE_MS).toISOString();
}

function leftoverTimestampInWindow(at, windowStart, leftoverEnd, exclusiveEnd) {
  const t = parseFlexibleIso(at);
  if (!Number.isFinite(t)) return false;
  const start = parseFlexibleIso(windowStart);
  if (Number.isFinite(start) && t < start) return false;
  const end = parseFlexibleIso(leftoverEnd);
  if (Number.isFinite(end)) {
    if (exclusiveEnd) {
      if (t >= end) return false;
    } else if (t > end) return false;
  }
  return true;
}

function sessionSpendIsFrozen(session) {
  if (!session) return false;
  if (session.spendSource === 'flag') return true;
  if (!reportedHasSpendNumbers(session)) return false;
  if (!session.spendSource || session.spendSource === 'adapter' || session.spendSource === 'unreported') return false;
  return true;
}

function existingSourceRecords(metrics) {
  const out = [];
  for (const session of metrics.sessions || []) {
    for (const src of session.sources || []) {
      if (src) out.push(src);
    }
  }
  return out;
}

function existingSourceIdSet(metrics) {
  const ids = new Set();
  for (const session of metrics.sessions || []) {
    for (const src of session.sources || []) {
      if (src && src.id != null && src.id !== '') ids.add(String(src.id));
    }
  }
  return ids;
}

function lastNonArchiverSession(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].role !== 'Archiver') return list[i];
  }
  return null;
}

function dropStaleArchiveSelfReport(reported, sessions) {
  const base = reported && typeof reported === 'object' ? { ...reported } : emptyMetricsFields();
  const last = lastNonArchiverSession(sessions);
  if (!last) return base;
  const sameInput = numOrNull(base.inputTokens) != null && numOrNull(base.inputTokens) === numOrNull(last.inputTokens);
  const sameOutput = numOrNull(base.outputTokens) === numOrNull(last.outputTokens);
  if (sameInput && sameOutput) {
    base.inputTokens = null;
    base.outputTokens = null;
    base.totalTokens = null;
    base.costUsd = null;
    base.ampCredits = null;
    if (!base.spendSource || base.spendSource === 'self-report') base.spendSource = null;
  }
  if (base.model && last.model && base.model === last.model) base.model = null;
  if (base.platform && last.platform && base.platform === last.platform) base.platform = null;
  return base;
}

function uniqueSourceModels(sources) {
  const seen = [];
  for (const src of sources || []) {
    if (src.model && !seen.includes(src.model)) seen.push(src.model);
  }
  return seen;
}

function rankSources(sources) {
  return [...sources].sort((a, b) => {
    const ta = a.totalTokens ?? 0;
    const tb = b.totalTokens ?? 0;
    if (tb !== ta) return tb - ta;
    const platformCmp = String(a.platform || '').localeCompare(String(b.platform || ''));
    if (platformCmp !== 0) return platformCmp;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function primaryModelFromSources(sources) {
  const withModel = (sources || []).filter((src) => src && src.model);
  if (!withModel.length) return null;
  const top = rankSources(withModel)[0];
  const model = top && top.model;
  return model == null || model === '' ? null : String(model);
}

function primaryPlatformFromSources(sources) {
  if (!sources || !sources.length) return null;
  const platform = rankSources(sources)[0] && rankSources(sources)[0].platform;
  return platform && VALID_PLATFORMS.has(platform) ? platform : null;
}

function hasSpendOverride(opts) {
  return Boolean(
    opts
    && (opts.inputTokens != null || opts.outputTokens != null || opts.totalTokens != null || opts.costUsd != null || opts.ampCredits != null),
  );
}

function reportedHasSpendNumbers(reported) {
  if (!reported) return false;
  return (
    reported.inputTokens != null
    || reported.outputTokens != null
    || reported.totalTokens != null
    || reported.costUsd != null
    || reported.ampCredits != null
  );
}

function sourceAmpCredits(sources) {
  let sum = null;
  for (const src of sources || []) {
    sum = addNullable(sum, numOrNull(src.ampCredits));
  }
  return sum;
}

function sourceEstimatedUsd(sources) {
  let sum = null;
  for (const src of sources || []) {
    sum = addNullable(sum, numOrNull(src.costUsdEstimated));
  }
  return sum;
}

function ampThreadTotals(threads) {
  const list = Array.isArray(threads) ? threads : [];
  let costUsd = null;
  let agentMode = null;
  const models = [];
  for (const thread of list) {
    costUsd = addNullable(costUsd, numOrNull(thread && thread.costUsd));
    if (!agentMode && thread && thread.agentMode) agentMode = String(thread.agentMode);
    for (const row of (thread && thread.models) || []) {
      if (row && row.model && !models.includes(row.model)) models.push(row.model);
    }
  }
  return { costUsd, agentMode, models };
}

function resolveSessionSpend(opts, reported, sources, extra = {}) {
  const flags = opts || {};
  const self = reported || emptyMetricsFields();
  const fromSources = sessionTotalsFromSources(sources || []);
  const sourceCredits = sourceAmpCredits(sources || []);
  const fromAmp = ampThreadTotals(extra.ampThreads);
  const flagInput = numOrNull(flags.inputTokens);
  const flagOutput = numOrNull(flags.outputTokens);
  const flagTotal = numOrNull(flags.totalTokens);
  const flagCost = numOrNull(flags.costUsd);
  const flagCredits = numOrNull(flags.ampCredits);
  const inputTokens = firstNonNull(flagInput, self.inputTokens, fromSources.inputTokens);
  const outputTokens = firstNonNull(flagOutput, self.outputTokens, fromSources.outputTokens);
  let totalTokens = firstNonNull(flagTotal, self.totalTokens, fromSources.totalTokens);
  if (totalTokens == null && (inputTokens != null || outputTokens != null)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }
  const costUsd = firstNonNull(flagCost, self.costUsd, fromAmp.costUsd, fromSources.costUsd);
  const ampCredits = firstNonNull(flagCredits, self.ampCredits, sourceCredits);
  const costUsdEstimated = sourceEstimatedUsd(sources || []);
  let spendSource = 'unreported';
  if (self.spendSource && reportedHasSpendNumbers(self)) spendSource = String(self.spendSource);
  else if (hasSpendOverride(flags)) spendSource = 'flag';
  else if (reportedHasSpendNumbers(self)) spendSource = 'self-report';
  else if (fromAmp.costUsd != null) spendSource = 'amp-usage';
  else if (
    fromSources.inputTokens != null
    || fromSources.outputTokens != null
    || fromSources.totalTokens != null
    || fromSources.costUsd != null
    || sourceCredits != null
  ) {
    spendSource = 'adapter';
  }
  return { inputTokens, outputTokens, totalTokens, costUsd, ampCredits, costUsdEstimated, spendSource, agentMode: fromAmp.agentMode };
}

function sessionTotalsFromFlags(opts) {
  const inputTokens = numOrNull(opts.inputTokens);
  const outputTokens = numOrNull(opts.outputTokens);
  let totalTokens = numOrNull(opts.totalTokens);
  if (totalTokens == null && (inputTokens != null || outputTokens != null)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: numOrNull(opts.costUsd),
  };
}

function sessionTotalsFromSources(sources) {
  let inputTokens = null;
  let outputTokens = null;
  let totalTokens = null;
  let costUsd = null;
  for (const src of sources || []) {
    inputTokens = addNullable(inputTokens, numOrNull(src.inputTokens));
    outputTokens = addNullable(outputTokens, numOrNull(src.outputTokens));
    totalTokens = addNullable(totalTokens, numOrNull(src.totalTokens));
    if (src.costUsd != null) costUsd = addNullable(costUsd, numOrNull(src.costUsd));
  }
  return { inputTokens, outputTokens, totalTokens, costUsd };
}

function runCollectSpend(metrics, windowStart, windowEnd, extra = {}) {
  try {
    return collectSpend({
      cwd: process.cwd(),
      windowStart,
      windowEnd,
      existingSourceIds: existingSourceIdSet(metrics),
      existingSources: existingSourceRecords(metrics),
      env: process.env,
      homedir: process.env.HOME,
      platforms: extra.platforms,
      ampThreadId: extra.ampThreadId,
      ampCli: extra.ampCli === true,
      cursorConversationId: extra.cursorConversationId,
      exportAmpThread: extra.exportAmpThread,
      usageAmpThread: extra.usageAmpThread,
    });
  } catch {
    return { sources: [], byPlatform: defaultSpendByPlatform(), byModel: [], notes: [] };
  }
}

function attachLeftoverSources(metrics, session, leftoverEnd, extra = {}) {
  if (!session || !session.endedAt || !leftoverEnd) return 0;
  const exclusiveEnd = extra.exclusiveEnd === true;
  const collected = runCollectSpend(metrics, session.endedAt, leftoverEnd, {
    platforms: extra.platforms,
    ampThreadId: session.threadId || extra.ampThreadId || ampThreadIdFromEnv(process.env) || null,
    ampCli: extra.ampCli === true || session.platform === 'amp',
    cursorConversationId: extra.cursorConversationId
      || (session.platform === 'cursor' ? session.threadId : undefined),
  });
  const incoming = (collected.sources || []).filter((src) => leftoverTimestampInWindow(
    src.at,
    session.endedAt,
    leftoverEnd,
    exclusiveEnd,
  ));
  if (!incoming.length) return 0;
  const merged = [...(session.sources || []), ...incoming];
  if (sessionSpendIsFrozen(session)) {
    session.sources = merged;
    const uniqueModels = uniqueSourceModels(merged);
    if (uniqueModels.length > 1) session.models = uniqueModels;
  } else {
    applyCollectedSessionFields(session, merged, session.model, {}, {
      model: session.model,
      platform: session.platform,
    }, { ampThreads: collected.ampThreads });
  }
  return incoming.length;
}

function applyCollectedSessionFields(session, sources, resolvedModel, opts, reported, extra = {}) {
  session.sources = sources || [];
  const uniqueModels = uniqueSourceModels(session.sources);
  const fromAmp = ampThreadTotals(extra.ampThreads);
  for (const model of fromAmp.models) {
    if (model && !uniqueModels.includes(model)) uniqueModels.push(model);
  }
  if (uniqueModels.length > 1) session.models = uniqueModels;
  const sourceModel = primaryModelFromSources(session.sources);
  if (sourceModel) {
    session.model = sourceModel;
  } else {
    session.model = (resolvedModel && !isPlaceholderModel(resolvedModel) ? resolvedModel : null)
      || fromAmp.models[0]
      || null;
  }
  if (!session.platform) session.platform = primaryPlatformFromSources(session.sources) || null;
  const spend = resolveSessionSpend(opts, reported, session.sources, extra);
  session.inputTokens = spend.inputTokens;
  session.outputTokens = spend.outputTokens;
  session.totalTokens = spend.totalTokens;
  session.costUsd = spend.costUsd;
  session.ampCredits = spend.ampCredits;
  session.costUsdEstimated = spend.costUsdEstimated;
  session.spendSource = spend.spendSource;
  if (spend.agentMode) session.agentMode = spend.agentMode;
  const usageModels = [];
  for (const thread of extra.ampThreads || []) {
    for (const row of thread.models || []) {
      if (row && row.model) usageModels.push(row);
    }
  }
  if (usageModels.length) session.usageModels = usageModels;
}

function sessionTotalsLookOverridden(session) {
  const fromSources = sessionTotalsFromSources(session.sources || []);
  return ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd'].some((key) => {
    const sessionVal = numOrNull(session[key]);
    const sourceVal = numOrNull(fromSources[key]);
    if (sessionVal == null) return false;
    if (sourceVal == null) return true;
    return sessionVal !== sourceVal;
  });
}

function metricsBackfillLastSession(projectDir, changeName) {
  const resolved = resolveMetricsFile(projectDir, changeName);
  if (resolved.missing) return { filePath: resolved.filePath, added: 0, missing: true };
  return metricsBackfillFile(resolved.filePath, changeName);
}

function metricsBackfillFile(filePath, changeName) {
  const nowIso = nowUtcIso();
  const metrics = loadMetricsFile(filePath, changeName, nowIso);
  const sessions = metrics.sessions || [];
  if (!sessions.length) return { filePath, added: 0, empty: true };
  const last = sessions[sessions.length - 1];
  const windowStart = last.startedAt || last.endedAt || metrics.createdAt;
  const lastPlatform = last && last.platform;
  const collected = runCollectSpend(metrics, windowStart, nowIso, {
    ampThreadId: last && last.threadId || ampThreadIdFromEnv(process.env) || null,
    ampCli: lastPlatform === 'amp',
    cursorConversationId: lastPlatform === 'cursor' ? last.threadId : undefined,
  });
  const incoming = collected.sources || [];
  if (!incoming.length) return { filePath, added: 0 };
  const merged = [...(last.sources || []), ...incoming];
  if (sessionSpendIsFrozen(last)) {
    last.sources = merged;
    const uniqueModels = uniqueSourceModels(merged);
    if (uniqueModels.length > 1) last.models = uniqueModels;
  } else {
    applyCollectedSessionFields(last, merged, last.model, {}, {
      model: last.model,
      platform: last.platform,
    }, { ampThreads: collected.ampThreads });
  }
  metrics.updatedAt = nowIso;
  recomputeMetricsAggregates(metrics);
  saveMetricsFile(filePath, metrics);
  return { filePath, added: incoming.length };
}

function adapterSourceName(platform, via) {
  if (platform === 'claude') return 'claude-jsonl';
  if (platform === 'amp') return via === 'amp-cli' ? 'amp-cli' : 'amp-thread';
  if (platform === 'cursor') return 'cursor-hook';
  return null;
}

function spendTuple(obj) {
  return {
    inputTokens: numOrNull(obj && obj.inputTokens),
    outputTokens: numOrNull(obj && obj.outputTokens),
    totalTokens: numOrNull(obj && obj.totalTokens),
    costUsd: numOrNull(obj && obj.costUsd),
    ampCredits: numOrNull(obj && obj.ampCredits),
    costUsdEstimated: numOrNull(obj && obj.costUsdEstimated),
  };
}

function spendTuplesMatch(a, b) {
  return ['inputTokens', 'outputTokens', 'totalTokens'].every((key) => {
    const left = a[key];
    const right = b[key];
    if (left == null && right == null) return true;
    return left === right;
  });
}

function addSpendNums(target, nums) {
  target.inputTokens = addNullable(target.inputTokens, nums.inputTokens);
  target.outputTokens = addNullable(target.outputTokens, nums.outputTokens);
  target.totalTokens = addNullable(target.totalTokens, nums.totalTokens);
  target.costUsd = addNullable(target.costUsd, nums.costUsd);
  target.ampCredits = addNullable(target.ampCredits, nums.ampCredits);
  target.costUsdEstimated = addNullable(target.costUsdEstimated, nums.costUsdEstimated);
}

function recomputeSpendMaps(metrics) {
  const byPlatform = defaultSpendByPlatform();
  const byModel = new Map();

  function addModelRow(model, platform, nums) {
    if (!model) return;
    const key = `${model}::${platform || ''}`;
    const row = byModel.get(key) || {
      model,
      platform: platform || null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      ampCredits: null,
      costUsdEstimated: null,
    };
    addSpendNums(row, nums);
    byModel.set(key, row);
  }

  function addSourceRow(src) {
    const nums = spendTuple(src);
    if (src.platform && byPlatform[src.platform]) {
      addSpendNums(byPlatform[src.platform], nums);
      const label = adapterSourceName(src.platform, src.via);
      if (label) byPlatform[src.platform].source = label;
    }
    addModelRow(src.model, src.platform, nums);
  }

  for (const session of metrics.sessions || []) {
    const sources = session.sources || [];
    if (sources.length > 0) {
      for (const src of sources) addSourceRow(src);
      continue;
    }
    const sessionNums = spendTuple(session);
    if (session.platform && byPlatform[session.platform]) {
      addSpendNums(byPlatform[session.platform], sessionNums);
    }
    addModelRow(session.model, session.platform, sessionNums);
  }
  metrics.spendByPlatform = byPlatform;
  metrics.spendByModel = [...byModel.values()];
}

function recomputeMetricsAggregates(metrics) {
  enrichMetricsCursorEstimates(metrics, process.cwd());
  const phases = {};
  const totals = { sessions: 0, durationMs: null, leadTimeMs: null, cloudSessions: 0 };
  const spend = emptySpendTotals();
  let firstStart = null;
  let lastEnd = null;
  for (const session of metrics.sessions) {
    totals.sessions += 1;
    if (session.runtime === 'cloud') totals.cloudSessions += 1;
    totals.durationMs = addNullable(totals.durationMs, numOrNull(session.durationMs));
    if (session.startedAt) firstStart = firstStart == null ? session.startedAt : earlierTimestamp(firstStart, session.startedAt);
    if (session.endedAt) lastEnd = lastEnd == null ? session.endedAt : laterTimestamp(lastEnd, session.endedAt);
    const key = session.phase || 'other';
    const phase = phases[key] || { sessions: 0, durationMs: null, ...emptySpendTotals(), agents: [], models: [] };
    phase.sessions += 1;
    phase.durationMs = addNullable(phase.durationMs, numOrNull(session.durationMs));
    for (const spendKey of METRICS_SPEND_KEYS) {
      let value = null;
      if ((session.sources || []).length > 0) {
        for (const src of session.sources) {
          value = addNullable(value, numOrNull(src[spendKey]));
        }
      } else {
        value = sessionFieldOrSources(session, spendKey);
      }
      phase[spendKey] = addNullable(phase[spendKey], value);
      spend[spendKey] = addNullable(spend[spendKey], value);
    }
    if (session.role && !phase.agents.includes(session.role)) phase.agents.push(session.role);
    if (session.model && !phase.models.includes(session.model)) phase.models.push(session.model);
    if (Array.isArray(session.models)) {
      for (const model of session.models) {
        if (model && !phase.models.includes(model)) phase.models.push(model);
      }
    }
    phases[key] = phase;
  }
  if (firstStart && lastEnd) {
    totals.leadTimeMs = Math.max(0, parseFlexibleIso(lastEnd) - parseFlexibleIso(firstStart));
  }
  metrics.phases = phases;
  metrics.totals = totals;
  metrics.spend = spend;
  recomputeSpendMaps(metrics);
}

function metricsRecordSessionStart(projectDir, changeName, role, client = {}) {
  const filePath = metricsFilePath(projectDir, changeName);
  const nowIso = nowUtcIso();
  const metrics = loadMetricsFile(filePath, changeName, nowIso);
  metrics.pending = {
    startedAt: nowIso,
    role: role || '',
    platform: client.platform || null,
    threadId: client.threadId || null,
    clientSource: client.source || null,
  };
  metrics.updatedAt = nowIso;
  recomputeMetricsAggregates(metrics);
  saveMetricsFile(filePath, metrics);
  return filePath;
}

function metricsRecordSessionEnd(projectDir, fields, opts = {}) {
  const filePath = metricsFilePath(projectDir, fields.changeName);
  const nowIso = nowUtcIso();
  const metrics = loadMetricsFile(filePath, fields.changeName, nowIso);
  const lastClosed = (metrics.sessions || [])[(metrics.sessions || []).length - 1];
  const leftoverEnd = (metrics.pending && metrics.pending.startedAt)
    ? metrics.pending.startedAt
    : leftoverGraceEnd(lastClosed && lastClosed.endedAt);
  attachLeftoverSources(metrics, lastClosed, leftoverEnd, {
    exclusiveEnd: Boolean(metrics.pending && metrics.pending.startedAt),
  });
  let startedAt = isoOrNull(opts.startedAt) || isoOrNull(metrics.pending && metrics.pending.startedAt) || null;
  const reported = opts.reported || fields.metrics || emptyMetricsFields();
  const resolvedModel = opts.model === undefined ? resolveModel(opts, process.env, reported) : opts.model;
  const windowStart = collectWindowStart(metrics, { startedAt });
  const pending = metrics.pending || {};
  const platform = opts.platform || pending.platform || null;
  const collectAll = opts.collect === true;
  const platforms = collectAll ? undefined : (platform ? [platform] : []);
  const shouldCollect = collectAll || (Array.isArray(platforms) && platforms.length > 0);
  const endedAt = nowIso;
  const collected = shouldCollect
    ? runCollectSpend(metrics, windowStart, endedAt, {
      platforms,
      ampThreadId: opts.ampThreadId || pending.threadId || ampThreadIdFromEnv(process.env) || null,
      ampCli: collectAll || platform === 'amp',
      cursorConversationId: platform === 'cursor' ? pending.threadId : undefined,
    })
    : { sources: [] };
  const startedMs = parseFlexibleIso(startedAt);
  const endedMs = parseFlexibleIso(endedAt);
  let durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs)
    ? Math.max(0, endedMs - startedMs)
    : null;
  const closedRole = canonicalRole(fields.closedRole) || fields.closedRole || '';
  const session = {
    startedAt,
    endedAt,
    durationMs,
    role: closedRole,
    phase: phaseForRole(closedRole),
    runtime: fields.runtime || 'local',
    agentId: fields.agentId || 'none',
    model: resolvedModel || null,
    platform: opts.platform || pending.platform || null,
    threadId: opts.ampThreadId || pending.threadId || null,
    tasks: fields.tasks || null,
    sources: [],
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
    ampCredits: null,
    costUsdEstimated: null,
    spendSource: 'unreported',
  };
  applyCollectedSessionFields(session, collected.sources || [], resolvedModel, opts, reported, collected);
  if (!session.startedAt) {
    let earliest = null;
    for (const src of session.sources || []) {
      const at = isoOrNull(src.at);
      if (!at) continue;
      earliest = earliest == null ? at : earlierTimestamp(earliest, at);
    }
    if (earliest) {
      session.startedAt = earliest;
      const fromMs = parseFlexibleIso(session.startedAt);
      const toMs = parseFlexibleIso(session.endedAt);
      session.durationMs = Number.isFinite(fromMs) && Number.isFinite(toMs)
        ? Math.max(0, toMs - fromMs)
        : null;
    }
  }
  metrics.sessions.push(session);
  metrics.pending = null;
  metrics.updatedAt = nowIso;
  recomputeMetricsAggregates(metrics);
  saveMetricsFile(filePath, metrics);
  if (opts.collect === true) metricsBackfillFile(filePath, fields.changeName);
  const latest = loadMetricsFile(filePath, fields.changeName, nowIso);
  const last = (latest.sessions || []).at(-1);
  if (last && last.spendSource === 'unreported') warnUnreportedSelfReport();
  if (!last || last.model == null) warnMissingModel();
  return filePath;
}

function metricsFinalizeArchive(targetDir, changeName, opts = {}) {
  const filePath = join(targetDir, 'metrics.json');
  const nowIso = nowUtcIso();
  const metrics = loadMetricsFile(filePath, changeName, nowIso);
  const pending = metrics.pending || {};
  const startedAt = isoOrNull(pending.startedAt) || nowIso;
  const endedAt = nowIso;
  const startedMs = parseFlexibleIso(startedAt);
  const endedMs = parseFlexibleIso(endedAt);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs)
    ? Math.max(0, endedMs - startedMs)
    : 0;
  const collectAll = opts.collect === true;
  const platform = opts.platform || pending.platform || null;
  const platforms = collectAll ? undefined : (platform ? [platform] : []);
  const shouldCollect = collectAll || (Array.isArray(platforms) && platforms.length > 0);
  const ampThreadId = opts.ampThreadId || pending.threadId || ampThreadIdFromEnv(process.env) || null;
  const collected = shouldCollect
    ? runCollectSpend(metrics, startedAt, endedAt, {
      platforms,
      ampThreadId,
      ampCli: collectAll || platform === 'amp',
      cursorConversationId: platform === 'cursor' ? (pending.threadId || ampThreadId) : undefined,
    })
    : { sources: [] };
  const reported = dropStaleArchiveSelfReport(opts.reported, metrics.sessions);
  const resolvedModel = opts.model === undefined ? resolveModel(opts, process.env, reported) : opts.model;
  const session = {
    startedAt,
    endedAt,
    durationMs,
    role: 'Archiver',
    phase: phaseForRole('Archiver'),
    runtime: opts.runtime || 'local',
    agentId: opts.agentId || 'none',
    model: resolvedModel || null,
    platform,
    threadId: ampThreadId || null,
    tasks: opts.tasks || null,
    sources: [],
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
    ampCredits: null,
    costUsdEstimated: null,
    spendSource: 'unreported',
  };
  applyCollectedSessionFields(session, collected.sources || [], resolvedModel, opts, reported, collected);
  metrics.sessions.push(session);
  metrics.archivedAt = nowIso;
  metrics.pending = null;
  metrics.updatedAt = nowIso;
  recomputeMetricsAggregates(metrics);
  saveMetricsFile(filePath, metrics);
  if (opts.collect === true) metricsBackfillFile(filePath, changeName);
  const latest = loadMetricsFile(filePath, changeName, nowIso);
  const last = (latest.sessions || []).at(-1);
  if (last && last.spendSource === 'unreported') warnUnreportedSelfReport();
  if (!last || last.model == null) warnMissingModel();
  if (latest.spend.costUsd === null) warnMissingUsd();
  return filePath;
}

function metricsPrepareArchiveStart(changeRoot, changeName, client = {}) {
  const filePath = join(changeRoot, 'metrics.json');
  if (!existsSync(filePath)) return;
  const nowIso = nowUtcIso();
  const metrics = loadMetricsFile(filePath, changeName, nowIso);
  if (metrics.pending == null) {
    metrics.pending = {
      startedAt: nowIso,
      role: 'Archiver',
      platform: client.platform || null,
      threadId: client.threadId || null,
      clientSource: client.source || null,
    };
  }
  const leftoverEnd = metrics.pending && metrics.pending.startedAt;
  attachLeftoverSources(metrics, lastNonArchiverSession(metrics.sessions), leftoverEnd, {
    exclusiveEnd: true,
  });
  metrics.updatedAt = nowIso;
  recomputeMetricsAggregates(metrics);
  saveMetricsFile(filePath, metrics);
}

function formatMetricsDuration(durationMs) {
  if (durationMs == null || !Number.isFinite(durationMs)) return '—';
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

function formatMetricsNumber(value) {
  return value == null ? '—' : String(value);
}

function formatMetricsCost(value) {
  return value == null ? '—' : `$${Number(value).toFixed(2)}`;
}

function formatMetricsCostLine(spend) {
  const billed = spend && spend.costUsd;
  const estimated = spend && spend.costUsdEstimated;
  if (billed == null && estimated == null) return '—';
  if (billed != null && estimated != null) {
    return `${formatMetricsCost(billed)} billed + ~${formatMetricsCost(estimated)} est.`;
  }
  if (billed != null) return formatMetricsCost(billed);
  return `~${formatMetricsCost(estimated)} est.`;
}

function sessionSpendSourceLabel(session) {
  const raw = session && session.spendSource;
  if (raw == null || String(raw).trim() === '') return 'unreported';
  return String(raw);
}

function renderMetricsSummary(metrics) {
  const lines = [];
  const sessions = Array.isArray(metrics.sessions) ? metrics.sessions : [];
  const unreported = sessions.filter((session) => sessionSpendSourceLabel(session) === 'unreported').length;
  lines.push(`sessions:  ${metrics.totals.sessions}${metrics.totals.cloudSessions ? ` (cloud: ${metrics.totals.cloudSessions})` : ''}`);
  lines.push(`work time: ${formatMetricsDuration(metrics.totals.durationMs)}`);
  lines.push(`lead time: ${formatMetricsDuration(metrics.totals.leadTimeMs)}`);
  lines.push(`tokens:    ${formatMetricsNumber(metrics.spend.totalTokens)} (in: ${formatMetricsNumber(metrics.spend.inputTokens)}, out: ${formatMetricsNumber(metrics.spend.outputTokens)})`);
  lines.push(`cost:      ${formatMetricsCostLine(metrics.spend)}`);
  lines.push(`unreported: ${unreported}`);
  if (metrics.archivedAt) lines.push(`archived:  ${formatKyivDisplay(metrics.archivedAt)}`);
  if (metrics.pending) {
    const pendingClient = metrics.pending.platform
      ? ` ${metrics.pending.platform}${metrics.pending.threadId ? ` ${metrics.pending.threadId}` : ''}`
      : '';
    lines.push(`open session since ${metrics.pending.startedAt} (${metrics.pending.role || 'unknown role'}${pendingClient})`);
  }

  const phaseOrder = ['explore', 'design', 'spec', 'review', 'apply', 'archive', 'other'];
  const phaseKeys = phaseOrder.filter((key) => metrics.phases[key]);
  if (phaseKeys.length) {
    lines.push('');
    lines.push('phase      sessions  time      tokens    cost      roles                models');
    for (const key of phaseKeys) {
      const phase = metrics.phases[key];
      lines.push([
        key.padEnd(10),
        String(phase.sessions).padEnd(9),
        formatMetricsDuration(phase.durationMs).padEnd(9),
        formatMetricsNumber(phase.totalTokens).padEnd(9),
        formatMetricsCostLine(phase).padEnd(9),
        (phase.agents.join(', ') || '—').padEnd(20),
        phase.models.join(', ') || '—',
      ].join(' '));
    }
  }

  const byPlatform = metrics.spendByPlatform || defaultSpendByPlatform();
  lines.push('');
  lines.push('by platform:');
  lines.push('platform   tokens    cost      credits   source');
  for (const key of ['cursor', 'claude', 'amp']) {
    const row = byPlatform[key] || emptyPlatformSpend();
    lines.push([
      key.padEnd(10),
      formatMetricsNumber(row.totalTokens).padEnd(9),
      formatMetricsCostLine(row).padEnd(9),
      formatMetricsNumber(row.ampCredits).padEnd(9),
      row.source || 'none',
    ].join(' '));
  }

  lines.push('');
  lines.push('by model:');
  lines.push('model                platform   tokens    cost      credits');
  const byModel = Array.isArray(metrics.spendByModel) ? metrics.spendByModel : [];
  if (!byModel.length) {
    lines.push('—                     —          —         —         —');
  } else {
    for (const row of byModel) {
      lines.push([
        String(row.model || '—').padEnd(20),
        String(row.platform || '—').padEnd(10),
        formatMetricsNumber(row.totalTokens).padEnd(9),
        formatMetricsCostLine(row).padEnd(9),
        formatMetricsNumber(row.ampCredits),
      ].join(' '));
    }
  }

  if (sessions.length) {
    lines.push('');
    lines.push('recent sessions:');
    for (const session of sessions.slice(-5)) {
      const spendLabel = session.totalTokens != null || session.costUsd != null || session.costUsdEstimated != null
        ? ` — ${formatMetricsNumber(session.totalTokens)} tok, ${formatMetricsCostLine(session)}`
        : '';
      const modeLabel = session.agentMode ? ` mode:${session.agentMode}` : '';
      lines.push(`- ${formatKyivDisplay(session.endedAt)}  ${String(session.phase || '').padEnd(7)} ${formatMetricsDuration(session.durationMs).padEnd(9)} ${session.role || '(no role)'}${session.model ? ` [${session.model}]` : ''}${modeLabel} (${sessionSpendSourceLabel(session)})${spendLabel}`);
    }
  }
  return lines;
}

function resolveMetricsFile(projectDir, changeName) {
  const activePath = metricsFilePath(projectDir, changeName);
  if (existsSync(activePath)) return { filePath: activePath, archived: false };
  const archiveDir = join(projectDir, 'openspec', 'changes', 'archive');
  if (existsSync(archiveDir)) {
    const folders = readdirSync(archiveDir)
      .filter((name) => name === changeName || name.endsWith(`-${changeName}`))
      .sort()
      .reverse();
    for (const folder of folders) {
      const archivedPath = join(archiveDir, folder, 'metrics.json');
      if (existsSync(archivedPath)) return { filePath: archivedPath, archived: true };
    }
  }
  return { filePath: activePath, archived: false, missing: true };
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
  const match = content.match(/^(?:#{1,6}\s*)?\*{0,2}Verdict:\*{0,2}\s*(.+?)\s*$/m);
  return match ? match[1].replace(/\*+\s*$/, '').trim() : 'unknown';
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
  const taskContractMatch = content.match(/task_contract:\s*(warn|strict|off)/);
  return {
    requireSpecReview: requireReviewMatch ? requireReviewMatch[1] === 'true' : true,
    requireDesignBrief: requireBriefMatch ? requireBriefMatch[1] === 'true' : false,
    maxActiveChanges: maxActiveMatch ? parseInt(maxActiveMatch[1], 10) : null,
    taskContract: taskContractMatch ? taskContractMatch[1] : 'warn',
  };
}

// --- Task-contract lint (gate-check --tasks) ---

const VAGUE_DO_PATTERNS = [/\bas needed\b/i, /\bif necessary\b/i, /\bas appropriate\b/i, /де потрібно/i, /за потреби/i];

function taskContractMode(projectDir) {
  const config = readPipelineConfig(projectDir);
  return config ? config.taskContract : 'warn';
}

function parseTaskContracts(content) {
  const tasks = [];
  let current = null;
  for (const line of content.split('\n')) {
    const taskMatch = line.match(/^\s*- \[[ xX]\]\s+(.*)$/);
    if (taskMatch) {
      current = { title: taskMatch[1].trim(), files: null, do: null, doneWhen: null };
      tasks.push(current);
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(/^\s+(Files|Do|Done-when):\s*(.*)$/);
    if (fieldMatch) {
      const value = fieldMatch[2].trim();
      if (fieldMatch[1] === 'Files') current.files = value;
      else if (fieldMatch[1] === 'Do') current.do = value;
      else current.doneWhen = value;
    } else if (/^\S/.test(line)) {
      current = null;
    }
  }
  return tasks;
}

function lintTaskContracts(projectDir, tasksPath) {
  const errors = [];
  const tasks = parseTaskContracts(readFileSync(tasksPath, 'utf-8'));
  for (const task of tasks) {
    const label = `task "${task.title.slice(0, 60)}"`;
    if (!task.files) errors.push(`${label}: missing Files:`);
    if (!task.do) errors.push(`${label}: missing Do:`);
    if (!task.doneWhen) errors.push(`${label}: missing Done-when:`);
    if (task.do) {
      for (const pattern of VAGUE_DO_PATTERNS) {
        const match = task.do.match(pattern);
        if (match) errors.push(`${label}: vague wording in Do: "${match[0]}"`);
      }
    }
    if (task.files) {
      for (const entry of task.files.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (/^new file:/i.test(entry)) continue;
        if (!existsSync(join(projectDir, entry))) errors.push(`${label}: Files: path does not exist: ${entry} (prefix with "new file:" if intentional)`);
      }
    }
  }
  return errors;
}

function runTasksLint(projectDir, name, { quiet = false } = {}) {
  const mode = taskContractMode(projectDir);
  const report = { mode, errors: [], warnings: [] };
  if (mode === 'off') return report;
  const tasksPath = join(projectDir, 'openspec', 'changes', name, 'tasks.md');
  if (!existsSync(tasksPath)) {
    report.warnings.push(`tasks.md not found: ${tasksPath}`);
    return report;
  }
  const findings = lintTaskContracts(projectDir, tasksPath);
  if (mode === 'strict') report.errors = findings;
  else report.warnings = [...report.warnings, ...findings];
  if (!quiet) {
    for (const e of report.errors) log.err(e);
    for (const w of report.warnings) log.warn(w);
  }
  return report;
}

// --- Tier 1 review (gate-check --review) ---

// Change names are interpolated into shell commands and paths; keep them slugs.
function isSafeChangeName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

function runTier1Review(projectDir, name) {
  const errors = [];
  if (!isSafeChangeName(name)) {
    return { pass: false, errors: [`invalid change name: ${name}`] };
  }
  const changeDir = join(projectDir, 'openspec', 'changes', name);
  if (!existsSync(changeDir)) {
    return { pass: false, errors: [`change not found: ${name}`] };
  }

  try {
    execSync(`npx openspec validate ${name} --strict --type change`, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  } catch (e) {
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n')[0] || 'non-zero exit';
    errors.push(`openspec validate --strict failed: ${detail}`);
  }

  const lint = runTasksLint(projectDir, name, { quiet: true });
  errors.push(...lint.errors);

  const proposalPath = join(changeDir, 'proposal.md');
  if (!existsSync(proposalPath)) {
    errors.push('proposal.md not found');
  } else {
    const proposal = readFileSync(proposalPath, 'utf-8');
    if (!/^#{2,}\s*Non-goals\b/im.test(proposal)) errors.push('proposal.md: missing "Non-goals" section');
    if (!/^#{2,}\s*Acceptance criteria\b/im.test(proposal)) errors.push('proposal.md: missing "Acceptance criteria" section');
  }

  for (const deltaPath of listDeltaSpecFiles(changeDir)) {
    const rel = deltaPath.replace(`${projectDir}/`, '');
    const sections = parseDeltaSpec(readFileSync(deltaPath, 'utf-8'));
    const total = sections.ADDED.length + sections.MODIFIED.length + sections.REMOVED.length;
    if (total === 0) errors.push(`${rel}: no non-empty ADDED/MODIFIED/REMOVED Requirements section`);
  }

  return { pass: errors.length === 0, errors, warnings: lint.warnings };
}

// --- Delta spec sync (archive --sync) ---

function listDeltaSpecFiles(changeDir) {
  const specsDir = join(changeDir, 'specs');
  if (!existsSync(specsDir)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) files.push(full);
    }
  };
  walk(specsDir);
  return files.sort();
}

function splitRequirementBlocks(sectionBody) {
  return String(sectionBody || '')
    .split(/^### Requirement: /m)
    .slice(1)
    .map((part) => {
      const nl = part.indexOf('\n');
      const name = (nl === -1 ? part : part.slice(0, nl)).trim();
      const body = nl === -1 ? '' : part.slice(nl + 1);
      return { name, block: `### Requirement: ${name}\n${body}`.replace(/\s+$/, '') };
    });
}

function parseDeltaSpec(content) {
  const sections = { ADDED: [], MODIFIED: [], REMOVED: [] };
  const parts = String(content || '').split(/^## /m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = nl === -1 ? '' : part.slice(nl + 1);
    const match = title.match(/^(ADDED|MODIFIED|REMOVED) Requirements$/);
    if (match) sections[match[1]] = splitRequirementBlocks(body);
  }
  return sections;
}

function findRequirementSpan(content, name) {
  const header = `### Requirement: ${name}`;
  const idx = content.indexOf(header);
  if (idx === -1) return null;
  const rest = content.slice(idx + header.length);
  const relEnd = rest.search(/\n### Requirement: |\n## /);
  const end = relEnd === -1 ? content.length : idx + header.length + relEnd;
  return [idx, end];
}

function planSpecSync(projectDir, deltaSpecPaths, changeName) {
  const plan = [];
  const conflicts = [];
  for (const deltaPath of deltaSpecPaths) {
    const capability = basename(dirname(deltaPath));
    const mainPath = join(projectDir, 'openspec', 'specs', capability, 'spec.md');
    const delta = parseDeltaSpec(readFileSync(deltaPath, 'utf-8'));
    if (delta.ADDED.length + delta.MODIFIED.length + delta.REMOVED.length === 0) continue;
    const existed = existsSync(mainPath);
    const dirExisted = existsSync(dirname(mainPath));
    const oldContent = existed ? readFileSync(mainPath, 'utf-8') : null;
    let content = existed
      ? oldContent
      : `## Purpose\n\n${capability} — requirements merged from change ${changeName}.\n\n## Requirements\n`;

    for (const req of delta.REMOVED) {
      const span = findRequirementSpan(content, req.name);
      if (!span) {
        conflicts.push(`${capability}: REMOVED requirement not found in main spec: "${req.name}"`);
        continue;
      }
      content = `${content.slice(0, span[0]).replace(/\n+$/, '\n\n')}${content.slice(span[1]).replace(/^\n+/, '')}`;
    }
    for (const req of delta.MODIFIED) {
      const span = findRequirementSpan(content, req.name);
      if (!span) {
        conflicts.push(`${capability}: MODIFIED requirement not found in main spec: "${req.name}"`);
        continue;
      }
      content = `${content.slice(0, span[0])}${req.block}\n\n${content.slice(span[1]).replace(/^\n+/, '')}`;
    }
    for (const req of delta.ADDED) {
      if (findRequirementSpan(content, req.name)) {
        conflicts.push(`${capability}: ADDED requirement already exists in main spec: "${req.name}"`);
        continue;
      }
      content = `${content.replace(/\s+$/, '')}\n\n${req.block}\n`;
    }
    if (!content.endsWith('\n')) content += '\n';
    plan.push({ mainPath, existed, dirExisted, oldContent, newContent: content });
  }
  return { plan, conflicts };
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

function gitStagedTouchesGlob(projectDir, srcGlob) {
  try {
    const out = execSync(`git diff --cached --name-only -- "${srcGlob}"`, {
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
    lines.push(`  4. MCP: ${pc.cyan('npx agent-orchestrator-kit mcp-setup')} (GitHub/GitLab from origin + browser)`);
    lines.push(`  5. Optional Figma: ${pc.cyan('npx agent-orchestrator-kit figma-setup')} then paste token into ${pc.cyan('.agents/figma.local.env')} (never in chat)`);
    lines.push(`  6. Optional pre-commit gate: ${pc.cyan('npx agent-orchestrator-kit hooks-setup')} or ${pc.cyan('init --hooks')}`);
    lines.push(`  7. Start your first change:`);
  } else if (profile === 'mvp') {
    lines.push(`  3. For quick demos use ${pc.cyan('/opsx:quick <name>')} (propose + apply, no review gate)`);
    lines.push(`  4. MCP: ${pc.cyan('npx agent-orchestrator-kit mcp-setup')} (GitHub/GitLab from origin + browser)`);
    lines.push(`  5. Optional Figma: ${pc.cyan('npx agent-orchestrator-kit figma-setup')} then paste token into ${pc.cyan('.agents/figma.local.env')} (never in chat)`);
    lines.push(`  6. Optional pre-commit gate: ${pc.cyan('npx agent-orchestrator-kit hooks-setup')} or ${pc.cyan('init --hooks')}`);
    lines.push(`  7. Start exploring:`);
  } else {
    lines.push(`  3. MCP: ${pc.cyan('npx agent-orchestrator-kit mcp-setup')} (GitHub/GitLab from origin + browser)`);
    lines.push(`  4. Optional Figma: ${pc.cyan('npx agent-orchestrator-kit figma-setup')} then paste token into ${pc.cyan('.agents/figma.local.env')} (never in chat)`);
    lines.push(`  5. Optional pre-commit gate: ${pc.cyan('npx agent-orchestrator-kit hooks-setup')} or ${pc.cyan('init --hooks')}`);
    lines.push(`  6. Start your first change:`);
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

function parseAmpSubagentSource(content) {
  const parsed = String(content || '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const name = parsed?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = parsed?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!parsed || !name || !description) return null;
  return { parsed, name, description };
}

function buildAmpSubagentSkillContent(file, parsed) {
  const name = parsed[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = parsed[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return [
    '---',
    `name: ${AMP_SUBAGENT_SKILL_PREFIX}${name}`,
    `description: ${description}`,
    '---',
    '',
    `<!-- AUTO-GENERATED from .agents/subagents/${file} — edit the source file, then run: npx agent-orchestrator-kit sync -->`,
    '',
    AMP_SPAWN_PREAMBLE,
    '',
    parsed[2].trim(),
    '',
  ].join('\n');
}

function skillHealthState(projectDir, name) {
  const source = join(projectDir, '.agents', 'skills', name, 'SKILL.md');
  if (!existsSync(source)) return 'missing';
  const sourceBytes = readFileSync(source);
  for (const ide of ['.cursor', '.claude']) {
    const copy = join(projectDir, ide, 'skills', name, 'SKILL.md');
    if (!existsSync(copy)) return 'stale';
    if (Buffer.compare(sourceBytes, readFileSync(copy)) !== 0) return 'stale';
  }
  return 'ok';
}

function printSkillHealth(projectDir) {
  const inventory = readSkillsInventory(projectDir);
  const names = [...inventory.kit, ...inventory.stack];
  console.log(pc.bold('\nSkill health'));
  for (const name of names) {
    const state = skillHealthState(projectDir, name);
    const isStack = inventory.stack.includes(name);
    let line = `  ${name.padEnd(28)} ${state}`;
    if (state === 'missing' && isStack && inventory.external) {
      line += `  npx ${inventory.external} install --agent all --yes`;
    }
    console.log(line);
  }

  const subagentsDir = join(projectDir, '.agents', 'subagents');
  const issues = [];
  let ok = 0;
  let total = 0;
  if (existsSync(subagentsDir)) {
    for (const file of readdirSync(subagentsDir).filter((f) => f.endsWith('.md'))) {
      const parsedWrap = parseAmpSubagentSource(readFileSync(join(subagentsDir, file), 'utf-8'));
      if (!parsedWrap) continue;
      total += 1;
      const expected = Buffer.from(buildAmpSubagentSkillContent(file, parsedWrap.parsed));
      const wrapperPath = join(
        projectDir,
        '.agents',
        'skills',
        `${AMP_SUBAGENT_SKILL_PREFIX}${parsedWrap.name}`,
        'SKILL.md',
      );
      if (!existsSync(wrapperPath) || Buffer.compare(expected, readFileSync(wrapperPath)) !== 0) {
        issues.push(`${AMP_SUBAGENT_SKILL_PREFIX}${parsedWrap.name}`);
      } else {
        ok += 1;
      }
    }
  }
  if (!total) {
    console.log('  subagent wrappers: ok (0/0)');
  } else if (!issues.length) {
    console.log(`  subagent wrappers: ok (${ok}/${total})`);
  } else {
    console.log(`  subagent wrappers: ${issues.join(', ')} stale/missing (${ok}/${total} ok)`);
  }
  console.log('');
}

function generateAmpSubagentSkills(projectDir) {
  const subagentsDir = join(projectDir, '.agents', 'subagents');
  const skillsDir = join(projectDir, '.agents', 'skills');
  const expected = new Set();

  if (existsSync(subagentsDir)) {
    for (const file of readdirSync(subagentsDir).filter((f) => f.endsWith('.md'))) {
      const content = readFileSync(join(subagentsDir, file), 'utf-8');
      const parsedWrap = parseAmpSubagentSource(content);
      if (!parsedWrap) {
        log.warn(`skip Amp wrapper (missing name/description frontmatter): .agents/subagents/${file}`);
        continue;
      }

      const skillName = `${AMP_SUBAGENT_SKILL_PREFIX}${parsedWrap.name}`;
      expected.add(skillName);
      mkdirSync(join(skillsDir, skillName), { recursive: true });
      writeFileSync(join(skillsDir, skillName, 'SKILL.md'), buildAmpSubagentSkillContent(file, parsedWrap.parsed));
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
  const ampExample = join(projectDir, AMP_EXAMPLE_REL);
  const ampDest = join(projectDir, '.amp', 'settings.json');
  if (seedLiveMcpFromExample(ampDest, ampExample, 'amp.mcpServers', OPTIONAL_MCP_SEED_STRIP, '.amp/settings.json')) {
    // seeded
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
  .option('--hooks', 'Opt-in: install pre-commit gate-check hook (husky-first)', false)
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
    chmodX(join(projectDir, HOOK_SCRIPT_REL));

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

    log.title('Configuring Memory MCP');
    refreshMemoryManagedFiles(projectDir);
    ensureMemoryMcpEntry(projectDir);

    log.title('Configuring Cursor spend hook');
    reportCursorSpendHook(projectDir, log);

    if (opts.hooks) {
      log.title('Installing pre-commit gate');
      const hookResult = runHooksSetup(projectDir);
      if (!hookResult.ok) process.exitCode = 1;
    }

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
    log.title('Refreshing MCP launchers and hook script');
    refreshOptionalMcpManagedFiles(projectDir);
    log.title('Configuring Memory MCP');
    refreshMemoryManagedFiles(projectDir);
    ensureMemoryMcpEntry(projectDir);
    log.title('Configuring Cursor spend hook');
    reportCursorSpendHook(projectDir, log);
    mergeGitignore(projectDir, GITIGNORE_LINES);

    log.ok(`Updated to v${KIT_VERSION}`);
    log.info('Run ./scripts/sync-local-agent-skills.sh to sync to local IDE');
    log.info('Optional MCP: npx agent-orchestrator-kit mcp-setup');
    log.info('Optional Figma: npx agent-orchestrator-kit figma-setup');
    log.info('Optional pre-commit gate: npx agent-orchestrator-kit hooks-setup');
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

    log.title('Configuring Memory MCP');
    ensureMemoryMcpEntry(projectDir);

    log.title('Configuring Cursor spend hook');
    reportCursorSpendHook(projectDir, log);

    mergeGitignore(projectDir, GITIGNORE_LINES);

    log.ok('Sync complete');
    log.warn('.cursor/, .claude/, .amp/ are local only — not committed to git');
  });

program
  .command('status')
  .description('Show status of active OpenSpec changes (tasks progress, review verdict, archive readiness, MCP and skill health)')
  .action(() => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator status');

    const changes = listActiveChanges(projectDir);
    if (changes.length === 0) {
      log.info('No active changes');
    } else {
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
    }

    printMcpHealth(projectDir);
    printSpendHealth(projectDir);
    printSkillHealth(projectDir);
  });

program
  .command('gate-check [change-name]')
  .description('Deterministically check the review gate before apply/merge (exit non-zero if unmet)')
  .option('--src-glob <glob>', 'source path filter used to detect code changes', 'src/')
  .option('--base <ref>', 'git ref to diff against', 'HEAD~1')
  .option('--staged', 'check staged files (git diff --cached) instead of --base...HEAD', false)
  .option('--tasks <name>', 'lint task contracts (Files/Do/Done-when) of a change')
  .option('--review <name>', 'run deterministic Tier 1 review checks on a change')
  .option('--json', 'with --review: print a {pass, errors[]} JSON report to stdout', false)
  .action((changeName, opts) => {
    const projectDir = process.cwd();

    if (opts.tasks) {
      log.title(`gate-check --tasks  ${opts.tasks}`);
      const mode = taskContractMode(projectDir);
      if (mode === 'off') {
        log.info('task contract lint disabled (pipeline.task_contract: off)');
        return;
      }
      const report = runTasksLint(projectDir, opts.tasks);
      if (report.errors.length) {
        console.error(`task contract gate failed — ${report.errors.length} error(s) (pipeline.task_contract: strict)`);
        process.exitCode = 1;
      } else if (report.warnings.length) {
        log.warn(`task contract: ${report.warnings.length} issue(s) — warn mode, not blocking`);
      } else {
        log.ok('all tasks follow the contract (Files/Do/Done-when)');
      }
      return;
    }

    if (opts.review) {
      const result = runTier1Review(projectDir, opts.review);
      if (opts.json) {
        console.log(JSON.stringify({ pass: result.pass, errors: result.errors }, null, 2));
      } else {
        log.title(`gate-check --review  ${opts.review}`);
        for (const e of result.errors) log.err(e);
        for (const w of result.warnings || []) log.warn(w);
        if (result.pass) log.ok('Tier 1 review passed — proceed to spec-reviewer (Tier 2)');
        else log.err(`Tier 1 review failed — ${result.errors.length} error(s)`);
      }
      if (!result.pass) process.exitCode = 1;
      return;
    }

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

    const touchesSrc = opts.staged
      ? gitStagedTouchesGlob(projectDir, opts.srcGlob)
      : gitDiffTouchesGlob(projectDir, opts.base, opts.srcGlob);
    if (touchesSrc === false) {
      log.ok(`no ${opts.staged ? 'staged ' : ''}changes under ${opts.srcGlob} — nothing to gate`);
      return;
    }
    if (touchesSrc === null) {
      log.warn(`could not compute git ${opts.staged ? 'staged ' : ''}diff — skipping gate-check`);
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
  .command('archive <name>')
  .description('Archive a completed change: check gates, optionally sync delta specs, move to a dated archive, validate, write final handoff')
  .option('--sync', 'merge delta specs into openspec/specs/ before archiving')
  .option('--no-sync', 'skip delta-spec merge (requires --force when delta specs exist)')
  .option('--force', 'confirm archiving without merge when delta specs exist', false)
  .option('--model <name>', 'LLM product id recorded on the Archiver session')
  .option('--platform <platform>', 'Session platform: cursor | claude | amp')
  .option('--input-tokens <n>', 'Input tokens spent in the Archiver session')
  .option('--output-tokens <n>', 'Output tokens spent in the Archiver session')
  .option('--total-tokens <n>', 'Total tokens spent in the Archiver session (default: input + output)')
  .option('--cost-usd <usd>', 'Cost of the Archiver session in USD')
  .option('--collect', 'Collect all spend adapters (default: locked Cursor/Amp/Claude client only)', false)
  .action((name, opts) => {
    const projectDir = process.cwd();
    const fail = (msg) => {
      console.error(msg);
      process.exitCode = 1;
    };
    log.title(`agent-orchestrator archive  ${name}`);

    if (!isSafeChangeName(name)) return fail(`invalid change name: ${name}`);

    const platformResult = resolvePlatform(opts, process.env);
    if (platformResult.error) {
      log.err(platformResult.error);
      process.exitCode = 1;
      return;
    }
    if (platformResult.warn) console.error(platformResult.warn);
    const resolvedModel = resolveModel(opts, process.env);

    let status;
    try {
      const out = execSync(`npx openspec status --change ${name} --json`, {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      status = JSON.parse(out);
    } catch (e) {
      const detail = `${(e.stderr || e.stdout || e.message || '')}`.trim().split('\n')[0];
      return fail(`could not resolve change "${name}" via openspec status: ${detail}`);
    }

    const changeRoot = status.changeRoot || join(projectDir, 'openspec', 'changes', name);
    const changesDir = (status.planningHome && status.planningHome.changesDir) || join(projectDir, 'openspec', 'changes');
    if (!existsSync(changeRoot)) return fail(`change not found: ${changeRoot}`);

    // Gate 1: review verdict (only when required by pipeline config)
    const config = readPipelineConfig(projectDir);
    const requireReview = config ? config.requireSpecReview : true;
    if (requireReview) {
      const verdict = parseReviewVerdict(changeRoot);
      if (!(verdict && /^APPROVE/i.test(verdict))) {
        return fail(`review gate failed — change "${name}" has ${verdict ? `verdict "${verdict}"` : 'no review.md'} (require_spec_review: true)`);
      }
    }

    // Gate 2: all tasks checked (skipped when the schema has no tasks artifact)
    const tasksPaths = (status.artifactPaths && status.artifactPaths.tasks && status.artifactPaths.tasks.existingOutputPaths) || [];
    for (const tasksPath of tasksPaths) {
      if (/^\s*- \[ \]/m.test(readFileSync(tasksPath, 'utf-8'))) {
        return fail(`tasks gate failed — ${tasksPath.replace(`${projectDir}/`, '')} still has unchecked "- [ ]" items`);
      }
    }

    // Gate 3: target archive must not exist
    const dateStamp = new Date().toISOString().slice(0, 10);
    const targetDir = join(changesDir, 'archive', `${dateStamp}-${name}`);
    const targetRel = targetDir.replace(`${projectDir}/`, '');
    if (existsSync(targetDir)) return fail(`archive gate failed — target already exists: ${targetRel}`);

    // Sync decision for delta specs
    const deltaSpecs = listDeltaSpecFiles(changeRoot);
    let plan = [];
    let syncStatus = 'no delta specs';
    if (deltaSpecs.length) {
      if (opts.sync === undefined) {
        return fail(`change "${name}" has ${deltaSpecs.length} delta spec(s) — pass --sync to merge them into openspec/specs/, or --no-sync --force to archive without merging`);
      }
      if (opts.sync === false && !opts.force) {
        return fail('refusing --no-sync without --force — delta specs would be archived without merging into openspec/specs/');
      }
      if (opts.sync) {
        const result = planSpecSync(projectDir, deltaSpecs, name);
        if (result.conflicts.length) {
          for (const conflict of result.conflicts) console.error(`sync conflict: ${conflict}`);
          return fail('delta-spec merge refused — resolve conflicts manually with the openspec-sync-specs skill, then re-run archive');
        }
        plan = result.plan;
        // Snapshots of affected main specs are held in plan[].oldContent for rollback.
        for (const entry of plan) {
          mkdirSync(dirname(entry.mainPath), { recursive: true });
          writeFileSync(entry.mainPath, entry.newContent);
        }
        syncStatus = `synced ${plan.length} main spec file(s)`;
      } else {
        syncStatus = 'skipped (--no-sync --force)';
      }
    }

    const archiveClient = resolveRestoreClient({
      env: process.env,
      cwd: projectDir,
      homedir: process.env.HOME,
      platform: opts.platform,
    });
    metricsPrepareArchiveStart(changeRoot, name, archiveClient);
    mkdirSync(dirname(targetDir), { recursive: true });
    renameSync(changeRoot, targetDir);

    // Strict validation with full rollback on failure
    try {
      execSync('npx openspec validate --all --strict', {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
    } catch (e) {
      renameSync(targetDir, changeRoot);
      for (const entry of plan) {
        if (entry.existed) writeFileSync(entry.mainPath, entry.oldContent);
        else if (entry.dirExisted) rmSync(entry.mainPath, { force: true });
        else rmSync(dirname(entry.mainPath), { recursive: true, force: true });
      }
      const detail = `${e.stdout || ''}${e.stderr || ''}`.trim() || 'non-zero exit';
      console.error(detail);
      return fail('openspec validate --all --strict failed — rolled back: change restored, main specs reverted to pre-sync state');
    }

    // Final handoff: pipeline is complete, no next-session prompt.
    // Change dir has already been moved — read prior Runtime from the archive target.
    const archivedHandoffPath = join(targetDir, 'handoff.md');
    let priorFields = {};
    if (existsSync(archivedHandoffPath)) {
      priorFields = fieldsFromSections(name, parseHandoffMarkdown(readFileSync(archivedHandoffPath, 'utf-8')));
    }
    const metricsPreview = loadMetricsFile(join(targetDir, 'metrics.json'), name, nowUtcIso());
    const reported = dropStaleArchiveSelfReport(priorFields.metrics, metricsPreview.sessions);
    const client = resolveRestoreClient({
      env: process.env,
      cwd: projectDir,
      homedir: process.env.HOME,
      platform: opts.platform,
    });
    const archivePlatform = resolvePlatform(opts, process.env, reported, {
      platform: client.platform,
      threadId: client.threadId,
    });
    const archiveModel = resolveModel(opts, process.env, reported);
    if (archivePlatform.warn) console.error(archivePlatform.warn);
    printMetricsSectionWarnings(reported, Boolean(archivePlatform.warn));
    const clientLabel = archivePlatform.value || client.platform
      ? `${archivePlatform.value || client.platform}${client.threadId ? ` ${client.threadId}` : ''}${client.source ? ` (${client.source})` : ''}`
      : 'unknown — pass --platform or run archive from Cursor/Amp/Claude';
    console.error(`metrics: archive client ${clientLabel}`);
    const runtimeResult = resolveRuntime({}, process.env, priorFields);
    const progress = parseTasksProgress(targetDir);
    const fields = {
      changeName: name,
      closedRole: 'Archiver',
      change: `- name: ${name}\n- status: archived`,
      done: `Change archived to ${targetRel}. Delta spec sync: ${syncStatus}. openspec validate --all --strict passed.`,
      decisions: 'none',
      blocked: 'none',
      nextCommand: 'none',
      nextRole: 'none',
      attach: `- \`${targetRel}/\``,
      spawn: 'none',
      constraints: 'Pipeline complete — no next session.',
      runtime: runtimeResult.value || 'local',
      agentId: resolveAgentId({}, process.env, priorFields),
      metrics: reported,
      status: 'archived',
      tasks: progress ? `${progress.done}/${progress.total}` : '',
      review: parseReviewVerdict(targetDir) || '',
      summary: `archived to ${targetRel}`,
    };
    writeFileSync(join(targetDir, 'handoff.md'), `${buildHandoffMarkdown(fields).trim()}\n`);
    const memoryPath = persistMemoryFromHandoff(projectDir, fields);
    const metricsPath = metricsFinalizeArchive(targetDir, name, {
      model: archiveModel,
      platform: archivePlatform.value || client.platform || null,
      ampThreadId: client.threadId || ampThreadIdFromEnv(process.env) || null,
      runtime: fields.runtime,
      agentId: fields.agentId,
      tasks: fields.tasks,
      collect: opts.collect === true,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      totalTokens: opts.totalTokens,
      costUsd: opts.costUsd,
      reported,
    });

    console.log(`change:   ${name}`);
    console.log(`schema:   ${status.schemaName || 'unknown'}`);
    console.log(`archive:  ${targetRel}`);
    console.log(`sync:     ${syncStatus}`);
    console.log(`handoff:  ${join(targetRel, 'handoff.md')} (next_command: none)`);
    console.log(`memory:   ${memoryPath.replace(`${projectDir}/`, '')}`);
    console.log(`metrics:  ${metricsPath.replace(`${projectDir}/`, '')} (archived_at set)`);
    try {
      const archivedMetrics = loadMetricsFile(metricsPath, name, nowUtcIso());
      for (const line of renderMetricsSummary(archivedMetrics)) console.log(line);
    } catch {}
    log.ok(`archived ${name}`);
  });

program
  .command('hooks-setup')
  .description('Opt-in pre-commit gate: husky-first, otherwise core.hooksPath=.githooks (never writes .git/hooks)')
  .action(() => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator hooks-setup');
    const result = runHooksSetup(projectDir);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command('mcp-setup')
  .description('Install optional GitHub/GitLab (from git origin) and browser MCP launchers (never prints tokens)')
  .option('--vcs <provider>', 'Override VCS detection: github | gitlab')
  .option('--no-browser', 'Skip browser MCP')
  .action((opts) => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator mcp-setup');
    const vcs = opts.vcs ? String(opts.vcs).toLowerCase() : '';
    if (vcs && vcs !== 'github' && vcs !== 'gitlab') {
      log.err('invalid --vcs (use github or gitlab)');
      process.exitCode = 1;
      return;
    }
    runMcpSetup(projectDir, { vcs, browser: opts.browser !== false });
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

program
  .command('memory-setup')
  .description('Install memory MCP launcher and rewrite Cursor/Amp configs to use an absolute MEMORY_FILE_PATH')
  .action(() => {
    const projectDir = process.cwd();
    log.title('agent-orchestrator memory-setup');
    refreshMemoryManagedFiles(projectDir);
    mergeGitignore(projectDir, GITIGNORE_LINES);
    ensureMemoryMcpEntry(projectDir);
    log.ok(`Memory file: ${resolve(projectDir, MEMORY_FILE_REL)}`);
    log.info('Restart Cursor / Amp after this change');
  });

program
  .command('handoff [change-name]')
  .description('Persist or restore session handoff: write handoff.md, upsert Memory JSON, print the expanded next-thread prompt')
  .option('--restore', 'Print the restore briefing instead of persisting', false)
  .option('--closed-role <role>', 'Closed role for persist')
  .option('--next-command <command>', 'Next /opsx:* command')
  .option('--next-role <role>', 'Next role or subagent name')
  .option('--summary <text>', 'Persisted summary (also fills Done when Done is empty)')
  .option('--done <text>', 'Done section')
  .option('--decisions <text>', 'Decisions section')
  .option('--blocked <text>', 'Blocked section')
  .option('--attach <text>', 'Attach section')
  .option('--spawn <text>', 'Subagents to spawn')
  .option('--constraints <text>', 'Constraints section')
  .option('--status <status>', 'Change status observation')
  .option('--tasks <progress>', 'Task progress n/m')
  .option('--review <verdict>', 'Review verdict')
  .option('--session-count <n>', 'Handoff session_count')
  .option('--runtime <runtime>', 'Session runtime: local | cloud')
  .option('--agent-id <id>', 'Cloud agent identifier')
  .option('--cloud-check', 'Verify change artifacts are committed and pushed', false)
  .option('--started-at <iso>', 'Session start timestamp (overrides the pending marker from --restore)')
  .option('--model <name>', 'LLM product id recorded in metrics.json')
  .option('--platform <platform>', 'Session platform: cursor | claude | amp')
  .option('--input-tokens <n>', 'Input tokens spent in this session')
  .option('--output-tokens <n>', 'Output tokens spent in this session')
  .option('--total-tokens <n>', 'Total tokens spent in this session (default: input + output)')
  .option('--cost-usd <usd>', 'Cost of this session in USD')
  .option('--no-metrics', 'Skip recording this session into metrics.json')
  .option('--collect', 'Additionally collect local spend adapters', false)
  .action((changeName, opts) => {
    const projectDir = process.cwd();
    const resolved = resolveHandoffChange(projectDir, changeName);
    if (!resolved) {
      log.err('No active change found. Pass a name: npx agent-orchestrator-kit handoff <name>');
      process.exitCode = 1;
      return;
    }
    if (resolved.ambiguous) {
      log.err(`Multiple active changes: ${resolved.ambiguous.join(', ')}. Pass the change name argument.`);
      process.exitCode = 1;
      return;
    }

    const name = resolved;
    const { agentLanguage } = readOrchestratorMeta(projectDir);
    const changeDir = join(projectDir, 'openspec', 'changes', name);

    if (opts.restore) {
      log.title(`handoff restore  ${name}`);
      const { filePath, fields } = readHandoffFields(projectDir, name);
      const memoryPath = resolve(projectDir, MEMORY_FILE_REL);
      const memoryItems = loadMemoryItems(memoryPath).filter(
        (item) => item.type === 'entity' && String(item.name || '').includes(name),
      );
      if (!fields && memoryItems.length === 0) {
        log.err(`No handoff.md or Memory entities for ${name}`);
        log.info(`Expected: ${filePath}`);
        process.exitCode = 1;
        return;
      }
      if (fields) {
        log.ok(`handoff.md: ${filePath}`);
        console.log(`next_command: ${fields.nextCommand || '(missing)'}`);
        console.log(`next_role: ${fields.nextRole || '(missing)'}`);
        console.log(`closed_role: ${fields.closedRole || '(missing)'}`);
        console.log('');
        console.log(fields.done || '');
      } else {
        log.warn('handoff.md missing — using Memory JSON only');
      }
      const decisionsPath = decisionsFilePath(projectDir, name);
      if (existsSync(decisionsPath)) {
        log.ok(`decisions.md: ${decisionsPath}`);
        const entries = parseDecisionsFileEntries(readFileSync(decisionsPath, 'utf-8'));
        for (const entry of entries) {
          console.log(`- ${entry.date} ${entry.text}`);
        }
      } else {
        console.log('decisions: none');
      }
      if (memoryItems.length) {
        log.ok(`Memory entities: ${memoryItems.length} (${memoryPath})`);
      } else {
        log.warn(`Memory JSON empty or missing at ${memoryPath}`);
      }
      if (opts.metrics !== false && existsSync(changeDir)) {
        const client = resolveRestoreClient({
          env: process.env,
          cwd: projectDir,
          homedir: process.env.HOME,
          platform: opts.platform,
        });
        const metricsPath = metricsRecordSessionStart(projectDir, name, fields ? fields.nextRole : '', client);
        const clientLabel = client.platform
          ? `${client.platform}${client.threadId ? ` ${client.threadId}` : ''} (${client.source})`
          : 'unknown — pass --platform or fill ## Metrics';
        log.ok(`metrics: session start recorded (${metricsPath.replace(`${projectDir}/`, '')})`);
        log.info(`metrics: client ${clientLabel}`);
      }
      return;
    }

    if (opts.cloudCheck) {
      const existingCheck = readHandoffFields(projectDir, name);
      const checkFields = existingCheck.fields || { changeName: name };
      if (!applyRuntimeToFields(checkFields, opts, process.env)) {
        process.exitCode = 1;
        return;
      }
      const findings = collectCloudCheckFindings(projectDir, name);
      if (!findings.length) {
        log.ok('cloud-check passed');
        return;
      }
      const emit = checkFields.runtime === 'cloud' ? log.err : log.warn;
      for (const finding of findings) emit(finding);
      if (checkFields.runtime === 'cloud') process.exitCode = 1;
      return;
    }

    console.error(pc.bold(pc.white(`\nhandoff persist  ${name}`)));
    if (!existsSync(changeDir)) {
      log.err(`change not found: ${name}`);
      process.exitCode = 1;
      return;
    }

    const existing = readHandoffFields(projectDir, name);
    const extra = {
      closedRole: opts.closedRole,
      nextCommand: opts.nextCommand,
      nextRole: opts.nextRole,
      summary: opts.summary,
      done: opts.done,
      decisions: opts.decisions,
      blocked: opts.blocked,
      attach: opts.attach,
      spawn: opts.spawn,
      constraints: opts.constraints,
      status: opts.status,
      tasks: opts.tasks,
      review: opts.review,
      sessionCount: opts.sessionCount,
    };
    const sections = existing.fields ? parseHandoffMarkdown(readFileSync(existing.filePath, 'utf-8')) : {};
    const fields = fieldsFromSections(name, sections, extra);
    const missing = missingHandoffFields(fields);
    if (missing.length) {
      log.err(`handoff.md incomplete — missing: ${missing.join(', ')}`);
      log.err('Write the file sections or pass --closed-role, --done/--summary, and --next-command');
      process.exitCode = 1;
      return;
    }

    const progress = parseTasksProgress(changeDir);
    if (!fields.tasks && progress) fields.tasks = `${progress.done}/${progress.total}`;
    if (!fields.review) fields.review = parseReviewVerdict(changeDir) || '';
    if (!fields.status) {
      fields.status = fields.review && /^APPROVE/i.test(fields.review) ? 'spec-approved' : 'in-progress';
    }

    if (!applyRuntimeToFields(fields, opts, process.env)) {
      process.exitCode = 1;
      return;
    }

    const reported = fields.metrics || emptyMetricsFields();
    const metricsPreview = loadMetricsFile(metricsFilePath(projectDir, name), name, nowUtcIso());
    const platformResult = resolvePlatform(opts, process.env, reported, metricsPreview.pending);
    if (platformResult.error) {
      log.err(platformResult.error);
      process.exitCode = 1;
      return;
    }
    if (platformResult.warn) console.error(platformResult.warn);
    printMetricsSectionWarnings(reported, Boolean(platformResult.warn));
    const resolvedModel = resolveModel(opts, process.env, reported);

    const prompt = buildNextSessionPrompt(fields, agentLanguage).replace(/^\n+|\n+$/g, '');
    fields.prompt = prompt;
    writeFileSync(existing.filePath, `${buildHandoffMarkdown(fields).trim()}\n`);
    console.error(pc.green('  ✓'), existing.filePath.replace(`${projectDir}/`, ''));

    appendDecisionsFromHandoff(projectDir, name, fields.decisions);
    const memoryPath = persistMemoryFromHandoff(projectDir, fields);
    console.error(pc.green('  ✓'), `Memory JSON upserted: ${memoryPath}`);

    if (opts.metrics !== false) {
      const metricsPath = metricsRecordSessionEnd(projectDir, fields, {
        startedAt: opts.startedAt,
        model: resolvedModel,
        platform: platformResult.value || null,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        totalTokens: opts.totalTokens,
        costUsd: opts.costUsd,
        collect: opts.collect === true,
        ampThreadId: (metricsPreview.pending && metricsPreview.pending.threadId) || ampThreadIdFromEnv(process.env) || null,
        reported,
      });
      console.error(pc.green('  ✓'), `metrics.json updated: ${metricsPath.replace(`${projectDir}/`, '')}`);
    }

    if (fields.runtime === 'cloud') printCloudPersistNextSteps(name);

    console.error(pc.dim('Copy the prompt below into the next chat as one fenced block. Do not include this line.'));
    process.stdout.write(`${prompt}\n`);
  });

program
  .command('metrics [change-name]')
  .description('Show recorded session metrics for a change: time per phase, tokens, cost, roles, and models')
  .option('--json', 'Print raw metrics.json', false)
  .option('--collect', 'Backfill the last session from local spend adapters without adding a new session', false)
  .action((changeName, opts) => {
    const projectDir = process.cwd();
    let name = changeName;
    let collectedAlready = false;
    if (!name) {
      const resolved = resolveHandoffChange(projectDir, changeName);
      if (!resolved) {
        log.err('No active change found. Pass a name: npx agent-orchestrator-kit metrics <name>');
        process.exitCode = 1;
        return;
      }
      if (resolved.ambiguous) {
        if (opts.collect) {
          let added = 0;
          for (const change of resolved.ambiguous) {
            const result = metricsBackfillLastSession(projectDir, change);
            added += result.added || 0;
          }
          collectedAlready = true;
          if (!opts.json) log.ok(`collect: ${added} new source(s) across ${resolved.ambiguous.length} changes`);
          if (opts.json) {
            process.stdout.write(`${JSON.stringify({ collected: added, changes: resolved.ambiguous }, null, 2)}\n`);
            return;
          }
          name = resolved.ambiguous[0];
        } else {
          log.err(`Multiple active changes: ${resolved.ambiguous.join(', ')}. Pass the change name argument.`);
          process.exitCode = 1;
          return;
        }
      } else {
        name = resolved;
      }
    }

    if (opts.collect && name && !collectedAlready) {
      const result = metricsBackfillLastSession(projectDir, name);
      if (result.missing) {
        log.err(`No metrics.json for ${name}`);
        process.exitCode = 1;
        return;
      }
      if (!opts.json) log.ok(`collect: ${result.added} new source(s) on last session`);
    }

    const { filePath, archived, missing } = resolveMetricsFile(projectDir, name);
    if (missing) {
      log.err(`No metrics.json for ${name}`);
      log.info(`Expected: ${filePath.replace(`${projectDir}/`, '')}`);
      log.info('Metrics are recorded by: handoff --restore (session start) and handoff <name> (session end)');
      process.exitCode = 1;
      return;
    }

    const metrics = loadMetricsFile(filePath, name, nowUtcIso());
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
      return;
    }

    log.title(`metrics  ${name}${archived ? '  (archived)' : ''}`);
    console.log(`file:      ${filePath.replace(`${projectDir}/`, '')}`);
    for (const line of renderMetricsSummary(metrics)) console.log(line);
  });

function isDirectCliRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(entry) === fileURLToPath(import.meta.url);
  }
}

if (isDirectCliRun()) {
  program.parse();
}

export { formatMetricsCostLine, resolveSessionSpend, canonicalRole, phaseForRole };
