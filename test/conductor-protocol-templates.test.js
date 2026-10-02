import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { checkReviewMd } from '../bin/agent-orchestrator.js';

// Pin phrases of the cost-lean conductor protocol in the shipped templates:
// the thin conductor of /opsx:propose, the review.md schema gate of
// /opsx:review and the narrow-reading rules of both spec specialists.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const template = (rel) => readFileSync(join(KIT_ROOT, 'templates', rel), 'utf-8');

const PROPOSE_FILES = ['.agents/commands/opsx-propose.md', '.agents/skills/openspec-propose/SKILL.md'];
const THIN_CONDUCTOR = '**Thin conductor (cost-lean protocol):**';

function assertIncludes(rel, content, phrases) {
  for (const phrase of phrases) assert.ok(content.includes(phrase), `${rel}: missing "${phrase}"`);
}

// The paragraph that starts with `marker`, up to the next blank line.
function paragraphFrom(rel, content, marker) {
  const start = content.indexOf(marker);
  assert.notEqual(start, -1, `${rel}: missing "${marker}"`);
  assert.equal(content.indexOf(marker, start + 1), -1, `${rel}: "${marker}" occurs more than once`);
  const end = content.indexOf('\n\n', start);
  assert.notEqual(end, -1, `${rel}: no blank line after the paragraph`);
  return content.slice(start, end);
}

test('opsx-propose.md and its skill mirror carry the same Thin conductor paragraph', () => {
  const pins = [
    'MUST NOT research the repo',
    'at most 5 tool calls',
    'at most 3 tool calls',
    'brief PATH',
    'MUST NOT re-read the artifacts',
    'on a re-propose after Verdict REQUEST CHANGES',
  ];
  const paragraphs = PROPOSE_FILES.map((rel) => {
    const content = template(rel);
    assertIncludes(rel, content, pins);
    const paragraph = paragraphFrom(rel, content, THIN_CONDUCTOR);
    assertIncludes(`${rel} (Thin conductor paragraph)`, paragraph, pins);
    return paragraph;
  });
  assert.equal(paragraphs[0], paragraphs[1]);
});

test('the propose templates relay the artifact budget warning and keep the Tier 1 pre-gate wording', () => {
  for (const rel of PROPOSE_FILES) {
    assertIncludes(rel, template(rel), [
      'does not change the exit code: relay it verbatim',
      'Tier 1 pre-gate',
      'exit 0 is forbidden',
      'If the pre-gate still fails after the one re-spawn, report',
    ]);
  }
});

test('opsx-review.md runs gate-check --review-md and its APPROVE example passes the gate', () => {
  const rel = '.agents/commands/opsx-review.md';
  const content = template(rel);
  assertIncludes(rel, content, [
    'gate-check --review-md <name>',
    'NEXT-AFTER-RC applies only to an accepted (schema-conforming) RC',
    '**Source:** gate-check',
  ]);
  assert.ok(!content.includes('MUST reject an RC'), `${rel}: the manual heading check is still there`);

  const example = content.match(/```markdown\n(# Spec Review\n[\s\S]*?)\n```/);
  assert.ok(example, `${rel}: no markdown example that starts with "# Spec Review"`);
  const dir = mkdtempSync(join(tmpdir(), 'aok-review-example-'));
  try {
    writeFileSync(join(dir, 'review.md'), `${example[1]}\n`);
    writeFileSync(join(dir, 'apply-notes.md'), '- constraint\n- pitfall\n- verification command\n');
    assert.deepEqual(checkReviewMd(dir), { pass: true, errors: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-architect.md and spec-reviewer.md carry the narrow-reading rules', () => {
  const architect = '.agents/subagents/spec-architect.md';
  const reviewer = '.agents/subagents/spec-reviewer.md';
  for (const rel of [architect, reviewer]) {
    assertIncludes(rel, template(rel), [
      'never re-read a file already read in this session',
      'batch independent reads into one call',
      'are read in full, once',
    ]);
  }
  assertIncludes(architect, template(architect), ['artifact budget']);
  assertIncludes(reviewer, template(reviewer), ['gate-check --review-md <name>']);
});
