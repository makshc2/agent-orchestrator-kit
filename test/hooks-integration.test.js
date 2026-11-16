import { test } from 'node:test';
import assert from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { dispatch } from '../bin/hooks/index.js';

const run = promisify(execFile);
const KIT = process.cwd();
const CLI = join(KIT, 'bin', 'agent-orchestrator.js');
const LAUNCHER = join(KIT, 'templates', 'scripts', 'agent-hook-launcher.cjs');
const SEMANTIC = ['tasks.md', 'handoff.md', 'decisions.md', 'metrics.json'];

async function consumer(profile) {
  const dir = await mkdtemp(join(tmpdir(), `aok-int-${profile}-`));
  await run('git', ['init', '--quiet', dir]);
  await run('node', [CLI, 'init', '--profile', profile, '--name', 'Int', '--lang', 'en'], { cwd: dir });
  const orch = join(dir, '.agents', 'orchestrator.yaml');
  await writeFile(orch, (await readFile(orch, 'utf8')).replace(/^hooks:\n  enabled: false/m, 'hooks:\n  enabled: true'));
  const change = join(dir, 'openspec', 'changes', 'demo');
  await mkdir(change, { recursive: true });
  await writeFile(join(change, 'tasks.md'), '## 1. Work\n\n- [ ] 1.1 Build\n  Files: src/App.vue, src/stores/cart.js\n');
  await writeFile(join(change, 'handoff.md'), '# Session Handoff\n');
  await writeFile(join(change, 'decisions.md'), '# Decisions\n');
  await writeFile(join(change, 'metrics.json'), '{"pending":{"x":1}}\n');
  if (profile === 'vue3') {
    // Stack skills are installed separately in consumers; simulate an installed vue-core.
    await mkdir(join(dir, '.agents', 'skills', 'vue-core'), { recursive: true });
    await writeFile(join(dir, '.agents', 'skills', 'vue-core', 'SKILL.md'), '# vue-core\n');
  }
  await run('git', ['-C', dir, 'add', '-A']);
  await run('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  return { dir, change };
}

const digests = async (change) => Object.fromEntries(await Promise.all(SEMANTIC.map(async (f) => [f, createHash('sha256').update(await readFile(join(change, f))).digest('hex')])));

// Executes the packaged launcher offline (no npx, no network) exactly as a client would.
function launch(dir, payload, env = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [LAUNCHER], { cwd: dir, env: { ...process.env, AOK_HOOK_RUNTIME: KIT, npm_config_offline: 'true', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr, elapsed: Date.now() - started }));
    child.stdin.on('error', () => {}); // the launcher closes stdin early on oversized input
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}

const claude = (dir, name, extra = {}) => ({ session_id: 'sess-int', cwd: dir, hook_event_name: name, ...extra });

