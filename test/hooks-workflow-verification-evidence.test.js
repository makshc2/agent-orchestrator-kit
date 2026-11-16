import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { scopeIds } from '../bin/hooks/adapters/shared.js';
import { bindSession } from '../bin/hooks/binding.js';
import { dispatch, builtinPolicies } from '../bin/hooks/index.js';
import { createStore } from '../bin/hooks/store.js';
import { runScopedChecks } from '../bin/hooks/workflow/checks.js';
import { runVerification } from '../bin/hooks/workflow/evidence.js';
import { changeStore } from '../bin/hooks/workflow/stores.js';

const execFileAsync = promisify(execFile);
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function yaml({ command, options, checks = [] }) {
  const verification = JSON.stringify(options);
  const checkOptions = JSON.stringify({ commands: checks, debounceMs: 0, timeoutMs: 30000 });
  const shown = command === '' ? '""' : command;
  return `hooks:\n  enabled: true\n  mode: enforce\n  policies:\n    verification:\n      enabled: true\n      mode: observe\n      options: ${verification}\n    checks:\n      enabled: true\n      mode: enforce\n      options: ${checkOptions}\nverifier:\n  test_command: ${shown}\n`;
}

async function git(dir, args) {
  await execFileAsync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { env: GIT_ENV });
}

async function makeProject(body) {
  const dir = await mkdtemp(join(tmpdir(), 'aok-evidence-'));
  await git(dir, ['init', '--quiet']);
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.agents'), { recursive: true });
  await mkdir(join(dir, 'openspec', 'changes', 'demo-change'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.js'), 'base\n');
  await writeFile(join(dir, 'package.json'), '{"name":"demo"}\n');
  await writeFile(join(dir, 'package-lock.json'), '{"lock":1}\n');
  await writeFile(join(dir, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(dir, 'probe.cjs'), "require('node:fs').appendFileSync('runs.txt','1'); console.log('UNIQUE_OUTPUT_TOKEN');\n");
  await writeFile(join(dir, 'slow.cjs'), 'setTimeout(() => {}, 8000);\n');
  await writeFile(join(dir, 'mutate.cjs'), "require('node:fs').appendFileSync('src/a.js','x');\n");
  await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [ ] 1.1 Sample\n  Files: src/a.js\n');
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), body);
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'base', '--quiet']);
  const ids = scopeIds(dir);
  await bindSession({ projectDir: dir, ids, change: 'demo-change', role: 'implementer', task: '1.1', session: 'sess-1' });
  return { dir, ids };
}

function verify(dir, ids, extra = {}) {
  return runVerification({
    projectDir: dir,
    ids,
    changeId: 'demo-change',
    sessionId: 'sess-1',
    agentId: null,
    taskId: '1.1',
    ...extra,
  });
}

async function headOf(dir) {
  return (await execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
}

const options = {
  timeoutMs: 30000,
  ignoredInputs: ['ignored.txt'],
  generatedOutputs: ['runs.txt', 'formatting.txt'],
  environmentNames: ['AOK_EVIDENCE_SAMPLE'],
};

test('evidence tracks real inputs, reuses stable runs, and skips progress-only edits', async () => {
  process.env.AOK_EVIDENCE_SAMPLE = 'one';
  const command = 'node probe.cjs';
  const { dir, ids } = await makeProject(yaml({ command, options }));
  try {
    const head = await headOf(dir);
    await writeFile(join(dir, 'src', 'b.js'), 'isolated\n');
    assert.equal(existsSync(join(dir, 'runs.txt')), false);
    const store = createStore({
      projectDir: dir,
      scope: { level: 'session', ...ids, changeId: 'demo-change', sessionId: 'sess-1', agentId: null, eventId: 'edit' },
      pruneIntervalMs: 10 ** 9,
    });
    await dispatch({
      schemaVersion: 1,
      kind: 'tool.after',
      eventId: 'edit-1',
      occurredAt: '2026-11-16T10:00:00.000Z',
      scope: { ...ids, changeId: 'demo-change', sessionId: 'sess-1', agentId: null },
      contextEpoch: null,
      source: { client: 'cursor', clientVersion: '3.22.12', runtime: 'test', nativeEvent: {} },
      data: { role: 'implementer', taskId: '1.1', files: ['src/b.js'], tool: { name: 'Edit', operation: 'write' }, outcome: { status: 'success' }, stopReason: null },
    }, {
      policies: builtinPolicies,
      store,
      config: { projectDir: dir, hooks: { enabled: true, mode: 'enforce', policies: { verification: { enabled: true, mode: 'enforce', options } } } },
    });
    assert.equal(existsSync(join(dir, 'runs.txt')), false);

    const first = await verify(dir, ids);
    assert.equal(first.reused, false);
    assert.equal(first.record.status, 'full');
    assert.equal(await readFile(join(dir, 'runs.txt'), 'utf8'), '1');
    assert.ok(first.reportLines.some((line) => line.includes('UNIQUE_OUTPUT_TOKEN')));
    const evidence = changeStore(dir, ids, 'demo-change');
    const latest = await evidence.read('verification-evidence', 'latest');
    const key = createHash('sha256').update(JSON.stringify({
      base: command,
      actual: command,
      scope: { mode: 'full', files: ['src/a.js'] },
    })).digest('hex').slice(0, 16);
    assert.deepEqual(await evidence.read('verification-evidence', key), latest);
    assert.equal(latest.status, 'full');
    assert.equal(JSON.stringify(latest).includes('UNIQUE_OUTPUT_TOKEN'), false);
    assert.equal(JSON.stringify(latest).includes(command), false);
    const audit = await evidence.log('audit');
    assert.equal(JSON.stringify(audit).includes(command), false);
    assert.equal(JSON.stringify(audit).includes('UNIQUE_OUTPUT_TOKEN'), false);

    const again = await verify(dir, ids);
    assert.equal(again.reused, true);
    assert.equal(await readFile(join(dir, 'runs.txt'), 'utf8'), '1');

    await writeFile(join(dir, 'src', 'a.js'), 'unstaged\n');
    assert.equal((await verify(dir, ids)).reused, false);
    await git(dir, ['add', 'src/a.js']);
    assert.equal((await verify(dir, ids)).reused, false);
    await writeFile(join(dir, 'src', 'c.js'), 'new\n');
    assert.equal((await verify(dir, ids)).reused, false);
    await writeFile(join(dir, 'package.json'), '{"name":"demo","changed":true}\n');
    assert.equal((await verify(dir, ids)).reused, false);
    await writeFile(join(dir, 'package-lock.json'), '{"lock":2}\n');
    assert.equal((await verify(dir, ids)).reused, false);
    await writeFile(join(dir, 'ignored.txt'), 'secret\n');
    assert.equal((await verify(dir, ids)).reused, false);
    await writeFile(join(dir, 'ignored.txt'), 'secret-2\n');
    assert.equal((await verify(dir, ids)).reused, false);
    process.env.AOK_EVIDENCE_SAMPLE = 'two';
    assert.equal((await verify(dir, ids)).reused, false);
    assert.equal((await verify(dir, ids)).reused, true);

    await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [x] 1.1 Sample\n  Files: src/a.js\n');
    await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'handoff.md'), 'progress\n');
    assert.equal((await verify(dir, ids)).reused, true);
    await writeFile(join(dir, 'openspec', 'changes', 'demo-change', 'tasks.md'), '- [x] 1.1 Sample edited\n  Files: src/a.js\n');
    assert.equal((await verify(dir, ids)).reused, false);
    assert.equal(await headOf(dir), head);
  } finally {
    delete process.env.AOK_EVIDENCE_SAMPLE;
    await rm(dir, { recursive: true, force: true });
  }
});

