import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const HOOK_CLIENTS = ['claude', 'cursor', 'amp'];
export const OWNERSHIP_MANIFEST_REL = join('.agents', 'hooks', 'ownership.json');
export const HOOK_LAUNCHER_REL = join('scripts', 'agent-hook-launcher.cjs');
export const AMP_PLUGIN_REL = join('.amp', 'plugins', 'agent-orchestrator.ts');
export const HOOK_STATE_FALLBACK_REL = join('.agents', '.hook-state');
export const HOOK_SCOPES_REL = join('.agents', 'hook-skill-scopes.json');
export const LAUNCHER_COMMAND = 'node scripts/agent-hook-launcher.cjs';
const LAUNCHER_NEEDLE = 'agent-hook-launcher.cjs';
const PROBE_TIMEOUT_MS = 2000;

const CLIENT_SPECS = {
  claude: {
    configRel: join('.claude', 'settings.json'),
    events: ['SessionStart', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionEnd'],
    entry: () => ({ matcher: '*', hooks: [{ type: 'command', command: LAUNCHER_COMMAND }] }),
    ownsEntry: (entry) => Array.isArray(entry?.hooks)
      && entry.hooks.some((hook) => String(hook?.command || '').includes(LAUNCHER_NEEDLE)),
  },
  cursor: {
    configRel: join('.cursor', 'hooks.json'),
    events: ['sessionStart', 'sessionEnd', 'beforeReadFile', 'afterFileEdit', 'postToolUse', 'subagentStart', 'subagentStop', 'stop', 'preCompact'],
    entry: () => ({ command: LAUNCHER_COMMAND }),
    ownsEntry: (entry) => String(entry?.command || '').includes(LAUNCHER_NEEDLE),
  },
  amp: { configRel: AMP_PLUGIN_REL, events: [], entry: null, ownsEntry: null },
};

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const canonicalJson = (value) => JSON.stringify(value);
const entryDigest = (entry) => sha256(canonicalJson(entry));

function writeAtomicSync(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = join(dirname(filePath), `tmp-aok-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  writeFileSync(tmpPath, content, 'utf8');
  const verified = readFileSync(tmpPath, 'utf8');
  if (verified !== content) {
    rmSync(tmpPath, { force: true });
    throw new Error(`atomic write verification failed for ${filePath}`);
  }
  renameSync(tmpPath, filePath);
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) return { ok: true, missing: true, value: null };
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch {
    return { ok: false, value: null };
  }
}

export function resolveHookStateRoot(projectDir) {
  try {
    const gitDir = execFileSync('git', ['-C', projectDir, 'rev-parse', '--absolute-git-dir'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: PROBE_TIMEOUT_MS,
    }).toString().trim();
    if (gitDir.startsWith('/')) return { root: join(gitDir, 'aok-hooks', 'v1'), fallback: false };
  } catch {}
  return { root: join(projectDir, HOOK_STATE_FALLBACK_REL, 'v1'), fallback: true };
}

function ensureFallbackIgnored(projectDir) {
  const { root, fallback } = resolveHookStateRoot(projectDir);
  if (!fallback) return root;
  mkdirSync(root, { recursive: true });
  const gitignorePath = join(projectDir, '.gitignore');
  const ownedLine = '.agents/.hook-state/';
  const raw = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (raw.split(/\r?\n/).includes(ownedLine)) return root;
  const prefix = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
  writeFileSync(gitignorePath, `${raw}${prefix}${ownedLine}\n`, 'utf8');
  return root;
}

function expectedAssets(kitRoot) {
  const assets = [
    { file: HOOK_LAUNCHER_REL, src: join(kitRoot, 'templates', 'scripts', 'agent-hook-launcher.cjs') },
    { file: HOOK_SCOPES_REL, src: join(kitRoot, 'templates', 'hook-skill-scopes.json') },
  ];
  return assets.filter((asset) => existsSync(asset.src));
}

function expectedAmpPlugin(kitRoot) {
  const src = join(kitRoot, 'templates', 'amp', 'agent-orchestrator.ts');
  return existsSync(src) ? { file: AMP_PLUGIN_REL, src } : null;
}

function readManifest(projectDir) {
  const result = readJsonFile(join(projectDir, OWNERSHIP_MANIFEST_REL));
  if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) return null;
  return result.value;
}

function writeManifest(projectDir, manifest) {
  writeAtomicSync(join(projectDir, OWNERSHIP_MANIFEST_REL), `${JSON.stringify(manifest, null, 2)}\n`);
}

function clientRecord(manifest, client) {
  const record = manifest?.clients?.[client];
  return record && typeof record === 'object' && Array.isArray(record.entries) && Array.isArray(record.assets)
    ? record
    : null;
}

function mergeHookConfig({ spec, config }) {
  const changes = { added: [], adopted: [], conflicts: [] };
  const hooks = config.hooks && typeof config.hooks === 'object' ? config.hooks : {};
  for (const event of spec.events) {
    const expected = spec.entry();
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    const owned = entries.filter(spec.ownsEntry);
    if (owned.length === 1 && entryDigest(owned[0]) === entryDigest(expected)) continue;
    if (owned.length > 0) {
      changes.conflicts.push(`${event}: owned entry modified (left byte-identical)`);
      continue;
    }
    hooks[event] = [...entries, expected];
    changes.added.push(event);
  }
  config.hooks = hooks;
  return changes;
}

function stripOwnedHookConfig({ spec, config }) {
  const changes = { removed: [], conflicts: [] };
  const hooks = config.hooks && typeof config.hooks === 'object' ? config.hooks : {};
  const expected = spec.entry();
  for (const event of spec.events) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = [];
    let removedOwned = false;
    for (const entry of entries) {
      if (!spec.ownsEntry(entry)) {
        kept.push(entry);
        continue;
      }
      if (entryDigest(entry) !== entryDigest(expected)) {
        changes.conflicts.push(`${event}: owned entry modified (left in place)`);
        kept.push(entry);
        continue;
      }
      removedOwned = true;
    }
    if (kept.length === 0 && removedOwned) delete hooks[event];
    else if (removedOwned) hooks[event] = kept;
    if (removedOwned) changes.removed.push(event);
  }
  config.hooks = hooks;
  return changes;
}

function installAssets({ projectDir, kitRoot, client, log }) {
  const installed = [];
  const wrote = [];
  const assets = [...expectedAssets(kitRoot)];
  if (client === 'amp') {
    const plugin = expectedAmpPlugin(kitRoot);
    if (plugin) assets.push(plugin);
  }
  for (const asset of assets) {
    const dest = join(projectDir, asset.file);
    const digest = sha256(readFileSync(asset.src, 'utf8'));
    const unchanged = existsSync(dest) && sha256(readFileSync(dest, 'utf8')) === digest;
    if (!unchanged) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(asset.src, dest);
      wrote.push(asset.file);
      log?.ok?.(asset.file);
    }
    installed.push({ file: asset.file.replace(/\\/g, '/'), digest });
  }
  return { installed, wrote };
}

function removeUnchangedAssets({ projectDir, manifestRecord, log }) {
  const removed = [];
  const conflicts = [];
  for (const asset of manifestRecord?.assets ?? []) {
    const dest = join(projectDir, asset.file);
    if (!existsSync(dest)) continue;
    const digest = sha256(readFileSync(dest, 'utf8'));
    if (digest !== asset.digest) {
      conflicts.push(`${asset.file}: owned file modified (left in place)`);
      continue;
    }
    rmSync(dest, { force: true });
    removed.push(asset.file);
    log?.ok?.(`${asset.file} removed`);
  }
  for (const dir of [dirname(join(projectDir, AMP_PLUGIN_REL)), join(projectDir, '.claude'), join(projectDir, '.cursor')]) {
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
    } catch {}
  }
  return { removed, conflicts };
}

export function enableHooksClient({ projectDir, kitRoot, client, env = process.env, probeVersion = true, log }) {
  if (!HOOK_CLIENTS.includes(client)) {
    return { ok: false, changed: false, added: [], adopted: [], conflicts: [`unknown client: ${client}`] };
  }
  const spec = CLIENT_SPECS[client];
  const result = { ok: true, changed: false, added: [], adopted: [], conflicts: [] };
  const manifestPath = join(projectDir, OWNERSHIP_MANIFEST_REL);
  const manifest = readManifest(projectDir) ?? { schemaVersion: 1, clients: {} };
  if (!manifest.clients || typeof manifest.clients !== 'object') manifest.clients = {};
  const record = clientRecord(manifest, client);

  if (spec.entry) {
    const configPath = join(projectDir, spec.configRel);
    const parsed = readJsonFile(configPath);
    if (!parsed.ok) {
      result.ok = false;
      result.conflicts.push(`${spec.configRel}: malformed JSON — fix it, then re-run hooks enable`);
      return result;
    }
    const config = parsed.missing || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)
      ? {}
      : parsed.value;
    if (client === 'cursor' && config.version == null) config.version = 1;

    if (!record) {
      const kitShapedEvents = spec.events.filter((event) =>
        (Array.isArray(config.hooks?.[event]) ? config.hooks[event] : []).some(spec.ownsEntry));
      if (kitShapedEvents.length > 0) {
        const expected = spec.entry();
        const allMatch = kitShapedEvents.every((event) => {
          const owned = config.hooks[event].filter(spec.ownsEntry);
          return owned.length === 1 && entryDigest(owned[0]) === entryDigest(expected);
        });
        if (!allMatch) {
          result.ok = false;
          result.conflicts.push(
            `${spec.configRel}: kit-shaped entries differ from this kit's expected entries — resolve manually (bytes left unchanged)`);
          return result;
        }
        result.adopted = kitShapedEvents;
        log?.ok?.(`${spec.configRel}: adopted ${kitShapedEvents.length} committed owned entr${kitShapedEvents.length === 1 ? 'y' : 'ies'} (digest-verified)`);
      }
    }

    const changes = mergeHookConfig({ spec, config });
    result.conflicts.push(...changes.conflicts);
    if (changes.conflicts.length > 0) {
      result.ok = false;
      return result;
    }
    if (changes.added.length > 0 || parsed.missing) {
      writeAtomicSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      result.changed = true;
      result.added = changes.added;
    }
  }

  const entries = (spec.entry
    ? spec.events.map((event) => ({
      id: `${client}:${event}`,
      file: spec.configRel.replace(/\\/g, '/'),
      event,
      command: LAUNCHER_COMMAND,
      digest: entryDigest(spec.entry()),
    }))
    : []);
  const { installed, wrote } = installAssets({ projectDir, kitRoot, client, log });
  if (wrote.length > 0) result.changed = true;

  manifest.clients[client] = { enabled: true, adopted: result.adopted.length > 0, entries, assets: installed };
  writeManifest(projectDir, manifest);
  ensureFallbackIgnored(projectDir);
  persistCapabilityStatus({
    projectDir,
    client,
    status: { client, version: probeVersion ? probeClientVersion(client, { env }) : null },
  });
  log?.ok?.(`${OWNERSHIP_MANIFEST_REL.replace(/\\/g, '/')} rewritten (client: ${client})`);
  return result;
}

