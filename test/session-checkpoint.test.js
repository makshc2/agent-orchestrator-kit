import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { readCheckpoint, writeFileAtomic } from '../bin/session-checkpoint.js';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;

const HANDOFF = [
  '# Handoff',
  '',
  '## Closed role',
  'Implementer',
  '',
  '## Next command',
  '/opsx:apply x',
  '',
  '## Next role',
  'Implementer',
  '',
  '## Done',
  'ok',
  '',
  '## Attach',
  '- a',
  '',
].join('\n');

function tasksMd(done, total) {
  const lines = [];
  for (let i = 1; i <= total; i += 1) {
    lines.push(`- [${i <= done ? 'x' : ' '}] ${Math.ceil(i / 3)}.${((i - 1) % 3) + 1} task ${i}`);
    lines.push('  Files: src/a.js');
  }
  return `${lines.join('\n')}\n`;
}

function setup(files = {}, changeName = 'x') {
  const dir = mkdtempSync(join(tmpdir(), 'aok-checkpoint-'));
  const home = join(dir, '.home');
  mkdirSync(home, { recursive: true });
  const changeDir = join(dir, 'openspec', 'changes', changeName);
  mkdirSync(changeDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(changeDir, name), content);
  return { dir, changeDir, home, name: changeName };
}

function run(ctx, args) {
  const res = spawnSync('node', [CLI, ...args], {
    cwd: ctx.dir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: ctx.home,
      XDG_CONFIG_HOME: join(ctx.home, 'cfg'),
      XDG_DATA_HOME: join(ctx.home, 'data'),
    },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}`.replace(ANSI_RE, '') };
}

const checkpointPath = (ctx) => join(ctx.changeDir, 'checkpoint.json');
const tmpPath = (ctx) => join(ctx.changeDir, 'checkpoint.json.tmp');
const readRecord = (ctx) => JSON.parse(readFileSync(checkpointPath(ctx), 'utf-8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const age = (p, secondsAgo) => {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(p, t, t);
};

function gitInit(dir) {
  const opts = { cwd: dir, encoding: 'utf-8' };
  spawnSync('git', ['init', '-q'], opts);
  spawnSync('git', ['config', 'user.name', 'T'], opts);
  spawnSync('git', ['config', 'user.email', 't@example.com'], opts);
}


const cleanup = (ctx) => rmSync(ctx.dir, { recursive: true, force: true });

test('checkpoint after a finished task writes a valid record', () => {
  const ctx = setup({ 'tasks.md': tasksMd(3, 9) });
  try {
    const res = run(ctx, ['checkpoint', 'x', '--task', '2.1', '--done', 'finished 2.1', '--next', 'start 2.2']);
    assert.equal(res.status, 0, res.out);
    const record = readRecord(ctx);
    assert.equal(record.seq, 1);
    assert.equal(record.task, '2.1');
    assert.deepEqual(record.snapshot.tasks, { done: 3, total: 9 });
    assert.equal(existsSync(join(ctx.changeDir, 'handoff.md')), false);
    assert.equal(existsSync(join(ctx.changeDir, 'decisions.md')), false);
    assert.equal(existsSync(join(ctx.home, '.cursor', 'memory.json')), false);
    for (const line of res.out.split('\n')) assert.ok(!line.startsWith('/opsx:'), line);
    assert.equal(readCheckpoint(ctx.changeDir, 'x').state, 'valid');
  } finally {
    cleanup(ctx);
  }
});

test('checkpoint records the review verdict', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4), 'review.md': '# Review\n\nVerdict: APPROVE\n' });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    assert.equal(readRecord(ctx).snapshot.review, 'APPROVE');
  } finally {
    cleanup(ctx);
  }
});

test('checkpoint rejects an unknown or ambiguous change', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    const missing = run(ctx, ['checkpoint', 'nope', '--done', 'a']);
    assert.equal(missing.status, 1, missing.out);
    assert.equal(existsSync(join(ctx.dir, 'openspec', 'changes', 'nope', 'checkpoint.json')), false);

    const other = join(ctx.dir, 'openspec', 'changes', 'y');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'tasks.md'), tasksMd(1, 4));
    const ambiguous = run(ctx, ['checkpoint', '--done', 'a']);
    assert.equal(ambiguous.status, 1, ambiguous.out);
    assert.equal(existsSync(checkpointPath(ctx)), false);
    assert.equal(existsSync(join(other, 'checkpoint.json')), false);
  } finally {
    cleanup(ctx);
  }
});

test('checkpoint never writes decisions.md', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4), 'decisions.md': '# Decisions\n\n- 2026-01-01 old: text\n' });
  try {
    const decisions = join(ctx.changeDir, 'decisions.md');
    age(decisions, 600);
    const before = { sha: sha(decisions), mtime: statSync(decisions).mtimeMs };
    const res = run(ctx, ['checkpoint', 'x', '--decision', '- retry: retain history']);
    assert.equal(res.status, 0, res.out);
    assert.equal(sha(decisions), before.sha);
    assert.equal(statSync(decisions).mtimeMs, before.mtime);
    assert.deepEqual(readRecord(ctx).decisions, ['- retry: retain history']);

    const bare = setup({ 'tasks.md': tasksMd(1, 4) });
    try {
      assert.equal(run(bare, ['checkpoint', 'x', '--decision', '- retry: retain history']).status, 0);
      assert.equal(existsSync(join(bare.changeDir, 'decisions.md')), false);
      for (const value of ['none', '- None']) {
        const bad = setup({ 'tasks.md': tasksMd(1, 4) });
        try {
          const out = run(bad, ['checkpoint', 'x', '--decision', value]);
          assert.equal(out.status, 1, `${value}: ${out.out}`);
          assert.equal(existsSync(checkpointPath(bad)), false);
        } finally {
          cleanup(bad);
        }
      }
    } finally {
      cleanup(bare);
    }
  } finally {
    cleanup(ctx);
  }
});

test('persist after a checkpoint records the decision once', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--decision', 'cache: use sha256']).status, 0);
    writeFileSync(join(ctx.changeDir, 'handoff.md'), `${HANDOFF}\n## Decisions\n- cache: use sha256\n`);
    const persist = run(ctx, ['handoff', 'x', '--no-metrics']);
    assert.equal(persist.status, 0, persist.out);
    const decisions = readFileSync(join(ctx.changeDir, 'decisions.md'), 'utf-8');
    const hits = decisions.split('\n').filter((l) => l.includes('cache: use sha256'));
    assert.equal(hits.length, 1, decisions);
  } finally {
    cleanup(ctx);
  }
});

