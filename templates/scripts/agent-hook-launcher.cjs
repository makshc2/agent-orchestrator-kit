#!/usr/bin/env node
// Owned by agent-orchestrator-kit (hooks enable --client claude|cursor).
// Thin local launcher: resolves the installed kit package and delegates to the
// packaged adapter. Never installs, never uses network npx, never blocks a
// session — missing runtime is a visible diagnostic plus the manual workflow.

const { createRequire } = require('node:module');
const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const MAX_STDIN_BYTES = 256 * 1024;

function fail(diagnostic) {
  process.stderr.write(`[aok-hooks] ${diagnostic}\n`);
  process.stderr.write('[aok-hooks] manual workflow still applies (hooks are observe-only)\n');
  process.exit(0);
}

function readStdin() {
  return new Promise((resolveStdin, rejectStdin) => {
    let size = 0;
    const chunks = [];
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) {
        rejectStdin(new Error('event payload exceeds 256 KiB'));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => resolveStdin(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', rejectStdin);
  });
}

function resolveKitRoot() {
  if (process.env.AOK_HOOK_RUNTIME) return resolve(process.env.AOK_HOOK_RUNTIME);
  const projectDir = process.cwd();
  const names = ['agent-orchestrator-kit', 'agent-orchestrator'];
  for (let dir = projectDir; ; dir = join(dir, '..')) {
    for (const name of names) {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
  }
  try {
    const requireFromProject = createRequire(join(projectDir, 'package.json'));
    for (const name of names) {
      const packageJson = requireFromProject.resolve(`${name}/package.json`);
      return resolve(packageJson, '..', '..');
    }
  } catch {}
  return null;
}

function detectClient(payload) {
  if (process.env.AOK_HOOK_CLIENT) return process.env.AOK_HOOK_CLIENT;
  if (payload && typeof payload.hook_event_name === 'string') return 'claude';
  if (payload && typeof payload.event === 'string') return 'cursor';
  if (payload && typeof payload.name === 'string') return 'amp';
  return null;
}

async function main() {
  const raw = await readStdin();
  let payload = null;
  try {
    payload = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  const client = detectClient(payload);
  if (!client) fail('could not detect the client from the event payload; set AOK_HOOK_CLIENT');

  const kitRoot = resolveKitRoot();
  if (!kitRoot) fail('packaged runtime not found (install agent-orchestrator-kit locally, or set AOK_HOOK_RUNTIME)');

  const adapterUrl = join(kitRoot, 'bin', 'hooks', 'adapters', `${client}.js`);
  if (!existsSync(adapterUrl)) fail(`packaged adapter missing for client "${client}" at ${adapterUrl}`);

  const adapter = await import(require('node:url').pathToFileURL(adapterUrl).href);
  if (typeof adapter.run !== 'function') fail(`adapter for "${client}" does not export run()`);
  await adapter.run({ projectDir: process.cwd(), payload, stdin: raw });
  process.exit(0);
}

main().catch((error) => fail(`launcher error: ${error && error.message ? error.message : String(error)}`));
