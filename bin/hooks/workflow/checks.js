import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { readHooksConfig } from '../adapters/shared.js';
import { resolvePolicyOptions } from '../install.js';
import { withLease } from './jobs.js';
import { recordOutcome } from './outcomes.js';

const execFileAsync = promisify(execFile);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function globMatch(glob, value) {
  const parts = [];
  let index = 0;
  while (index < glob.length) {
    if (glob.startsWith('**/', index)) {
      parts.push('(?:.*/)?');
      index += 3;
      continue;
    }
    if (glob.startsWith('**', index)) {
      parts.push('.*');
      index += 2;
      continue;
    }
    if (glob[index] === '*') {
      parts.push('[^/]*');
      index += 1;
      continue;
    }
    parts.push(glob[index].replace(/[|\\{}()[\]^$+?.]/g, '\\$&'));
    index += 1;
  }
  return new RegExp(`^${parts.join('')}$`).test(value);
}

function covers(roots, candidate) {
  return roots.some((root) => candidate === root || candidate.startsWith(`${root.replace(/\/$/, '')}/`));
}

function safeRelative(projectDir, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) return null;
  const absolute = resolve(projectDir, rel);
  const back = relative(projectDir, absolute);
  if (back.startsWith('..') || back === '') return null;
  return back.split('\\').join('/');
}

export function loadChecksConfig(projectDir) {
  const config = readHooksConfig(projectDir);
  const entry = config.hooks?.policies?.checks ?? { enabled: false, mode: 'observe', options: {} };
  const resolved = resolvePolicyOptions('checks', entry.options ?? {});
  return { config, entry, resolved };
}

async function fileDigest(abs) {
  try {
    return digest(await readFile(abs));
  } catch {
    return null;
  }
}

async function publish(projectDir, ids, binding, outcome) {
  return recordOutcome({
    projectDir,
    ids,
    outcome: {
      policy: 'checks',
      changeId: binding?.changeId ?? null,
      sessionId: binding?.sessionId ?? null,
      agentId: binding?.agentId ?? null,
      taskId: binding?.taskId ?? null,
      ...outcome,
    },
  });
}

function eligibleCommands(options, paths, commandId, allowedFiles) {
  return options.commands.filter((command) => {
    if (commandId && command.id !== commandId) return false;
    return paths.some((path) => covers(allowedFiles, path) && command.globs.some((glob) => globMatch(glob, path)));
  });
}

async function runProcess(command, cwd, timeoutMs, signal) {
  try {
    const result = await execFileAsync(command.executable, command.args, {
      cwd,
      timeout: timeoutMs,
      signal,
      windowsHide: true,
    });
    return { status: 'completed', exitCode: result.code ?? 0, signal: null };
  } catch (error) {
    if (error?.killed && error.signal === 'SIGTERM' && !Number.isInteger(error.code)) {
      return { status: 'timeout', exitCode: null, signal: error.signal };
    }
    if (error?.signal) return { status: 'failed', exitCode: Number.isInteger(error.code) ? error.code : null, signal: error.signal, reason: 'crash' };
    return { status: 'failed', exitCode: Number.isInteger(error.code) ? error.code : 1, signal: error.signal ?? null, reason: `exit-${error.code ?? 1}` };
  }
}

async function importPatch({ projectDir, files, copyDir, before, beforeImport }) {
  if (beforeImport) await beforeImport();
  const drifted = [];
  for (const rel of files) {
    if ((await fileDigest(join(projectDir, rel))) !== before.get(rel)) drifted.push(rel);
  }
  if (drifted.length > 0) return { imported: [], discarded: drifted, reason: 'concurrent-change' };
  const imported = [];
  for (const rel of files) {
    let next;
    try {
      next = await readFile(join(copyDir, rel));
    } catch {
      continue;
    }
    if (digest(next) === before.get(rel)) continue;
    const abs = join(projectDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, next);
    imported.push(rel);
  }
  return { imported, discarded: [], reason: null };
}

