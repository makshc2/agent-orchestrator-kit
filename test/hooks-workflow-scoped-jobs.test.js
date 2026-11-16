import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { loadChecksConfig, runScopedChecks } from '../bin/hooks/workflow/checks.js';
import { acquireLease, enqueueJob, readQueue, releaseLease, withLease } from '../bin/hooks/workflow/jobs.js';
import { readOutcomes } from '../bin/hooks/workflow/outcomes.js';
import { worktreeStore } from '../bin/hooks/workflow/stores.js';

const execFileAsync = promisify(execFile);

const binding = {
  changeId: 'demo-change',
  sessionId: 'sess-1',
  agentId: null,
  taskId: '1.1',
  files: ['src/a.js'],
};

function command(id, args, extra = {}) {
  return {
    id,
    executable: 'node',
    args,
    globs: ['src/*.js'],
    writablePaths: extra.writablePaths ?? [],
  };
}

async function makeProject(yaml) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-scoped-'));
  await execFileAsync('git', ['init', '--quiet', dir]);
  await mkdir(join(dir, '.agents'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.js'), 'original\n');
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), yaml);
  return dir;
}

function yamlFor(commands, { timeoutMs = 30000, debounceMs = 500, testCommand = "node -e \"require('node:fs').writeFileSync('suite-ran.txt','1')\"" } = {}) {
  const options = JSON.stringify({ commands, debounceMs, timeoutMs });
  return `hooks:\n  enabled: true\n  mode: enforce\n  policies:\n    checks:\n      enabled: true\n      mode: enforce\n      options: ${options}\nverifier:\n  test_command: "${testCommand.replaceAll('"', '\\"')}"\n`;
}

const idsFor = (name) => ({ repoId: 'repo', worktreeId: name });

test('checks defaults and scoped jobs coalesce without merging identity', async () => {
  const dir = await makeProject('hooks:\n  enabled: true\n  policies:\n    checks:\n      enabled: true\n      mode: observe\n');
  const loaded = loadChecksConfig(dir);
  assert.equal(loaded.resolved.ok, true);
  assert.equal(loaded.resolved.options.debounceMs, 500);
  assert.equal(loaded.resolved.options.timeoutMs, 30000);
  assert.deepEqual(loaded.resolved.options.commands, []);
  const ids = idsFor('coalesce');
  const base = {
    projectDir: dir,
    ids,
    kind: 'checks',
    changeId: 'demo-change',
    sessionId: 'sess-1',
    agentId: null,
    taskId: '1.1',
    bindingDigest: 'b',
    allowedFiles: ['src/a.js'],
    paths: ['src/a.js'],
    commandId: 'lint',
    optionsDigest: 'o',
  };
  await enqueueJob(base);
  await enqueueJob({ ...base, paths: ['src/a.js'] });
  await enqueueJob({ ...base, taskId: '9.9' });
  await enqueueJob({ ...base, changeId: 'other-change' });
  await enqueueJob({ ...base, commandId: 'typecheck' });
  const jobs = Object.values((await readQueue({ projectDir: dir, ids })).jobs);
  assert.equal(jobs.length, 4);
  assert.equal(new Set(jobs.map((job) => job.coalesceKey)).size, 4);
  await rm(dir, { recursive: true, force: true });
});

test('a held verification lease serializes formatters and null-session writers share it', async () => {
  const dir = await makeProject(yamlFor([
    command('format', ['-e', "require('node:fs').writeFileSync('src/a.js','formatted\\n')"], { writablePaths: ['src/a.js'] }),
  ]));
  const ids = idsFor('serialize');
  let release;
  let ready = false;
  const verification = withLease({ projectDir: dir, ids }, () => new Promise((resolve) => {
    ready = true;
    release = resolve;
  }));
  while (!ready) await new Promise((resolve) => setTimeout(resolve, 5));
  const formatting = runScopedChecks({
    projectDir: dir,
    ids,
    binding,
    paths: ['src/a.js'],
    commandId: 'format',
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), 'original\n');
  await assert.rejects(
    () => withLease({ projectDir: dir, ids, timeoutMs: 40 }, async () => {}),
    (error) => error.code === 'ERR_HOOK_LEASE_TIMEOUT',
  );
  release();
  await verification;
  const result = await formatting;
  assert.equal(result.results[0].status, 'completed');
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), 'formatted\n');
  assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);
  await rm(dir, { recursive: true, force: true });
});

