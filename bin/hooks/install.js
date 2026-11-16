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

export function parseHookConfig(content) {
  const config = hookConfigDefaults();
  let inHooks = false;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (/^hooks:\s*$/.test(line)) {
      inHooks = true;
      continue;
    }
    if (inHooks && /^\S/.test(line)) break;
    if (!inHooks) continue;
    const enabled = line.match(/^\s+enabled:\s*(true|false)\s*$/);
    if (enabled) config.enabled = enabled[1] === 'true';
    const mode = line.match(/^\s+mode:\s*(\w+)\s*$/);
    if (mode) config.mode = mode[1];
    const policies = line.match(/^\s+policies:\s*(\{\}\s*)?$/);
    if (policies) config.policies = {};
  }
  return config;
}

export function ownedHookEvents(client) {
  const spec = CLIENT_SPECS[client];
  return spec ? [...spec.events] : [];
}
