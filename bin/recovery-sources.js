import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readCheckpoint, decisionKey, CHECKPOINT_TMP } from './session-checkpoint.js';

const HASH_RE = /^[0-9a-f]{7,40}$/;
const PLANNING_TOP = new Set(['proposal.md', 'design.md', 'design-brief.md', 'tasks.md']);

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const short = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 80);

function git(projectDir, args) {
  return execFileSync('git', args, {
    cwd: projectDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
    maxBuffer: 4194304,
  });
}

function newestMtime(dir, neutralFiles, topLevel) {
  let newest = 0;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    if (topLevel && neutralFiles && neutralFiles.has(entry.name)) continue;
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        newest = Math.max(newest, newestMtime(full, neutralFiles, false));
      } else {
        newest = Math.max(newest, statSync(full).mtimeMs);
      }
    } catch {
      /* ignore */
    }
  }
  return newest;
}

function isPlanningPath(relative) {
  if (PLANNING_TOP.has(relative)) return true;
  return relative.startsWith('specs/') && relative.endsWith('.md');
}

function tasksDigestText(relative, text) {
  if (relative !== 'tasks.md') return text;
  return text.replace(/^(\s*)- \[[xX]\]/gm, '$1- [ ]');
}

function parseTasks(text) {
  const lines = text.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*- \[([ xX])\]\s+(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(lines[i]);
    if (!match) continue;
    const files = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (/^\s*- \[/.test(next) || /^#/.test(next)) break;
      const filesMatch = /^\s+Files:\s*(.*)$/.exec(next);
      if (!filesMatch) continue;
      for (const raw of filesMatch[1].split(',')) {
        const cleaned = raw
          .replace(/`/g, '')
          .replace(/["']/g, '')
          .trim()
          .replace(/^new file:\s*/i, '')
          .trim()
          .replace(/^\.\//, '')
          .trim();
        if (cleaned) files.push(cleaned);
      }
      break;
    }
    items.push({ id: match[2], title: match[3].trim(), checked: match[1] !== ' ', files });
  }
  return items;
}

export function collectRecoverySources(projectDir, changeName, deps = {}) {
  const { neutralFiles, slackMs = 0, handoffFields = null, missingHandoffFields, parseDecisionsFileEntries } = deps;
  const changeDir = join(projectDir, 'openspec', 'changes', changeName);
  const relChangeDir = `openspec/changes/${changeName}/`;
  const gaps = [];
  const add = (source, text) => gaps.push({ source, text });

  // checkpoint
  let checkpoint = { state: 'missing' };
  let tmpLeftover = false;
  try {
    checkpoint = readCheckpoint(changeDir, changeName);
  } catch (error) {
    checkpoint = { state: 'corrupt', reason: short(error) };
  }
  try {
    tmpLeftover = existsSync(join(changeDir, CHECKPOINT_TMP));
  } catch {
    tmpLeftover = false;
  }
  if (checkpoint.state === 'missing') add('checkpoint.json', 'no checkpoint.json');
  if (checkpoint.state === 'corrupt') add('checkpoint.json', `checkpoint.json unreadable (${checkpoint.reason}): ignored`);
  if (tmpLeftover) add('checkpoint.json.tmp', 'leftover checkpoint.json.tmp: an interrupted checkpoint write; ignored');

  // handoff
  const handoff = { present: false, fields: handoffFields, sha256: null, missingSections: [], stale: false };
  const handoffPath = join(changeDir, 'handoff.md');
  let handoffMtime = 0;
  try {
    if (existsSync(handoffPath)) {
      const bytes = readFileSync(handoffPath);
      handoff.present = true;
      handoff.sha256 = sha256(bytes);
      handoffMtime = statSync(handoffPath).mtimeMs;
    } else {
      add('handoff.md', 'no handoff.md');
    }
  } catch (error) {
    add('handoff.md', `handoff.md unreadable: ${short(error)}`);
  }
  if (handoffFields && typeof missingHandoffFields === 'function') {
    try {
      handoff.missingSections = missingHandoffFields(handoffFields) || [];
    } catch {
      handoff.missingSections = [];
    }
    if (handoff.missingSections.length > 0) {
      add('handoff.md', `handoff.md lacks required section(s): ${handoff.missingSections.join(', ')}`);
    }
  }
  if (handoff.present) {
    try {
      const newest = newestMtime(changeDir, neutralFiles instanceof Set ? neutralFiles : new Set(), true);
      handoff.stale = newest - handoffMtime > slackMs;
    } catch {
      handoff.stale = false;
    }
  }

  const checkpointValid = checkpoint.state === 'valid';
  const usable =
    checkpointValid && (checkpoint.record.snapshot.handoffSha256 || null) === (handoff.sha256 || null);
  const superseded = checkpointValid && !usable;
  if (superseded) {
    add('checkpoint.json, handoff.md', 'checkpoint.json superseded: handoff.md changed after it; only its reported decisions are shown');
  }

  // decisions
  const decisions = { present: false, entries: [] };
  const decisionsPath = join(changeDir, 'decisions.md');
  let decisionsReadable = false;
  try {
    if (existsSync(decisionsPath)) {
      const text = readFileSync(decisionsPath, 'utf-8');
      decisions.present = true;
      decisionsReadable = true;
      decisions.entries = typeof parseDecisionsFileEntries === 'function' ? parseDecisionsFileEntries(text) || [] : [];
    } else {
      add('decisions.md', 'no decisions.md');
    }
  } catch (error) {
    decisionsReadable = false;
    add('decisions.md', `decisions.md unreadable: ${short(error)}`);
  }
  const decisionsUnrecorded = [];
  if (checkpointValid) {
    const recorded = new Set();
    if (decisionsReadable) {
      for (const entry of decisions.entries) {
        const text = typeof entry === 'string' ? entry : entry && (entry.text || entry.decision || '');
        if (text) recorded.add(decisionKey(text));
      }
    }
    for (const text of checkpoint.record.decisions || []) {
      if (!recorded.has(decisionKey(text))) decisionsUnrecorded.push(text);
    }
  }

  // tasks
  const tasks = { present: false, done: 0, total: 0, items: [] };
  const tasksPath = join(changeDir, 'tasks.md');
  try {
    if (existsSync(tasksPath)) {
      const text = readFileSync(tasksPath, 'utf-8');
      tasks.present = true;
      tasks.items = parseTasks(text);
      tasks.total = tasks.items.length;
      tasks.done = tasks.items.filter((item) => item.checked).length;
    } else {
      add('tasks.md', 'no tasks.md');
    }
  } catch (error) {
    add('tasks.md', `tasks.md unreadable: ${short(error)}`);
  }

  // review
  const review = { present: false, verdict: null, currency: { state: 'na', files: [], sha: null, reason: null } };
  const reviewPath = join(changeDir, 'review.md');
  let reviewText = null;
  try {
    if (existsSync(reviewPath)) {
      reviewText = readFileSync(reviewPath, 'utf-8');
      review.present = true;
      const match = /^\s*(?:[-*]\s*)?(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(.+)$/im.exec(reviewText);
      review.verdict = match ? match[1].replace(/\*/g, '').trim() : null;
    } else {
      add('review.md', 'no review.md');
    }
  } catch (error) {
    add('review.md', `review.md unreadable: ${short(error)}`);
  }

  // git
  const gitInfo = { available: false, changed: [], shortstat: '', refKind: 'none', ref: null, commits: [] };
  let prefix = '';
  try {
    git(projectDir, ['rev-parse', '--is-inside-work-tree']);
    gitInfo.available = true;
  } catch (error) {
    const code = error && error.code;
    const failed = code === 'ENOENT' || code === 'ETIMEDOUT' || code === 'EACCES';
    add('git', failed ? 'git unavailable: command failed' : 'git unavailable: not a git repository');
    gitInfo.available = false;
  }
  if (gitInfo.available) {
    try {
      prefix = git(projectDir, ['rev-parse', '--show-prefix']).trim();
    } catch {
      prefix = '';
    }
    try {
      const out = git(projectDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      const records = out.split('\0').filter((part) => part.length > 0);
      const paths = [];
      for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        if (record.length < 4) continue;
        const x = record[0];
        const y = record[1];
        paths.push(record.slice(3));
        if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
          i += 1;
          if (i < records.length) paths.push(records[i]);
        }
      }
      for (const path of paths) {
        if (prefix && !path.startsWith(prefix)) continue;
        const relative = prefix ? path.slice(prefix.length) : path;
        if (relative.startsWith(relChangeDir)) continue;
        gitInfo.changed.push(relative);
      }
    } catch {
      gitInfo.changed = [];
    }
    try {
      gitInfo.shortstat = git(projectDir, ['diff', '--shortstat', 'HEAD']).trim();
    } catch {
      gitInfo.shortstat = '';
    }
    let ref = null;
    const head = usable ? checkpoint.record.snapshot.head : null;
    if (head && HASH_RE.test(head)) {
      try {
        git(projectDir, ['cat-file', '-e', `${head}^{commit}`]);
        ref = head;
        gitInfo.refKind = 'checkpoint';
      } catch {
        ref = null;
      }
    }
    if (!ref) {
      try {
        const logged = git(projectDir, ['log', '-1', '--format=%H', '--', `${relChangeDir}handoff.md`]).trim();
        if (HASH_RE.test(logged)) {
          ref = logged;
          gitInfo.refKind = 'handoff';
        }
      } catch {
        ref = null;
      }
    }
    gitInfo.ref = ref;
    try {
      const args = ref
        ? ['log', '--format=%h%x09%s', '-n', '5', `${ref}..HEAD`]
        : ['log', '--format=%h%x09%s', '-n', '5'];
      const out = git(projectDir, args);
      gitInfo.commits = out
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const tab = line.indexOf('\t');
          return tab === -1 ? { hash: line, subject: '' } : { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
        });
    } catch {
      gitInfo.commits = [];
    }
  }

  // review currency
  if (review.verdict && /^approve/i.test(review.verdict)) {
    review.currency = reviewCurrency(projectDir, relChangeDir, changeDir, gitInfo.available);
  }

  // pending
  let pending = null;
  try {
    const raw = JSON.parse(readFileSync(join(changeDir, 'metrics.json'), 'utf-8'));
    const open = raw && raw.pending;
    if (open && open.startedAt) pending = { role: open.role || null, startedAt: open.startedAt };
  } catch {
    pending = null;
  }

  return {
    name: changeName,
    checkpoint: { state: checkpoint.state, record: checkpoint.record || null, reason: checkpoint.reason || null },
    usable,
    superseded,
    tmpLeftover,
    handoff,
    decisions,
    decisionsUnrecorded,
    tasks,
    review,
    git: gitInfo,
    pending,
    gaps,
  };
}

function reviewCurrency(projectDir, relChangeDir, changeDir, gitAvailable) {
  const none = (reason) => ({ state: 'unknown', files: [], sha: null, reason });
  if (!gitAvailable) return none('no git');
  let sha = null;
  try {
    const dirty = git(projectDir, ['status', '--porcelain=v1', '-z', '--', `${relChangeDir}review.md`]);
    if (dirty.replace(/\0/g, '').trim().length > 0) return none('review.md not committed or modified');
    sha = git(projectDir, ['log', '-1', '--format=%H', '--', `${relChangeDir}review.md`]).trim();
  } catch {
    return none('git command failed');
  }
  if (!HASH_RE.test(sha)) return none('review.md not committed or modified');

  let baseline = [];
  try {
    baseline = git(projectDir, ['ls-tree', '-r', '--name-only', sha, '--', relChangeDir.replace(/\/$/, '')])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith(relChangeDir))
      .map((line) => line.slice(relChangeDir.length))
      .filter(isPlanningPath);
  } catch {
    return none('git command failed');
  }
  const current = currentPlanningPaths(changeDir);
  const compared = Array.from(new Set([...baseline, ...current])).sort();
  const files = [];
  for (const relative of compared) {
    let baseText = null;
    if (baseline.includes(relative)) {
      try {
        baseText = git(projectDir, ['show', `${sha}:./${relChangeDir}${relative}`]);
      } catch {
        return none('git command failed');
      }
    }
    let currentText = null;
    try {
      currentText = readFileSync(join(changeDir, relative), 'utf-8');
    } catch {
      currentText = null;
    }
    if (baseText === null || currentText === null) {
      files.push(relative);
      continue;
    }
    if (sha256(tasksDigestText(relative, baseText)) !== sha256(tasksDigestText(relative, currentText))) files.push(relative);
  }
  return files.length > 0 ? { state: 'stale', files, sha, reason: null } : { state: 'current', files: [], sha, reason: null };
}

function currentPlanningPaths(changeDir) {
  const found = [];
  for (const name of PLANNING_TOP) {
    try {
      if (existsSync(join(changeDir, name))) found.push(name);
    } catch {
      /* ignore */
    }
  }
  const walk = (dir, prefix) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), `${relative}/`);
      else if (entry.name.endsWith('.md')) found.push(relative);
    }
  };
  walk(join(changeDir, 'specs'), 'specs/');
  return found.filter(isPlanningPath);
}