test('timeout, empty command and binding mismatch do not move HEAD or store command text', async () => {
  const slow = await makeProject(yaml({
    command: 'node slow.cjs',
    options: { ...options, timeoutMs: 200, environmentNames: [] },
  }));
  try {
    const head = await headOf(slow.dir);
    const timed = await verify(slow.dir, slow.ids);
    assert.equal(timed.record.status, 'timeout');
    assert.equal(timed.record.reusable, false);
    assert.equal(JSON.stringify(timed.record).includes('node slow.cjs'), false);
    assert.equal(await headOf(slow.dir), head);
  } finally {
    await rm(slow.dir, { recursive: true, force: true });
  }

  const empty = await makeProject(yaml({ command: '', options: { ...options, environmentNames: [] } }));
  try {
    const emptyHead = await headOf(empty.dir);
    const skipped = await verify(empty.dir, empty.ids);
    assert.equal(skipped.record.status, 'skipped-no-command');
    assert.equal(skipped.record.testsLine, 'tests: skipped (no test_command)');
    assert.equal(existsSync(join(empty.dir, 'runs.txt')), false);
    assert.equal(await headOf(empty.dir), emptyHead);
    const mismatch = await verify(empty.dir, empty.ids, { taskId: '9.9' });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.reason, 'binding-mismatch');
    assert.equal((await changeStore(empty.dir, empty.ids, 'demo-change').read('verification-evidence', 'latest')).status, 'skipped-no-command');
  } finally {
    await rm(empty.dir, { recursive: true, force: true });
  }
});

test('verification waits for a formatter lease and a concurrent write is not reusable', async () => {
  const checks = [{
    id: 'slow',
    executable: 'node',
    args: ['-e', "require('node:fs').writeFileSync('formatting.txt','1'); setTimeout(() => {}, 400)"],
    globs: ['src/*.js'],
    writablePaths: [],
  }];
  const plain = { ...options, environmentNames: [] };
  const { dir, ids } = await makeProject(yaml({ command: 'node probe.cjs', options: plain, checks }));
  try {
    const formatting = runScopedChecks({
      projectDir: dir,
      ids,
      binding: { changeId: 'demo-change', sessionId: 'sess-1', agentId: null, taskId: '1.1', files: ['src/a.js'] },
      paths: ['src/a.js'],
      commandId: 'slow',
    });
    const started = Date.now();
    while (!existsSync(join(dir, 'formatting.txt'))) {
      if (Date.now() - started > 2000) break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.equal(existsSync(join(dir, 'formatting.txt')), true);
    const verifying = verify(dir, ids);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(existsSync(join(dir, 'runs.txt')), false);
    await formatting;
    await verifying;
    assert.equal(await readFile(join(dir, 'runs.txt'), 'utf8'), '1');

    await writeFile(join(dir, '.agents', 'orchestrator.yaml'), yaml({ command: 'node mutate.cjs', options: plain, checks }));
    const raced = await verify(dir, ids);
    assert.equal(raced.record.unstable, true);
    assert.equal(raced.record.reusable, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