export function disableHooksClient({ projectDir, kitRoot, client, log }) {
  if (!HOOK_CLIENTS.includes(client)) {
    return { ok: false, changed: false, removed: [], conflicts: [`unknown client: ${client}`] };
  }
  const spec = CLIENT_SPECS[client];
  const result = { ok: true, changed: false, removed: [], conflicts: [] };
  const manifest = readManifest(projectDir);
  const record = clientRecord(manifest, client);
  if (!manifest || !record) {
    log?.info?.(`${client}: not installed (nothing to remove)`);
    return result;
  }

  if (spec.entry) {
    const configPath = join(projectDir, spec.configRel);
    const parsed = readJsonFile(configPath);
    if (!parsed.ok) {
      result.ok = false;
      result.conflicts.push(`${spec.configRel}: malformed JSON — bytes left unchanged`);
      return result;
    }
    if (!parsed.missing && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
      const config = parsed.value;
      const changes = stripOwnedHookConfig({ spec, config });
      result.conflicts.push(...changes.conflicts);
      if (changes.conflicts.length > 0) result.ok = false;
      if (changes.conflicts.length === 0 && changes.removed.length > 0) {
        writeAtomicSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
        result.changed = true;
        result.removed.push(...changes.removed);
      }
    }
  }

  const assets = removeUnchangedAssets({ projectDir, manifestRecord: record, log });
  result.conflicts.push(...assets.conflicts);
  if (assets.conflicts.length > 0) result.ok = false;
  if (assets.removed.length > 0) result.changed = true;
  result.removed.push(...assets.removed);

  if (result.conflicts.length === 0) {
    delete manifest.clients[client];
    if (Object.keys(manifest.clients).length === 0) rmSync(join(projectDir, OWNERSHIP_MANIFEST_REL), { force: true });
    else writeManifest(projectDir, manifest);
    result.changed = true;
    log?.ok?.(`hooks disabled for ${client}`);
  }
  return result;
}