export async function runScopedChecks({
  projectDir,
  ids,
  ownerToken = null,
  binding = null,
  paths = [],
  commandId = null,
  originJobIds = [],
  beforeImport = null,
  timeoutMs = null,
} = {}) {
  if (!binding?.sessionId || !binding?.changeId || !binding?.taskId || !Array.isArray(binding.files)) {
    return { ok: false, reason: 'missing-binding', results: [] };
  }
  const loaded = loadChecksConfig(projectDir);
  if (!loaded.resolved.ok) {
    await publish(projectDir, ids, binding, { status: 'failed', reason: 'config-invalid', source: { eventId: null, jobId: null } });
    return { ok: false, reason: 'config-invalid', results: [] };
  }
  const options = loaded.resolved.options;
  const limit = timeoutMs ?? options.timeoutMs;
  const safePaths = paths.map((path) => safeRelative(projectDir, path)).filter(Boolean);
  const allowedFiles = binding.files.map((path) => safeRelative(projectDir, path)).filter(Boolean);
  if (originJobIds.length > 0) {
    const outcome = await publish(projectDir, ids, binding, {
      status: 'suppressed',
      reason: 'own-origin',
      source: { eventId: null, jobId: originJobIds[0] },
      evidence: { scope: { mode: 'suppressed', files: safePaths } },
    });
    return { ok: true, suppressed: true, debounceMs: options.debounceMs, timeoutMs: limit, results: [], outcome };
  }
  if (commandId && !options.commands.some((command) => command.id === commandId)) {
    const outcome = await publish(projectDir, ids, binding, { status: 'skipped', reason: 'not-configured' });
    return { ok: true, debounceMs: options.debounceMs, timeoutMs: limit, results: [], outcome };
  }
  const commands = eligibleCommands(options, safePaths, commandId, allowedFiles);
  const outside = safePaths.filter((path) => !covers(allowedFiles, path));
  const results = [];
  await withLease({ projectDir, ids, ownerToken, timeoutMs: limit }, async ({ signal }) => {
    if (signal?.aborted) return;
    for (const command of commands) {
      const targets = allowedFiles.filter((file) => command.globs.some((glob) => globMatch(glob, file))
        && (command.writablePaths.length === 0 || command.writablePaths.some((root) => covers([root], file))));
      const mutating = command.writablePaths.length > 0;
      if (!mutating) {
        const ran = await runProcess(command, projectDir, limit, signal);
        results.push({ commandId: command.id, ...ran });
        await publish(projectDir, ids, binding, {
          status: ran.status === 'completed' && ran.exitCode === 0 ? 'completed' : ran.status,
          reason: ran.reason ?? (ran.status === 'timeout' ? 'timeout' : `exit-${ran.exitCode}`),
          duration: null,
          evidence: { scope: { mode: 'readonly', files: targets } },
        });
        continue;
      }
      const copyDir = await mkdtemp(join(tmpdir(), 'aok-check-'));
      const before = new Map();
      try {
        for (const rel of targets) {
          before.set(rel, await fileDigest(join(projectDir, rel)));
          if (before.get(rel) == null) continue;
          const destination = join(copyDir, rel);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, await readFile(join(projectDir, rel)));
        }
        const ran = await runProcess(command, copyDir, limit, signal);
        if (signal?.aborted) {
          results.push({ commandId: command.id, status: 'failed', reason: 'lease-lost' });
          await publish(projectDir, ids, binding, { status: 'failed', reason: 'lease-lost' });
          continue;
        }
        const patch = ran.status === 'completed' && ran.exitCode === 0
          ? await importPatch({ projectDir, files: targets, copyDir, before, beforeImport })
          : { imported: [], discarded: [], reason: ran.reason ?? ran.status };
        if (patch.reason === 'concurrent-change') {
          results.push({ commandId: command.id, status: 'failed', reason: 'concurrent-change', imported: [] });
          await publish(projectDir, ids, binding, { status: 'failed', reason: 'concurrent-change', evidence: { scope: { mode: 'formatter', files: patch.discarded } } });
          continue;
        }
        results.push({ commandId: command.id, ...ran, imported: patch.imported });
        await publish(projectDir, ids, binding, {
          status: ran.status === 'completed' && ran.exitCode === 0 ? 'completed' : ran.status,
          reason: ran.reason ?? (ran.status === 'timeout' ? 'timeout' : `exit-${ran.exitCode}`),
          evidence: { scope: { mode: 'formatter', files: patch.imported } },
        });
      } finally {
        await rm(copyDir, { recursive: true, force: true });
      }
    }
  });
  return { ok: true, debounceMs: options.debounceMs, timeoutMs: limit, outside, results };
}
