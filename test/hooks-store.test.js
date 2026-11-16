import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createStore } from '../bin/hooks/store.js';
import { createStore as createStoreFromIndex } from '../bin/hooks/index.js';

const execFileAsync = promisify(execFile);
const storeUrl = new URL('../bin/hooks/store.js', import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashSegment = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

async function makeProject({ git = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-store-'));
  if (git) await execFileAsync('git', ['init', '--quiet', dir]);
  return dir;
}

async function walkFiles(dirPath, out = []) {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) await walkFiles(entryPath, out);
    else out.push(entryPath);
  }
  return out;
}

const scope = (overrides = {}) => ({
  level: 'session',
  repoId: 'repo-1',
  worktreeId: 'wt-1',
  changeId: null,
  sessionId: 'sess-1',
  agentId: null,
  eventId: 'evt-base',
  ...overrides,
});

async function worktreeDiagnostics(projectDir) {
  const wt = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  return wt.log('diagnostics');
}

test('createStore is re-exported from the frozen public index', () => {
  assert.equal(typeof createStoreFromIndex, 'function');
});

test('store root lives under the absolute git dir and falls back for non-Git projects', async () => {
  const gitProject = await makeProject({ git: true });
  const { stdout } = await execFileAsync('git', ['-C', gitProject, 'rev-parse', '--absolute-git-dir']);
  const gitStore = createStore({ projectDir: gitProject, scope: scope({ level: 'worktree' }) });
  assert.equal(await gitStore.root(), join(stdout.trim(), 'aok-hooks', 'v1'));

  const plainProject = await makeProject({ git: false });
  const plainStore = createStore({ projectDir: plainProject, scope: scope({ level: 'worktree' }) });
  assert.equal(await plainStore.root(), join(plainProject, '.agents', '.hook-state', 'v1'));

  const topEntries = (await readdir(plainProject)).sort();
  assert.deepEqual(topEntries, ['.agents']);
  await rm(gitProject, { recursive: true, force: true });
  await rm(plainProject, { recursive: true, force: true });
});

test('session stores isolate by session id and a later bind never moves the namespace', async () => {
  const projectDir = await makeProject();
  const s1 = createStore({ projectDir, scope: scope({ sessionId: 's1', changeId: null }), pruneIntervalMs: 10 ** 9 });
  const s2 = createStore({ projectDir, scope: scope({ sessionId: 's2' }), pruneIntervalMs: 10 ** 9 });
  await s1.transact('data', 'k', () => ({ owner: 's1' }));
  assert.equal(await s2.read('data', 'k'), null);

  const s1Bound = createStore({ projectDir, scope: scope({ sessionId: 's1', changeId: 'c9' }), pruneIntervalMs: 10 ** 9 });
  assert.deepEqual(await s1Bound.read('data', 'k'), { owner: 's1' });
  await rm(projectDir, { recursive: true, force: true });
});

test('agent stores isolate per agent and share per agent identity', async () => {
  const projectDir = await makeProject();
  const a1 = createStore({ projectDir, scope: scope({ level: 'agent', sessionId: 's1', agentId: 'a1' }), pruneIntervalMs: 10 ** 9 });
  const a2 = createStore({ projectDir, scope: scope({ level: 'agent', sessionId: 's1', agentId: 'a2' }), pruneIntervalMs: 10 ** 9 });
  await a1.transact('data', 'who', () => ({ agent: 'a1' }));
  assert.equal(await a2.read('data', 'who'), null);
  const a1again = createStore({ projectDir, scope: scope({ level: 'agent', sessionId: 's1', agentId: 'a1' }), pruneIntervalMs: 10 ** 9 });
  assert.deepEqual(await a1again.read('data', 'who'), { agent: 'a1' });
  await rm(projectDir, { recursive: true, force: true });
});

