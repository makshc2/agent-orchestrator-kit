import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { checkReviewMd } from '../bin/agent-orchestrator.js';

// `gate-check --review-md <name>` checks review.md against the /opsx:review
// schema: exactly one Verdict line, the `Previous findings` heading after any
// Tier 2 pass, non-empty Checklist / Findings (Blocker, Major, Minor) /
// Required Before Apply on REQUEST CHANGES, and an apply-notes.md of at most
// 20 lines on APPROVE. A Tier 1 record is held to its verdict alone.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;

const MISSING_PREVIOUS = 'review.md: missing "Previous findings" section';

// Tier 2 APPROVE as written for archive-from-terminal (R4).
const APPROVE = [
  '# Spec Review',
  '',
  '**Change:** demo-change',
  '**Date:** 2026-10-02',
  '**Verdict:** APPROVE',
  '',
  '## Checklist summary',
  '- Proposal: ✓',
  '- Design: ✓',
  '- Tasks: ✓',
  '- Delta specs: ✓',
  '',
  '## Notes',
  'Nothing blocking.',
  '',
  '## Previous findings',
  'none — first review cycle',
  '',
];

// Tier 2 REQUEST CHANGES as written for propose-review-pregate, with one
// section the schema does not know.
const REQUEST_CHANGES = [
  '# Spec Review',
  '',
  '**Change:** demo-change',
  '**Verdict:** REQUEST CHANGES',
  '',
  '## Checklist',
  '- proposal ↔ design ↔ tasks: ✗',
  '- Delta specs cover design: ✓',
  '',
  '## Findings',
  '',
  '### Blocker',
  '1. Task 2.1 contradicts design D3.',
  '',
  '### Major',
  '',
  '### Minor',
  '',
  '## Required Before Apply',
  '1. Align task 2.1 with D3.',
  '',
  '## Reviewer notes',
  'Checked in a scratch copy.',
  '',
  '## Previous findings',
  'none — first review cycle',
  '',
];

// The record the parent writes when Tier 1 fails: no Checklist section.
const TIER1_RECORD = [
  '# Spec Review',
  '',
  '**Change:** demo-change',
  '**Verdict:** REQUEST CHANGES',
  '',
  '**Source:** gate-check',
  '',
  '## Errors',
  '- proposal.md: missing "Non-goals" section',
  '',
];

const text = (lines) => lines.join('\n');
const without = (lines, ...dropped) => lines.filter((line) => !dropped.includes(line));
const notes = (count) => `${Array.from({ length: count }, (_, i) => `- note ${i + 1}`).join('\n')}\n`;

function writeChange(changeDir, review, applyNotes) {
  mkdirSync(changeDir, { recursive: true });
  if (review !== undefined) writeFileSync(join(changeDir, 'review.md'), review);
  if (applyNotes !== undefined) writeFileSync(join(changeDir, 'apply-notes.md'), applyNotes);
  return changeDir;
}

