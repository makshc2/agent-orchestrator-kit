import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildRecoveryBriefing } from '../bin/session-recovery.js';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;
const QUESTIONS_HEADING = 'QUESTIONS FOR THE USER (the CLI never prompts; the conductor asks only these)';
const HEADINGS = ['FACTS', 'UNKNOWN', 'CONTRADICTIONS', 'GAPS', QUESTIONS_HEADING];

function handoffMd({ next = '/opsx:apply x', role = 'Implementer', extra = '' } = {}) {
  const lines = ['# Handoff', '', '## Closed role', 'Implementer', '', '## Next command', next, ''];
  lines.push('## Next role', role, '');
  lines.push('## Done', 'ok', '', '## Attach', '- a', '');
  return `${lines.join('\n')}${extra}`;
}

function tasksMd(items) {
  const out = [];
  for (const item of items) {
    out.push(`- [${item.checked ? 'x' : ' '}] ${item.id} ${item.title || 'task'}`);
    out.push(`  Files: ${(item.files || ['src/a.js']).join(', ')}`);
    out.push(`  Do: ${item.do || 'work'}`);
  }
  return `${out.join('\n')}\n`;
}

const BASE_TASKS = tasksMd([
  { id: '1.1', checked: true, files: ['src/one.js'] },
  { id: '1.2', checked: true, files: ['src/two.js'] },
  { id: '2.1', checked: false, files: ['src/three.js'] },
  { id: '2.2', checked: false, files: ['src/a.js'] },
]);

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
}

function gitInit(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function gitCommit(dir, message) {
  git(dir, ['add', '-A']);
  const res = git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
  assert.ok(res.status === 0 || res.status === 1, res.stderr);
  return git(dir, ['rev-parse', 'HEAD']).stdout.trim();
}

function makeProject(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aok-briefing-'));
  const dir = join(root, 'project');
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const changeDir = join(dir, 'openspec', 'changes', 'x');
  mkdirSync(changeDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(changeDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return { root, dir, home, changeDir };
}

const BASE_FILES = {
  'proposal.md': '# Proposal\n\nwhy\n',
  'design.md': '# Design\n\nhow\n',
  'tasks.md': BASE_TASKS,
  'review.md': '# Review\n\nVerdict: APPROVE\n',
  'decisions.md': '# Decisions\n\n- 2026-01-01 cache: use sha256\n',
  'handoff.md': handoffMd(),
};

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

const restore = (ctx, extra = []) => run(ctx, ['handoff', 'x', '--restore', '--no-metrics', '--platform', 'claude', ...extra]);
const checkpoint = (ctx, args) => run(ctx, ['checkpoint', 'x', ...args]);

// Base fixture: committed artifacts plus one earlier restore that leaves pending open.
function makeBase(overrides = {}, { commit = true, openPending = true } = {}) {
  const ctx = makeProject({ ...BASE_FILES, ...overrides });
  if (commit) {
    gitInit(ctx.dir);
    ctx.head = gitCommit(ctx.dir, 'artifacts');
  }
  if (openPending) {
    const first = run(ctx, ['handoff', 'x', '--restore', '--platform', 'claude']);
    assert.equal(first.status, 0, first.out);
    assert.ok(JSON.parse(readFileSync(join(ctx.changeDir, 'metrics.json'), 'utf-8')).pending);
  }
  return ctx;
}

const cleanup = (ctx) => rmSync(ctx.root, { recursive: true, force: true });

function briefing(out) {
  const lines = out.split('\n');
  const start = lines.findIndex((l) => l.startsWith('RECOVERY BRIEFING'));
  assert.ok(start >= 0, `no RECOVERY BRIEFING in:\n${out}`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('DETAILS:'));
  assert.ok(end > start, `no DETAILS: line in:\n${out}`);
  return lines.slice(start, end + 1);
}

function section(out, heading) {
  const lines = briefing(out);
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `heading ${heading} missing`);
  const items = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (HEADINGS.includes(lines[i]) || lines[i].startsWith('DETAILS:')) break;
    if (lines[i].startsWith('- ')) items.push(lines[i]);
  }
  return items;
}

const detailsLine = (out) => briefing(out).find((l) => l.startsWith('DETAILS:'));
const age = (p, secondsAgo) => {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(p, t, t);
};

function snapshotTree(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) walk(full);
      else {
        const st = statSync(full);
        out.push([relative(dir, full), createHash('sha256').update(readFileSync(full)).digest('hex'), st.mtimeMs]);
      }
    }
  };
  walk(dir);
  return out;
}

