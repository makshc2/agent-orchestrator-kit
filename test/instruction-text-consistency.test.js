import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pin the instruction-text rules of instruction-mirror-consistency: specialists
// own their steps, code-reviewer is on request and diff-gated, quick has no
// time-box, data-contradicting rules stay gone, and the skill keeps the
// statements the main specs require outside its generated mirror blocks.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const template = (rel) => readFileSync(join(KIT_ROOT, 'templates', rel), 'utf-8');
const SKILL = '.agents/skills/agent-orchestration/SKILL.md';

function listMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

test('specialists own the artifact build loop and the design capture steps', () => {
  const architect = template('.agents/subagents/spec-architect.md');
  for (const s of ['openspec instructions', '**Gate:** not run (/opsx:quick)', 'Artifact build loop (first propose):']) {
    assert.ok(architect.includes(s), `spec-architect.md lacks ${s}`);
  }
  for (const rel of ['.agents/commands/opsx-propose.md', '.agents/skills/openspec-propose/SKILL.md']) {
    const text = template(rel);
    assert.ok(!text.includes('openspec instructions'), `${rel} still has openspec instructions`);
    assert.ok(!text.includes('Delegate steps'), `${rel} still has Delegate steps`);
  }
  const intake = template('.agents/subagents/design-intake.md');
  const design = template('.agents/commands/opsx-design.md');
  for (const s of ['Confidence notes', 'figma-fetch']) {
    assert.ok(intake.includes(s), `design-intake.md lacks ${s}`);
    assert.ok(!design.includes(s), `opsx-design.md still has ${s}`);
  }
});

test('code-reviewer is on request and gated on an implementation diff', () => {
  const text = template('.agents/subagents/code-reviewer.md');
  const description = text.split('\n').find((line) => line.startsWith('description:'));
  assert.ok(description.includes('Use on request or before a PR/MR'));
  assert.ok(description.includes('Do NOT use for'));
  assert.ok(!text.includes('ALWAYS use'));
  for (const s of ['git diff HEAD --stat', 'no implementation diff', 'apply-notes.md']) {
    assert.ok(text.includes(s), `code-reviewer.md lacks ${s}`);
  }
});

test('the quick command has no time-box and keeps the single exit', () => {
  const text = template('.agents/commands/opsx-quick.md');
  assert.doesNotMatch(text, /hours/i);
  assert.ok(text.includes('Never emit or request paste of a next-session prompt'));
});

test('data-contradicting rules stay removed from README and templates', () => {
  const readme = readFileSync(join(KIT_ROOT, 'README.md'), 'utf-8');
  const files = [['README.md', readme], ...listMarkdown(join(KIT_ROOT, 'templates')).map((f) => [f, readFileSync(f, 'utf-8')])];
  for (const [name, text] of files) {
    for (const s of ['1–3 tasks', 'Max ~3 hours', 'All tasks in one apply session']) {
      assert.ok(!text.includes(s), `${name} contains ${s}`);
    }
  }
  const skill = template(SKILL);
  for (const [name, text] of [['README.md', readme], [SKILL, skill]]) {
    for (const re of [/`(rush|smart|deep)`/, /\(rush\/smart\/deep\)/, /rush\/flash/]) {
      assert.doesNotMatch(text, re, `${name} matches ${re}`);
    }
  }
});

test('the skill keeps the required statements outside its mirror blocks', () => {
  const skill = template(SKILL);
  const skillOutsideMirrors = skill.replace(/<!-- aok:mirror:begin [^\n]*-->[\s\S]*?<!-- aok:mirror:end [^\n]*-->/g, '');
  for (const s of [
    'Write session artifacts only to git-tracked paths (never `/tmp`, never gitignored caches)',
    'Closed role MAY have a sentence after `—`; metrics stores the canonical token',
    'family `cursor-grok-4.6` is only a fallback',
    'Spec review discovery loops: ≤ 2',
    'one-finding review loop',
    '## Runtime',
  ]) {
    assert.ok(skillOutsideMirrors.includes(s), `skill outside mirrors lacks ${s}`);
  }
  assert.ok(skill.includes('cloud-check'));
  const propose = template('.agents/skills/openspec-propose/SKILL.md');
  for (const s of ['Required Before Apply', 'gate-check --review', 'Tier 1 pre-gate', 'exit 0 is forbidden']) {
    assert.ok(propose.includes(s), `openspec-propose/SKILL.md lacks ${s}`);
  }
});