test('decisions accumulate until persisted', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--decision', 'cache: use sha256']).status, 0);
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'more']).status, 0);
    assert.deepEqual(readRecord(ctx).decisions, ['cache: use sha256']);

    writeFileSync(join(ctx.changeDir, 'handoff.md'), `${HANDOFF}\n## Decisions\n- cache: use sha256\n`);
    assert.equal(run(ctx, ['handoff', 'x', '--no-metrics']).status, 0);
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'after persist']).status, 0);
    assert.deepEqual(readRecord(ctx).decisions, []);

    const many = setup({ 'tasks.md': tasksMd(1, 4) });
    try {
      let n = 0;
      for (let call = 0; call < 3; call += 1) {
        const args = ['checkpoint', 'x'];
        for (let i = 0; i < 10; i += 1) {
          n += 1;
          args.push('--decision', `topic${n}: text ${n}`);
        }
        const out = run(many, args);
        assert.equal(out.status, 0, out.out);
      }
      assert.equal(readRecord(many).decisions.length, 30);
      const before = { sha: sha(checkpointPath(many)), seq: readRecord(many).seq };
      const over = run(many, ['checkpoint', 'x', '--decision', 'topic31: text 31']);
      assert.equal(over.status, 1, over.out);
      assert.equal(sha(checkpointPath(many)), before.sha);
      assert.equal(readRecord(many).seq, before.seq);
    } finally {
      cleanup(many);
    }
  } finally {
    cleanup(ctx);
  }
});