test('interrupted session prints the briefing after the warning', () => {
  const ctx = makeBase();
  try {
    assert.equal(checkpoint(ctx, ['--task', '2.1', '--done', 'finished 2.1', '--next', 'start 2.2']).status, 0);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const lines = res.out.split('\n');
    const header = lines.findIndex((l) => l.includes('handoff restore'));
    const warn = lines.findIndex((l) => l.includes('UNPERSISTED SESSION'));
    const brief = lines.findIndex((l) => l.startsWith('RECOVERY BRIEFING'));
    assert.ok(header >= 0 && header < warn, res.out);
    assert.ok(warn < brief, res.out);
    const facts = section(res.out, 'FACTS');
    assert.ok(
      facts.some((l) => l.includes('finished 2.1') && l.endsWith('[checkpoint.json]')),
      facts.join('\n'),
    );
  } finally {
    cleanup(ctx);
  }
});

test('stale handoff is reported as outdated', () => {
  const ctx = makeBase({}, { openPending: false });
  try {
    age(join(ctx.changeDir, 'handoff.md'), 60);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'UNKNOWN').some((l) => l.includes('handoff.md predates the edits')), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('missing checkpoint is a gap', () => {
  const ctx = makeBase();
  try {
    mkdirSync(join(ctx.dir, 'src'), { recursive: true });
    writeFileSync(join(ctx.dir, 'src', 'three.js'), 'x\n');
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'GAPS').some((l) => l.includes('no checkpoint.json')), res.out);
    const facts = section(res.out, 'FACTS');
    assert.ok(facts.some((l) => l.includes('tasks: 2/4')), facts.join('\n'));
    assert.ok(facts.some((l) => l.includes('decisions: 1 recorded')), facts.join('\n'));
    assert.ok(facts.some((l) => /^- git: /.test(l)), facts.join('\n'));
  } finally {
    cleanup(ctx);
  }
});

