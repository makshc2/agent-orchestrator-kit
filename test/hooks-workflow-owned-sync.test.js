import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { scopeIds } from '../bin/hooks/adapters/shared.js';
import { worktreeStore } from '../bin/hooks/binding.js';
import { acquireLease, releaseLease, withLease } from '../bin/hooks/workflow/jobs.js';
import { ownedSync } from '../bin/hooks/workflow/owned-sync.js';

const execFileAsync = promisify(execFile);
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-owned-'));
  await execFileAsync('git', ['init', '--quiet', dir], { env: GIT_ENV });
  await mkdir(join(dir, '.agents', 'skills', 'demo'), { recursive: true });
  await mkdir(join(dir, '.agents', 'rules'), { recursive: true });
  await mkdir(join(dir, '.agents', 'commands'), { recursive: true });
  await mkdir(join(dir, '.agents', 'subagents'), { recursive: true });
  await writeFile(join(dir, '.agents', 'skills', 'demo', 'SKILL.md'), 'skill\n');
  await writeFile(join(dir, '.agents', 'rules', 'local.mdc'), 'rule\n');
  await writeFile(join(dir, '.agents', 'commands', 'opsx-apply.md'), 'command\n');
  return { dir, ids: scopeIds(dir) };
}

test('owned sync adopts identical files, preserves unknown and modified files, and deletes stale owned copies', async () => {
  const { dir, ids } = await makeProject();
  try {
    await mkdir(join(dir, '.cursor', 'skills', 'demo'), { recursive: true });
    await writeFile(join(dir, '.cursor', 'skills', 'demo', 'SKILL.md'), 'skill\n');
    await mkdir(join(dir, '.cursor', 'rules'), { recursive: true });
    await writeFile(join(dir, '.cursor', 'rules', 'custom.mdc'), 'keep me\n');
    const first = await ownedSync({ projectDir: dir, ids });
    assert.ok(first.adopted.includes('.cursor/skills/demo/SKILL.md'));
    assert.equal(await readFile(join(dir, '.cursor', 'commands', 'opsx-apply.md'), 'utf8'), 'command\n');
    assert.equal(await readFile(join(dir, '.claude', 'commands', 'opsx', 'apply.md'), 'utf8'), 'command\n');
    assert.equal(await readFile(join(dir, '.cursor', 'rules', 'custom.mdc'), 'utf8'), 'keep me\n');
    const manifest = await worktreeStore(dir, ids).read('owned-sync', 'manifest');
    assert.ok(manifest.entries.some((entry) => entry.destination === '.cursor/rules/local.mdc' && entry.deliveredDigest === digest('rule\n')));

    await writeFile(join(dir, '.cursor', 'rules', 'local.mdc'), 'user edit\n');
    const modified = await ownedSync({ projectDir: dir, ids });
    assert.ok(modified.conflicts.includes('.cursor/rules/local.mdc'));
    assert.equal(await readFile(join(dir, '.cursor', 'rules', 'local.mdc'), 'utf8'), 'user edit\n');

    await rm(join(dir, '.agents', 'commands', 'opsx-apply.md'));
    const removed = await ownedSync({ projectDir: dir, ids });
    assert.ok(removed.deleted.includes('.cursor/commands/opsx-apply.md'));
    assert.ok(removed.deleted.includes('.claude/commands/opsx/apply.md'));
    assert.equal(existsSync(join(dir, '.cursor', 'commands', 'opsx-apply.md')), false);
    assert.equal(await readFile(join(dir, '.cursor', 'rules', 'custom.mdc'), 'utf8'), 'keep me\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a modified Amp wrapper survives regeneration and stale-directory cleanup', async () => {
  const { dir, ids } = await makeProject();
  try {
    const source = join(dir, '.agents', 'subagents', 'code-writer.md');
    await writeFile(source, '---\nname: code-writer\ndescription: writes code\n---\n\nBody\n');
    const wrapper = join(dir, '.agents', 'skills', 'subagent-code-writer', 'SKILL.md');
    await ownedSync({ projectDir: dir, ids });
    assert.equal(existsSync(wrapper), true);
    assert.equal(existsSync(join(dir, '.cursor', 'skills', 'subagent-code-writer', 'SKILL.md')), false);
    const generated = await readFile(wrapper, 'utf8');
    await writeFile(wrapper, `${generated}\nlocal note\n`);
    const again = await ownedSync({ projectDir: dir, ids });
    assert.ok(again.conflicts.includes('.agents/skills/subagent-code-writer/SKILL.md'));
    assert.match(await readFile(wrapper, 'utf8'), /local note/);
    await rm(source);
    const stale = await ownedSync({ projectDir: dir, ids });
    assert.ok(stale.conflicts.includes('.agents/skills/subagent-code-writer/SKILL.md'));
    assert.equal(existsSync(wrapper), true);

    await writeFile(source, '---\nname: fresh-writer\ndescription: fresh\n---\n\nFresh\n');
    await ownedSync({ projectDir: dir, ids });
    const fresh = join(dir, '.agents', 'skills', 'subagent-fresh-writer', 'SKILL.md');
    assert.equal(existsSync(fresh), true);
    await rm(source);
    const cleaned = await ownedSync({ projectDir: dir, ids });
    assert.ok(cleaned.deleted.includes('.agents/skills/subagent-fresh-writer/SKILL.md'));
    assert.equal(existsSync(fresh), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrent sync waits on the worktree lease and a worker token is reused', async () => {
  const { dir, ids } = await makeProject();
  try {
    let release;
    const held = withLease({ projectDir: dir, ids }, () => new Promise((resolve) => { release = resolve; }));
    const ready = Date.now() + 5000;
    while (typeof release !== 'function') {
      if (Date.now() > ready) throw new Error('lease holder did not start');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const syncing = ownedSync({ projectDir: dir, ids });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(existsSync(join(dir, '.cursor', 'rules', 'local.mdc')), false);
    release();
    await held;
    await syncing;
    assert.equal(await readFile(join(dir, '.cursor', 'rules', 'local.mdc'), 'utf8'), 'rule\n');

    const acquired = await acquireLease({ projectDir: dir, ids });
    const before = await worktreeStore(dir, ids).read('jobs', 'lease');
    await writeFile(join(dir, '.agents', 'rules', 'local.mdc'), 'rule changed\n');
    await ownedSync({ projectDir: dir, ids, ownerToken: acquired.ownerToken });
    const after = await worktreeStore(dir, ids).read('jobs', 'lease');
    assert.equal(after.owner, before.owner);
    assert.equal(after.expiresAt, before.expiresAt);
    assert.equal(await readFile(join(dir, '.cursor', 'rules', 'local.mdc'), 'utf8'), 'rule changed\n');
    await releaseLease({ projectDir: dir, ids, ownerToken: acquired.ownerToken });
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== 'ENOTEMPTY' || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  }
});

test('an interrupted journal write is recovered and profile IDE config stays untouched', async () => {
  const { dir, ids } = await makeProject();
  try {
    const content = 'recovered\n';
    await worktreeStore(dir, ids).transact('owned-sync', 'journal', () => ({
      pending: [{
        source: '.agents/rules/recovered.mdc',
        destination: '.cursor/rules/recovered.mdc',
        digest: digest(content),
        content,
      }],
    }));
    await writeFile(join(dir, '.agents', 'rules', 'recovered.mdc'), content);
    await mkdir(join(dir, '.cursor', 'rules'), { recursive: true });
    await writeFile(join(dir, '.cursor', 'rules', 'recovered.mdc'), 'partial');
    const recovered = await ownedSync({ projectDir: dir, ids });
    assert.equal(await readFile(join(dir, '.cursor', 'rules', 'recovered.mdc'), 'utf8'), content);
    assert.ok(recovered.changed.includes('.cursor/rules/recovered.mdc'));
    const journal = await worktreeStore(dir, ids).read('owned-sync', 'journal');
    assert.deepEqual(journal.pending, []);
    const manifest = await worktreeStore(dir, ids).read('owned-sync', 'manifest');
    assert.ok(manifest.entries.some((entry) => entry.destination === '.cursor/rules/recovered.mdc'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  for (const profile of ['generic', 'mvp', 'node', 'vue3']) {
    const dir = await mkdtemp(join(tmpdir(), 'aok-owned-'));
    await execFileAsync('git', ['init', '--quiet', dir], { env: GIT_ENV });
    await mkdir(join(dir, '.agents', 'skills', 'demo'), { recursive: true });
    await mkdir(join(dir, '.cursor'), { recursive: true });
    await mkdir(join(dir, '.amp'), { recursive: true });
    const { copyFile } = await import('node:fs/promises');
    await copyFile(join(process.cwd(), 'profiles', profile, 'orchestrator.yaml'), join(dir, '.agents', 'orchestrator.yaml'));
    await writeFile(join(dir, '.agents', 'skills', 'demo', 'SKILL.md'), `profile ${profile}\n`);
    const hooks = `${JSON.stringify({ version: 1, hooks: { stop: [{ command: 'node scripts/cursor-spend-hook.cjs' }] }, userHooks: { keep: profile } }, null, 2)}\n`;
    const settings = `${JSON.stringify({ mcpServers: { memory: { command: 'node' } }, foreign: profile }, null, 2)}\n`;
    await writeFile(join(dir, '.cursor', 'hooks.json'), hooks);
    await writeFile(join(dir, '.amp', 'settings.json'), settings);
    const ids = scopeIds(dir);
    try {
      await ownedSync({ projectDir: dir, ids });
      assert.equal(await readFile(join(dir, '.cursor', 'hooks.json'), 'utf8'), hooks);
      assert.equal(await readFile(join(dir, '.amp', 'settings.json'), 'utf8'), settings);
      assert.equal(await readFile(join(dir, '.cursor', 'skills', 'demo', 'SKILL.md'), 'utf8'), `profile ${profile}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('a destination symlink that leaves the project is not written', async () => {
  const { dir, ids } = await makeProject();
  const outside = await mkdtemp(join(tmpdir(), 'aok-outside-'));
  try {
    await symlink(outside, join(dir, '.cursor'));
    const result = await ownedSync({ projectDir: dir, ids, target: 'cursor' });
    assert.ok(result.conflicts.some((path) => path.startsWith('.cursor/')));
    assert.equal(existsSync(join(outside, 'rules', 'local.mdc')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
