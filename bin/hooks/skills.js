// Data-only stack-skill resolution for the hook runtime. Selection comes from
// the installed .agents/hook-skill-scopes.json plus the project's orchestrator
// config; nothing here installs packages, runs code, or blocks on missing files.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const DEFAULT_SCOPES = { schemaVersion: 1, stacks: {}, roleAliases: {}, unscopedRoles: ['implementation', 'testing'] };

export function loadScopes(projectDir) {
  const path = resolve(projectDir, '.agents', 'hook-skill-scopes.json');
  if (!existsSync(path)) return { scopes: DEFAULT_SCOPES, source: 'defaults', path };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.stacks) return { scopes: parsed, source: path, path };
  } catch {}
  return { scopes: DEFAULT_SCOPES, source: 'defaults', path };
}

export function parseProjectConfig(content) {
  const config = { stack: null, skillsStack: [] };
  const lines = String(content || '').split(/\r?\n/);
  let section = null;
  let skillsSection = null;
  for (const line of lines) {
    if (/^\S/.test(line) && !line.startsWith('- ')) {
      section = /^skills:/.test(line) ? 'skills' : /^project:/.test(line) ? 'project' : null;
      skillsSection = null;
      const inlineStack = line.match(/^project:.*\bstack:\s*([A-Za-z0-9_-]+)/);
      if (inlineStack) config.stack = inlineStack[1];
      continue;
    }
    if (section === 'project') {
      const stack = line.match(/^\s+stack:\s*([A-Za-z0-9_-]+)\s*$/);
      if (stack) config.stack = stack[1];
      continue;
    }
    if (section === 'skills') {
      const stackHeader = line.match(/^(\s+)stack:\s*(.*)$/);
      if (stackHeader) {
        skillsSection = 'stack';
        const inline = stackHeader[2].match(/^\[(.*)\]$/);
        if (inline) {
          config.skillsStack = inline[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
          skillsSection = null;
        } else if (stackHeader[2].trim() === '[]') {
          config.skillsStack = [];
          skillsSection = null;
        }
        continue;
      }
      if (skillsSection === 'stack') {
        const item = line.match(/^\s+-\s+([A-Za-z0-9_-]+)\s*$/);
        if (item) config.skillsStack.push(item[1]);
      }
    }
  }
  return config;
}

export function readProjectConfig(projectDir) {
  const path = resolve(projectDir, '.agents', 'orchestrator.yaml');
  if (!existsSync(path)) return { ...parseProjectConfig(null), path };
  try {
    return { ...parseProjectConfig(readFileSync(path, 'utf8')), path };
  } catch {
    return { ...parseProjectConfig(null), path };
  }
}

const normalizeRole = (role, scopes) => {
  const raw = String(role || '').toLowerCase();
  const alias = scopes.roleAliases?.[raw];
  if (alias) return alias;
  if (['implementation', 'testing'].includes(raw)) return raw;
  return raw || null;
};

function globToRegExp(glob) {
  const expanded = String(glob).replace(/\{([^{}]+)\}/g, (_, body) => `\u0001${body.split(',').join('\u0002')}\u0003`);
  const escaped = expanded
    .replace(/[.+^$()|[\]\\{}]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(')
    .replace(/\u0002/g, '|')
    .replace(/\u0003/g, ')');
  return new RegExp(`^${escaped}$`);
}

const globCache = new Map();
const matcherFor = (glob) => {
  if (!globCache.has(glob)) globCache.set(glob, globToRegExp(glob));
  return globCache.get(glob);
};

export function canonicalizePath(projectDir, rawPath) {
  if (typeof rawPath !== 'string' || rawPath === '') return { status: 'invalid' };
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(projectDir, rawPath);
  const projectReal = safeRealPath(projectDir);
  if (!projectReal) return { status: 'invalid' };
  let real;
  try {
    real = realpathSync(absolute);
  } catch {
    const rel = relative(projectReal, absolute);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { status: 'rejected', absolute, reason: 'outside-worktree' };
    return { status: 'missing', absolute, rel };
  }
  const rel = relative(projectReal, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { status: 'rejected', absolute: real, reason: rel === '' ? 'worktree-root' : 'symlink-escape' };
  return { status: 'ok', absolute: real, rel };
}

function safeRealPath(target) {
  try {
    return realpathSync(resolve(target));
  } catch {
    return null;
  }
}

function skillInstalled(projectDir, name) {
  return existsSync(resolve(projectDir, '.agents', 'skills', name, 'SKILL.md'));
}

function digestFile(absolute) {
  try {
    return createHash('sha256').update(readFileSync(absolute, 'utf8')).digest('hex');
  } catch {
    return null;
  }
}

// paths: { status: 'ok'|'missing'|'rejected', rel, absolute }
export function resolveSkills({ projectDir, role, taskFiles = [], accessedPaths = [], config = null, scopes = null }) {
  const projectConfig = config ?? readProjectConfig(projectDir);
  const { scopes: scopesData } = scopes ?? loadScopes(projectDir);
  const normalizedRole = normalizeRole(role, scopesData);
  const stackKey = projectConfig.stack;
  const installed = (projectConfig.skillsStack ?? []).filter((name) => skillInstalled(projectDir, name));

  const canonicalFiles = (taskFiles ?? []).map((path) => canonicalizePath(projectDir, path));
  const canonicalAccessed = (accessedPaths ?? []).map((path) => canonicalizePath(projectDir, path));
  // Scope matching is path-based: absent task Files still select their scopes
  // (they are reported as missing separately); only digests require existence.
  const eligible = [...canonicalFiles, ...canonicalAccessed].filter((entry) => entry.status === 'ok' || entry.status === 'missing');

  const selected = new Map();
  const missingSkills = new Set();
  const addSkill = (name, why) => {
    if (!name || selected.has(name)) return;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return;
    if (!skillInstalled(projectDir, name)) { missingSkills.add(`.agents/skills/${name}/SKILL.md`); return; }
    selected.set(name, { name, why, sourcePath: `.agents/skills/${name}/SKILL.md` });
  };

  const stackSpec = stackKey ? scopesData.stacks?.[stackKey] : null;
  if (stackSpec) {
    const roleSkills = stackSpec.roles?.[normalizedRole] ?? stackSpec.roles?.implementation ?? [];
    for (const name of roleSkills) addSkill(name, `stack ${stackKey} role ${normalizedRole}`);
    for (const scope of stackSpec.fileScopes ?? []) {
      const match = eligible.some((entry) => (scope.globs ?? []).some((glob) => matcherFor(glob).test(entry.rel)));
      if (match) for (const name of scope.skills ?? []) addSkill(name, `file scope ${scope.globs?.[0] ?? ''}`);
    }
  } else {
    // Generic/Node (and any stack without scopes): unscoped installed inventory
    // is conservatively included for implementation/testing instead of guessed.
    if ((scopesData.unscopedRoles ?? ['implementation', 'testing']).includes(normalizedRole)) {
      for (const name of projectConfig.skillsStack ?? []) addSkill(name, 'unscoped installed inventory');
    }
  }

  // Uncertain Vue matches: .vue paths in a project that does not declare the
  // vue3 stack conservatively select the applicable installed Vue inventory.
  if (stackKey !== 'vue3' && eligible.some((entry) => (entry.rel ?? '').endsWith('.vue'))) {
    const vueInventory = ['javascript-core', 'vue-core', 'vue-testing', 'vue-pinia', 'vue-axios', 'vue-router', 'vue-composables', 'vite'];
    for (const name of vueInventory) {
      if (installed.includes(name)) addSkill(name, 'conservative vue inventory for .vue paths');
    }
  }

  const present = [...selected.values()].map((skill) => ({
    ...skill,
    absolutePath: resolve(projectDir, skill.sourcePath),
    contentDigest: digestFile(resolve(projectDir, skill.sourcePath)),
  }));

  return {
    stack: stackKey,
    role: normalizedRole,
    selected: present,
    missingSkills: [...missingSkills],
    missingFiles: [...canonicalFiles, ...canonicalAccessed].filter((entry) => entry.status === 'missing').map((entry) => entry.rel),
    rejectedFiles: [...canonicalFiles, ...canonicalAccessed].filter((entry) => entry.status === 'rejected').map((entry) => ({ path: entry.rel ?? entry.absolute, reason: entry.reason })),
    evaluatedFiles: eligible.filter((entry) => entry.status === 'ok').map((entry) => ({ path: entry.rel, digest: digestFile(entry.absolute) })),
  };
}

export function skillDigest(projectDir, name) {
  const absolute = resolve(projectDir, '.agents', 'skills', name, 'SKILL.md');
  if (!existsSync(absolute)) return null;
  return digestFile(absolute);
}