test('corrupt checkpoint is ignored', () => {
  const ctx = makeBase();
  try {
    assert.equal(checkpoint(ctx, ['--done', 'finished 2.1']).status, 0);
    const path = join(ctx.changeDir, 'checkpoint.json');
    truncateSync(path, Math.floor(statSync(path).size / 2));
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'GAPS').some((l) => l.includes('checkpoint.json unreadable (invalid JSON): ignored')),
      res.out,
    );
    assert.ok(!briefing(res.out).some((l) => l.includes('finished 2.1') || l.includes('checkpoint seq')), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('leftover temp file is noted', () => {
  const ctx = makeBase();
  try {
    assert.equal(checkpoint(ctx, ['--done', 'finished 2.1']).status, 0);
    writeFileSync(join(ctx.changeDir, 'checkpoint.json.tmp'), '{"half":');
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'FACTS').some((l) => l.includes('finished 2.1')), res.out);
    assert.ok(section(res.out, 'GAPS').some((l) => l.includes('checkpoint.json.tmp')), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('no git is a gap', () => {
  const ctx = makeBase({}, { commit: false });
  try {
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'GAPS').some((l) => l.includes('git unavailable: not a git repository')),
      res.out,
    );
  } finally {
    cleanup(ctx);
  }
});

test('contradicting sources', () => {
  const ctx = makeBase({ 'handoff.md': handoffMd({ next: '/opsx:propose x' }) });
  try {
    const four = tasksMd([
      { id: '1.1', checked: true, files: ['src/one.js'] },
      { id: '1.2', checked: true, files: ['src/two.js'] },
      { id: '2.1', checked: true, files: ['src/three.js'] },
      { id: '2.2', checked: true, files: ['src/a.js'] },
    ]);
    writeFileSync(join(ctx.changeDir, 'tasks.md'), four);
    assert.equal(checkpoint(ctx, ['--done', 'z']).status, 0);
    writeFileSync(join(ctx.changeDir, 'tasks.md'), BASE_TASKS);
    writeFileSync(join(ctx.changeDir, 'design.md'), '# Design\n\nhow, revised\n');
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const items = section(res.out, 'CONTRADICTIONS');
    assert.equal(items.length, 3, items.join('\n'));
    for (const item of items) {
      const tags = /\[([^\]]+)\]$/.exec(item);
      assert.ok(tags, item);
      assert.equal(tags[1].split(', ').length, 2, item);
    }
    assert.ok(
      section(res.out, QUESTIONS_HEADING).some((l) => l.includes('which is right?')),
      res.out,
    );
  } finally {
    cleanup(ctx);
  }
});

test('reported decision is unknown until persisted', () => {
  const ctx = makeBase();
  try {
    const decisions = join(ctx.changeDir, 'decisions.md');
    const before = readFileSync(decisions);
    assert.equal(checkpoint(ctx, ['--decision', '- retry: retain history']).status, 0);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const unknown = section(res.out, 'UNKNOWN');
    assert.ok(
      unknown.some((l) => l.includes('- retry: retain history') && l.endsWith('[checkpoint.json, decisions.md]')),
      unknown.join('\n'),
    );
    assert.ok(!section(res.out, 'CONTRADICTIONS').some((l) => l.includes('retain history')), res.out);
    assert.deepEqual(readFileSync(decisions), before);

    writeFileSync(decisions, `${before.toString()}- 2026-02-02 retry: retain history\n`);
    const after = restore(ctx);
    assert.equal(after.status, 0, after.out);
    assert.ok(!section(after.out, 'UNKNOWN').some((l) => l.includes('retain history')), after.out);
  } finally {
    cleanup(ctx);
  }
});

test('superseded checkpoint is used for decisions only', () => {
  const ctx = makeBase();
  try {
    const six = tasksMd(
      ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2'].map((id) => ({ id, checked: true, files: ['src/one.js'] })),
    );
    writeFileSync(join(ctx.changeDir, 'tasks.md'), tasksMd([
      { id: '1.1', checked: true, files: ['src/one.js'] },
      { id: '1.2', checked: true, files: ['src/two.js'] },
      { id: '2.1', checked: true, files: ['src/three.js'] },
      { id: '2.2', checked: true, files: ['src/a.js'] },
    ]));
    assert.equal(checkpoint(ctx, ['--decision', 'retry: retain history']).status, 0);
    const checkpointHead = JSON.parse(readFileSync(join(ctx.changeDir, 'checkpoint.json'), 'utf-8')).snapshot.head;
    writeFileSync(join(ctx.changeDir, 'handoff.md'), handoffMd({ extra: '\n## Metrics\n- ok\n' }));
    const second = gitCommit(ctx.dir, 'rewrite handoff');
    writeFileSync(join(ctx.changeDir, 'tasks.md'), six);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'GAPS').some((l) => l.includes('checkpoint.json superseded')), res.out);
    for (const item of [...section(res.out, 'CONTRADICTIONS'), ...section(res.out, QUESTIONS_HEADING)]) {
      assert.ok(!/reported 4/.test(item), item);
    }
    assert.ok(
      section(res.out, 'UNKNOWN').some((l) => l.includes('retry: retain history')),
      res.out,
    );
    const details = detailsLine(res.out);
    assert.notEqual(second, checkpointHead);
    assert.ok(details.includes(second), details);
    assert.ok(!details.includes(checkpointHead), details);
  } finally {
    cleanup(ctx);
  }
});

