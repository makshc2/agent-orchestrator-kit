import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { TOKEN_TTL_MS, bindSession, linkChild, resolveBinding, recordSeenSession, seenSessions, taskFiles } from '../bin/hooks/binding.js';
import { echoContext } from '../bin/hooks/adapters/shared.js';

const run = promisify(execFile);
const CLI = join(process.cwd(), 'bin', 'agent-orchestrator.js');
const ids = { repoId: 'r', worktreeId: 'w' };

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-bind-'));
  await run('git', ['init', '--quiet', dir]);
  for (const name of ['demo', 'other']) {
    await mkdir(join(dir, 'openspec', 'changes', name), { recursive: true });
    await writeFile(join(dir, 'openspec', 'changes', name, 'tasks.md'), [
      '## 1. Work', '', '- [ ] 1.1 Build it', '  Files: src/a.js, new file: src/b.vue', '  Do: x', '',
      '- [ ] 1.2 Test it', '  Files: test/a.test.js', '',
    ].join('\n'));
  }
  return dir;
}

test('explicit binding records change/role/task/session and contracted Files', async () => {
  const dir = await makeProject();
  const { binding, token, expiresAt } = await bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '1.1', session: 'sess-1' });
  assert.deepEqual(binding.files, ['src/a.js', 'src/b.vue']);
  assert.match(token, /^aok-bind-[0-9a-f]{32}$/);
  assert.ok(Date.parse(expiresAt) - Date.now() <= TOKEN_TTL_MS);
  assert.equal((await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1' })).changeId, 'demo');
  assert.deepEqual(taskFiles(dir, 'demo', '1.2'), ['test/a.test.js']);
  await rm(dir, { recursive: true, force: true });
});

test('ambiguous or invalid input is rejected and nothing is inferred by recency', async () => {
  const dir = await makeProject();
  await bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '1.1', session: 'sess-1' });
  await assert.rejects(bindSession({ projectDir: dir, ids, change: 'missing', role: 'implementer', task: '1.1', session: 's' }), /does not exist/);
  await assert.rejects(bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '9.9', session: 's' }), /not found/);
  await assert.rejects(bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '1.1' }), /--session/);
  assert.equal(await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-2' }), null);
  assert.equal(await resolveBinding({ projectDir: dir, ids, sessionId: null }), null);
  await rm(dir, { recursive: true, force: true });
});

test('children never inherit without a token; token links once and expires', async () => {
  const dir = await makeProject();
  const { token } = await bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '1.1', session: 'sess-1' });
  assert.equal(await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1', agentId: 'child-1' }), null);
  const parentUse = await linkChild({ projectDir: dir, ids, token, session: 'sess-1' });
  assert.equal(parentUse.ok, false);
  const linked = await linkChild({ projectDir: dir, ids, token, session: 'sess-1', agent: 'child-1', role: 'test-writer' });
  assert.equal(linked.ok, true);
  const child = await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1', agentId: 'child-1' });
  assert.equal(child.role, 'test-writer');
  assert.equal(child.via, 'token');
  assert.equal(child.parentSessionId, 'sess-1');
  assert.equal((await linkChild({ projectDir: dir, ids, token, session: 'sess-1', agent: 'child-2' })).reason, 'token already used');
  assert.equal(await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1', agentId: 'child-2' }), null);
  const fresh = await bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '1.1', session: 'sess-1' });
  const late = await linkChild({ projectDir: dir, ids, token: fresh.token, session: 'sess-9', now: Date.now() + TOKEN_TTL_MS + 1 });
  assert.equal(late.reason, 'token expired');
  assert.equal((await linkChild({ projectDir: dir, ids, token: 'nope', session: 's' })).ok, false);
  await rm(dir, { recursive: true, force: true });
});

test('parent and child bindings stay isolated', async () => {
  const dir = await makeProject();
  const { token } = await bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '1.1', session: 'sess-1' });
  await linkChild({ projectDir: dir, ids, token, session: 'sess-1', agent: 'child-1' });
  await bindSession({ projectDir: dir, ids, change: 'demo', role: 'implementer', task: '1.2', session: 'sess-1', agent: 'child-1' });
  assert.equal((await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1' })).task, '1.1');
  assert.equal((await resolveBinding({ projectDir: dir, ids, sessionId: 'sess-1', agentId: 'child-1' })).task, '1.2');
  await rm(dir, { recursive: true, force: true });
});

