import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import { AMP_SUBAGENT_SKILL_PREFIX, buildAmpSubagentSkillContent, parseAmpSubagentSource } from '../../agent-orchestrator.js';
import { MIRROR_TARGET, renderInstructionMirrors } from '../../instruction-mirrors.js';
import { worktreeStore } from '../binding.js';
import { withLease } from './jobs.js';
import { recordOutcome } from './outcomes.js';

const TARGETS = new Set(['all', 'cursor', 'claude', 'amp']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function posix(value) {
  return value.split(sep).join('/');
}

function selected(target) {
  if (target !== 'all' && !TARGETS.has(target)) return new Set(['cursor', 'claude', 'amp']);
  if (target === 'all') return new Set(['cursor', 'claude', 'amp']);
  return new Set([target]);
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function walk(dir, prefix = '') {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else out.push(posix(rel));
  }
  return out;
}

function resolveInside(projectDir, rel) {
  if (typeof rel !== 'string' || rel === '' || isAbsolute(rel)) return null;
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  let root;
  try {
    root = realpathSync(projectDir);
  } catch {
    return null;
  }
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    const next = join(current, parts[index]);
    try {
      if (lstatSync(next).isSymbolicLink()) {
        const target = realpathSync(next);
        const back = relative(root, target);
        if (!back || back.startsWith('..') || isAbsolute(back)) return null;
        current = target;
        continue;
      }
    } catch {
      return join(current, ...parts.slice(index));
    }
    current = next;
  }
  const back = relative(root, current);
  if (!back || back.startsWith('..') || isAbsolute(back)) return null;
  return current;
}

