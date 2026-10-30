import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;
const HANDOFF = '# Handoff\n\n## Closed role\nExplorer\n\n## Next command\n/opsx:propose x\n\n## Next role\nArchitect\n\n## Done\nok\n\n## Attach\n- a\n';

function setup(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aok-unpersisted-'));
  const home = join(dir, '.home');
  mkdirSync(home, { recursive: true });
  const changeDir = join(dir, 'openspec/changes/x');
  mkdirSync(changeDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(changeDir, name), content);
  return { dir, changeDir, home };
}

function restore({ dir, home }, extra = []) {
  const res = spawnSync('node', [CLI, 'handoff', 'x', '--restore', '--platform', 'claude', ...extra], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'cfg'), XDG_DATA_HOME: join(home, 'data') },
  });
  return { status: res.status, out: (res.stdout + res.stderr).replace(ANSI_RE, '') };
}

function age(path, secondsAgo) {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(path, t, t);
}

test('restore warns when metrics.json still has an open pending session', () => {
  const ctx = setup({ 'handoff.md': HANDOFF });
  try {
    const first = restore(ctx);
    assert.equal(first.status, 0, first.out);
    assert.doesNotMatch(first.out, /UNPERSISTED SESSION/);
    const metrics = JSON.parse(readFileSync(join(ctx.changeDir, 'metrics.json'), 'utf-8'));
    assert.ok(metrics.pending, 'first restore opens a pending session');
    const second = restore(ctx);
    assert.equal(second.status, 0, second.out);
    assert.match(second.out, /UNPERSISTED SESSION/);
    assert.match(second.out, /previous session \(Architect, started /);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test('restore warns about artifacts without handoff.md even when it cannot brief', () => {
  const ctx = setup({ 'proposal.md': '# p\n' });
  try {
    const res = restore(ctx);
    assert.equal(res.status, 1, res.out);
    assert.match(res.out, /UNPERSISTED SESSION/);
    assert.match(res.out, /no handoff\.md/);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test('restore warns when handoff.md is older than the artifacts', () => {
  const ctx = setup({ 'handoff.md': HANDOFF, 'tasks.md': '- [ ] 1.1 t\n' });
  try {
    age(join(ctx.changeDir, 'handoff.md'), 60);
    const res = restore(ctx, ['--no-metrics']);
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /handoff\.md is older than the change artifacts/);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test('restore stays quiet when handoff.md is newest and nothing is pending', () => {
  const ctx = setup({ 'handoff.md': HANDOFF, 'tasks.md': '- [ ] 1.1 t\n' });
  try {
    age(join(ctx.changeDir, 'tasks.md'), 60);
    const res = restore(ctx, ['--no-metrics']);
    assert.equal(res.status, 0, res.out);
    assert.doesNotMatch(res.out, /UNPERSISTED SESSION/);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test('explore command and skill name Session Exit as the exception to the artifact ban', () => {
  for (const rel of ['templates/.agents/commands/opsx-explore.md', 'templates/.agents/skills/openspec-explore/SKILL.md']) {
    const text = readFileSync(join(KIT_ROOT, rel), 'utf-8');
    assert.match(text, /Session Exit/, rel);
    assert.match(text, /`npx agent-orchestrator-kit handoff <name>`|handoff` CLI/, rel);
  }
});