for (const profile of ['generic', 'mvp', 'node', 'vue3']) {
  test(`${profile}: enable, bind, deliver, change, snapshot, resume, audit, update, disable`, async () => {
    const { dir, change } = await consumer(profile);
    try {
      const before = await digests(change);
      await run('node', [CLI, 'hooks', 'enable', '--client', 'claude'], { cwd: dir });
      const start = await launch(dir, claude(dir, 'SessionStart', { source: 'startup' }));
      assert.equal(start.code, 0);
      assert.match(start.stdout, /native session id: sess-int/);
      const bound = JSON.parse((await run('node', [CLI, 'hooks', 'bind', '--change', 'demo', '--role', 'implementer', '--task', '1.1', '--session', 'sess-int', '--json'], { cwd: dir })).stdout);
      const resumed = await launch(dir, claude(dir, 'SessionStart', { source: 'resume' }));
      const context = JSON.parse(resumed.stdout).hookSpecificOutput.additionalContext;
      assert.match(context, /FACTS|GAPS/, 'metrics-neutral briefing delivered');
      if (profile === 'vue3') assert.match(context, /vue-core\/SKILL\.md/);
      await writeFile(join(dir, 'src.js'), 'x\n');
      await launch(dir, claude(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: join(dir, 'src.js') }, tool_use_id: 't1' }));
      const child = await launch(dir, claude(dir, 'SubagentStart', { agent_id: 'kid', agent_type: 'code-writer', prompt: `token ${bound.token}` }));
      assert.equal(child.code, 0);
      await launch(dir, claude(dir, 'SubagentStop', { agent_id: 'kid' }));
      await run('node', [CLI, 'hooks', 'snapshot', '--session', 'sess-int'], { cwd: dir });
      const status = JSON.parse((await run('node', [CLI, 'hooks', 'status', '--json'], { cwd: dir })).stdout);
      assert.ok(status.sessions.some((s) => s.sessionId === 'sess-int'));
      const stateRoot = join(dir, '.git', 'aok-hooks');
      assert.ok(existsSync(stateRoot), 'local audit state exists');
      await run('node', [CLI, 'update'], { cwd: dir }).catch(() => {});
      await run('node', [CLI, 'hooks', 'disable', '--client', 'claude'], { cwd: dir });
      assert.deepEqual(await digests(change), before, 'semantic files and pending metrics untouched');
      assert.ok(!(await readdir(change)).includes('checkpoint.json'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('two concurrent worktrees keep separate bindings and state', async () => {
  const a = await consumer('generic');
  const b = await consumer('generic');
  try {
    await run('node', [CLI, 'hooks', 'bind', '--change', 'demo', '--role', 'implementer', '--task', '1.1', '--session', 'sess-a'], { cwd: a.dir });
    const results = await Promise.all([
      launch(a.dir, claude(a.dir, 'SessionStart', { source: 'resume', session_id: 'sess-a' })),
      launch(b.dir, claude(b.dir, 'SessionStart', { source: 'resume', session_id: 'sess-a' })),
    ]);
    assert.ok(results.every((r) => r.code === 0));
    assert.match(results[0].stdout, /FACTS|GAPS/);
    assert.doesNotMatch(results[1].stdout, /FACTS|GAPS/, 'the other worktree cannot inherit the binding');
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test('oversized and malformed input never block and dispatch respects its deadline', async () => {
  const { dir } = await consumer('generic');
  try {
    const huge = await launch(dir, JSON.stringify({ hook_event_name: 'SessionStart', pad: 'x'.repeat(300 * 1024) }));
    assert.equal(huge.code, 0);
    assert.match(huge.stderr, /manual workflow/);
    const garbage = await launch(dir, '{not json', { AOK_HOOK_CLIENT: 'claude' });
    assert.equal(garbage.code, 0);
    const slow = { id: 'slow', evaluate: () => new Promise(() => {}) };
    const started = Date.now();
    const result = await dispatch({ schemaVersion: 1, kind: 'session.start', eventId: 'e', scope: {}, data: {} }, { policies: [slow] });
    assert.ok(Date.now() - started < 1500 + 1500, 'generous margin around the 1500 ms deadline');
    assert.ok(result.findings.some((f) => f.code === 'policy.timeout'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed runtime config is treated as disabled', async () => {
  const { dir } = await consumer('generic');
  try {
    await writeFile(join(dir, '.agents', 'orchestrator.yaml'), 'hooks:\n  enabled: maybe\n  :::\n');
    const r = await launch(dir, claude(dir, 'SessionStart', { source: 'startup' }));
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /SKILL\.md|FACTS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unsupported cloud runtime and unlinked subagents fall back to the manual workflow', async () => {
  const { dir } = await consumer('vue3');
  try {
    await run('node', [CLI, 'hooks', 'bind', '--change', 'demo', '--role', 'implementer', '--task', '1.1', '--session', 'sess-int'], { cwd: dir });
    const kid = await launch(dir, claude(dir, 'SubagentStart', { agent_id: 'kid-2', agent_type: 'code-writer' }));
    assert.equal(kid.code, 0);
    assert.doesNotMatch(kid.stdout, /SKILL\.md/, 'no parent inheritance without a token');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('npm pack ships the hook runtime, templates and docs', async () => {
  const { stdout } = await run('npm', ['pack', '--dry-run', '--json'], { cwd: KIT, maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  const files = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]).files.map((f) => f.path);
  for (const path of ['bin/hooks/index.js', 'bin/hooks/binding.js', 'bin/hooks/policies/context.js', 'bin/hooks/policies/recovery.js', 'bin/hooks/adapters/claude.js', 'templates/scripts/agent-hook-launcher.cjs', 'templates/hook-skill-scopes.json', 'docs/agent-hooks.md']) {
    assert.ok(files.includes(path), `${path} packed`);
  }
});
