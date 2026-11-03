const CAPS = { FACTS: 12, UNKNOWN: 7, CONTRADICTIONS: 5, GAPS: 5, QUESTIONS: 3 };
const QUESTIONS_HEADING = 'QUESTIONS FOR THE USER (the CLI never prompts; the conductor asks only these)';
const MAX_BYTES = 4096;

const oneLine = (value) => String(value === null || value === undefined ? '' : value).replace(/[\r\n\t]/g, ' ');
const firstLine = (value) => oneLine(String(value === null || value === undefined ? '' : value).split('\n')[0]);

function cutBytes(text, budget) {
  const chars = Array.from(text);
  let out = '';
  for (const char of chars) {
    if (Buffer.byteLength(out + char) > budget) break;
    out += char;
  }
  return out;
}

function cutChars(text, budget) {
  const chars = Array.from(text);
  return chars.length <= budget ? text : chars.slice(0, budget).join('');
}

function render(item) {
  return item.tags ? `- ${item.text} [${item.tags}]` : `- ${item.text}`;
}

function fitChars(item, limit) {
  const line = render(item);
  if (Array.from(line).length <= limit) return item;
  const tagLength = item.tags ? ` [${item.tags}]`.length : 0;
  const room = limit - 2 - tagLength - 1;
  if (room <= 0) return item;
  return { ...item, text: `${cutChars(item.text, room)}…` };
}

function fitBytes(item, budget) {
  const line = render(item);
  if (Buffer.byteLength(line) <= budget) return item;
  const tail = item.tags ? ` [${item.tags}]` : '';
  const room = budget - Buffer.byteLength(`- ${tail}`) - Buffer.byteLength('…');
  if (room <= 0) return item;
  return { ...item, text: `${cutBytes(item.text, room)}…` };
}

function capSection(items, cap, protectedSection) {
  if (items.length <= cap) return { items, dropped: 0 };
  if (protectedSection) {
    const kept = items.slice(0, cap - 1);
    kept.push({ text: `(${items.length - (cap - 1)} more omitted; see the files below)`, tags: 'DETAILS' });
    return { items: kept, dropped: 0 };
  }
  return { items: items.slice(0, cap), dropped: items.length - cap };
}

function joinUpTo(values, limit) {
  const shown = values.slice(0, limit).join(', ');
  return values.length > limit ? `${shown}, …` : shown;
}