test('handoff newer than checkpoint is shown as newer', () => {
  const ctx = makeBase();
  try {
    assert.equal(checkpoint(ctx, ['--done', 'a']).status, 0);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'FACTS').some((l) => l.includes('newer than handoff.md')), res.out);
    assert.deepEqual(section(res.out, 'CONTRADICTIONS'), ['- none']);
  } finally {
    cleanup(ctx);
  }
});

test('role question tests values', () => {
  const without = makeBase({ 'handoff.md': handoffMd({ role: '' }) }, { openPending: false });
  try {
    age(join(without.changeDir, 'handoff.md'), 60);
    const res = restore(without);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, QUESTIONS_HEADING).some((l) => l.includes('Which role was running?')),
      res.out,
    );
  } finally {
    cleanup(without);
  }

  const named = makeBase({ 'handoff.md': handoffMd({ role: 'Spec Reviewer' }) }, { openPending: false });
  try {
    age(join(named.changeDir, 'handoff.md'), 60);
    const res = restore(named);
    assert.equal(res.status, 0, res.out);
    assert.ok(!section(res.out, QUESTIONS_HEADING).some((l) => l.includes('Which role was running?')), res.out);
  } finally {
    cleanup(named);
  }
});

test('changed file is not a finished task', () => {
  const ctx = makeBase();
  try {
    mkdirSync(join(ctx.dir, 'src'), { recursive: true });
    writeFileSync(join(ctx.dir, 'src', 'a.js'), 'changed\n');
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'UNKNOWN').some(
        (l) => l.includes('task 2.2 lists src/a.js') && l.includes('completion is not confirmed'),
      ),
      res.out,
    );
    assert.ok(!section(res.out, 'FACTS').some((l) => /task 2\.2.*done/i.test(l)), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('untracked directories, unusual names and renames', () => {
  const odd = process.platform === 'win32' ? null : 'src/odd/a\tb\\c.js';
  const paths = ['src/new/a.js', 'src/файл.js', ...(odd ? [odd] : [])];
  // the Files: parser unwraps quotes, so the odd entry is listed quoted
  const items = paths.map((path, i) => ({
    id: `3.${i + 1}`,
    checked: false,
    files: [path === odd ? `"${path}"` : path],
  }));
  const ctx = makeBase({
    'tasks.md': tasksMd([
      { id: '1.1', checked: true, files: ['src/one.js'] },
      ...items,
      { id: '4.1', checked: false, files: ['src/renamed-from.js'] },
    ]),
  });
  try {
    mkdirSync(join(ctx.dir, 'src'), { recursive: true });
    writeFileSync(join(ctx.dir, 'src', 'renamed-from.js'), 'x\n');
    gitCommit(ctx.dir, 'add file to rename');
    for (const path of paths) {
      const full = join(ctx.dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, 'new\n');
    }
    git(ctx.dir, ['mv', 'src/renamed-from.js', 'src/renamed-to.js']);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const unknown = section(res.out, 'UNKNOWN');
    for (const item of items) {
      assert.ok(
        unknown.some((l) => l.startsWith(`- task ${item.id} lists `) && l.includes('completion is not confirmed')),
        `task ${item.id} missing in:\n${unknown.join('\n')}`,
      );
    }
    assert.ok(
      unknown.some((l) => l.startsWith('- task 4.1 lists src/renamed-from.js')),
      unknown.join('\n'),
    );
    assert.ok(!section(res.out, QUESTIONS_HEADING).some((l) => l.includes('match no task Files:')), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('ticked box is not a test result', () => {
  const ctx = makeBase();
  try {
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const lines = briefing(res.out);
    const claim = lines.filter((l) => l.includes('does not confirm that tests passed'));
    assert.equal(claim.length, 1, lines.join('\n'));
    for (const line of lines) {
      if (line === claim[0]) continue;
      assert.ok(!/tests?\s+(passed|pass|green)/i.test(line), line);
    }
  } finally {
    cleanup(ctx);
  }
});

test('stale APPROVE after an edit', () => {
  const ctx = makeBase();
  try {
    writeFileSync(join(ctx.changeDir, 'design.md'), '# Design\n\nrevised\n');
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'CONTRADICTIONS').some(
        (l) => l.includes('design.md') && l.endsWith('[review.md, git]'),
      ),
      res.out,
    );
  } finally {
    cleanup(ctx);
  }
});

test('checkpoint after the edit does not bless the review', () => {
  const ctx = makeBase();
  try {
    writeFileSync(join(ctx.changeDir, 'design.md'), '# Design\n\nrevised\n');
    assert.equal(checkpoint(ctx, ['--done', 'a']).status, 0);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'CONTRADICTIONS').some((l) => l.includes('design.md')), res.out);
    assert.ok(!section(res.out, 'FACTS').some((l) => l.includes('review covers the current')), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('re-review with the same verdict is current', () => {
  const ctx = makeBase();
  try {
    writeFileSync(join(ctx.changeDir, 'design.md'), '# Design\n\nrevised\n');
    writeFileSync(join(ctx.changeDir, 'review.md'), '# Review\n\nre-reviewed\n\nVerdict: APPROVE\n');
    gitCommit(ctx.dir, 're-review');
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'FACTS').some((l) => l.includes('review covers the current planning artifacts')),
      res.out,
    );
    assert.ok(!section(res.out, 'CONTRADICTIONS').some((l) => l.includes('review.md says')), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('deleted artifact and substantive task edit are stale', () => {
  const deleted = makeBase({ 'design-brief.md': '# Brief\n\nui\n' });
  try {
    rmSync(join(deleted.changeDir, 'design-brief.md'));
    const res = restore(deleted);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'CONTRADICTIONS').some((l) => l.includes('design-brief.md')),
      res.out,
    );
  } finally {
    cleanup(deleted);
  }

  const edited = makeBase();
  try {
    const path = join(edited.changeDir, 'tasks.md');
    writeFileSync(path, readFileSync(path, 'utf-8').replace('Do: work', 'Do: work, carefully'));
    const res = restore(edited);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'CONTRADICTIONS').some((l) => l.includes('tasks.md')), res.out);
  } finally {
    cleanup(edited);
  }
});

test('ticking boxes does not stale a review', () => {
  const ctx = makeBase();
  try {
    const path = join(ctx.changeDir, 'tasks.md');
    writeFileSync(path, readFileSync(path, 'utf-8').replace('- [ ] 2.1', '- [x] 2.1'));
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'FACTS').some((l) => l.includes('review covers the current planning artifacts')),
      res.out,
    );
    assert.ok(!section(res.out, 'CONTRADICTIONS').some((l) => l.includes('review.md says')), res.out);
  } finally {
    cleanup(ctx);
  }
});

test('review without evidence is unknown', () => {
  const untracked = makeProject(BASE_FILES);
  try {
    gitInit(untracked.dir);
    writeFileSync(join(untracked.dir, '.gitignore'), 'openspec/changes/x/review.md\n');
    gitCommit(untracked.dir, 'artifacts without review');
    age(join(untracked.changeDir, 'handoff.md'), 60);
    const res = restore(untracked);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'UNKNOWN').some((l) => l.includes('review currency unknown')), res.out);
    assert.ok(!briefing(res.out).some((l) => l.includes('review covers the current')), res.out);
  } finally {
    cleanup(untracked);
  }

  const noGit = makeBase({}, { commit: false, openPending: false });
  try {
    age(join(noGit.changeDir, 'handoff.md'), 60);
    const res = restore(noGit);
    assert.equal(res.status, 0, res.out);
    assert.ok(
      section(res.out, 'UNKNOWN').some((l) => l.includes('review currency unknown') && l.includes('no git')),
      res.out,
    );
    assert.ok(!briefing(res.out).some((l) => l.includes('review covers the current')), res.out);
  } finally {
    cleanup(noGit);
  }
});