function readBytes(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

async function stageDesired(projectDir, active) {
  const staging = await mkdtemp(join(tmpdir(), 'aok-owned-'));
  const desired = new Map();
  const put = async (rel, bytes, source) => {
    const abs = join(staging, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    desired.set(rel, { bytes, source });
  };
  const mirrors = renderInstructionMirrors(projectDir);
  if (mirrors.text != null) await put(MIRROR_TARGET, Buffer.from(mirrors.text, 'utf8'), MIRROR_TARGET);
  if (active.has('amp')) {
    const subagents = join(projectDir, '.agents', 'subagents');
    if (exists(subagents)) {
      for (const file of readdirSync(subagents).filter((entry) => entry.endsWith('.md'))) {
        const parsed = parseAmpSubagentSource(readFileSync(join(subagents, file), 'utf8'));
        if (!parsed) continue;
        const rel = `.agents/skills/${AMP_SUBAGENT_SKILL_PREFIX}${parsed.name}/SKILL.md`;
        await put(rel, Buffer.from(buildAmpSubagentSkillContent(file, parsed.parsed), 'utf8'), `.agents/subagents/${file}`);
      }
    }
  }
  if (active.has('cursor') || active.has('claude')) {
    for (const rel of walk(join(projectDir, '.agents', 'skills'))) {
      if (rel.split('/')[0].startsWith(AMP_SUBAGENT_SKILL_PREFIX)) continue;
      const staged = rel === 'agent-orchestration/SKILL.md' ? desired.get(MIRROR_TARGET) : null;
      const bytes = staged?.bytes ?? readBytes(join(projectDir, '.agents', 'skills', rel));
      if (!bytes) continue;
      const source = `.agents/skills/${rel}`;
      if (active.has('cursor')) await put(`.cursor/skills/${rel}`, bytes, source);
      if (active.has('claude')) await put(`.claude/skills/${rel}`, bytes, source);
    }
    const copyTree = async (sourceRoot, destPrefix) => {
      for (const rel of walk(join(projectDir, sourceRoot))) {
        const bytes = readBytes(join(projectDir, sourceRoot, rel));
        if (!bytes) continue;
        await put(`${destPrefix}/${rel}`, bytes, `${sourceRoot}/${rel}`);
      }
    };
    if (active.has('cursor')) {
      await copyTree('.agents/rules', '.cursor/rules');
      await copyTree('.agents/subagents', '.cursor/agents');
    }
    if (active.has('claude')) await copyTree('.agents/subagents', '.claude/agents');
    const commands = join(projectDir, '.agents', 'commands');
    if (exists(commands)) {
      for (const file of readdirSync(commands).filter((entry) => entry.endsWith('.md') && statSync(join(commands, entry)).isFile())) {
        const bytes = readBytes(join(commands, file));
        if (!bytes) continue;
        if (active.has('cursor')) await put(`.cursor/commands/${file}`, bytes, `.agents/commands/${file}`);
        if (active.has('claude')) {
          const match = file.match(/^([a-z0-9]+)-(.+\.md)$/i);
          const rel = match ? `${match[1]}/${match[2]}` : file;
          await put(`.claude/commands/${rel}`, bytes, `.agents/commands/${file}`);
        }
      }
    }
    if (active.has('claude') && exists(join(projectDir, 'CLAUDE.md'))) {
      const bytes = readBytes(join(projectDir, 'CLAUDE.md'));
      if (bytes) await put('.claude/CLAUDE.md', bytes, 'CLAUDE.md');
    }
  }
  return { staging, desired };
}

function entryFor(entries, destination) {
  return entries.find((entry) => entry.destination === destination) ?? null;
}

function classify(projectDir, destination, bytes, prior) {
  const abs = resolveInside(projectDir, destination);
  const digest = sha256(bytes);
  if (!abs) return { action: 'escape', digest };
  const current = readBytes(abs);
  const currentDigest = current ? sha256(current) : null;
  if (!prior) {
    if (currentDigest == null) return { action: 'create', digest, abs };
    if (currentDigest === digest) return { action: 'adopt', digest, abs };
    return { action: 'conflict', digest, abs };
  }
  if (currentDigest === digest) return { action: 'unchanged', digest, abs };
  if (currentDigest == null || currentDigest === prior.deliveredDigest) return { action: 'update', digest, abs };
  return { action: 'conflict', digest, abs };
}

async function atomicWrite(abs, bytes) {
  await mkdir(dirname(abs), { recursive: true });
  const temp = `${abs}.aok-tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(temp, bytes);
  await rename(temp, abs);
}

function wrapperHasExtras(projectDir, destination) {
  if (!destination.startsWith('.agents/skills/subagent-')) return false;
  const dirRel = posix(dirname(destination));
  const abs = resolveInside(projectDir, dirRel);
  if (!abs || !exists(abs)) return false;
  return walk(abs).some((rel) => posix(`${dirRel}/${rel}`) !== destination);
}

function remember(manifest, item) {
  return {
    entries: [
      ...manifest.entries.filter((entry) => entry.destination !== item.destination),
      { source: item.source, destination: item.destination, deliveredDigest: item.digest },
    ],
  };
}

export async function ownedSync({ projectDir, ids, target = 'all', log = null, ownerToken = null } = {}) {
  const emit = log ?? { info() {}, ok() {}, warn() {}, err() {} };
  return withLease({ projectDir, ids, ownerToken }, async () => {
    const store = worktreeStore(projectDir, ids);
    const active = selected(target);
    const result = { changed: [], adopted: [], deleted: [], conflicts: [] };
    let manifest = (await store.read('owned-sync', 'manifest')) ?? { entries: [] };
    const journal = (await store.read('owned-sync', 'journal')) ?? { pending: [] };
    for (const pending of journal.pending ?? []) {
      const bytes = Buffer.from(String(pending.content ?? ''), 'utf8');
      if (sha256(bytes) !== pending.digest || !resolveInside(projectDir, pending.destination)) {
        result.conflicts.push(pending.destination);
        continue;
      }
      const abs = resolveInside(projectDir, pending.destination);
      const current = readBytes(abs);
      if (!current || sha256(current) !== pending.digest) await atomicWrite(abs, bytes);
      manifest = remember(manifest, { source: pending.source, destination: pending.destination, digest: pending.digest });
      if (!result.changed.includes(pending.destination)) result.changed.push(pending.destination);
    }
    if ((journal.pending ?? []).length > 0) {
      await store.transact('owned-sync', 'manifest', () => manifest);
      await store.transact('owned-sync', 'journal', () => ({ pending: [] }));
    }
    const { staging, desired } = await stageDesired(projectDir, active);
    try {
      const planned = [...desired.entries()].map(([destination, item]) => ({ destination, ...item }));
      await store.transact('owned-sync', 'journal', () => ({
        pending: planned.map((item) => ({
          source: item.source,
          destination: item.destination,
          digest: sha256(item.bytes),
          content: item.bytes.toString('utf8'),
        })),
      }));
      for (const item of planned) {
        const prior = entryFor(manifest.entries, item.destination);
        const outcome = classify(projectDir, item.destination, item.bytes, prior);
        if (outcome.action === 'escape' || outcome.action === 'conflict') {
          result.conflicts.push(item.destination);
          emit.warn(`preserved ${item.destination}`);
          continue;
        }
        if (outcome.action === 'unchanged') continue;
        if (outcome.action === 'adopt') result.adopted.push(item.destination);
        else {
          await atomicWrite(outcome.abs, item.bytes);
          result.changed.push(item.destination);
          emit.ok(item.destination);
        }
        manifest = remember(manifest, { source: item.source, destination: item.destination, digest: outcome.digest });
      }
      const plannedSet = new Set(planned.map((item) => item.destination));
      const removable = manifest.entries.filter((entry) => {
        if (plannedSet.has(entry.destination)) return false;
        if (entry.destination.startsWith('.cursor/')) return active.has('cursor');
        if (entry.destination.startsWith('.claude/')) return active.has('claude');
        if (entry.destination.startsWith('.agents/skills/subagent-')) return active.has('amp');
        return false;
      });
      for (const entry of removable) {
        const abs = resolveInside(projectDir, entry.destination);
        const current = abs ? readBytes(abs) : null;
        const unchanged = current && sha256(current) === entry.deliveredDigest;
        if (!unchanged || wrapperHasExtras(projectDir, entry.destination)) {
          result.conflicts.push(entry.destination);
          continue;
        }
        rmSync(abs, { force: true });
        const parent = dirname(abs);
        if (exists(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
        manifest = { entries: manifest.entries.filter((item) => item.destination !== entry.destination) };
        result.deleted.push(entry.destination);
      }
      await store.transact('owned-sync', 'manifest', () => manifest);
      await store.transact('owned-sync', 'journal', () => ({ pending: [] }));
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    await recordOutcome({
      projectDir,
      ids,
      outcome: {
        policy: 'owned-sync',
        status: result.conflicts.length > 0 ? 'conflict' : 'completed',
        reason: result.conflicts.length > 0 ? 'conflict' : 'synced',
        evidence: {
          digest: sha256(JSON.stringify(manifest.entries)),
          freshness: 'current',
          scope: { mode: 'sync', files: [...result.changed, ...result.conflicts].slice(0, 32) },
        },
      },
    });
    return result;
  });
}
