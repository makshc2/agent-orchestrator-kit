import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pin the Part B checkpoint guidance: it lives in the two apply twins and is
// referenced by /opsx:quick, and it never leaks into always-on context.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = (rel) => readFileSync(join(KIT_ROOT, 'templates', rel), 'utf-8');

const APPLY_FILES = [
  '.agents/commands/opsx-apply.md',
  '.agents/skills/openspec-apply-change/SKILL.md',
];
const MARKER = 'checkpoint <name> --task <id>';

test('apply twins carry the same checkpoint bullet', () => {
  const bullets = [];
  for (const rel of APPLY_FILES) {
    const lines = template(rel).split('\n');
    const hits = lines.filter((l) => l.includes(MARKER));
    assert.equal(hits.length, 1, `${rel}: expected exactly one checkpoint bullet`);
    const idx = lines.findIndex((l) => l.includes(MARKER));
    const stepIdx = lines.findIndex((l) => l.includes('6. **Implement tasks'));
    const step65Idx = lines.findIndex((l) => l.startsWith('6.5.'));
    assert.ok(stepIdx >= 0, `${rel}: step 6 heading missing`);
    assert.ok(step65Idx >= 0, `${rel}: step 6.5 heading missing`);
    assert.ok(idx > stepIdx, `${rel}: bullet must follow step 6`);
    assert.ok(idx < step65Idx, `${rel}: bullet must precede step 6.5`);
    bullets.push(hits[0]);
  }
  assert.equal(bullets[0], bullets[1], 'the bullet must be byte-identical in both apply twins');
  const bullet = bullets[0];
  for (const phrase of ['code-reviewer', '## Decisions', 'never blocks the session']) {
    assert.ok(bullet.includes(phrase), `bullet must mention ${phrase}`);
  }
});

test('quick points to the apply checkpoint step', () => {
  const quick = template('.agents/commands/opsx-quick.md');
  assert.ok(quick.includes('checkpoint'), 'opsx-quick.md must mention checkpoint');
  assert.ok(quick.includes('/opsx:apply'), 'opsx-quick.md must point at /opsx:apply');
});

test('always-on text is untouched', () => {
  const files = ['AGENTS.md'];
  const rulesDir = join(KIT_ROOT, 'templates', '.agents', 'rules');
  for (const name of readdirSync(rulesDir)) {
    if (!name.endsWith('.mdc')) continue;
    const rel = join('.agents', 'rules', name);
    if (/alwaysApply:\s*true/.test(template(rel))) files.push(rel);
  }
  assert.ok(files.length > 1, 'expected at least one always-apply rule file');
  for (const rel of files) {
    assert.ok(
      !/checkpoint/i.test(template(rel)),
      `${rel} is always-on context and must not mention checkpoint`,
    );
  }
});