test('native ids are echoed in start context and listed (advisory) for status', async () => {
  const dir = await makeProject();
  assert.match(echoContext('abc-123', 'Claude session_id'), /native session id: abc-123/);
  assert.equal(echoContext(null, 'x'), '');
  await recordSeenSession({ projectDir: dir, ids, client: 'claude', sessionId: 'abc-123' });
  await recordSeenSession({ projectDir: dir, ids, client: 'cursor', sessionId: 'conv-1' });
  assert.deepEqual((await seenSessions({ projectDir: dir, ids })).map((s) => s.sessionId).sort(), ['abc-123', 'conv-1']);
  await rm(dir, { recursive: true, force: true });
});

test('CLI bind prints a token and child --token links; snapshot needs a binding', async () => {
  const dir = await makeProject();
  const bound = JSON.parse((await run('node', [CLI, 'hooks', 'bind', '--change', 'demo', '--role', 'implementer', '--task', '1.1', '--session', 'sess-1', '--json'], { cwd: dir })).stdout);
  const child = JSON.parse((await run('node', [CLI, 'hooks', 'bind', '--token', bound.token, '--session', 'sess-1', '--agent', 'kid', '--json'], { cwd: dir })).stdout);
  assert.equal(child.ok, true);
  await run('node', [CLI, 'hooks', 'snapshot', '--session', 'sess-1'], { cwd: dir });
  await assert.rejects(run('node', [CLI, 'hooks', 'snapshot', '--session', 'nobody'], { cwd: dir }));
  await rm(dir, { recursive: true, force: true });
});

test('manual fallback: apply twins share one byte-identical parent-delivery block', async () => {
  const block = (text) => {
    const start = text.indexOf('<!-- aok-hooks:parent-delivery -->');
    const end = text.indexOf('<!-- /aok-hooks:parent-delivery -->');
    assert.ok(start >= 0 && end > start, 'parent-delivery block present');
    return text.slice(start, end);
  };
  const command = await readFile('templates/.agents/commands/opsx-apply.md', 'utf8');
  const skill = await readFile('templates/.agents/skills/openspec-apply-change/SKILL.md', 'utf8');
  assert.equal(block(command), block(skill));
  assert.match(block(command), /manual(ly)? Read/i);
  assert.match(block(command), /hooks bind/);
  assert.ok(!(await readFile('templates/.agents/commands/opsx-quick.md', 'utf8')).includes('aok-hooks'));
  assert.ok(!/checkpoint/i.test(await readFile('templates/.agents/rules/session-handoff.mdc', 'utf8')));
  for (const writer of ['code-writer', 'test-writer']) {
    const body = await readFile(`templates/.agents/subagents/${writer}.md`, 'utf8');
    assert.match(body, /injected \(paths\)/);
    assert.match(body, /binding token/);
  }
});

test('generation fixtures carry the same writer audit and binding guidance in all four profiles', async () => {
  for (const profile of ['generic', 'mvp', 'node', 'vue3']) {
    const dir = await mkdtemp(join(tmpdir(), `aok-bind-gen-${profile}-`));
    try {
      await run('node', [CLI, 'init', '--profile', profile, '--name', 'Gen', '--lang', 'en'], { cwd: dir });
      await run('node', [CLI, 'sync', '--target', 'all'], { cwd: dir });
      for (const rel of ['.claude/agents/code-writer.md', '.cursor/agents/test-writer.md', '.agents/skills/subagent-code-writer/SKILL.md', '.agents/skills/subagent-test-writer/SKILL.md']) {
        const body = await readFile(join(dir, rel), 'utf8');
        assert.match(body, /\*\*Skills:\*\* read \(paths\), injected \(paths\), or missing \(paths\)/, `${profile} ${rel}`);
        assert.match(body, /hooks bind --token/, `${profile} ${rel}`);
        assert.match(body, /MANDATORY/, `${profile} ${rel}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
