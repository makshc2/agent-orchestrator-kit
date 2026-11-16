import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  HOOK_CLIENTS,
  OWNERSHIP_MANIFEST_REL,
  HOOK_LAUNCHER_REL,
  AMP_PLUGIN_REL,
  enableHooksClient,
  disableHooksClient,
  hooksStatus,
  refreshOwnedHookAssets,
  parseHookConfig,
  resolveHookStateRoot,
  ownedHookEvents,
} from '../bin/hooks/install.js';

const execFileAsync = promisify(execFile);
const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = OWNERSHIP_MANIFEST_REL.split('\\').join('/');
const silent = () => {};
const manifestPath = (dir) => join(dir, ...MANIFEST.split('/'));
const readJson = async (dir, rel) => JSON.parse(await readFile(join(dir, ...String(rel).split('/')), 'utf8'));

async function makeProject({ git = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-hooks-install-'));
  if (git) await execFileAsync('git', ['init', '--quiet', dir]);
  return dir;
}

async function withClaudeForeignSettings(dir) {
  await mkdir(join(dir, '.claude'), { recursive: true });
  const settings = {
    model: 'opus',
    hooks: {
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo foreign-stop' }] }],
      SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: 'echo foreign-resume' }] }],
    },
  };
  await writeFile(join(dir, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

async function withCursorSpendHooks(dir) {
  await mkdir(join(dir, '.cursor'), { recursive: true });
  const hooks = {
    version: 1,
    hooks: {
      stop: [{ command: 'node scripts/cursor-spend-hook.cjs' }],
      sessionEnd: [{ command: 'node scripts/cursor-spend-collect.cjs' }],
    },
  };
  await writeFile(join(dir, '.cursor', 'hooks.json'), `${JSON.stringify(hooks, null, 2)}\n`);
  return hooks;
}

test('all shipped profile configs declare disabled observe hook defaults', async () => {
  const yamlFiles = [
    'templates/orchestrator.yaml',
    'profiles/generic/orchestrator.yaml',
    'profiles/vue3/orchestrator.yaml',
    'profiles/node/orchestrator.yaml',
    'profiles/mvp/orchestrator.yaml',
  ];
  for (const rel of yamlFiles) {
    const config = parseHookConfig(await readFile(join(KIT_ROOT, ...rel.split('/')), 'utf8'));
    assert.deepEqual(config, { enabled: false, mode: 'observe', policies: {} }, rel);
  }
});

test('hooks-disabled projects retain prior behavior and report a distinct status', async () => {
  const dir = await makeProject();
  const status = hooksStatus({ projectDir: dir, kitRoot: KIT_ROOT });
  assert.equal(status.feature, 'agent-hook-runtime');
  assert.equal(status.defaults.enabled, false);
  assert.ok(status.distinctFrom.includes('pre-commit'));
  for (const client of HOOK_CLIENTS) {
    assert.equal(status.clients[client].enabled, false);
    assert.equal(status.clients[client].ownedEntries, 0);
  }
  assert.equal(status.runtime.launcher, false);
  const entries = await readdir(dir);
  assert.deepEqual(entries.sort(), ['.git']);
  await rm(dir, { recursive: true, force: true });
});

test('enable installs owned claude entries while preserving foreign settings', async () => {
  const dir = await makeProject();
  const foreign = await withClaudeForeignSettings(dir);
  const result = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  assert.equal(result.ok, true);
  assert.deepEqual(result.conflicts, []);

  const settings = await readJson(dir, join('.claude', 'settings.json'));
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.hooks.Stop, foreign.hooks.Stop);
  assert.deepEqual(settings.hooks.SessionStart[0], foreign.hooks.SessionStart[0]);
  for (const event of ownedHookEvents('claude')) {
    const owned = settings.hooks[event].filter((entry) => entry.hooks.some((hook) => String(hook.command).includes('agent-hook-launcher.cjs')));
    assert.equal(owned.length, 1, event);
  }
  assert.ok((await readFile(join(dir, HOOK_LAUNCHER_REL), 'utf8')).length > 0);

  const manifest = await readJson(dir, MANIFEST);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.clients.claude.enabled, true);
  assert.equal(manifest.clients.claude.entries.length, ownedHookEvents('claude').length);

  const again = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  await rm(dir, { recursive: true, force: true });
});