test('omitted fields clear earlier values', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--blocked', 'waiting', '--next', 'n', '--task', '2.1']).status, 0);
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'z']).status, 0);
    const record = readRecord(ctx);
    assert.equal(record.blocked, '');
    assert.equal(record.next, '');
    assert.equal(record.task, null);
    assert.equal(record.done, 'z');
    assert.equal(record.seq, 2);
  } finally {
    cleanup(ctx);
  }
});

test('repeated checkpoint is a no-op', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    age(checkpointPath(ctx), 600);
    const before = { sha: sha(checkpointPath(ctx)), mtime: statSync(checkpointPath(ctx)).mtimeMs };
    const second = run(ctx, ['checkpoint', 'x', '--done', 'a']);
    assert.equal(second.status, 0, second.out);
    assert.match(second.out, /checkpoint unchanged \(seq 1\)/);
    assert.equal(sha(checkpointPath(ctx)), before.sha);
    assert.equal(statSync(checkpointPath(ctx)).mtimeMs, before.mtime);
  } finally {
    cleanup(ctx);
  }
});

test('state change bumps seq', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    writeFileSync(join(ctx.changeDir, 'tasks.md'), tasksMd(2, 4));
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    const record = readRecord(ctx);
    assert.equal(record.seq, 2);
    assert.deepEqual(record.snapshot.tasks, { done: 2, total: 4 });
  } finally {
    cleanup(ctx);
  }
});

test('leftover temp file is removed on a changed state', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    const previousSeq = readRecord(ctx).seq;
    writeFileSync(tmpPath(ctx), '{"half":');
    const res = run(ctx, ['checkpoint', 'x', '--done', 'b']);
    assert.equal(res.status, 0, res.out);
    assert.equal(existsSync(tmpPath(ctx)), false);
    assert.equal(readRecord(ctx).seq, previousSeq + 1);
  } finally {
    cleanup(ctx);
  }
});

test('leftover temp file is removed on an unchanged state', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    age(checkpointPath(ctx), 600);
    const before = {
      sha: sha(checkpointPath(ctx)),
      mtime: statSync(checkpointPath(ctx)).mtimeMs,
      seq: readRecord(ctx).seq,
    };
    writeFileSync(tmpPath(ctx), '{"half":');
    const res = run(ctx, ['checkpoint', 'x', '--done', 'a']);
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /checkpoint unchanged/);
    assert.equal(existsSync(tmpPath(ctx)), false);
    assert.equal(sha(checkpointPath(ctx)), before.sha);
    assert.equal(statSync(checkpointPath(ctx)).mtimeMs, before.mtime);
    assert.equal(readRecord(ctx).seq, before.seq);
  } finally {
    cleanup(ctx);
  }
});

test('rename failure keeps the last good file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-atomic-'));
  try {
    const target = join(dir, 'checkpoint.json');
    writeFileSync(target, 'last good\n');
    const before = sha(target);
    assert.throws(
      () =>
        writeFileAtomic(target, 'new text\n', {
          renameSync: () => {
            throw new Error('rename failed');
          },
        }),
      /rename failed/,
    );
    assert.equal(sha(target), before);
    assert.equal(readFileSync(target, 'utf-8'), 'last good\n');
    assert.equal(existsSync(`${target}.tmp`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('torn and edited files are corrupt', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    const good = readFileSync(checkpointPath(ctx), 'utf-8');

    truncateSync(checkpointPath(ctx), Math.floor(good.length / 2));
    assert.deepEqual(readCheckpoint(ctx.changeDir, 'x'), { state: 'corrupt', reason: 'invalid JSON' });

    const edited = JSON.parse(good);
    edited.done = 'tampered';
    writeFileSync(checkpointPath(ctx), JSON.stringify(edited, null, 2));
    assert.deepEqual(readCheckpoint(ctx.changeDir, 'x'), { state: 'corrupt', reason: 'digest mismatch' });

    const wrongVersion = JSON.parse(good);
    wrongVersion.version = 2;
    writeFileSync(checkpointPath(ctx), JSON.stringify(wrongVersion, null, 2));
    assert.equal(readCheckpoint(ctx.changeDir, 'x').state, 'corrupt');

    writeFileSync(checkpointPath(ctx), good);
    assert.equal(readCheckpoint(ctx.changeDir, 'other').state, 'corrupt');

    rmSync(checkpointPath(ctx), { force: true });
    mkdirSync(checkpointPath(ctx));
    let result;
    assert.doesNotThrow(() => {
      result = readCheckpoint(ctx.changeDir, 'x');
    });
    assert.equal(result.state, 'corrupt');
  } finally {
    cleanup(ctx);
  }
});

test('corrupt checkpoint is replaced', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
  try {
    writeFileSync(checkpointPath(ctx), '{ not json');
    const res = run(ctx, ['checkpoint', 'x', '--done', 'a']);
    assert.equal(res.status, 0, res.out);
    assert.equal(readRecord(ctx).seq, 1);
    assert.match(res.out, /unreadable \(invalid JSON\)/);
  } finally {
    cleanup(ctx);
  }
});