test('no motive is invented', () => {
  const ctx = makeBase();
  try {
    assert.equal(checkpoint(ctx, ['--decision', 'switch to sha256']).status, 0);
    const before = snapshotTree(ctx.dir);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const item = section(res.out, 'UNKNOWN').find((l) => l.includes('switch to sha256'));
    assert.ok(item, res.out);
    assert.ok(item.includes(': switch to sha256 ['), item);
    assert.deepEqual(snapshotTree(ctx.dir), before);
  } finally {
    cleanup(ctx);
  }
});

test('questions only for material ambiguity', () => {
  const ctx = makeBase({ 'handoff.md': handoffMd({ next: '/opsx:review x' }) });
  try {
    mkdirSync(join(ctx.dir, 'other'), { recursive: true });
    for (const name of ['p.js', 'q.js', 'r.js']) writeFileSync(join(ctx.dir, 'other', name), 'x\n');
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const questions = section(res.out, QUESTIONS_HEADING);
    assert.equal(questions.length, 1, questions.join('\n'));
    assert.ok(questions[0].includes('match no task Files:'), questions[0]);
  } finally {
    cleanup(ctx);
  }

  const stale = makeBase();
  try {
    writeFileSync(join(stale.changeDir, 'design.md'), '# Design\n\nrevised\n');
    const res = restore(stale);
    assert.equal(res.status, 0, res.out);
    assert.ok(section(res.out, 'CONTRADICTIONS').some((l) => l.includes('review.md says')), res.out);
    assert.deepEqual(section(res.out, QUESTIONS_HEADING), ['- none']);
  } finally {
    cleanup(stale);
  }
});