test("storeFor('worktree') is one shared namespace for sessions and null-session writers", async () => {
  const projectDir = await makeProject();
  const base = { repoId: 'repo-1', worktreeId: 'wt-1' };
  const sessionA = createStore({ projectDir, scope: scope({ ...base, level: 'session', sessionId: 'sa', eventId: 'e-a' }), pruneIntervalMs: 10 ** 9 });
  const sessionB = createStore({ projectDir, scope: scope({ ...base, level: 'session', sessionId: 'sb', eventId: 'e-b' }), pruneIntervalMs: 10 ** 9 });
  const nullSession = createStore({ projectDir, scope: scope({ ...base, level: 'session', sessionId: null, eventId: 'e-n' }), pruneIntervalMs: 10 ** 9 });

  assert.equal(nullSession.quarantined, true);
  const worktrees = [sessionA, sessionB, nullSession].map((store) => store.storeFor('worktree'));
  for (const wt of worktrees) {
    assert.equal(wt.quarantined, false);
    assert.deepEqual(wt.missingIds, []);
  }

  for (const wt of worktrees) {
    for (let i = 0; i < 20; i += 1) {
      await wt.transact('jobs', 'lease', (prior) => ({ count: (prior?.count ?? 0) + 1, holder: wt.scope.sessionId }));
    }
  }
  assert.equal((await worktrees[0].read('jobs', 'lease')).count, 60);
  assert.equal((await worktrees[2].read('jobs', 'lease')).count, 60);
  await rm(projectDir, { recursive: true, force: true });
});

test("storeFor('change') is shared per bound change and quarantines without a change id", async () => {
  const projectDir = await makeProject();
  const eventOne = createStore({ projectDir, scope: scope({ sessionId: 's1', changeId: 'c1', eventId: 'e1' }), pruneIntervalMs: 10 ** 9 });
  const eventTwo = createStore({ projectDir, scope: scope({ sessionId: 's2', changeId: 'c1', eventId: 'e2' }), pruneIntervalMs: 10 ** 9 });
  const unbound = createStore({ projectDir, scope: scope({ sessionId: 's1', changeId: null, eventId: 'e3' }), pruneIntervalMs: 10 ** 9 });

  const changeOne = eventOne.storeFor('change');
  const changeTwo = eventTwo.storeFor('change');
  assert.equal(changeOne.quarantined, false);
  await changeOne.transact('data', 'task', () => ({ change: 'c1' }));
  assert.deepEqual(await changeTwo.read('data', 'task'), { change: 'c1' });

  const quarantined = unbound.storeFor('change');
  assert.equal(quarantined.quarantined, true);
  assert.deepEqual(quarantined.missingIds, ['changeId']);
  await quarantined.transact('data', 'task', () => ({ leaked: true }));
  assert.equal(await changeOne.read('data', 'task').then((v) => v.leaked), undefined);
  await rm(projectDir, { recursive: true, force: true });
});

test('a null session id quarantines writes keyed by the event id that no later event claims', async () => {
  const projectDir = await makeProject();
  const quarantined = createStore({ projectDir, scope: scope({ sessionId: null, eventId: 'evt-q' }), pruneIntervalMs: 10 ** 9 });
  assert.equal(quarantined.quarantined, true);
  assert.deepEqual(quarantined.missingIds, ['sessionId']);
  await quarantined.transact('data', 'x', () => ({ quarantined: true }));

  const realSession = createStore({ projectDir, scope: scope({ sessionId: 's-real', eventId: 'evt-real' }), pruneIntervalMs: 10 ** 9 });
  assert.equal(await realSession.read('data', 'x'), null);

  const otherQuarantine = createStore({ projectDir, scope: scope({ sessionId: null, eventId: 'evt-q2' }), pruneIntervalMs: 10 ** 9 });
  assert.equal(await otherQuarantine.read('data', 'x'), null);

  const replay = createStore({ projectDir, scope: scope({ sessionId: null, eventId: 'evt-q' }), pruneIntervalMs: 10 ** 9 });
  assert.deepEqual(await replay.read('data', 'x'), { quarantined: true });

  await sleep(50);
  const diagnostics = await worktreeDiagnostics(projectDir);
  assert.ok(diagnostics.some((record) => record.code === 'store.identity.quarantined'));
  await rm(projectDir, { recursive: true, force: true });
});