test('metrics.json is untouched', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4), 'handoff.md': HANDOFF });
  try {
    const restore = run(ctx, ['handoff', 'x', '--restore', '--platform', 'claude']);
    assert.equal(restore.status, 0, restore.out);
    const metrics = join(ctx.changeDir, 'metrics.json');
    assert.ok(JSON.parse(readFileSync(metrics, 'utf-8')).pending, 'restore opens a pending session');
    age(metrics, 600);
    const before = { sha: sha(metrics), mtime: statSync(metrics).mtimeMs };
    for (const done of ['a', 'b', 'c']) {
      assert.equal(run(ctx, ['checkpoint', 'x', '--done', done]).status, 0);
      assert.equal(sha(metrics), before.sha);
      assert.equal(statSync(metrics).mtimeMs, before.mtime);
    }

    const bare = setup({ 'tasks.md': tasksMd(1, 4) });
    try {
      assert.equal(run(bare, ['checkpoint', 'x', '--done', 'a']).status, 0);
      assert.equal(existsSync(join(bare.changeDir, 'metrics.json')), false);
    } finally {
      cleanup(bare);
    }
  } finally {
    cleanup(ctx);
  }
});

test('persist after restore and checkpoints records one session', () => {
  const sessions = [];
  for (const withCheckpoints of [true, false]) {
    const ctx = setup({ 'tasks.md': tasksMd(1, 4), 'handoff.md': HANDOFF });
    try {
      assert.equal(run(ctx, ['handoff', 'x', '--restore', '--platform', 'claude']).status, 0);
      if (withCheckpoints) {
        assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
        assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'b']).status, 0);
      }
      const persist = run(ctx, ['handoff', 'x', '--platform', 'claude']);
      assert.equal(persist.status, 0, persist.out);
      const metrics = JSON.parse(readFileSync(join(ctx.changeDir, 'metrics.json'), 'utf-8'));
      assert.equal(metrics.sessions.length, 1, JSON.stringify(metrics));
      assert.equal(metrics.pending, null);
      sessions.push(metrics.sessions.length);
    } finally {
      cleanup(ctx);
    }
  }
  assert.deepEqual(sessions, [1, 1]);
});

test('input bounds', () => {
  const cases = [
    { args: ['--done', 'x'.repeat(501)], rule: /longer than 500/ },
    { args: ['--decision', 'a: one\ntwo'], rule: /one line/ },
    {
      args: Array.from({ length: 11 }, (_, i) => ['--decision', `t${i}: v`]).flat(),
      rule: /at most 10 --decision/,
    },
    { args: ['--role', 'Wizard'], rule: /--role must be one of/ },
    { args: ['--task', 'abc'], rule: /--task must be a task id/ },
  ];
  for (const { args, rule } of cases) {
    const ctx = setup({ 'tasks.md': tasksMd(1, 4) });
    try {
      writeFileSync(tmpPath(ctx), '{"half":');
      const res = run(ctx, ['checkpoint', 'x', ...args]);
      assert.equal(res.status, 1, `${args[0]}: ${res.out}`);
      assert.match(res.out, rule);
      assert.equal(existsSync(checkpointPath(ctx)), false);
      assert.equal(existsSync(tmpPath(ctx)), true, 'a failed validation does not clean the temp file');
    } finally {
      cleanup(ctx);
    }
  }
});