test('enable installs owned cursor entries next to existing spend hooks', async () => {
  const dir = await makeProject();
  await withCursorSpendHooks(dir);
  const result = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'cursor', env: {}, probeVersion: false, log: silent });
  assert.equal(result.ok, true);

  const hooks = await readJson(dir, join('.cursor', 'hooks.json'));
  assert.equal(hooks.version, 1);
  assert.deepEqual(hooks.hooks.stop[0], { command: 'node scripts/cursor-spend-hook.cjs' });
  assert.deepEqual(hooks.hooks.sessionEnd[0], { command: 'node scripts/cursor-spend-collect.cjs' });
  for (const event of ownedHookEvents('cursor')) {
    const owned = hooks.hooks[event].filter((entry) => String(entry.command).includes('agent-hook-launcher.cjs'));
    assert.equal(owned.length, 1, event);
  }

  const disable = disableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'cursor', log: silent });
  assert.equal(disable.ok, true);
  const after = await readJson(dir, join('.cursor', 'hooks.json'));
  assert.deepEqual(after.hooks.stop, [{ command: 'node scripts/cursor-spend-hook.cjs' }]);
  assert.deepEqual(after.hooks.sessionEnd, [{ command: 'node scripts/cursor-spend-collect.cjs' }]);
  assert.equal(after.hooks.sessionStart, undefined);
  const manifest = JSON.parse(await readFile(manifestPath(dir), 'utf8').catch(() => 'null'));
  assert.equal(manifest, null);
  await rm(dir, { recursive: true, force: true });
});

test('enable installs the amp plugin and launcher as owned assets', async () => {
  const dir = await makeProject();
  const result = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'amp', env: {}, probeVersion: false, log: silent });
  assert.equal(result.ok, true);
  const plugin = await readFile(join(dir, ...AMP_PLUGIN_REL.split('/')), 'utf8');
  assert.ok(plugin.includes('agent-orchestrator-kit'));
  assert.ok(plugin.includes('session.start'));
  const manifest = await readJson(dir, MANIFEST);
  assert.deepEqual(manifest.clients.amp.entries, []);
  assert.ok(manifest.clients.amp.assets.some((asset) => asset.file === AMP_PLUGIN_REL.split('/').join('/')));

  const disable = disableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'amp', log: silent });
  assert.equal(disable.ok, true);
  const state = hooksStatus({ projectDir: dir, kitRoot: KIT_ROOT });
  assert.equal(state.clients.amp.enabled, false);
  await rm(dir, { recursive: true, force: true });
});