export function buildRecoveryBriefing(sources, { changeName } = {}) {
  const s = sources || {};
  const name = cutBytes(oneLine(changeName || s.name || ''), 60);
  const tasks = s.tasks || { present: false, done: 0, total: 0, items: [] };
  const git = s.git || { available: false, changed: [], shortstat: '', refKind: 'none', ref: null, commits: [] };
  const review = s.review || { present: false, verdict: null, currency: { state: 'na', files: [], sha: null, reason: null } };
  const decisions = s.decisions || { present: false, entries: [] };
  const checkpointRecord = (s.checkpoint && s.checkpoint.record) || null;
  const usable = Boolean(s.usable) && Boolean(checkpointRecord);
  const superseded = Boolean(s.superseded) && Boolean(checkpointRecord);
  const fields = (s.handoff && s.handoff.fields) || null;
  const verdict = review.verdict || '';
  const isApprove = /^approve/i.test(verdict);
  const currency = review.currency || { state: 'na', files: [], sha: null, reason: null };
  const sha7 = currency.sha ? String(currency.sha).slice(0, 7) : '';
  const nextCommand = usable ? '' : oneLine((fields && (fields.nextCommand || fields.next_command)) || '');
  const nextRole = oneLine((fields && (fields.nextRole || fields.next_role)) || '');
  const ticked = tasks.present ? tasks.done : 0;

  // FACTS
  const facts = [];
  if (tasks.present) facts.push({ text: `tasks: ${tasks.done}/${tasks.total} boxes ticked`, tags: 'tasks.md' });
  if (s.pending) {
    facts.push({
      text: `open session: ${oneLine(s.pending.role) || 'unknown role'} started ${oneLine(s.pending.startedAt)}`,
      tags: 'metrics.json',
    });
  }
  if (usable && !s.handoff?.present) {
    facts.push({
      text: `checkpoint seq ${checkpointRecord.seq} saved ${oneLine(checkpointRecord.savedAt)} (reported by the agent, not verified)`,
      tags: 'checkpoint.json',
    });
  } else if (usable) {
    facts.push({
      text: `checkpoint seq ${checkpointRecord.seq} saved ${oneLine(checkpointRecord.savedAt)}, newer than handoff.md (reported by the agent, not verified)`,
      tags: 'checkpoint.json, handoff.md',
    });
  } else if (superseded) {
    facts.push({
      text: `checkpoint seq ${checkpointRecord.seq} saved ${oneLine(checkpointRecord.savedAt)}, superseded by a later handoff.md (only its reported decisions are used)`,
      tags: 'checkpoint.json, handoff.md',
    });
  }
  if (usable) {
    const reported = [
      ['task', checkpointRecord.task],
      ['done', checkpointRecord.done],
      ['blocker', checkpointRecord.blocked],
      ['next', checkpointRecord.next],
    ];
    for (const [label, value] of reported) {
      if (value === null || value === undefined || String(value).trim() === '') continue;
      facts.push({ text: `reported ${label}: ${firstLine(value)}`, tags: 'checkpoint.json' });
    }
  }
  if (s.handoff?.present && !usable) {
    if (nextCommand) facts.push({ text: `handoff next: ${nextCommand} (${nextRole || 'unknown role'})`, tags: 'handoff.md' });
    const blocked = firstLine((fields && fields.blocked) || '');
    if (blocked && blocked.trim().toLowerCase() !== 'none') {
      facts.push({ text: `handoff blocker: ${blocked}`, tags: 'handoff.md' });
    }
  }
  if (review.present) facts.push({ text: `review: ${oneLine(verdict)}`, tags: 'review.md' });
  if (isApprove && currency.state === 'current') {
    facts.push({ text: `review covers the current planning artifacts (git, ${sha7})`, tags: 'review.md, git' });
  }
  if (decisions.entries.length > 0) {
    const newest = decisions.entries[decisions.entries.length - 1];
    const text = typeof newest === 'string' ? newest : (newest && (newest.text || newest.decision)) || '';
    facts.push({ text: `decisions: ${decisions.entries.length} recorded; newest: ${firstLine(text)}`, tags: 'decisions.md' });
  }
  if (git.changed.length > 0) {
    facts.push({ text: `git: ${git.changed.length} changed path(s): ${joinUpTo(git.changed.map(oneLine), 3)}`, tags: 'git' });
  }
  if (git.available && git.commits.length > 0) {
    const subjects = git.commits.map((commit) => oneLine(commit.subject)).join('; ');
    if (git.refKind !== 'none') {
      facts.push({ text: `git: ${git.commits.length} commit(s) since ${oneLine(git.ref)}: ${subjects}`, tags: 'git' });
    } else {
      facts.push({ text: `git: last ${git.commits.length} commit(s), unscoped: ${subjects}`, tags: 'git' });
    }
  }
  if (git.shortstat) facts.push({ text: `git: ${oneLine(git.shortstat)}`, tags: 'git' });

  // UNKNOWN
  const unknown = [];
  if (s.handoff?.stale) {
    unknown.push({ text: 'handoff.md predates the edits: its Done and Next command may be outdated', tags: 'handoff.md, file mtimes' });
  }
  if (isApprove && currency.state === 'unknown') {
    unknown.push({
      text: `review currency unknown: ${oneLine(verdict)} may not cover the current artifacts (${oneLine(currency.reason) || 'unknown'})`,
      tags: 'review.md, git',
    });
  }
  const unrecorded = s.decisionsUnrecorded || [];
  const lead = superseded
    ? 'reported decision from a superseded checkpoint not in decisions.md yet'
    : 'reported decision not in decisions.md yet';
  for (const decision of unrecorded.slice(0, 3)) {
    unknown.push({
      text: `${lead} (recorded when Session Exit persists ## Decisions): ${firstLine(decision)}`,
      tags: 'checkpoint.json, decisions.md',
    });
  }
  if (unrecorded.length > 3) {
    unknown.push({ text: `${unrecorded.length - 3} more reported decisions are not in decisions.md`, tags: 'checkpoint.json, decisions.md' });
  }
  if (ticked > 0) {
    unknown.push({
      text: `${ticked} boxes ticked; a ticked box does not confirm that tests passed; no test result is evaluated`,
      tags: 'tasks.md',
    });
  }
  const changedPaths = (git.changed || []).map(String);
  const matches = (file) => changedPaths.find((path) => (file.endsWith('/') ? path.startsWith(file) : path === file));
  const modifiedTasks = [];
  for (const item of tasks.items || []) {
    if (item.checked) continue;
    let hit = null;
    for (const file of item.files || []) {
      hit = matches(file);
      if (hit) break;
    }
    if (hit) modifiedTasks.push({ id: item.id, path: hit });
  }
  for (const entry of modifiedTasks.slice(0, 4)) {
    unknown.push({ text: `task ${oneLine(entry.id)} lists ${oneLine(entry.path)}, which is modified; completion is not confirmed`, tags: 'tasks.md, git' });
  }
  if (modifiedTasks.length > 4) {
    unknown.push({ text: `${modifiedTasks.length - 4} more unticked tasks list modified paths`, tags: 'tasks.md, git' });
  }

  // CONTRADICTIONS
  const contradictions = [];
  if (isApprove && currency.state === 'stale') {
    contradictions.push({
      text: `review.md says ${oneLine(verdict)} but ${joinUpTo((currency.files || []).map(oneLine), 3)} changed after commit ${sha7}, the last commit that touched review.md; the verdict does not cover the current artifacts`,
      tags: 'review.md, git',
    });
  }
  const reportedDone = usable && checkpointRecord.snapshot && checkpointRecord.snapshot.tasks ? checkpointRecord.snapshot.tasks.done : null;
  const fewerTicked = usable && Number.isInteger(reportedDone) && ticked < reportedDone;
  if (fewerTicked) {
    contradictions.push({ text: `tasks.md shows ${ticked} ticked boxes, the checkpoint reported ${reportedDone}`, tags: 'tasks.md, checkpoint.json' });
  }
  const handoffNext = oneLine((fields && (fields.nextCommand || fields.next_command)) || '');
  if (/^\/opsx:(explore|design|propose|review)/.test(handoffNext) && ticked > 0) {
    contradictions.push({ text: `handoff.md next command ${handoffNext} precedes apply, but ${ticked} boxes are ticked`, tags: 'handoff.md, tasks.md' });
  }

  // GAPS
  const gapItems = (s.gaps || []).map((gap) => ({ text: oneLine(gap.text), tags: oneLine(gap.source) }));

  // QUESTIONS
  const questions = [];
  const taskFiles = [];
  for (const item of tasks.items || []) for (const file of item.files || []) taskFiles.push(file);
  const unmatched = changedPaths.filter(
    (path) => !taskFiles.some((file) => (file.endsWith('/') ? path.startsWith(file) : path === file)),
  );
  if (unmatched.length > 0 && !/^\/opsx:apply/.test(handoffNext)) {
    questions.push({
      text: `${unmatched.length} modified path(s) match no task Files: (${joinUpTo(unmatched.map(oneLine), 3)}): do they belong to this change?`,
      tags: 'git, tasks.md',
    });
  }
  if (fewerTicked) {
    questions.push({ text: `tasks.md shows ${ticked} ticked boxes but the checkpoint reported ${reportedDone}: which is right?`, tags: 'tasks.md, checkpoint.json' });
  }
  const hasRole = (s.pending && oneLine(s.pending.role).trim()) || nextRole.trim() || (usable && checkpointRecord.role);
  if (!hasRole) {
    questions.push({
      text: 'Which role was running? No open session, handoff next role or usable checkpoint names it.',
      tags: 'metrics.json, handoff.md, checkpoint.json',
    });
  }

  const capped = {
    FACTS: capSection(facts, CAPS.FACTS, false),
    UNKNOWN: capSection(unknown, CAPS.UNKNOWN, false),
    CONTRADICTIONS: capSection(contradictions, CAPS.CONTRADICTIONS, true),
    GAPS: capSection(gapItems, CAPS.GAPS, true),
    QUESTIONS: capSection(questions, CAPS.QUESTIONS, true),
  };
  let factItems = capped.FACTS.items.map((item) => fitChars(item, 200));
  let unknownItems = capped.UNKNOWN.items.map((item) => fitChars(item, 200));
  const protectedSections = {
    CONTRADICTIONS: capped.CONTRADICTIONS.items.map((item) => fitChars(item, 200)),
    GAPS: capped.GAPS.items.map((item) => fitChars(item, 200)),
    QUESTIONS: capped.QUESTIONS.items.map((item) => fitChars(item, 200)),
  };
  let omitted = capped.FACTS.dropped + capped.UNKNOWN.dropped;

  const sourceNames = ['handoff.md', 'decisions.md', 'tasks.md', 'review.md', 'checkpoint.json', 'metrics.json'].filter((file) => {
    if (file === 'handoff.md') return Boolean(s.handoff?.present);
    if (file === 'decisions.md') return Boolean(decisions.present);
    if (file === 'tasks.md') return Boolean(tasks.present);
    if (file === 'review.md') return Boolean(review.present);
    if (file === 'checkpoint.json') return s.checkpoint && s.checkpoint.state === 'valid';
    return Boolean(s.pending);
  });
  let details = `DETAILS: openspec/changes/${name}/ (${sourceNames.join(', ')})`;
  if (git.available) {
    details += git.refKind === 'none' ? ' · git log -5' : ` · git log ${oneLine(git.ref)}..HEAD`;
  }

  const assemble = () => {
    const lines = [`RECOVERY BRIEFING — ${name} (local files and git only; read-only; canonical files unchanged)`];
    const section = (heading, items) => {
      lines.push(heading);
      if (items.length === 0) lines.push('- none');
      else for (const item of items) lines.push(render(item));
    };
    section('FACTS', factItems);
    section('UNKNOWN', unknownItems);
    section('CONTRADICTIONS', protectedSections.CONTRADICTIONS);
    section('GAPS', protectedSections.GAPS);
    section(QUESTIONS_HEADING, protectedSections.QUESTIONS);
    if (omitted > 0) lines.push(`(${omitted} more omitted; see the files below) [DETAILS]`);
    lines.push(details);
    return lines;
  };
  const tooBig = (lines) => Buffer.byteLength(`${lines.join('\n')}\n`) > MAX_BYTES;

  let lines = assemble();
  if (tooBig(lines)) {
    factItems = factItems.map((item) => fitChars(item, 120));
    unknownItems = unknownItems.map((item) => fitChars(item, 120));
    lines = assemble();
  }
  while (tooBig(lines) && (unknownItems.length > 0 || factItems.length > 0)) {
    if (unknownItems.length > 0) unknownItems = unknownItems.slice(0, -1);
    else factItems = factItems.slice(0, -1);
    omitted += 1;
    lines = assemble();
  }
  if (tooBig(lines)) {
    const originals = {
      CONTRADICTIONS: protectedSections.CONTRADICTIONS,
      GAPS: protectedSections.GAPS,
      QUESTIONS: protectedSections.QUESTIONS,
    };
    for (const budget of [400, 200, 120, 64]) {
      for (const key of ['CONTRADICTIONS', 'GAPS', 'QUESTIONS']) {
        protectedSections[key] = originals[key].map((item) => fitBytes(item, budget));
      }
      lines = assemble();
      if (!tooBig(lines)) break;
    }
  }
  return lines;
}
