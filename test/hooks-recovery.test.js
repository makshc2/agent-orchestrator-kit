import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { dispatch } from '../bin/hooks/index.js';
import { createStore } from '../bin/hooks/store.js';
import { recoveryPolicy, captureSnapshot } from '../bin/hooks/policies/recovery.js';

const run = promisify(execFile);
const INJECT = { injectContext: true };
const CAPS = { events: { 'session.start': INJECT, 'session.resume': INJECT, 'context.reset': INJECT, 'context.compacting': {}, 'file.changed': {}, 'agent.end': {} } };
const SEMANTIC = ['checkpoint.json', 'handoff.md', 'decisions.md', 'tasks.md', 'metrics.json'];

async function makeProject({ tasks = '- [x] 1.1 Done\n- [ ] 1.2 Next\n' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-recovery-'));
  await run('git', ['init', '--quiet', dir]);
  await run('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'init']);
  const change = join(dir, 'openspec', 'changes', 'demo');
  await mkdir(join(change, 'specs', 'cap'), { recursive: true });
  await writeFile(join(change, 'proposal.md'), '# Proposal\n');
  await writeFile(join(change, 'tasks.md'), `## 1. Work\n${tasks}`);
  await writeFile(join(change, 'specs', 'cap', 'spec.md'), '# spec\n');
  await writeFile(join(change, 'handoff.md'), '# Session Handoff\n');
  await writeFile(join(change, 'decisions.md'), '# Decisions\n');
  await writeFile(join(change, 'metrics.json'), '{"pending":{"session":1}}\n');
  return { dir, change };
}

async function digests(change) {
  const out = {};
  for (const name of await readdir(change)) {
    if (SEMANTIC.includes(name)) out[name] = createHash('sha256').update(await readFile(join(change, name))).digest('hex');
  }
  return out;
}

let n = 0;
const event = (kind, over = {}) => ({
  schemaVersion: 1, kind, eventId: `evt-${++n}`, occurredAt: new Date().toISOString(),
  scope: { changeId: 'demo', sessionId: 'sess-1', agentId: null, ...(over.scope ?? {}) },
  data: { files: [], ...(over.data ?? {}) },
});
const storeFor = (dir, ev) => createStore({ projectDir: dir, scope: { level: 'session', repoId: 'r', worktreeId: 'w', changeId: ev.scope.changeId, sessionId: ev.scope.sessionId, agentId: ev.scope.agentId, eventId: ev.eventId }, pruneIntervalMs: 10 ** 9 });
const fire = async (dir, ev, caps = CAPS) => {
  const store = storeFor(dir, ev);
  const result = await dispatch(ev, { capabilities: caps, store, config: { projectDir: dir, hooks: { enabled: true } }, policies: [recoveryPolicy] });
  return { result, store };
};
const has = (result, code) => result.findings.some((f) => f.code === code);

test('repeated start/resume/compaction keep semantic files and pending metrics byte-identical', async () => {
  const { dir, change } = await makeProject();
  const before = await digests(change);
  for (const kind of ['session.start', 'file.changed', 'session.resume', 'context.compacting', 'agent.end', 'context.reset', 'session.start']) {
    await fire(dir, event(kind, { data: { outcome: { status: 'success' } } }));
  }
  assert.deepEqual(await digests(change), before);
  assert.ok(!(await readdir(change)).includes('checkpoint.json'));
  await rm(dir, { recursive: true, force: true });
});

test('start briefing is bounded and the snapshot is labeled as a stale observation', async () => {
  const { dir } = await makeProject();
  await fire(dir, event('context.compacting'));
  const { result } = await fire(dir, event('session.resume'));
  const brief = result.context.find((item) => item.id === 'recovery-demo');
  assert.ok(brief);
  assert.ok(Buffer.byteLength(brief.text) <= 4096);
  assert.ok(brief.text.split('\n').length <= 40);
  const snap = result.context.find((item) => item.id === 'recovery-snapshot-demo');
  assert.match(snap.text, /stale observation, not current fact/);
  assert.match(snap.text, /not proof of passing tests or completion/);
  await rm(dir, { recursive: true, force: true });
});

test('snapshot holds technical fields only', async () => {
  const { dir } = await makeProject();
  const ev = event('agent.end', { data: { outcome: { status: 'success' } } });
  const snapshot = await captureSnapshot({ projectDir: dir, event: ev, store: storeFor(dir, ev), binding: { task: '1.2' }, trigger: 'explicit' });
  assert.match(snapshot.head.value, /^[0-9a-f]{40}$/);
  assert.equal(snapshot.task, '1.2');
  assert.ok(snapshot.artifacts['proposal.md'] && snapshot.artifacts['specs/cap/spec.md']);
  assert.deepEqual(snapshot.outcomes, [{ eventId: ev.eventId, kind: 'agent.end', status: 'success' }]);
  for (const key of ['done', 'blocked', 'next', 'decisions']) assert.ok(!(key in snapshot));
  await rm(dir, { recursive: true, force: true });
});

test('corrupt or interrupted snapshot is ignored with a gap', async () => {
  const { dir } = await makeProject();
  const ev = event('session.start');
  await storeFor(dir, ev).transact('snapshots', 'latest', () => ({ version: 1, trigger: 'file.changed' }));
  const { result } = await fire(dir, ev);
  assert.ok(has(result, 'recovery.snapshot.missing'));
  assert.ok(!result.context.some((item) => item.id === 'recovery-snapshot-demo'));
  await rm(dir, { recursive: true, force: true });
});

test('missing cloud state and unsupported reset coverage surface as gaps', async () => {
  const { dir } = await makeProject();
  const { result } = await fire(dir, event('session.start', { data: { runtime: 'cloud' } }), { events: { 'session.start': INJECT } });
  assert.ok(has(result, 'recovery.cloud.unsupported'));
  assert.ok(has(result, 'recovery.reset.unsupported'));
  assert.ok(has(result, 'recovery.snapshot.missing'));
  await rm(dir, { recursive: true, force: true });
});

test('multibyte task content keeps the briefing within the byte bound', async () => {
  const many = Array.from({ length: 80 }, (_, i) => `- [ ] 1.${i} Завдання з довгою назвою ✓ ${'ї'.repeat(60)}`).join('\n');
  const { dir } = await makeProject({ tasks: `${many}\n` });
  const { result } = await fire(dir, event('session.start'));
  const brief = result.context.find((item) => item.id === 'recovery-demo');
  assert.ok(Buffer.byteLength(brief.text) <= 4096);
  assert.ok(!brief.text.includes('�'));
  await rm(dir, { recursive: true, force: true });
});

test('unbound sessions get no briefing and are pointed at the canonical restore', async () => {
  const { dir } = await makeProject();
  const { result } = await fire(dir, event('session.start', { scope: { changeId: null } }));
  assert.equal(result.context.length, 0);
  assert.ok(has(result, 'recovery.unbound'));
  await rm(dir, { recursive: true, force: true });
});