test('storeFor with a missing required id quarantines and records a diagnostic', async () => {
  const projectDir = await makeProject();
  const base = createStore({ projectDir, scope: scope({ sessionId: 's1', agentId: null, eventId: 'e1' }), pruneIntervalMs: 10 ** 9 });
  const agentLevel = base.storeFor('agent');
  assert.equal(agentLevel.quarantined, true);
  assert.deepEqual(agentLevel.missingIds, ['agentId']);

  const nullSession = createStore({ projectDir, scope: scope({ sessionId: null, eventId: 'e2' }), pruneIntervalMs: 10 ** 9 });
  assert.equal(nullSession.storeFor('session').quarantined, true);
  assert.equal(nullSession.storeFor('agent').quarantined, true);
  assert.equal(base.storeFor('worktree').quarantined, false);
  assert.equal(base.storeFor('session').quarantined, false);

  await sleep(50);
  const diagnostics = await worktreeDiagnostics(projectDir);
  assert.ok(diagnostics.some((record) => record.code === 'store.identity.quarantined'));
  await rm(projectDir, { recursive: true, force: true });
});

test('transact commits updater results atomically and undefined leaves the prior value', async () => {
  const projectDir = await makeProject();
  const store = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  assert.equal(await store.read('ns', 'k'), null);
  assert.deepEqual(await store.transact('ns', 'k', () => ({ v: 1 })), { v: 1 });
  assert.deepEqual(await store.transact('ns', 'k', (prior) => ({ v: prior.v + 1 })), { v: 2 });
  const untouched = await store.transact('ns', 'k', () => undefined);
  assert.deepEqual(untouched, { v: 2 });
  assert.deepEqual(await store.read('ns', 'k'), { v: 2 });
  await rm(projectDir, { recursive: true, force: true });
});

test('append dedups stable occurrence ids but not identical argument payloads', async () => {
  const projectDir = await makeProject();
  const store = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });

  const first = await store.append('jobs', { id: 'occ-1', kind: 'tool.after', status: 'success' });
  const duplicate = await store.append('jobs', { id: 'occ-1', kind: 'tool.after', status: 'success' });
  assert.equal(first.stored, true);
  assert.equal(duplicate.stored, false);
  assert.equal(duplicate.deduped, true);
  assert.equal((await store.log('jobs')).length, 1);

  await store.append('jobs', { kind: 'tool.after', args: ['same', 'arguments'] });
  await store.append('jobs', { kind: 'tool.after', args: ['same', 'arguments'] });
  assert.equal((await store.log('jobs')).length, 3);
  await rm(projectDir, { recursive: true, force: true });
});

test('lock acquisition is bounded and surfaces a timeout error', async () => {
  const projectDir = await makeProject();
  const shared = { projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 };
  const holder = createStore(shared);
  let signalUpdaterEntered;
  const updaterEntered = new Promise((resolve) => { signalUpdaterEntered = resolve; });
  const slow = holder.transact('locked', 'k', async () => {
    signalUpdaterEntered();
    await sleep(500);
    return { v: 1 };
  });
  await updaterEntered;
  const waiter = createStore({ ...shared, lockTimeoutMs: 120, lockPollMs: 10 });
  await assert.rejects(
    () => waiter.transact('locked', 'k', () => ({ v: 2 })),
    (error) => error.code === 'ERR_HOOK_STORE_LOCK_TIMEOUT',
  );
  assert.deepEqual(await slow, { v: 1 });
  assert.deepEqual(await holder.read('locked', 'k'), { v: 1 });
  await rm(projectDir, { recursive: true, force: true });
});