test('malformed client config reports a conflict and leaves bytes unchanged', async () => {
  const dir = await makeProject();
  await mkdir(join(dir, '.claude'), { recursive: true });
  const malformed = '{ "hooks": broken';
  await writeFile(join(dir, '.claude', 'settings.json'), malformed);
  const result = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  assert.equal(result.ok, false);
  assert.ok(result.conflicts[0].includes('malformed JSON'));
  assert.equal(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'), malformed);

  const enabledElsewhere = await makeProject();
  enableHooksClient({ projectDir: enabledElsewhere, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  const corruptPath = join(enabledElsewhere, '.claude', 'settings.json');
  const corruptBytes = '{ "hooks": also-broken';
  await writeFile(corruptPath, corruptBytes);
  const disable = disableHooksClient({ projectDir: enabledElsewhere, kitRoot: KIT_ROOT, client: 'claude', log: silent });
  assert.equal(disable.ok, false);
  assert.ok(disable.conflicts.some((conflict) => conflict.includes('malformed JSON')));
  assert.equal(await readFile(corruptPath, 'utf8'), corruptBytes);
  await rm(dir, { recursive: true, force: true });
  await rm(enabledElsewhere, { recursive: true, force: true });
});

test('modified owned entries conflict and are never rewritten by enable or disable', async () => {
  const dir = await makeProject();
  enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  const settingsPath = join(dir, '.claude', 'settings.json');
  const modified = JSON.parse(await readFile(settingsPath, 'utf8'));
  modified.hooks.SessionStart[modified.hooks.SessionStart.length - 1].hooks[0].command += ' --user-edit';
  await writeFile(settingsPath, `${JSON.stringify(modified, null, 2)}\n`);
  const bytesBefore = await readFile(settingsPath, 'utf8');

  const enable = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  assert.equal(enable.ok, false);
  assert.ok(enable.conflicts.some((conflict) => conflict.includes('SessionStart')));
  assert.equal(await readFile(settingsPath, 'utf8'), bytesBefore);

  const disable = disableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', log: silent });
  assert.equal(disable.ok, false);
  assert.ok(disable.conflicts.some((conflict) => conflict.includes('SessionStart')));
  assert.equal(await readFile(settingsPath, 'utf8'), bytesBefore);
  const manifest = await readJson(dir, MANIFEST);
  assert.equal(manifest.clients.claude.enabled, true);
  await rm(dir, { recursive: true, force: true });
});

test('a clone without a manifest adopts digest-verified committed entries', async () => {
  const dir = await makeProject();
  enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  await rm(manifestPath(dir), { force: true });

  const adopt = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  assert.equal(adopt.ok, true);
  assert.equal(adopt.adopted.length, ownedHookEvents('claude').length);
  const status = hooksStatus({ projectDir: dir, kitRoot: KIT_ROOT });
  assert.equal(status.clients.claude.adopted, true);
  assert.equal(status.clients.claude.enabled, true);
  await rm(dir, { recursive: true, force: true });
});

test('kit-shaped entries that do not match are reported conflicts and stay byte-identical', async () => {
  const dir = await makeProject();
  enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  await rm(manifestPath(dir), { force: true });
  const settingsPath = join(dir, '.claude', 'settings.json');
  const modified = JSON.parse(await readFile(settingsPath, 'utf8'));
  modified.hooks.SessionStart[modified.hooks.SessionStart.length - 1].hooks[0].command = 'node scripts/agent-hook-launcher.cjs --drifted';
  await writeFile(settingsPath, `${JSON.stringify(modified, null, 2)}\n`);
  const bytesBefore = await readFile(settingsPath, 'utf8');

  const result = enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  assert.equal(result.ok, false);
  assert.ok(result.conflicts.some((conflict) => conflict.includes('kit-shaped')));
  assert.equal(await readFile(settingsPath, 'utf8'), bytesBefore);
  await rm(dir, { recursive: true, force: true });
});

test('non-Git projects use the gitignored fallback state root', async () => {
  const dir = await makeProject({ git: false });
  enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  const { root, fallback } = resolveHookStateRoot(dir);
  assert.equal(fallback, true);
  assert.ok(root.includes(join('.agents', '.hook-state', 'v1')));
  const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
  assert.ok(gitignore.split('\n').includes('.agents/.hook-state/'));
  const status = hooksStatus({ projectDir: dir, kitRoot: KIT_ROOT, env: {}, probe: false });
  assert.equal(status.runtime.fallbackStateRoot, true);
  assert.equal(status.clients.claude.version, null);
  await rm(dir, { recursive: true, force: true });
});

test('capability status is local-only: it never lands in the git-tracked manifest', async () => {
  const dir = await makeProject();
  enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'claude', env: {}, probeVersion: false, log: silent });
  const manifestRaw = await readFile(manifestPath(dir), 'utf8');
  assert.ok(!manifestRaw.includes('"version"'));
  assert.ok(!manifestRaw.includes('capabilities'));
  await rm(dir, { recursive: true, force: true });
});

test('update refreshes owned assets only after replacement validates and never enables hooks', async () => {
  const dir = await makeProject();
  enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'amp', env: {}, probeVersion: false, log: silent });

  const fakeKit = await mkdtemp(join(tmpdir(), 'aok-fake-kit-'));
  await mkdir(join(fakeKit, 'templates', 'scripts'), { recursive: true });
  await mkdir(join(fakeKit, 'templates', 'amp'), { recursive: true });
  const nextLauncher = '// refreshed launcher v2\n';
  await writeFile(join(fakeKit, 'templates', 'scripts', 'agent-hook-launcher.cjs'), nextLauncher);
  await cp(join(KIT_ROOT, 'templates', 'amp'), join(fakeKit, 'templates', 'amp'), { recursive: true });

  const refreshed = refreshOwnedHookAssets({ projectDir: dir, kitRoot: fakeKit, log: silent });
  assert.ok(refreshed.refreshed.includes('scripts/agent-hook-launcher.cjs'));
  assert.equal(await readFile(join(dir, HOOK_LAUNCHER_REL), 'utf8'), nextLauncher);
  const manifest = await readJson(dir, MANIFEST);
  assert.equal(manifest.clients.amp.enabled, true);

  const untouched = refreshOwnedHookAssets({ projectDir: dir, kitRoot: fakeKit, log: silent });
  assert.equal(untouched.changed, false);

  const none = await makeProject();
  assert.equal(refreshOwnedHookAssets({ projectDir: none, kitRoot: KIT_ROOT, log: silent }).changed, false);
  await rm(dir, { recursive: true, force: true });
  await rm(fakeKit, { recursive: true, force: true });
  await rm(none, { recursive: true, force: true });
});

