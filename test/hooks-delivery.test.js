import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { dispatch } from '../bin/hooks/index.js';
import { createStore } from '../bin/hooks/store.js';
import { contextPolicy, commitContextDelivery } from '../bin/hooks/policies/context.js';

const execFileAsync = promisify(execFile);
const SCOPES = await readFile('templates/hook-skill-scopes.json', 'utf8');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const INJECT = { injectContext: true };
const CAPS = { events: { 'session.start': INJECT, 'session.resume': INJECT, 'agent.start': INJECT, 'tool.after': INJECT, 'context.reset': INJECT } };

async function makeProject({ skills = { 'javascript-core': '# js\n', 'vue-core': '# vue\n' } } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-delivery-'));
  await execFileAsync('git', ['init', '--quiet', dir]);
  await mkdir(join(dir, '.agents'), { recursive: true });
  await writeFile(join(dir, '.agents', 'hook-skill-scopes.json'), SCOPES);
  for (const [name, body] of Object.entries(skills)) {
    await mkdir(join(dir, '.agents', 'skills', name), { recursive: true });
    await writeFile(join(dir, '.agents', 'skills', name, 'SKILL.md'), body);
  }
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), [
    'project:', '  stack: vue3', 'skills:', '  stack:', '    - javascript-core', '    - vue-core', '',
  ].join('\n'));
  return dir;
}

let counter = 0;
const event = (kind, over = {}) => ({
  schemaVersion: 1,
  kind,
  eventId: `evt-${++counter}`,
  occurredAt: new Date().toISOString(),
  scope: { changeId: 'demo', sessionId: 'sess-1', agentId: null, ...(over.scope ?? {}) },
  data: { role: 'implementer', files: [], ...(over.data ?? {}) },
  ...(over.contextEpoch ? { contextEpoch: over.contextEpoch } : {}),
});

function storeFor(dir, ev) {
  return createStore({
    projectDir: dir,
    scope: { level: 'session', repoId: 'r', worktreeId: 'w', changeId: ev.scope.changeId, sessionId: ev.scope.sessionId, agentId: ev.scope.agentId, eventId: ev.eventId },
    pruneIntervalMs: 10 ** 9,
  });
}

const config = (dir, extra = {}) => ({ projectDir: dir, hooks: { enabled: true }, ...extra });

// Dispatch, then simulate the adapter having emitted a valid response containing the context.
async function deliver(dir, ev, { caps = CAPS, emit = true, extra = {} } = {}) {
  const store = storeFor(dir, ev);
  const result = await dispatch(ev, { capabilities: caps, store, config: config(dir, extra), policies: [contextPolicy] });
  if (emit) {
    const text = result.context.map((item) => item.text).join('\n\n');
    await commitContextDelivery({ event: ev, result, output: { additional_context: text }, store });
  }
  return { result, store };
}

const delivered = (result) => result.context.map((item) => item.sourcePath).sort();
const codes = (result, code) => result.findings.filter((f) => f.code === code).flatMap((f) => f.paths);

test('same-context dedup: second start in the same epoch injects nothing', async () => {
  const dir = await makeProject();
  const first = await deliver(dir, event('session.start', { contextEpoch: 'e1' }));
  assert.deepEqual(delivered(first.result), ['.agents/skills/javascript-core/SKILL.md', '.agents/skills/vue-core/SKILL.md']);
  const receipt = await first.store.read('skill-receipts', sha('.agents/skills/vue-core/SKILL.md'));
  assert.equal(receipt.status, 'injected');
  assert.equal(receipt.source, 'hook');
  assert.equal(receipt.contentDigest, sha('# vue\n'));
  assert.equal(receipt.sessionId, 'sess-1');
  const second = await deliver(dir, event('session.resume', { contextEpoch: 'e1' }));
  assert.deepEqual(delivered(second.result), []);
  await rm(dir, { recursive: true, force: true });
});

test('no receipt without an emitted response (submission only)', async () => {
  const dir = await makeProject();
  const { result, store } = await deliver(dir, event('session.start', { contextEpoch: 'e1' }), { emit: false });
  assert.equal(result.context.length, 2);
  assert.equal(await store.read('skill-receipts', sha('.agents/skills/vue-core/SKILL.md')), null);
  await rm(dir, { recursive: true, force: true });
});

test('child agents never share parent receipts', async () => {
  const dir = await makeProject();
  await deliver(dir, event('session.start', { contextEpoch: 'e1' }));
  const child = await deliver(dir, event('agent.start', { contextEpoch: 'e1', scope: { agentId: 'child-1' } }));
  assert.equal(child.result.context.length, 2);
  await rm(dir, { recursive: true, force: true });
});