test('briefing is capped', () => {
  const tasks = [];
  for (let i = 1; i <= 20; i += 1) {
    tasks.push({ id: `5.${i}`, checked: false, title: `task ${'t'.repeat(200)}`, files: [`src/gen/f${i}.js`] });
  }
  const ctx = makeBase({ 'tasks.md': tasksMd([{ id: '1.1', checked: true, files: ['src/one.js'] }, ...tasks]) });
  try {
    mkdirSync(join(ctx.dir, 'src', 'gen'), { recursive: true });
    for (let i = 1; i <= 60; i += 1) writeFileSync(join(ctx.dir, 'src', 'gen', `f${i}.js`), 'x\n');
    const args = [];
    for (let i = 1; i <= 10; i += 1) args.push('--decision', `topic${i}: ${'d'.repeat(120)}`);
    for (let call = 0; call < 3; call += 1) {
      const used = [];
      for (let i = 1; i <= 10; i += 1) used.push('--decision', `topic${call * 10 + i}: ${'d'.repeat(120)}`);
      assert.equal(checkpoint(ctx, used).status, 0, `decision call ${call}`);
    }
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const lines = briefing(res.out);
    assert.ok(lines.length <= 40, `${lines.length} lines`);
    assert.ok(Buffer.byteLength(`${lines.join('\n')}\n`) <= 4096, `${Buffer.byteLength(lines.join('\n'))} bytes`);
    assert.ok(lines.some((l) => l.endsWith('[DETAILS]')), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('DETAILS:')), lines.join('\n'));
    for (const heading of HEADINGS) assert.ok(lines.includes(heading), `${heading} missing`);
    void args;
  } finally {
    cleanup(ctx);
  }
});

