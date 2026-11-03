import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pin the apply test-run discipline (step 6.5) in the shipped templates and the
// fix-change regression-test guideline in the four planning guideline files.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = (rel) => readFileSync(join(KIT_ROOT, 'templates', rel), 'utf-8');

const APPLY_FILES = ['.agents/commands/opsx-apply.md', '.agents/skills/openspec-apply-change/SKILL.md'];
const STEP_65 = '6.5. **Run the tests once (before the last box)**';
const STEP_7 = '7. **On completion or pause, show status**';

function stepBlock(rel) {
  const text = template(rel);
  const start = text.indexOf(STEP_65);
  const end = text.indexOf(STEP_7);
  assert.ok(start >= 0, `${rel}: step 6.5 heading missing`);
  assert.ok(end > start, `${rel}: step 7 must follow step 6.5`);
  const step6 = text.indexOf('6. **Implement tasks');
  assert.ok(step6 >= 0 && step6 < start, `${rel}: step 6.5 must follow step 6`);
  return text.slice(start, end);
}

test('step 6.5 is identical in both apply twins and sits between step 6 and step 7', () => {
  const blocks = APPLY_FILES.map(stepBlock);
  assert.equal(blocks[0], blocks[1], 'step 6.5 must be byte-identical in both apply twins');
});

test('step 6.5 carries the outcome rules and no archive line', () => {
  const block = stepBlock(APPLY_FILES[0]);
  const phrases = [
    'verifier.test_command',
    'last 20 lines',
    'tests: skipped (no test_command)',
    'Never guess a command such as `npm test`',
    'STOP and leave the last box unticked',
    'Never skip a run without a record',
    'tests: <passed>/<total>',
    'tests: green (exit 0)',
    'tests: red (see Blocked)',
    'accepted by user',
    'tests: not run (paused:',
    'leave `## Blocked` empty',
  ];
  for (const phrase of phrases) assert.ok(block.includes(phrase), `step 6.5 must contain ${phrase}`);
  assert.ok(!block.includes('archive <name> --sync'), 'step 6.5 must not carry an archive command line');
});

test('the apply command keeps the test status and the archive ban in Session Exit', () => {
  const apply = template(APPLY_FILES[0]);
  assert.ok(apply.includes('build/lint and test status in Done'), 'Session Exit must ask for test status');
  assert.ok(apply.includes('Never start archive in this apply chat.'), 'Session Exit must ban archive');
});

test('the quick command asks for the tests status in Done', () => {
  assert.ok(
    template('.agents/commands/opsx-quick.md').includes('build/lint and `tests:` status in Done'),
    'opsx-quick.md must ask for the tests status',
  );
});

test('the four guideline files carry the fix-change regression rule', () => {
  const files = [
    '.agents/subagents/spec-architect.md',
    '.agents/commands/opsx-propose.md',
    '.agents/skills/openspec-propose/SKILL.md',
  ];
  for (const rel of files) {
    const text = template(rel);
    assert.ok(text.includes('starts with `fix-`'), `${rel} must name the fix- prefix`);
    assert.ok(
      text.includes('regression test that fails on the unfixed code'),
      `${rel} must ask for a regression test`,
    );
  }
  const config = readFileSync(join(KIT_ROOT, 'templates', 'openspec-config.yaml.example'), 'utf-8');
  assert.ok(config.includes('starts with `fix-`'), 'the config example must name the fix- prefix');
  assert.ok(
    config.includes('regression test that fails on the unfixed code'),
    'the config example must ask for a regression test',
  );
});

test('the outcome rows say what happens to the last box', () => {
  const lines = stepBlock(APPLY_FILES[0]).split('\n');
  const bullet = (marker) => {
    const line = lines.find((l) => l.trim().startsWith('- ') && l.includes(marker));
    assert.ok(line, `no outcome bullet for ${marker}`);
    return line;
  };
  const skipped = bullet('tests: skipped (no test_command)');
  assert.ok(skipped.includes('tick the last box'), 'the skipped bullet must tick the last box');

  const preExisting = bullet('accepted by user');
  const acceptsAt = preExisting.indexOf('accepts');
  assert.ok(acceptsAt >= 0, 'the pre-existing-failure bullet must name an explicit acceptance');
  assert.ok(
    preExisting.indexOf('tick the last box', acceptsAt) > acceptsAt,
    'the pre-existing-failure bullet must tick the last box only after the user accepts',
  );

  const notRun = bullet('tests: not run (<reason>)');
  assert.ok(notRun.includes('unticked'), 'the not-run bullet must leave the last box unticked');
});
