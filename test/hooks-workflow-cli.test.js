import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { scopeIds } from '../bin/hooks/adapters/shared.js';
import { createStore } from '../bin/hooks/store.js';
import { drainOutcomes, noticeRecord, notifyOutcome } from '../bin/hooks/workflow/notifications.js';
import { recordOutcome } from '../bin/hooks/workflow/outcomes.js';

const execFileAsync = promisify(execFile);
const CLI = join(process.cwd(), 'bin', 'agent-orchestrator.js');
const SCRIPT = join(process.cwd(), 'templates', 'scripts', 'sync-local-agent-skills.sh');

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30000,
  });
}

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
}

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-cli-'));
  await git(dir, ['init', '--quiet']);
  await mkdir(join(dir, '.agents', 'rules'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'demo-change'), { recursive: true });
  await writeFile(join(dir, 'probe.cjs'), 'process.exit(0);\n');
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), 'hooks:\n  enabled: true\n  mode: enforce\n  policies:\n    verification:\n      enabled: true\n      mode: observe\n      options: {}\n    completion:\n      enabled: true\n      mode: enforce\n      options: {}\nverifier:\n  test_command: node probe.cjs\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [ ] 4.2 Expose CLI\n  Files: probe.cjs\n');
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'handoff.md'), 'same prose\n');
  await writeFile(join(dir, '.agents', 'rules', 'demo.mdc'), 'rule\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init', '--quiet']);
  return dir;
}