test('old change without a checkpoint is unaffected', () => {
  const outputs = [];
  for (const withCheckpoint of [true, false]) {
    const ctx = setup({
      'tasks.md': tasksMd(4, 4),
      'handoff.md': HANDOFF,
      'review.md': '# Review\n\nVerdict: APPROVE\n',
      'proposal.md': '# p\n',
    });
    try {
      if (withCheckpoint) writeFileSync(checkpointPath(ctx), '{ not json');
      assert.equal(run(ctx, ['handoff', 'x', '--no-metrics']).status, 0);
      const status = run(ctx, ['status']);
      const gate = run(ctx, ['gate-check', '--review', 'x']);
      outputs.push([status.out.split(ctx.dir).join('<DIR>'), gate.out.split(ctx.dir).join('<DIR>')]);
      if (!withCheckpoint) assert.equal(existsSync(checkpointPath(ctx)), false);
    } finally {
      cleanup(ctx);
    }
  }
  assert.equal(outputs[0][0], outputs[1][0]);
  assert.equal(outputs[0][1], outputs[1][1]);
});

test('clean restore ignores a valid checkpoint', () => {
  const outputs = [];
  for (const withCheckpoint of [false, true]) {
    const ctx = setup({ 'tasks.md': tasksMd(1, 4), 'handoff.md': HANDOFF });
    try {
      if (withCheckpoint) {
        assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
      }
      age(join(ctx.changeDir, 'tasks.md'), 600);
      if (withCheckpoint) age(checkpointPath(ctx), 600);
      const res = run(ctx, ['handoff', 'x', '--restore', '--no-metrics', '--platform', 'claude']);
      assert.equal(res.status, 0, res.out);
      outputs.push(res.out.split(ctx.dir).join('<DIR>'));
    } finally {
      cleanup(ctx);
    }
  }
  assert.equal(outputs[0], outputs[1]);
});

test('checkpoint storage is not ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-ignore-'));
  try {
    gitInit(dir);
    cpSync(join(KIT_ROOT, '.gitignore'), join(dir, '.gitignore'));
    mkdirSync(join(dir, 'openspec', 'changes', 'x'), { recursive: true });
    writeFileSync(join(dir, 'openspec', 'changes', 'x', 'checkpoint.json'), '{}\n');
    const res = spawnSync('git', ['check-ignore', 'openspec/changes/x/checkpoint.json'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.equal(res.status, 1, `checkpoint.json must stay git-tracked: ${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkpoint alone does not make handoff.md stale', () => {
  const ctx = setup({ 'tasks.md': tasksMd(1, 4), 'handoff.md': HANDOFF });
  try {
    age(join(ctx.changeDir, 'tasks.md'), 600);
    assert.equal(run(ctx, ['checkpoint', 'x', '--done', 'a']).status, 0);
    const res = run(ctx, ['handoff', 'x', '--restore', '--no-metrics', '--platform', 'claude']);
    assert.equal(res.status, 0, res.out);
    assert.doesNotMatch(res.out, /handoff\.md is older than the change artifacts/);
  } finally {
    cleanup(ctx);
  }
});

test('checkpoint help lists the options', () => {
  const res = spawnSync('node', [CLI, 'checkpoint', '--help'], { encoding: 'utf-8' });
  const out = `${res.stdout}${res.stderr}`.replace(ANSI_RE, '');
  for (const flag of ['--task', '--role', '--done', '--blocked', '--next', '--decision']) {
    assert.ok(out.includes(flag), `${flag} missing from help: ${out}`);
  }
});