test('update refuses to overwrite locally modified owned assets', async () => {
  const dir = await makeProject();
  enableHooksClient({ projectDir: dir, kitRoot: KIT_ROOT, client: 'amp', env: {}, probeVersion: false, log: silent });
  await writeFile(join(dir, HOOK_LAUNCHER_REL), '// local user edit\n');

  const fakeKit = await mkdtemp(join(tmpdir(), 'aok-fake-kit-'));
  await mkdir(join(fakeKit, 'templates', 'scripts'), { recursive: true });
  await mkdir(join(fakeKit, 'templates', 'amp'), { recursive: true });
  await writeFile(join(fakeKit, 'templates', 'scripts', 'agent-hook-launcher.cjs'), '// v3\n');
  await cp(join(KIT_ROOT, 'templates', 'amp'), join(fakeKit, 'templates', 'amp'), { recursive: true });

  const result = refreshOwnedHookAssets({ projectDir: dir, kitRoot: fakeKit, log: silent });
  assert.ok(result.conflicts.some((conflict) => conflict.includes('modified locally')));
  assert.equal(await readFile(join(dir, HOOK_LAUNCHER_REL), 'utf8'), '// local user edit\n');
  await rm(dir, { recursive: true, force: true });
  await rm(fakeKit, { recursive: true, force: true });
});

test('missing runtime produces a visible diagnostic and a zero exit, never an install', async () => {
  const emptyRuntime = await mkdtemp(join(tmpdir(), 'aok-empty-runtime-'));
  const project = await makeProject();
  const launcher = join(KIT_ROOT, 'templates', 'scripts', 'agent-hook-launcher.cjs');
  const run = (env, payload = '') => new Promise((resolveRun, rejectRun) => {
    const child = execFile('node', [launcher], {
      cwd: project,
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024,
      timeout: 15000,
    }, (error, stdout, stderr) => {
      if (error && error.code !== undefined && error.code !== 0) rejectRun(error);
      else resolveRun({ stdout, stderr, exitCode: child.exitCode });
    });
    child.stdin.end(payload);
  });
  const noAdapter = await run({ AOK_HOOK_RUNTIME: emptyRuntime, AOK_HOOK_CLIENT: 'claude' });
  assert.equal(noAdapter.exitCode, 0);
  assert.ok(noAdapter.stderr.includes('[aok-hooks]'));

  const undetectable = await run({ AOK_HOOK_CLIENT: '', AOK_HOOK_RUNTIME: '' });
  assert.equal(undetectable.exitCode, 0);
  assert.ok(undetectable.stderr.includes('[aok-hooks]'));

  const entries = await readdir(project);
  assert.deepEqual(entries.sort(), ['.git']);
  await rm(emptyRuntime, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});