test('update and sync flags avoid the shell hint and honor ownership', async () => {
  const dir = await project();
  try {
    const plain = run(dir, ['update']);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(`${plain.stdout}\n${plain.stderr}`, /Run \.\/scripts\/sync-local-agent-skills\.sh to sync to local IDE/);
    const synced = run(dir, ['update', '--sync', '--target', 'all']);
    assert.equal(synced.status, 0, synced.stderr);
    assert.doesNotMatch(`${synced.stdout}\n${synced.stderr}`, /Run \.\/scripts\/sync-local-agent-skills\.sh to sync to local IDE/);
    const owned = run(dir, ['sync', '--owned', '--target', 'cursor']);
    assert.equal(owned.status, 0, owned.stderr);
    assert.equal(existsSync(join(dir, '.cursor', 'rules', 'demo.mdc')), true);
    await writeFile(join(dir, '.cursor', 'rules', 'demo.mdc'), 'local edit\n');
    const conflict = run(dir, ['sync', '--owned', '--target', 'cursor']);
    assert.notEqual(conflict.status, 0);
    assert.match(`${conflict.stdout}\n${conflict.stderr}`, /owned conflict/);
    assert.equal(await readFile(join(dir, '.cursor', 'rules', 'demo.mdc'), 'utf8'), 'local edit\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('hooks verify and complete follow the binding and print Claude findings', async () => {
  const dir = await project();
  try {
    const missing = run(dir, ['hooks', 'complete', '--change', 'demo-change', '--session', 'sess']);
    assert.notEqual(missing.status, 0);
    assert.match(`${missing.stdout}\n${missing.stderr}`, /binding/);
    const bound = run(dir, ['hooks', 'bind', '--change', 'demo-change', '--role', 'implementer', '--task', '4.2', '--session', 'sess']);
    assert.equal(bound.status, 0, bound.stderr);
    const wrong = run(dir, ['hooks', 'complete', '--change', 'demo-change', '--session', 'sess', '--task', '9.9']);
    assert.notEqual(wrong.status, 0);
    const confirmed = run(dir, ['hooks', 'complete', '--change', 'demo-change', '--session', 'sess', '--confirm-handoff']);
    const text = `${confirmed.stdout}\n${confirmed.stderr}`;
    assert.match(text, /handoff receipt cf-/);
    assert.match(text, /Claude parent Stop cannot request a follow-up/);
    const verified = run(dir, ['hooks', 'verify', '--change', 'demo-change', '--session', 'sess']);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /verification/);
    assert.doesNotMatch(`${verified.stdout}\n${verified.stderr}`, /probe\.cjs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the shell owned entry uses the local CLI and notices stay sanitized', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aok-shell-'));
  try {
    await mkdir(join(dir, 'scripts'), { recursive: true });
    await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(dir, 'bin'), { recursive: true });
    await mkdir(join(dir, '.agents', 'skills'), { recursive: true });
    await mkdir(join(dir, '.agents', 'rules'), { recursive: true });
    await writeFile(join(dir, '.gitignore'), '');
    const script = await readFile(SCRIPT, 'utf8');
    await writeFile(join(dir, 'scripts', 'sync-local-agent-skills.sh'), script);
    await chmod(join(dir, 'scripts', 'sync-local-agent-skills.sh'), 0o755);
    const fake = join(dir, 'node_modules', '.bin', 'agent-orchestrator-kit');
    await writeFile(fake, '#!/bin/sh\nprintf "%s\\n" "$@" > "$PWD/called.txt"\n');
    await chmod(fake, 0o755);
    const npmDir = join(dir, 'fake-bin');
    await mkdir(npmDir, { recursive: true });
    await writeFile(join(npmDir, 'npm'), '#!/bin/sh\ntouch "$PWD/npm-called"\nexit 1\n');
    await writeFile(join(npmDir, 'npx'), '#!/bin/sh\ntouch "$PWD/npm-called"\nexit 1\n');
    await chmod(join(npmDir, 'npm'), 0o755);
    await chmod(join(npmDir, 'npx'), 0o755);
    const owned = spawnSync('sh', [join(dir, 'scripts', 'sync-local-agent-skills.sh'), '--owned'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${npmDir}:${process.env.PATH}` },
    });
    assert.equal(owned.status, 0, owned.stderr);
    assert.equal(await readFile(join(dir, 'called.txt'), 'utf8'), 'sync\n--owned\n');
    assert.equal(existsSync(join(dir, 'npm-called')), false);
    await rm(join(dir, 'called.txt'));
    const legacy = spawnSync('sh', [join(dir, 'scripts', 'sync-local-agent-skills.sh')], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${npmDir}:${process.env.PATH}` },
    });
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.equal(existsSync(join(dir, 'called.txt')), false);

    const ids = { repoId: 'repo', worktreeId: 'wt-cli' };
    const noteDir = join(dir, 'notes');
    await mkdir(noteDir, { recursive: true });
    await git(noteDir, ['init', '--quiet']);
    await mkdir(join(noteDir, '.agents'), { recursive: true });
    await writeFile(join(noteDir, '.agents', 'orchestrator.yaml'), 'hooks:\n  enabled: true\n  mode: observe\n  policies:\n    workflow-notifications:\n      enabled: true\n      mode: observe\n      options: {"dedupMs":60000}\n');
    const outcome = await recordOutcome({
      projectDir: noteDir,
      ids,
      outcome: {
        policy: 'owned-sync',
        status: 'conflict',
        reason: 'conflict',
        command: 'npm test --secret',
        changeId: 'demo-change',
        sessionId: 'sess',
        evidence: { digest: 'abc', freshness: 'stale', scope: { mode: 'narrowed', files: ['src/a.js'] } },
        source: { eventId: 'evt-1' },
      },
    });
    const record = noticeRecord({ ...outcome, command: 'npm test', freshness: 'stale', scope: { mode: 'narrowed' } });
    assert.equal(record.code, 'owned-sync.conflict');
    assert.equal(record.command, undefined);
    assert.equal(record.freshness, undefined);
    assert.equal(record.scope, undefined);
    assert.match(record.message, /conflict/);
    const first = await notifyOutcome({ projectDir: noteDir, ids, outcome });
    const second = await notifyOutcome({ projectDir: noteDir, ids, outcome });
    assert.equal(first.delivered, true);
    assert.equal(second.coalesced, true);
    const runtime = createStore({
      projectDir: noteDir,
      scope: { level: 'worktree', ...ids, changeId: null, sessionId: null, agentId: null, eventId: 'cli' },
      pruneIntervalMs: 10 ** 9,
    });
    const stored = await runtime.log('diagnostics');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].code, 'owned-sync.conflict');
    await writeFile(join(noteDir, '.agents', 'orchestrator.yaml'), 'hooks:\n  enabled: false\n  mode: observe\n  policies: {}\n');
    const again = await recordOutcome({
      projectDir: noteDir,
      ids,
      outcome: { policy: 'completion', status: 'blocked', reason: 'blocked', changeId: 'demo-change', sessionId: 'other' },
    });
    const drained = await drainOutcomes({ projectDir: noteDir, ids });
    assert.equal(drained.delivered, 0);
    assert.ok(drained.retained >= 1);
    assert.ok(again.outcomeId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