test('briefing is byte-bounded for multibyte text', () => {
  const emoji = '😀'.repeat(300);
  const sources = {
    name: 'x',
    checkpoint: { state: 'valid', record: null, reason: null },
    usable: false,
    superseded: false,
    tmpLeftover: false,
    handoff: { present: true, fields: null, sha256: 'a', missingSections: [], stale: true },
    decisions: { present: true, entries: ['д'.repeat(400)] },
    decisionsUnrecorded: ['д'.repeat(400)],
    tasks: {
      present: true,
      done: 1,
      total: 2,
      items: [{ id: '1.1', title: 'т'.repeat(400), checked: false, files: [`src/${'ф'.repeat(400)}.js`] }],
    },
    review: { present: true, verdict: 'APPROVE', currency: { state: 'stale', files: [`src/${'ф'.repeat(400)}.js`], sha: 'abcdef1234567', reason: null } },
    git: { available: true, changed: [`src/${'ф'.repeat(400)}.js`], shortstat: '1 file changed', refKind: 'none', ref: null, commits: [] },
    pending: null,
    gaps: [
      ...Array.from({ length: 20 }, () => ({ source: 'checkpoint.json', text: emoji })),
      ...Array.from({ length: 12 }, () => ({ source: 'review.md, git', text: emoji })),
    ],
  };
  const lines = buildRecoveryBriefing(sources, { changeName: 'x' });
  const text = `${lines.join('\n')}\n`;
  assert.ok(lines.length <= 40, `${lines.length} lines`);
  assert.ok(Buffer.byteLength(text) <= 4096, `${Buffer.byteLength(text)} bytes`);
  assert.ok(!Buffer.from(text, 'utf-8').toString('utf-8').includes('�'), 'replacement character found');
  for (const line of lines) {
    if (!line.startsWith('- ') || line === '- none') continue;
    assert.ok(line.endsWith(']'), line);
  }
  assert.ok(lines.some((l) => l.startsWith('DETAILS:')), lines.join('\n'));

  const ctx = makeBase();
  try {
    const path = `src/${Array.from({ length: 40 }, () => 'ф'.repeat(8)).join('/')}.js`;
    mkdirSync(dirname(join(ctx.dir, path)), { recursive: true });
    writeFileSync(join(ctx.dir, path), 'x\n');
    assert.equal(checkpoint(ctx, ['--decision', `тема: ${'д'.repeat(390)}`]).status, 0);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    const real = briefing(res.out);
    assert.ok(real.length <= 40, `${real.length} lines`);
    assert.ok(Buffer.byteLength(`${real.join('\n')}\n`) <= 4096);
    assert.ok(!real.join('\n').includes('�'));
  } finally {
    cleanup(ctx);
  }
});

test('unreadable handoff.md and decisions.md still restore', () => {
  const badDecisions = makeBase();
  try {
    rmSync(join(badDecisions.changeDir, 'decisions.md'));
    mkdirSync(join(badDecisions.changeDir, 'decisions.md'));
    const res = restore(badDecisions);
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /decisions\.md unreadable/);
    assert.ok(section(res.out, 'GAPS').some((l) => l.includes('decisions.md unreadable')), res.out);
  } finally {
    cleanup(badDecisions);
  }

  const badHandoff = makeBase();
  try {
    rmSync(join(badHandoff.changeDir, 'handoff.md'));
    mkdirSync(join(badHandoff.changeDir, 'handoff.md'));
    const res = restore(badHandoff);
    assert.equal(res.status, 1, res.out);
    const lines = res.out.split('\n');
    const warn = lines.findIndex((l) => l.includes('UNPERSISTED SESSION'));
    const brief = lines.findIndex((l) => l.startsWith('RECOVERY BRIEFING'));
    const error = lines.findIndex((l) => l.includes('No handoff.md or Memory entities'));
    assert.ok(warn >= 0 && warn < brief && brief < error, res.out);
  } finally {
    cleanup(badHandoff);
  }

  const withMemory = makeBase();
  try {
    rmSync(join(withMemory.changeDir, 'handoff.md'));
    mkdirSync(join(withMemory.changeDir, 'handoff.md'));
    const memoryDir = join(withMemory.dir, '.cursor');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, 'memory.json'),
      `${JSON.stringify({
        type: 'entity',
        name: 'Change:x',
        entityType: 'Change',
        observations: ['status: in-progress', 'next_command: /opsx:apply x'],
      })}\n`,
    );
    const res = restore(withMemory);
    assert.equal(res.status, 0, res.out);
    assert.ok(res.out.includes('RECOVERY BRIEFING'), res.out);
  } finally {
    cleanup(withMemory);
  }
});

