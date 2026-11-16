import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const PROGRESS_NAMES = new Set(['handoff.md', 'checkpoint.json', 'metrics.json', 'decisions.md']);
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(projectDir, args) {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function normalizeTasks(text) {
  return text.replace(/^(\s*)- \[[xX]\]/gm, '$1- [ ]');
}

function progressPath(changeId, name) {
  return `openspec/changes/${changeId}/${name}`;
}

function excluded(changeId, rel, generated) {
  if (rel.startsWith('.git/') || rel.includes('aok-hooks/') || rel.startsWith('.agents/.hook-state/')) return true;
  if (generated.has(rel)) return true;
  return PROGRESS_NAMES.has(rel.split('/').pop()) && rel === progressPath(changeId, rel.split('/').pop());
}

async function digestFile(projectDir, rel, tasks) {
  const abs = resolve(projectDir, rel);
  let first;
  let second;
  try {
    first = await readFile(abs);
    second = await readFile(abs);
  } catch {
    return { digest: null, unstable: false };
  }
  if (!first.equals(second)) return { digest: null, unstable: true };
  const raw = sha256(first);
  if (tasks && rel === tasks) return { digest: sha256(normalizeTasks(first.toString('utf8'))), raw, unstable: false };
  return { digest: raw, unstable: false };
}

async function listInputs(projectDir, changeId, options) {
  const generated = new Set(options.generatedOutputs ?? []);
  const tracked = new Map();
  const index = git(projectDir, ['ls-files', '-s', '-z']);
  if (index) {
    for (const row of index.split('\0')) {
      if (!row) continue;
      const staged = row.match(/^(\d+) ([0-9a-f]+) \d+\t(.+)$/i);
      if (!staged) continue;
      const rel = staged[3];
      if (excluded(changeId, rel, generated)) continue;
      tracked.set(rel, { path: rel, indexSha: staged[2], kind: 'tracked' });
    }
  }
  const untracked = git(projectDir, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (untracked) {
    for (const rel of untracked.split('\0')) {
      if (!rel || excluded(changeId, rel, generated) || tracked.has(rel)) continue;
      tracked.set(rel, { path: rel, indexSha: null, kind: 'untracked' });
    }
  }
  for (const rel of [...(options.ignoredInputs ?? []), ...LOCKFILES, '.agents/orchestrator.yaml']) {
    if (excluded(changeId, rel, generated) || tracked.has(rel)) continue;
    try {
      await stat(resolve(projectDir, rel));
    } catch {
      continue;
    }
    tracked.set(rel, { path: rel, indexSha: null, kind: rel.endsWith('orchestrator.yaml') || LOCKFILES.includes(rel) ? 'config' : 'ignored-input' });
  }
  return [...tracked.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function fingerprint(projectDir, changeId, options) {
  const tasksRel = progressPath(changeId, 'tasks.md');
  const entries = [];
  let unstable = false;
  for (const item of await listInputs(projectDir, changeId, options)) {
    const hashed = await digestFile(projectDir, item.path, tasksRel);
    if (hashed.unstable) unstable = true;
    entries.push({ ...item, worktreeDigest: hashed.digest });
  }
  const tasksRaw = await digestFile(projectDir, tasksRel, null);
  const handoffRaw = await digestFile(projectDir, progressPath(changeId, 'handoff.md'), null);
  const again = [];
  for (const item of entries) {
    const hashed = await digestFile(projectDir, item.path, tasksRel);
    if (hashed.unstable || hashed.digest !== item.worktreeDigest) unstable = true;
    again.push(hashed.digest);
  }
  if (again.some((digest, index) => digest !== entries[index].worktreeDigest)) unstable = true;
  const environment = (options.environmentNames ?? []).map((name) => ({
    name,
    digest: sha256(String(process.env[name] ?? '')),
  }));
  const body = {
    entries,
    environment,
    tool: { node: process.version, platform: process.platform },
  };
  return {
    unstable,
    digest: sha256(JSON.stringify(body)),
    entries,
    environment,
    tasksDigest: tasksRaw.digest,
    handoffDigest: handoffRaw.digest,
    head: git(projectDir, ['rev-parse', 'HEAD'])?.trim() ?? null,
  };
}
