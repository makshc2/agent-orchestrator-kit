import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { isGreenApplyExit } from '../bin/agent-orchestrator.js';

// /opsx:quick is a working path for small changes: a minimal delta keeps
// strict validation green, and when require_spec_review is true a light
// in-session spec-reviewer pass writes a real review.md that the gates accept.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
const OPENSPEC_BIN = join(KIT_ROOT, 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js');
const template = (rel) => readFileSync(join(KIT_ROOT, 'templates', rel), 'utf-8');

function assertIncludes(rel, content, phrases) {
  for (const phrase of phrases) assert.ok(content.includes(phrase), `${rel}: missing "${phrase}"`);
}

const PROPOSAL = `## Why

A small demo needs an export button so users can download the current table.

## What Changes

- Add an export button to the table toolbar.

## Non-goals

- No new export formats.

## Acceptance criteria

- The toolbar shows an Export button.
`;

const TASKS = `## 1. Export button

- [ ] 1.1 Add the Export button
  Files: src/toolbar.txt
  Do: Append the line \`Export button\` to src/toolbar.txt.
  Done-when: src/toolbar.txt contains the line \`Export button\`.
`;

const DELTA = `## ADDED Requirements

### Requirement: Toolbar export button

The toolbar SHALL show an Export button.

#### Scenario: Export button is visible

- **WHEN** the table toolbar renders
- **THEN** it shows an Export button
`;

const QUICK_REVIEW = `# Spec Review

**Verdict:** APPROVE
**Mode:** quick

## Checklist

- [x] proposal ↔ tasks ↔ delta consistent

## Previous findings

none — first review cycle
`;

function quickProject({ delta = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aok-opsx-quick-'));
  symlinkSync(join(KIT_ROOT, 'node_modules'), join(dir, 'node_modules'));
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents', 'orchestrator.yaml'), 'version: 1\npipeline:\n  require_spec_review: true\n  task_contract: strict\n');
  mkdirSync(join(dir, 'openspec', 'specs'), { recursive: true });
  writeFileSync(join(dir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'toolbar.txt'), '');
  const change = join(dir, 'openspec', 'changes', 'quick-demo');
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, 'proposal.md'), PROPOSAL);
  writeFileSync(join(change, 'tasks.md'), TASKS);
  if (delta) {
    mkdirSync(join(change, 'specs', 'toolbar'), { recursive: true });
    writeFileSync(join(change, 'specs', 'toolbar', 'spec.md'), DELTA);
  }
  return { dir, change };
}

function run(dir, args) {
  const env = { ...process.env, HOME: join(dir, '.aok-home'), OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' };
  return spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf-8', timeout: 60000 });
}

test('opsx-quick.md: minimal delta, light review when required, Implementer exit with the archive line', () => {
  const rel = '.agents/commands/opsx-quick.md';
  const content = template(rel);
  assertIncludes(rel, content, [
    'missing file or key = `true`',
    'a minimal delta: one `## ADDED Requirements`',
    '`openspec validate --strict` rejects a change without a delta',
    'npx agent-orchestrator-kit gate-check --review <name>',
    'spawn `spec-reviewer` in quick mode',
    'npx agent-orchestrator-kit gate-check --review-md <name>',
    'never write `review.md` yourself',
    'next command `/opsx:propose <name>`',
    'Apply is parent-driven exactly as in `/opsx:apply`',
    '`Implementer — quick`',
    'npx agent-orchestrator-kit archive <name> --sync',
  ]);
  assert.ok(!content.includes('Skip `specs/` delta'), `${rel}: still tells the architect to skip the delta`);
  assert.ok(!content.includes('run `/opsx:archive` after CI green'), `${rel}: still routes archive through a chat command`);

  assertIncludes('.agents/subagents/spec-reviewer.md', template('.agents/subagents/spec-reviewer.md'), [
    'Quick mode (the spawn prompt mentions `/opsx:quick`)',
    'REQUEST CHANGES only for a Blocker',
    '`**Mode:** quick`',
  ]);
  assertIncludes('.agents/subagents/spec-architect.md', template('.agents/subagents/spec-architect.md'), [
    'a minimal delta of one requirement with one scenario',
    '**Gate:** not run (/opsx:quick)',
  ]);
  assert.equal(isGreenApplyExit({ closedRole: 'Implementer — quick', blocked: 'none' }, { done: 1, total: 1 }), true);
});

test('a quick change without a delta fails strict validation', () => {
  const { dir } = quickProject({ delta: false });
  try {
    const res = run(dir, [OPENSPEC_BIN, 'validate', 'quick-demo', '--strict', '--type', 'change']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout + res.stderr, /Change must have at least one delta/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a minimal quick change passes Tier 1 and a quick-mode review.md passes the schema gate', () => {
  const { dir, change } = quickProject();
  try {
    const validate = run(dir, [OPENSPEC_BIN, 'validate', 'quick-demo', '--strict', '--type', 'change']);
    assert.equal(validate.status, 0, validate.stdout + validate.stderr);
    const tier1 = run(dir, [CLI, 'gate-check', '--review', 'quick-demo', '--json']);
    assert.equal(tier1.status, 0, tier1.stdout + tier1.stderr);
    assert.deepEqual(JSON.parse(tier1.stdout).errors, []);

    writeFileSync(join(change, 'review.md'), QUICK_REVIEW);
    writeFileSync(join(change, 'apply-notes.md'), '- Major: none\n- Verify: grep -c "Export button" src/toolbar.txt\n');
    const schema = run(dir, [CLI, 'gate-check', '--review-md', 'quick-demo']);
    assert.equal(schema.status, 0, schema.stdout + schema.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