test('artifacts without handoff.md print the briefing before the error', () => {
  const ctx = makeProject({ 'proposal.md': '# p\n', 'tasks.md': BASE_TASKS });
  try {
    const res = restore(ctx);
    assert.equal(res.status, 1, res.out);
    const lines = res.out.split('\n');
    const brief = lines.findIndex((l) => l.startsWith('RECOVERY BRIEFING'));
    const error = lines.findIndex((l) => l.includes('No handoff.md or Memory entities'));
    assert.ok(brief >= 0 && brief < error, res.out);
  } finally {
    cleanup(ctx);
  }
});

test('clean state prints no briefing', () => {
  const ctx = makeBase({}, { openPending: false });
  try {
    for (const name of ['proposal.md', 'design.md', 'tasks.md', 'review.md']) age(join(ctx.changeDir, name), 600);
    const first = restore(ctx);
    assert.equal(first.status, 0, first.out);
    assert.ok(!first.out.includes('UNPERSISTED SESSION'), first.out);
    assert.ok(!first.out.includes('RECOVERY BRIEFING'), first.out);

    assert.equal(checkpoint(ctx, ['--done', 'a']).status, 0);
    const second = restore(ctx);
    assert.equal(second.status, 0, second.out);
    assert.ok(!second.out.includes('UNPERSISTED SESSION'), second.out);
    assert.ok(!second.out.includes('RECOVERY BRIEFING'), second.out);
  } finally {
    cleanup(ctx);
  }
});

test('restore twice and persist count sessions once', () => {
  const ctx = makeBase({}, { openPending: false });
  try {
    const metricsPath = join(ctx.changeDir, 'metrics.json');
    const first = run(ctx, ['handoff', 'x', '--restore', '--platform', 'claude']);
    assert.equal(first.status, 0, first.out);
    assert.ok(JSON.parse(readFileSync(metricsPath, 'utf-8')).pending, 'first restore writes pending');
    const second = run(ctx, ['handoff', 'x', '--restore', '--platform', 'claude']);
    assert.equal(second.status, 0, second.out);
    assert.ok(second.out.includes('RECOVERY BRIEFING'), second.out);
    assert.ok(JSON.parse(readFileSync(metricsPath, 'utf-8')).pending, 'second restore writes pending');
    const persist = run(ctx, ['handoff', 'x', '--platform', 'claude']);
    assert.equal(persist.status, 0, persist.out);
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
    assert.equal(metrics.sessions.length, 1, JSON.stringify(metrics));
    assert.equal(metrics.pending, null);
  } finally {
    cleanup(ctx);
  }
});

test('restore with the briefing is read-only', () => {
  const ctx = makeBase();
  try {
    assert.equal(checkpoint(ctx, ['--done', 'a', '--decision', 'cache: keep']).status, 0);
    const before = snapshotTree(ctx.dir);
    const res = restore(ctx);
    assert.equal(res.status, 0, res.out);
    assert.ok(res.out.includes('RECOVERY BRIEFING'), res.out);
    assert.deepEqual(snapshotTree(ctx.dir), before);
  } finally {
    cleanup(ctx);
  }
});

test('same files give the same briefing for every platform', () => {
  const ctx = makeBase();
  try {
    assert.equal(checkpoint(ctx, ['--done', 'a']).status, 0);
    const briefings = ['cursor', 'claude', 'amp'].map((platform) => {
      const res = run(ctx, ['handoff', 'x', '--restore', '--no-metrics', '--platform', platform]);
      assert.equal(res.status, 0, res.out);
      return briefing(res.out).join('\n');
    });
    assert.equal(briefings[0], briefings[1]);
    assert.equal(briefings[1], briefings[2]);
  } finally {
    cleanup(ctx);
  }
});