test('stale locks are recovered by age and by dead pid', async () => {
  const projectDir = await makeProject();
  const root = await createStore({ projectDir, scope: scope({ level: 'worktree' }) }).root();

  const staleByAge = createStore({ projectDir, scope: scope({ level: 'worktree' }), lockPollMs: 10 });
  const held = staleByAge.transact('stale', 'age', async () => {
    await sleep(600);
    return { v: 1 };
  });
  await sleep(80);
  const lockFiles = (await walkFiles(root)).filter((file) => file.endsWith('.lock'));
  assert.equal(lockFiles.length, 1);
  const oldTime = new Date(Date.now() - 120000);
  await utimes(lockFiles[0], oldTime, oldTime);
  const agedWaiter = createStore({ projectDir, scope: scope({ level: 'worktree' }), lockTimeoutMs: 400, staleLockMs: 30000, lockPollMs: 10 });
  assert.deepEqual(await agedWaiter.transact('stale', 'age', () => ({ v: 2 })), { v: 2 });
  await held;

  const deadRoot = await createStore({ projectDir, scope: scope({ level: 'worktree' }) }).root();
  const deadLockDir = join(deadRoot, `wt-${hashSegment('repo-1\0wt-1')}`, 'worktree', 'locks');
  await mkdir(deadLockDir, { recursive: true });
  const deadPid = 4194300;
  await writeFile(join(deadLockDir, `${hashSegment('stale\0pid')}.lock`), `${JSON.stringify({ pid: deadPid, ts: Date.now(), rand: 't' })}\n`);
  const pidWaiter = createStore({ projectDir, scope: scope({ level: 'worktree' }), lockTimeoutMs: 400, lockPollMs: 10 });
  assert.deepEqual(await pidWaiter.transact('stale', 'pid', () => ({ v: 'recovered' })), { v: 'recovered' });
  await rm(projectDir, { recursive: true, force: true });
});

test('an interrupted rename falls back to the last-good value and recovers', async () => {
  const projectDir = await makeProject();
  const store = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  await store.transact('data', 'k', () => ({ v: 1 }));
  await store.transact('data', 'k', (prior) => ({ v: prior.v + 1 }));

  const root = await store.root();
  const dataFile = (await walkFiles(root)).find((file) => file.endsWith(join('data', 'k.json')));
  assert.ok(dataFile);
  await writeFile(dataFile, '{"corrupt": tru', 'utf8');
  assert.deepEqual(await store.read('data', 'k'), { v: 1 });
  assert.deepEqual(await store.transact('data', 'k', (prior) => ({ v: prior.v + 1 })), { v: 2 });
  await rm(projectDir, { recursive: true, force: true });
});

test('corrupt log records are skipped without losing valid ones', async () => {
  const projectDir = await makeProject();
  const store = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  await store.append('jobs', { id: 'ok-1', status: 'success' });
  const corrupt = await store.append('jobs', { id: 'bad-1', status: 'success' });
  await store.append('jobs', { id: 'ok-2', status: 'success' });
  await writeFile(corrupt.path, 'not-json', 'utf8');

  const records = await store.log('jobs');
  assert.deepEqual(records.map((record) => record.id).sort(), ['ok-1', 'ok-2']);
  await rm(projectDir, { recursive: true, force: true });
});

test('two processes transacting one key never lose updates', async () => {
  const projectDir = await makeProject();
  const childScript = `
    import { createStore } from '${pathToFileURL(fileURLToPath(storeUrl)).href}';
    const store = createStore({ projectDir: ${JSON.stringify(projectDir)}, scope: { level: 'worktree', repoId: 'repo-1', worktreeId: 'wt-1' }, lockTimeoutMs: 8000, pruneIntervalMs: 1e9 });
    for (let i = 0; i < 50; i += 1) {
      await store.transact('jobs', 'counter', (prior) => ({ count: (prior?.count ?? 0) + 1 }));
    }
  `;
  const children = [0, 1].map(() => execFileAsync('node', ['--input-type=module', '--eval', childScript]));
  await Promise.all(children);

  const verifier = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  assert.equal((await verifier.read('jobs', 'counter')).count, 100);
  await rm(projectDir, { recursive: true, force: true });
});