// Runs checkReviewMd over a temp change directory holding the given files.
function check(review, applyNotes) {
  const dir = mkdtempSync(join(tmpdir(), 'aok-review-md-'));
  try {
    return checkReviewMd(writeChange(join(dir, 'demo-change'), review, applyNotes));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cliSpawn(dir, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8' });
  return { status: res.status, stdout: String(res.stdout).replace(ANSI_RE, ''), stderr: String(res.stderr).replace(ANSI_RE, '') };
}

test('a Tier 2 APPROVE with Previous findings and a 20-line apply-notes.md passes', () => {
  assert.deepEqual(check(text(APPROVE), notes(20)), { pass: true, errors: [] });
  // A verdict suffix and a heading-style Verdict line are accepted.
  const suffixed = text(APPROVE).replace('**Verdict:** APPROVE', '## Verdict: approve ✓');
  assert.deepEqual(check(suffixed, notes(3)), { pass: true, errors: [] });
});

test('a Tier 2 REQUEST CHANGES with every required section passes, extra sections are ignored', () => {
  assert.deepEqual(check(text(REQUEST_CHANGES)), { pass: true, errors: [] });
  // Heading level and case do not matter; a bucket may be a bold line.
  const loose = text(REQUEST_CHANGES)
    .replace('## Checklist', '### checklist')
    .replace('## Required Before Apply', '#### required before apply')
    .replace('### Blocker', '**Blocker**')
    .replace('### Major', '**Major** (none)')
    .replace('## Previous findings', '# PREVIOUS FINDINGS');
  assert.deepEqual(check(loose), { pass: true, errors: [] });
});

test('a Tier 1 record is held to its verdict only', () => {
  assert.deepEqual(check(text(TIER1_RECORD)), { pass: true, errors: [] });

  const approved = check(text(TIER1_RECORD).replace('REQUEST CHANGES', 'APPROVE'));
  assert.equal(approved.pass, false);
  assert.deepEqual(approved.errors, ['review.md: a Tier 1 record (**Source:** gate-check) must have Verdict REQUEST CHANGES']);

  // With a Checklist section the file is a Tier 2 review, whatever its Source line says.
  const tier2 = check(text([...without(REQUEST_CHANGES, '## Previous findings', 'none — first review cycle'), '**Source:** gate-check', '']));
  assert.equal(tier2.pass, false);
  assert.deepEqual(tier2.errors, [MISSING_PREVIOUS]);

  // The Source line must match exactly.
  const inline = check(text(TIER1_RECORD).replace('**Source:** gate-check', 'See **Source:** gate-check above'));
  assert.ok(inline.errors.includes(MISSING_PREVIOUS), JSON.stringify(inline.errors));
});

test('the Verdict line must be present, single and APPROVE or REQUEST CHANGES', () => {
  const none = check(text(without(APPROVE, '**Verdict:** APPROVE')), notes(3));
  assert.deepEqual(none, { pass: false, errors: ['review.md: no Verdict line'] });

  const two = check(text([...APPROVE, 'Verdict: APPROVE', '']), notes(3));
  assert.deepEqual(two, { pass: false, errors: ['review.md: 2 Verdict lines (exactly one required)'] });

  const maybe = check(text(APPROVE).replace('**Verdict:** APPROVE', '**Verdict:** MAYBE'), notes(3));
  assert.deepEqual(maybe, { pass: false, errors: ['review.md: Verdict "MAYBE" is neither APPROVE nor REQUEST CHANGES'] });
});

test('REQUEST CHANGES needs non-empty Checklist, Findings with three buckets and Required Before Apply', () => {
  const noRequired = check(text(without(REQUEST_CHANGES, '## Required Before Apply', '1. Align task 2.1 with D3.')));
  assert.deepEqual(noRequired, { pass: false, errors: ['review.md: missing "Required Before Apply" section'] });

  const emptyChecklist = check(text(without(REQUEST_CHANGES, '- proposal ↔ design ↔ tasks: ✗', '- Delta specs cover design: ✓')));
  assert.deepEqual(emptyChecklist, { pass: false, errors: ['review.md: "Checklist" section is empty'] });

  const noMinor = check(text(without(REQUEST_CHANGES, '### Minor')));
  assert.deepEqual(noMinor, { pass: false, errors: ['review.md: Findings has no "Minor" bucket'] });

  const noFindings = check(text(without(REQUEST_CHANGES, '## Findings', '### Blocker', '1. Task 2.1 contradicts design D3.', '### Major', '### Minor')));
  assert.deepEqual(noFindings, { pass: false, errors: ['review.md: missing "Findings" section'] });
});

test('a Tier 2 review without the Previous findings heading fails, APPROVE and REQUEST CHANGES alike', () => {
  const dropped = ['## Previous findings', 'none — first review cycle'];
  assert.deepEqual(check(text(without(APPROVE, ...dropped)), notes(3)), { pass: false, errors: [MISSING_PREVIOUS] });
  assert.deepEqual(check(text(without(REQUEST_CHANGES, ...dropped))), { pass: false, errors: [MISSING_PREVIOUS] });
});

test('APPROVE needs an apply-notes.md of at most 20 lines', () => {
  assert.deepEqual(check(text(APPROVE)), { pass: false, errors: ['apply-notes.md not found (required on APPROVE)'] });
  assert.deepEqual(check(text(APPROVE), notes(21)), { pass: false, errors: ['apply-notes.md has 21 lines (max 20)'] });
  // Trailing blank lines are not counted.
  assert.deepEqual(check(text(APPROVE), `${notes(20)}\n\n\n`), { pass: true, errors: [] });
});

test('a change directory without review.md fails with a single error', () => {
  assert.deepEqual(check(undefined, notes(3)), { pass: false, errors: ['review.md not found'] });
});

test('gate-check --review-md reports through the exit code, the text output and --json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-review-md-cli-'));
  try {
    writeChange(join(dir, 'openspec/changes/good-change'), text(APPROVE), notes(3));
    writeChange(join(dir, 'openspec/changes/bad-change'), text(without(APPROVE, '## Previous findings', 'none — first review cycle')), notes(3));

    const good = cliSpawn(dir, ['gate-check', '--review-md', 'good-change']);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.ok(good.stdout.includes('gate-check --review-md  good-change'), good.stdout);
    assert.ok(good.stdout.includes('review.md conforms to the schema'), good.stdout);
    const goodJson = cliSpawn(dir, ['gate-check', '--review-md', 'good-change', '--json']);
    assert.equal(goodJson.status, 0, goodJson.stdout + goodJson.stderr);
    assert.deepEqual(JSON.parse(goodJson.stdout), { pass: true, errors: [] });

    const bad = cliSpawn(dir, ['gate-check', '--review-md', 'bad-change']);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.ok(bad.stdout.includes(MISSING_PREVIOUS), bad.stdout);
    assert.ok(bad.stdout.includes('review.md schema check failed — 1 error(s)'), bad.stdout);
    assert.ok(!bad.stdout.includes('conforms'), bad.stdout);
    const badJson = cliSpawn(dir, ['gate-check', '--review-md', 'bad-change', '--json']);
    assert.equal(badJson.status, 1, badJson.stdout + badJson.stderr);
    assert.deepEqual(JSON.parse(badJson.stdout), { pass: false, errors: [MISSING_PREVIOUS] });

    const unsafe = cliSpawn(dir, ['gate-check', '--review-md', '../x', '--json']);
    assert.equal(unsafe.status, 1, unsafe.stdout + unsafe.stderr);
    assert.deepEqual(JSON.parse(unsafe.stdout), { pass: false, errors: ['invalid change name: ../x'] });

    const missing = cliSpawn(dir, ['gate-check', '--review-md', 'no-such-change', '--json']);
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.deepEqual(JSON.parse(missing.stdout), { pass: false, errors: ['change not found: no-such-change'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// These 17 archived reviews predate the `Previous findings` schema; the 5
// oldest also have no apply-notes.md, and add-factory-gates-and-mcp has a
// 24-line apply-notes.md. Every other archived review.md must conform.
const LEGACY_REVIEW_MD = [
  '2026-06-27-add-gitlab-verify',
  '2026-07-12-add-design-intake',
  '2026-07-12-add-pipeline-automation-hardening',
  '2026-08-13-add-pipeline-subagent-conductor',
  '2026-08-13-figma-token-setup',
  '2026-08-18-lean-pipeline-v2',
  '2026-08-20-agentic-factory-roadmap',
  '2026-08-27-add-factory-gates-and-mcp',
  '2026-08-27-add-factory-memory-and-skills',
  '2026-08-28-add-cloud-agent-handoff',
  '2026-08-29-fix-metrics-model-and-spend',
  '2026-08-30-prompt-session-metrics',
  '2026-08-31-fix-metrics-session-attribution',
  '2026-08-31-surface-estimated-spend',
  '2026-09-02-fix-cursor-leftover-race-and-multiroot',
  '2026-09-04-fix-metrics-amp-cost-lock-leftover',
  '2026-09-07-fix-metrics-dedup-window-compact-schema',
];

test('archived review.md files conform, except the listed ones that predate the schema', () => {
  assert.equal(LEGACY_REVIEW_MD.length, 17);
  const archiveDir = join(KIT_ROOT, 'openspec/changes/archive');
  const reviewed = readdirSync(archiveDir).filter((name) => existsSync(join(archiveDir, name, 'review.md')));
  for (const name of LEGACY_REVIEW_MD) assert.ok(reviewed.includes(name), `${name}: no archived review.md`);
  for (const name of ['2026-09-07-exhaustive-review-findings', '2026-09-25-propose-review-pregate', '2026-10-01-archive-from-terminal']) {
    assert.ok(reviewed.includes(name) && !LEGACY_REVIEW_MD.includes(name), `${name}: expected a conforming archived review.md`);
  }

  for (const name of reviewed) {
    const result = checkReviewMd(join(archiveDir, name));
    if (LEGACY_REVIEW_MD.includes(name)) {
      assert.equal(result.pass, false, `${name}: conforms now — remove it from LEGACY_REVIEW_MD`);
      for (const error of result.errors) {
        assert.ok(error.includes('Previous findings') || error.includes('apply-notes.md'), `${name}: ${error}`);
      }
    } else {
      assert.deepEqual(result, { pass: true, errors: [] }, `${name}: ${result.errors.join('; ')}`);
    }
  }
});