test('checks keep owner tokens, reject bad tokens, and publish real failures', async () => {
  const dir = await makeProject(yamlFor([
    command('fail', ['-e', 'process.exit(2)']),
    command('format', ['-e', "require('node:fs').writeFileSync('src/a.js','formatted\\n')"], { writablePaths: ['src/a.js'] }),
  ], { timeoutMs: 30000 }));
  const ids = idsFor('tokens');
  const acquired = await acquireLease({ projectDir: dir, ids });
  const before = await worktreeStore(dir, ids).read('jobs', 'lease');
  const failed = await runScopedChecks({
    projectDir: dir,
    ids,
    ownerToken: acquired.ownerToken,
    binding,
    paths: ['src/a.js'],
    commandId: 'fail',
  });
  assert.equal(failed.results[0].status, 'failed');
  assert.equal(failed.results[0].exitCode, 2);
  const after = await worktreeStore(dir, ids).read('jobs', 'lease');
  assert.equal(after.owner, acquired.ownerToken);
  assert.equal(after.expiresAt, before.expiresAt);
  const stored = await readOutcomes({ projectDir: dir, ids });
  assert.equal(stored.some((row) => row.policy === 'checks' && row.status === 'failed' && row.reason === 'exit-2'), true);
  assert.equal(JSON.stringify(stored).includes('process.exit'), false);

  await assert.rejects(
    () => runScopedChecks({
      projectDir: dir,
      ids,
      ownerToken: 'wrong-token',
      binding,
      paths: ['src/a.js'],
      commandId: 'fail',
    }),
    /lease token/,
  );
  await releaseLease({ projectDir: dir, ids, ownerToken: acquired.ownerToken });
  const expired = await acquireLease({ projectDir: dir, ids, ownerToken: 'expired-token', now: Date.now() - 10000 });
  assert.equal(expired.ok, true);
  await assert.rejects(
    () => runScopedChecks({
      projectDir: dir,
      ids,
      ownerToken: 'expired-token',
      binding,
      paths: ['src/a.js'],
      commandId: 'fail',
    }),
    /lease token/,
  );
  const missing = await runScopedChecks({ projectDir: dir, ids, binding: null, paths: ['src/a.js'] });
  assert.equal(missing.reason, 'missing-binding');
  await rm(dir, { recursive: true, force: true });
});

test('timeouts, crashes, own origins and out-of-scope patches do not overwrite user work', async () => {
  const dir = await makeProject(yamlFor([
    command('slow', ['-e', 'setTimeout(() => {}, 5000)'], { writablePaths: [] }),
    command('crash', ['-e', 'process.kill(process.pid, "SIGKILL")']),
    command('format', ['-e', "require('node:fs').mkdirSync('src',{recursive:true}); require('node:fs').writeFileSync('src/a.js','formatted\\n'); require('node:fs').writeFileSync('src/b.js','nope\\n'); require('node:fs').writeFileSync('escape.txt','nope\\n')"], { writablePaths: ['src/a.js'] }),
    command('unknown', ['-e', 'process.exit(0)']),
  ], { timeoutMs: 200 }));
  const ids = idsFor('bounds');
  const timed = await runScopedChecks({ projectDir: dir, ids, binding, paths: ['src/a.js'], commandId: 'slow' });
  assert.equal(timed.results[0].status, 'timeout');
  const crashed = await runScopedChecks({ projectDir: dir, ids, binding, paths: ['src/a.js'], commandId: 'crash' });
  assert.equal(crashed.results[0].reason, 'crash');
  const again = await withLease({ projectDir: dir, ids, timeoutMs: 500 }, async ({ ownerToken }) => ownerToken);
  assert.equal(typeof again, 'string');

  const suppressed = await runScopedChecks({
    projectDir: dir,
    ids,
    binding,
    paths: ['src/a.js'],
    commandId: 'format',
    originJobIds: ['job-self'],
  });
  assert.equal(suppressed.suppressed, true);
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), 'original\n');

  const skipped = await runScopedChecks({ projectDir: dir, ids, binding, paths: ['src/a.js'], commandId: 'not-configured' });
  assert.equal(skipped.outcome.status, 'skipped');
  assert.equal(existsSync(join(dir, 'suite-ran.txt')), false);

  const outside = await runScopedChecks({
    projectDir: dir,
    ids,
    binding,
    paths: ['src/a.js', '../secret.txt'],
    commandId: 'format',
  });
  assert.deepEqual(outside.outside, []);
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), 'formatted\n');
  assert.equal(existsSync(join(dir, 'src', 'b.js')), false);
  assert.equal(existsSync(join(dir, 'escape.txt')), false);

  await writeFile(join(dir, 'src', 'a.js'), 'original\n');
  const raced = await runScopedChecks({
    projectDir: dir,
    ids,
    binding,
    paths: ['src/a.js'],
    commandId: 'format',
    beforeImport: () => writeFile(join(dir, 'src', 'a.js'), 'user-edit\n'),
  });
  assert.equal(raced.results[0].reason, 'concurrent-change');
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), 'user-edit\n');
  const outcomes = await readOutcomes({ projectDir: dir, ids });
  assert.equal(outcomes.some((row) => row.status === 'timeout' && row.reason === 'timeout'), true);
  assert.equal(outcomes.some((row) => row.status === 'failed' && row.reason === 'crash'), true);
  assert.equal(outcomes.some((row) => row.status === 'suppressed'), true);
  assert.equal(outcomes.some((row) => row.reason === 'concurrent-change'), true);
  await rm(dir, { recursive: true, force: true });
});