test('content digest change and compaction epoch both reload', async () => {
  const dir = await makeProject();
  await deliver(dir, event('session.start', { contextEpoch: 'e1' }));
  await writeFile(join(dir, '.agents', 'skills', 'vue-core', 'SKILL.md'), '# vue v2\n');
  const changed = await deliver(dir, event('session.resume', { contextEpoch: 'e1' }));
  assert.deepEqual(delivered(changed.result), ['.agents/skills/vue-core/SKILL.md']);
  const reset = await deliver(dir, event('context.reset', { contextEpoch: 'e2' }));
  assert.equal(reset.result.context.length, 2);
  await rm(dir, { recursive: true, force: true });
});

test('confirmed native preload records a receipt without duplicate injection', async () => {
  const dir = await makeProject();
  const ev = event('session.start', { contextEpoch: 'e1' });
  const skillEvidence = [{ sourcePath: '.agents/skills/vue-core/SKILL.md', contentDigest: sha('# vue\n'), sessionId: 'sess-1', agentId: null, epoch: 'e1', source: 'native-preload', confirmed: true, fullContent: true }];
  const { result, store } = await deliver(dir, ev, { extra: { skillEvidence } });
  assert.deepEqual(delivered(result), ['.agents/skills/javascript-core/SKILL.md']);
  const receipt = await store.read('skill-receipts', sha('.agents/skills/vue-core/SKILL.md'));
  assert.equal(receipt.source, 'native-preload');
  await rm(dir, { recursive: true, force: true });
});

test('overflow is not truncated and stays undelivered with a manual Read path', async () => {
  const big = `# big\n${'x'.repeat(40 * 1024)}\n`;
  const dir = await makeProject({ skills: { 'javascript-core': '# js\n', 'vue-core': big } });
  const { result, store } = await deliver(dir, event('session.start', { contextEpoch: 'e1' }));
  assert.deepEqual(delivered(result), ['.agents/skills/javascript-core/SKILL.md']);
  assert.deepEqual(codes(result, 'skills.undelivered'), ['.agents/skills/vue-core/SKILL.md']);
  assert.deepEqual(codes(result, 'skills.missing'), []);
  assert.equal(await store.read('skill-receipts', sha('.agents/skills/vue-core/SKILL.md')), null);
  await rm(dir, { recursive: true, force: true });
});

test('unsupported delivery falls back to manual Read', async () => {
  const dir = await makeProject();
  const { result } = await deliver(dir, event('session.start', { contextEpoch: 'e1' }), { caps: { events: {} } });
  assert.equal(result.context.length, 0);
  assert.equal(codes(result, 'skills.undelivered').length, 2);
  await rm(dir, { recursive: true, force: true });
});

test('partial/error reads and agent-reported reads never become read receipts', async () => {
  const dir = await makeProject();
  const base = { sourcePath: '.agents/skills/vue-core/SKILL.md', contentDigest: sha('# vue\n'), sessionId: 'sess-1', agentId: null, epoch: 'e1', confirmed: true };
  const failed = event('tool.after', { contextEpoch: 'e1', data: { tool: { operation: 'read' }, outcome: { status: 'error' } } });
  const partial = await deliver(dir, failed, { emit: false, extra: { skillEvidence: [{ ...base, source: 'observed-read', fullContent: false }] } });
  assert.equal(await partial.store.read('skill-receipts', sha(base.sourcePath)), null);
  const reported = await deliver(dir, event('tool.after', { contextEpoch: 'e1' }), { emit: false, extra: { skillEvidence: [{ ...base, source: 'agent-reported', fullContent: true }] } });
  assert.deepEqual(codes(reported.result, 'skills.reported'), [base.sourcePath]);
  const ok = event('tool.after', { contextEpoch: 'e1', data: { tool: { operation: 'read' }, outcome: { status: 'success' } } });
  const read = await deliver(dir, ok, { emit: false, extra: { skillEvidence: [{ ...base, source: 'observed-read', fullContent: true }] } });
  assert.equal((await read.store.read('skill-receipts', sha(base.sourcePath))).status, 'read');
  await rm(dir, { recursive: true, force: true });
});

test('honest audit: missing skills reported, delivery never claims compliance', async () => {
  const dir = await makeProject({ skills: { 'javascript-core': '# js\n' } });
  const { result, store } = await deliver(dir, event('session.start', { contextEpoch: 'e1' }));
  assert.deepEqual(codes(result, 'skills.missing'), ['.agents/skills/vue-core/SKILL.md']);
  const audit = (await store.log('audit')).filter((r) => r.type === 'skill-delivery');
  assert.equal(audit.length, 1);
  assert.match(audit[0].message, /compliance are unconfirmed/);
  await rm(dir, { recursive: true, force: true });
});

test('unbound identity yields manual fallback only', async () => {
  const dir = await makeProject();
  const { result } = await deliver(dir, event('session.start', { scope: { changeId: null } }));
  assert.equal(result.context.length, 0);
  assert.equal(codes(result, 'skills.manual').length, 0);
  assert.ok(result.findings.some((f) => f.code === 'skills.manual'));
  await rm(dir, { recursive: true, force: true });
});