export function probeClientVersion(client, { env = process.env } = {}) {
  const override = env[`AOK_${client.toUpperCase()}_VERSION`];
  if (override && override.trim()) return override.trim();
  const bins = { claude: 'claude', cursor: 'cursor', amp: 'amp' };
  const bin = bins[client];
  if (!bin) return null;
  try {
    return execFileSync(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split('\n')[0].slice(0, 64) || null;
  } catch {
    return null;
  }
}

export function persistCapabilityStatus({ projectDir, client, status }) {
  const root = ensureFallbackIgnored(projectDir);
  const dir = join(root, 'status');
  mkdirSync(dir, { recursive: true });
  const payload = { ...status, probedAt: new Date().toISOString() };
  writeAtomicSync(join(dir, `${client}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function readCapabilityStatus(projectDir, client) {
  const { root } = resolveHookStateRoot(projectDir);
  const result = readJsonFile(join(root, 'status', `${client}.json`));
  return result.ok && result.value ? result.value : null;
}

export function hooksStatus({ projectDir, kitRoot, env = process.env, probe = true }) {
  const manifest = readManifest(projectDir);
  const clients = {};
  for (const client of HOOK_CLIENTS) {
    const spec = CLIENT_SPECS[client];
    const record = clientRecord(manifest, client);
    let installedEntries = 0;
    let conflicts = [];
    if (record && spec.entry) {
      const parsed = readJsonFile(join(projectDir, spec.configRel));
      if (!parsed.ok) conflicts = [`${spec.configRel}: malformed JSON`];
      else if (!parsed.missing && parsed.value) {
        installedEntries = spec.events.filter((event) =>
          (Array.isArray(parsed.value?.hooks?.[event]) ? parsed.value.hooks[event] : []).some(spec.ownsEntry)).length;
      }
    }
    const persisted = readCapabilityStatus(projectDir, client);
    const override = env[`AOK_${client.toUpperCase()}_VERSION`];
    const version = probe
      ? (probeClientVersion(client, { env }) ?? override ?? persisted?.version ?? null)
      : (override ?? persisted?.version ?? null);
    clients[client] = {
      enabled: Boolean(record?.enabled),
      adopted: Boolean(record?.adopted),
      ownedEntries: installedEntries,
      conflicts,
      version,
      capabilities: persisted ?? null,
    };
  }
  const launcherInstalled = existsSync(join(projectDir, HOOK_LAUNCHER_REL));
  const { root, fallback } = resolveHookStateRoot(projectDir);
  return {
    schemaVersion: 1,
    feature: 'agent-hook-runtime',
    distinctFrom: 'git pre-commit gate (hooks-setup / init --hooks, unchanged)',
    defaults: { enabled: false, mode: 'observe', policies: {} },
    runtime: { launcher: launcherInstalled, stateRoot: root.replace(/\\/g, '/'), fallbackStateRoot: fallback },
    clients,
  };
}

export function refreshOwnedHookAssets({ projectDir, kitRoot, log }) {
  const manifest = readManifest(projectDir);
  if (!manifest) return { changed: false, refreshed: [], conflicts: [] };
  const refreshed = [];
  const conflicts = [];
  for (const client of HOOK_CLIENTS) {
    const record = clientRecord(manifest, client);
    if (!record) continue;
    for (const asset of record.assets ?? []) {
      const dest = join(projectDir, asset.file);
      const src = join(kitRoot, 'templates', ...String(asset.file).split('/'));
      if (!existsSync(src) || !existsSync(dest)) continue;
      const nextDigest = sha256(readFileSync(src, 'utf8'));
      if (nextDigest === asset.digest) continue;
      const currentDigest = sha256(readFileSync(dest, 'utf8'));
      if (currentDigest !== asset.digest) {
        conflicts.push(`${asset.file}: owned file modified locally (left unchanged)`);
        continue;
      }
      const tmpPath = `${dest}.tmp-aok-${process.pid}`;
      copyFileSync(src, tmpPath);
      if (sha256(readFileSync(tmpPath, 'utf8')) !== nextDigest) {
        rmSync(tmpPath, { force: true });
        conflicts.push(`${asset.file}: replacement validation failed (left unchanged)`);
        continue;
      }
      renameSync(tmpPath, dest);
      asset.digest = nextDigest;
      refreshed.push(asset.file);
      log?.ok?.(`${asset.file} refreshed (validated)`);
    }
  }
  if (refreshed.length > 0) writeManifest(projectDir, manifest);
  return { changed: refreshed.length > 0, refreshed, conflicts };
}

export function hookConfigDefaults() {
  return { enabled: false, mode: 'observe', policies: {} };
}

export const WORKFLOW_POLICY_IDS = [
  'verification',
  'completion',
  'scope',
  'checks',
  'owned-sync',
  'workflow-notifications',
];

const POLICY_OPTION_KEYS = {
  verification: new Set(['timeoutMs', 'ignoredInputs', 'generatedOutputs', 'environmentNames']),
  completion: new Set(['validationTimeoutMs']),
  scope: new Set(),
  checks: new Set(['commands', 'debounceMs', 'timeoutMs']),
  'owned-sync': new Set(['target', 'debounceMs', 'timeoutMs']),
  'workflow-notifications': new Set(['dedupMs']),
};

const TIMEOUT_RANGE = { min: 1, max: 300000 };
const DEBOUNCE_RANGE = { min: 0, max: 5000 };
const DEDUP_RANGE = { min: 1, max: 300000 };
const SYNC_TARGETS = new Set(['all', 'cursor', 'claude', 'amp']);

function readYamlScalar(raw) {
  const value = String(raw || '').trim();
  const quoted = value.match(/^"([^"]*)"|^'([^']*)'/);
  if (quoted) return quoted[1] !== undefined ? quoted[1] : quoted[2];
  return value.replace(/(^|\s)#.*$/, '').trim();
}

function integerIn(value, range) {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

function isRelativePath(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) return false;
  return !value.split(/[\\/]/).includes('..');
}

function isStringArray(value, paths) {
  return Array.isArray(value) && value.every((item) => (paths ? isRelativePath(item) : typeof item === 'string'));
}

function validCheckCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return false;
  const keys = Object.keys(command);
  if (keys.length !== 5 || keys.some((key) => !['id', 'executable', 'args', 'globs', 'writablePaths'].includes(key))) return false;
  if (typeof command.id !== 'string' || command.id === '') return false;
  if (typeof command.executable !== 'string' || command.executable === '' || !isRelativePath(command.executable) && command.executable.includes('/')) return false;
  if (command.executable.split(/[\\/]/).includes('..') || command.executable.startsWith('/') || /^[A-Za-z]:/.test(command.executable)) return false;
  return isStringArray(command.args, false) && isStringArray(command.globs, true) && isStringArray(command.writablePaths, true);
}

export function policyOptionDefaults(id) {
  switch (id) {
    case 'verification':
      return { timeoutMs: 30000, ignoredInputs: [], generatedOutputs: [], environmentNames: [] };
    case 'completion':
      return { validationTimeoutMs: 30000 };
    case 'scope':
      return {};
    case 'checks':
      return { commands: [], debounceMs: 500, timeoutMs: 30000 };
    case 'owned-sync':
      return { target: 'all', debounceMs: 500, timeoutMs: 30000 };
    case 'workflow-notifications':
      return { dedupMs: 60000 };
    default:
      return {};
  }
}

export function validatePolicyOptions(id, options) {
  if (options == null) return { ok: true, options: {} };
  if (typeof options !== 'object' || Array.isArray(options)) {
    return { ok: false, message: `policy ${id} options must be a JSON object` };
  }
  const allowed = POLICY_OPTION_KEYS[id];
  if (!allowed) return { ok: true, options: { ...options } };
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) return { ok: false, message: `policy ${id} option ${key} is not supported` };
  }
  if (id === 'verification') {
    if (options.timeoutMs !== undefined && !integerIn(options.timeoutMs, TIMEOUT_RANGE)) {
      return { ok: false, message: 'verification timeoutMs must be an integer from 1 to 300000' };
    }
    for (const key of ['ignoredInputs', 'generatedOutputs']) {
      if (options[key] !== undefined && !isStringArray(options[key], true)) {
        return { ok: false, message: `verification ${key} must be relative path strings` };
      }
    }
    if (options.environmentNames !== undefined && !isStringArray(options.environmentNames, false)) {
      return { ok: false, message: 'verification environmentNames must be strings' };
    }
  } else if (id === 'completion') {
    if (options.validationTimeoutMs !== undefined && !integerIn(options.validationTimeoutMs, TIMEOUT_RANGE)) {
      return { ok: false, message: 'completion validationTimeoutMs must be an integer from 1 to 300000' };
    }
  } else if (id === 'checks') {
    if (options.commands !== undefined && (!Array.isArray(options.commands) || !options.commands.every(validCheckCommand))) {
      return { ok: false, message: 'checks commands must be objects with id, executable, args, globs and writablePaths' };
    }
    if (options.debounceMs !== undefined && !integerIn(options.debounceMs, DEBOUNCE_RANGE)) {
      return { ok: false, message: 'checks debounceMs must be an integer from 0 to 5000' };
    }
    if (options.timeoutMs !== undefined && !integerIn(options.timeoutMs, TIMEOUT_RANGE)) {
      return { ok: false, message: 'checks timeoutMs must be an integer from 1 to 300000' };
    }
  } else if (id === 'owned-sync') {
    if (options.target !== undefined && !SYNC_TARGETS.has(options.target)) {
      return { ok: false, message: 'owned-sync target must be all, cursor, claude or amp' };
    }
    if (options.debounceMs !== undefined && !integerIn(options.debounceMs, DEBOUNCE_RANGE)) {
      return { ok: false, message: 'owned-sync debounceMs must be an integer from 0 to 5000' };
    }
    if (options.timeoutMs !== undefined && !integerIn(options.timeoutMs, TIMEOUT_RANGE)) {
      return { ok: false, message: 'owned-sync timeoutMs must be an integer from 1 to 300000' };
    }
  } else if (id === 'workflow-notifications') {
    if (options.dedupMs !== undefined && !integerIn(options.dedupMs, DEDUP_RANGE)) {
      return { ok: false, message: 'workflow-notifications dedupMs must be an integer from 1 to 300000' };
    }
  }
  return { ok: true, options: { ...options } };
}

export function resolvePolicyOptions(id, options = {}) {
  const validation = validatePolicyOptions(id, options ?? {});
  if (!validation.ok) return validation;
  return { ok: true, options: { ...policyOptionDefaults(id), ...validation.options } };
}

function scalarToken(raw) {
  const value = readYamlScalar(raw);
  if (value === 'true' || value === 'false') return { kind: 'bool', value: value === 'true' };
  if ((value === 'observe' || value === 'enforce') && !/^['"]/.test(String(raw || '').trim())) return { kind: 'word', value };
  const quoted = String(raw || '').trim().match(/^(['"])(observe|enforce)\1/);
  if (quoted) return { kind: 'word', value: quoted[2] };
  return { kind: 'other', value };
}

function extractJsonObject(text) {
  if (!text.startsWith('{')) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const rest = text.slice(i + 1).trim();
        if (rest !== '' && !rest.startsWith('#')) return null;
        return text.slice(0, i + 1);
      }
    }
  }
  return null;
}

function configFinding(message, policyId = null) {
  return { code: 'hooks.policy.config.invalid', severity: 'error', message, policyId, paths: [] };
}

// Direct child of the top-level pipeline block only. Comments, nested
// lookalikes and values outside that block cannot flip the default.
export function readRequireSpecReview(content) {
  let inPipeline = false;
  let childIndent = null;
  let found = false;
  let value = null;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (/^pipeline:\s*(#.*)?$/.test(line)) {
      found = true;
      inPipeline = true;
      childIndent = null;
      continue;
    }
    if (inPipeline && /^#/.test(line)) continue;
    if (inPipeline && /^\S/.test(line)) break;
    if (!inPipeline || /^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const entry = line.match(/^(\s+)([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!entry) continue;
    if (childIndent === null) childIndent = entry[1];
    if (entry[1] !== childIndent) continue;
    if (entry[2] !== 'require_spec_review') continue;
    const raw = readYamlScalar(entry[3]);
    value = raw === 'true' ? true : raw === 'false' ? false : null;
  }
  if (!found || value === null) return true;
  return value;
}

export function parseHookConfig(content) {
  const config = hookConfigDefaults();
  const findings = [];
  const lines = String(content || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^hooks:\s*(#.*)?$/.test(line));
  if (start < 0) return { ...config, findings };

  let hooksIndent = null;
  let policiesIndent = null;
  let policyIndent = null;
  let state = 'hooks';
  let currentId = null;

  const entryFor = (id) => {
    if (!config.policies[id]) config.policies[id] = { enabled: false, mode: 'observe', options: {} };
    return config.policies[id];
  };
  const invalidate = (id, message) => {
    entryFor(id).enabled = false;
    findings.push(configFinding(message, id));
  };
  const consumeDeeper = (parentIndent, from) => {
    let cursor = from;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
        cursor += 1;
        continue;
      }
      if (/^\S/.test(line)) break;
      if (line.match(/^\s*/)[0].length <= parentIndent.length) break;
      cursor += 1;
    }
    return cursor;
  };

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const indent = line.match(/^\s*/)[0];
    const body = line.slice(indent.length);
    if (hooksIndent === null) hooksIndent = indent;
    if (indent.length < hooksIndent.length) break;

    if (indent === hooksIndent) {
      state = 'hooks';
      currentId = null;
    } else if (state === 'policy' && policiesIndent && indent === policiesIndent) {
      state = 'policies';
      currentId = null;
      policyIndent = null;
    }

    if (state === 'hooks' && indent === hooksIndent) {
      const enabled = body.match(/^enabled:\s*(.+)$/);
      if (enabled) {
        const token = scalarToken(enabled[1]);
        if (token.kind === 'bool') config.enabled = token.value;
        else findings.push(configFinding('hooks.enabled must be a boolean'));
        continue;
      }
      const mode = body.match(/^mode:\s*(.+)$/);
      if (mode) {
        const token = scalarToken(mode[1]);
        if (token.kind === 'word') config.mode = token.value;
        else findings.push(configFinding('hooks.mode must be observe or enforce'));
        continue;
      }
      if (/^policies:\s*\{\s*\}\s*(#.*)?$/.test(body)) {
        config.policies = {};
        state = 'hooks';
        continue;
      }
      if (/^policies:\s*(#.*)?$/.test(body)) {
        state = 'policies';
        policiesIndent = null;
        currentId = null;
        continue;
      }
      if (/^policies:/.test(body)) findings.push(configFinding('hooks.policies must be {} or a nested map'));
      continue;
    }

    if ((state === 'policies' || state === 'policy') && policiesIndent === null && indent.length > hooksIndent.length) {
      policiesIndent = indent;
    }
    if ((state === 'policies' || state === 'policy') && policiesIndent && indent === policiesIndent) {
      const named = body.match(/^([A-Za-z0-9][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!named) continue;
      currentId = named[1];
      entryFor(currentId);
      state = 'policy';
      policyIndent = null;
      const inline = readYamlScalar(named[2]);
      if (inline === '' ) continue;
      if (inline === '{}') continue;
      invalidate(currentId, `policy ${currentId} must be a nested mapping`);
      i = consumeDeeper(indent, i + 1) - 1;
      continue;
    }

    if (state === 'policy' && currentId && indent.length > (policiesIndent ? policiesIndent.length : hooksIndent.length)) {
      if (policyIndent === null) policyIndent = indent;
      if (indent !== policyIndent) continue;
      const enabled = body.match(/^enabled:\s*(.+)$/);
      if (enabled) {
        const token = scalarToken(enabled[1]);
        if (token.kind === 'bool') entryFor(currentId).enabled = token.value;
        else invalidate(currentId, `policy ${currentId} enabled must be a boolean`);
        continue;
      }
      const mode = body.match(/^mode:\s*(.+)$/);
      if (mode) {
        const token = scalarToken(mode[1]);
        if (token.kind === 'word') entryFor(currentId).mode = token.value;
        else invalidate(currentId, `policy ${currentId} mode must be observe or enforce`);
        continue;
      }
      const options = body.match(/^options:\s*(.*)$/);
      if (!options) continue;
      const raw = String(options[1] || '').replace(/\s+#.*$/, '').trim();
      if (raw === '' || raw.startsWith('|') || raw.startsWith('>')) {
        invalidate(currentId, `policy ${currentId} options must be a single-line JSON object`);
        i = consumeDeeper(indent, i + 1) - 1;
        continue;
      }
      const jsonText = extractJsonObject(raw);
      if (!jsonText) {
        invalidate(currentId, `policy ${currentId} options JSON is malformed or multiline`);
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        invalidate(currentId, `policy ${currentId} options JSON is malformed`);
        continue;
      }
      const validated = validatePolicyOptions(currentId, parsed);
      if (!validated.ok) {
        entryFor(currentId).options = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        invalidate(currentId, validated.message);
        continue;
      }
      entryFor(currentId).options = validated.options;
    }
  }

  const invalidIds = new Set(findings.map((finding) => finding.policyId).filter(Boolean));
  for (const id of invalidIds) {
    if (config.policies[id]) config.policies[id].enabled = false;
  }
  return { ...config, findings };
}

export function ownedHookEvents(client) {
  const spec = CLIENT_SPECS[client];
  return spec ? [...spec.events] : [];
}