test('prune evicts audit-like records first and reports every eviction', async () => {
  const projectDir = await makeProject();
  const store = createStore({
    projectDir,
    scope: scope({ level: 'worktree' }),
    retentionDays: 30,
    retentionMaxBytes: 1200,
    pruneIntervalMs: 10 ** 9,
  });
  const padding = 'x'.repeat(1000);
  const receipts = await store.append('receipts', { id: 'rec-big', note: padding });
  const audit = await store.append('audit', { id: 'aud-1', code: 'seen', status: 'success' });
  const receiptsBytes = (await stat(receipts.path)).size;
  assert.ok(receiptsBytes > 1000);

  const tighter = createStore({
    projectDir,
    scope: scope({ level: 'worktree' }),
    retentionDays: 30,
    retentionMaxBytes: receiptsBytes,
    pruneIntervalMs: 10 ** 9,
  });
  const summary = await tighter.prune();
  assert.ok(summary.evicted >= 1);
  assert.equal(await readFile(audit.path, 'utf8').then(() => 'present', () => 'missing'), 'missing');
  assert.equal(await readFile(receipts.path, 'utf8').then(() => 'present', () => 'missing'), 'present');

  await sleep(50);
  const diagnostics = await worktreeDiagnostics(projectDir);
  assert.ok(diagnostics.some((record) => record.code === 'store.retention.evicted'));
  await rm(projectDir, { recursive: true, force: true });
});

test('diagnostics and audit records are sanitized; other namespaces are not', async () => {
  const projectDir = await makeProject();
  const store = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  await store.append('audit', {
    id: 'a1',
    code: 'tool.observed',
    message: 'ran with key AbCdEfGhIjKlMnOpQrStUv',
    transcript: 'PRIVATE',
    env: { TOKEN: '1' },
    args: ['--secret=hunter2'],
    body: 'file contents',
    status: 'success',
    durationMs: 7,
  });
  const [auditRecord] = await store.log('audit');
  assert.equal(auditRecord.transcript, undefined);
  assert.equal(auditRecord.env, undefined);
  assert.equal(auditRecord.args, undefined);
  assert.equal(auditRecord.body, undefined);
  assert.ok(!String(auditRecord.message).includes('AbCdEfGhIjKlMnOpQrStUv'));
  assert.ok(String(auditRecord.message).includes('[redacted]'));
  assert.equal(auditRecord.status, 'success');
  assert.equal(auditRecord.durationMs, 7);

  await store.append('leases', { id: 'l1', args: ['--secret=hunter2'], custom: 'kept' });
  const [leaseRecord] = await store.log('leases');
  assert.deepEqual(leaseRecord.args, ['--secret=hunter2']);
  assert.equal(leaseRecord.custom, 'kept');
  await rm(projectDir, { recursive: true, force: true });
});

test('namespaces and keys are validated as identifiers, never paths', async () => {
  const projectDir = await makeProject();
  const store = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  await assert.rejects(() => store.read('../escape', 'k'), (error) => error.code === 'ERR_HOOK_STORE_IDENTIFIER');
  await assert.rejects(() => store.read('ns', '../evil'), (error) => error.code === 'ERR_HOOK_STORE_IDENTIFIER');
  await assert.rejects(() => store.transact('ns', 'a/b', () => ({})), (error) => error.code === 'ERR_HOOK_STORE_IDENTIFIER');
  await assert.rejects(() => store.append('a/b', { id: 'x' }), (error) => error.code === 'ERR_HOOK_STORE_IDENTIFIER');
  await assert.rejects(
    async () => createStore({ projectDir, scope: scope({ level: 'orbit' }) }),
    (error) => error.code === 'ERR_HOOK_STORE_SCOPE',
  );

  const root = await store.root();
  const before = (await walkFiles(root)).length;
  assert.equal(before, (await walkFiles(root)).length);
  await rm(projectDir, { recursive: true, force: true });
});

test('notify records once per code within a scope', async () => {
  const projectDir = await makeProject();
  const store = createStore({ projectDir, scope: scope({ level: 'worktree' }), pruneIntervalMs: 10 ** 9 });
  const first = await store.notify({ code: 'runtime.degraded', message: 'slow policy' });
  const second = await store.notify({ code: 'runtime.degraded', message: 'slow policy' });
  assert.equal(first.stored, true);
  assert.equal(second.stored, false);
  assert.equal(second.deduped, true);
  const records = await store.log('diagnostics');
  assert.equal(records.filter((record) => record.code === 'runtime.degraded').length, 1);
  assert.equal(relative(projectDir, (await walkFiles(await store.root()))[0]).startsWith('..'), false);
  await rm(projectDir, { recursive: true, force: true });
});
