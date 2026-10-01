import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parseDeltaSpec, planSpecSync } from '../bin/agent-orchestrator.js';

// Tier 1 (`gate-check --review`) runs the same delta-heading check as
// `archive --sync` (planSpecSync): MODIFIED/REMOVED/RENAMED headings must
// byte-match the main spec, ADDED headings must not exist there yet.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');

function isolatedEnv(dir) {
  const env = { ...process.env, HOME: join(dir, '.aok-home'), XDG_CONFIG_HOME: join(dir, '.aok-xdg-config'), XDG_DATA_HOME: join(dir, '.aok-xdg-data'), AMP_DATA_DIR: join(dir, '.aok-amp'), AOK_AMP_BIN: join(dir, '.no-amp-bin') };
  for (const key of ['AOK_MODEL', 'AOK_PLATFORM', 'CURSOR_AGENT', 'CURSOR_CONVERSATION_ID', 'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'AMP_CURRENT_THREAD', 'AMP_THREAD_ID']) delete env[key];
  for (const sub of ['.aok-home', '.aok-xdg-config', '.aok-xdg-data', '.aok-amp']) mkdirSync(join(dir, sub), { recursive: true });
  return env;
}

function runInit(dir) {
  execSync(`node "${CLI}" init --profile generic --name HeadingCheck --lang en`, { cwd: dir, stdio: 'pipe' });
}

// Deterministic openspec stub: `validate` always passes, so only the kit's own
// checks decide the gate-check result.
const OPENSPEC_STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'validate') { console.log('valid (stub)'); process.exit(0); }
if (args[0] === 'status') { console.log('{}'); process.exit(0); }
process.exit(0);
`;

function installOpenspecStub(dir) {
  const pkgDir = join(dir, 'node_modules', 'openspec');
  const binDir = join(dir, 'node_modules', '.bin');
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'openspec', version: '0.0.0', bin: { openspec: './cli.js' } }));
  writeFileSync(join(pkgDir, 'cli.js'), OPENSPEC_STUB, { mode: 0o755 });
  writeFileSync(join(binDir, 'openspec'), '#!/bin/sh\nexec node "$(dirname "$0")/../openspec/cli.js" "$@"\n', { mode: 0o755 });
}

function gateCheckReview(dir, name) {
  const res = spawnSync(process.execPath, [CLI, 'gate-check', '--review', name, '--json'], { cwd: dir, encoding: 'utf-8', env: isolatedEnv(dir) });
  assert.ok(res.stdout.trim(), `no JSON on stdout: ${res.stderr}`);
  return { status: res.status, ...JSON.parse(res.stdout) };
}

const MAIN_SPEC = `## Purpose

Auth capability.

## Requirements

### Requirement: Old Req

The system SHALL use the original behavior.

#### Scenario: original works
- WHEN the old path runs
- THEN it stays original

### Requirement: Dead Req

The system SHALL do something obsolete.

#### Scenario: obsolete
- WHEN legacy runs
- THEN it is obsolete
`;

const REQ = (name, text) => `### Requirement: ${name}\n\n${text}\n\n#### Scenario: ${name} works\n- WHEN it runs\n- THEN it works\n`;

function makeChange(dir, name, { authDelta, mainSpec = MAIN_SPEC }) {
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(join(changeDir, 'specs/auth'), { recursive: true });
  writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\n## Why\n\nBecause.\n\n## Non-goals\n\n- none\n\n## Acceptance criteria\n\n- works\n');
  writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n- [x] 1.1 Do the thing\n  Files: src/thing.js\n  Do: implement the thing exactly as specified\n  Done-when: thing test passes\n');
  writeFileSync(join(changeDir, 'review.md'), '# Spec Review\n\n**Verdict:** APPROVE\n');
  writeFileSync(join(changeDir, 'specs/auth/spec.md'), authDelta);
  mkdirSync(join(dir, 'openspec/specs/auth'), { recursive: true });
  writeFileSync(join(dir, 'openspec/specs/auth/spec.md'), mainSpec);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/thing.js'), 'export const thing = 1;\n');
  return changeDir;
}

function withProject(prefix, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    runInit(dir);
    installOpenspecStub(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parseDeltaSpec reads the RENAMED section as FROM/TO pairs', () => {
  const sections = parseDeltaSpec(
    '## RENAMED Requirements\n\n- FROM: `### Requirement: Old Name`\n- TO: `### Requirement: New Name`\n\nFROM: ### Requirement: Second Old\nTO: ### Requirement: Second New\n\n## MODIFIED Requirements\n\n### Requirement: New Name\n\nbody\n',
  );
  assert.deepEqual(sections.RENAMED, [
    { from: 'Old Name', to: 'New Name' },
    { from: 'Second Old', to: 'Second New' },
  ]);
  assert.deepEqual(sections.MODIFIED.map((r) => r.name), ['New Name']);
  assert.deepEqual(parseDeltaSpec('## ADDED Requirements\n\n### Requirement: X\n\nbody\n').RENAMED, []);
});

test('gate-check --review passes when MODIFIED/REMOVED headings match the main spec', () => {
  withProject('aok-heading-ok-', (dir) => {
    makeChange(dir, 'add-auth', {
      authDelta: `## ADDED Requirements\n\n${REQ('New Req', 'New.')}\n## MODIFIED Requirements\n\n${REQ('Old Req', 'Updated.')}\n## REMOVED Requirements\n\n### Requirement: Dead Req\n\n**Reason**: obsolete\n`,
    });
    const report = gateCheckReview(dir, 'add-auth');
    assert.equal(report.status, 0, JSON.stringify(report));
    assert.equal(report.pass, true);
    assert.deepEqual(report.errors, []);
  });
});

test('gate-check --review fails on a MODIFIED heading absent from the main spec with the archive conflict string', () => {
  withProject('aok-heading-modified-', (dir) => {
    makeChange(dir, 'add-auth', { authDelta: `## MODIFIED Requirements\n\n${REQ('Old Requirement', 'Updated.')}` });
    const report = gateCheckReview(dir, 'add-auth');
    assert.equal(report.status, 1);
    assert.equal(report.pass, false);
    assert.ok(report.errors.includes('auth: MODIFIED requirement not found in main spec: "Old Requirement"'), JSON.stringify(report.errors));
  });
});

test('gate-check --review is byte-exact: case or whitespace drift in a MODIFIED heading still fails', () => {
  withProject('aok-heading-exact-', (dir) => {
    makeChange(dir, 'add-auth', { authDelta: `## MODIFIED Requirements\n\n${REQ('old req', 'Updated.')}` });
    const lower = gateCheckReview(dir, 'add-auth');
    assert.equal(lower.pass, false);
    assert.ok(lower.errors.some((e) => e === 'auth: MODIFIED requirement not found in main spec: "old req"'), JSON.stringify(lower.errors));

    writeFileSync(join(dir, 'openspec/changes/add-auth/specs/auth/spec.md'), `## MODIFIED Requirements\n\n${REQ('Old  Req', 'Updated.')}`);
    const spaced = gateCheckReview(dir, 'add-auth');
    assert.equal(spaced.pass, false);
    assert.ok(spaced.errors.some((e) => e === 'auth: MODIFIED requirement not found in main spec: "Old  Req"'), JSON.stringify(spaced.errors));
  });
});

test('gate-check --review fails on REMOVED-not-found and ADDED-already-exists', () => {
  withProject('aok-heading-removed-added-', (dir) => {
    makeChange(dir, 'add-auth', {
      authDelta: `## ADDED Requirements\n\n${REQ('Old Req', 'Duplicate.')}\n## REMOVED Requirements\n\n### Requirement: Ghost Req\n\n**Reason**: never existed\n`,
    });
    const report = gateCheckReview(dir, 'add-auth');
    assert.equal(report.pass, false);
    assert.ok(report.errors.includes('auth: REMOVED requirement not found in main spec: "Ghost Req"'), JSON.stringify(report.errors));
    assert.ok(report.errors.includes('auth: ADDED requirement already exists in main spec: "Old Req"'), JSON.stringify(report.errors));
  });
});

test('gate-check --review accepts an ADDED-only delta for a capability without a main spec', () => {
  withProject('aok-heading-newcap-', (dir) => {
    const changeDir = makeChange(dir, 'add-auth', { authDelta: `## ADDED Requirements\n\n${REQ('New Req', 'New.')}` });
    mkdirSync(join(changeDir, 'specs/newcap'), { recursive: true });
    writeFileSync(join(changeDir, 'specs/newcap/spec.md'), `## ADDED Requirements\n\n${REQ('Fresh Req', 'Fresh.')}`);
    const report = gateCheckReview(dir, 'add-auth');
    assert.equal(report.pass, true, JSON.stringify(report.errors));
  });
});

test('gate-check --review passes a RENAMED-only delta and rejects a RENAMED FROM absent from the main spec', () => {
  withProject('aok-heading-renamed-', (dir) => {
    makeChange(dir, 'add-auth', { authDelta: '## RENAMED Requirements\n\n- FROM: `### Requirement: Old Req`\n- TO: `### Requirement: Renamed Req`\n' });
    const ok = gateCheckReview(dir, 'add-auth');
    assert.equal(ok.pass, true, JSON.stringify(ok.errors));
    assert.ok(!ok.errors.some((e) => /no non-empty/.test(e)));

    writeFileSync(join(dir, 'openspec/changes/add-auth/specs/auth/spec.md'), '## RENAMED Requirements\n\n- FROM: `### Requirement: Missing Req`\n- TO: `### Requirement: Renamed Req`\n');
    const missing = gateCheckReview(dir, 'add-auth');
    assert.equal(missing.pass, false);
    assert.ok(missing.errors.includes('auth: RENAMED requirement not found in main spec: "Missing Req"'), JSON.stringify(missing.errors));

    writeFileSync(join(dir, 'openspec/changes/add-auth/specs/auth/spec.md'), '## RENAMED Requirements\n\n- FROM: `### Requirement: Old Req`\n- TO: `### Requirement: Dead Req`\n');
    const collides = gateCheckReview(dir, 'add-auth');
    assert.equal(collides.pass, false);
    assert.ok(collides.errors.includes('auth: RENAMED target already exists in main spec: "Dead Req"'), JSON.stringify(collides.errors));
  });
});

test('planSpecSync applies RENAMED before MODIFIED so the new heading is found', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-plan-rename-'));
  try {
    const changeDir = makeChange(dir, 'add-auth', {
      authDelta: `## RENAMED Requirements\n\n- FROM: \`### Requirement: Old Req\`\n- TO: \`### Requirement: Renamed Req\`\n\n## MODIFIED Requirements\n\n${REQ('Renamed Req', 'Updated after rename.')}`,
    });
    const result = planSpecSync(dir, [join(changeDir, 'specs/auth/spec.md')], 'add-auth');
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.plan.length, 1);
    const merged = result.plan[0].newContent;
    assert.match(merged, /^### Requirement: Renamed Req$/m);
    assert.doesNotMatch(merged, /^### Requirement: Old Req$/m);
    assert.match(merged, /Updated after rename\./);
    assert.doesNotMatch(merged, /original behavior/);
    assert.match(merged, /^### Requirement: Dead Req$/m, 'untouched requirement survives');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive --sync writes the RENAMED heading into the main spec', () => {
  withProject('aok-archive-rename-', (dir) => {
    makeChange(dir, 'add-auth', { authDelta: '## RENAMED Requirements\n\n- FROM: `### Requirement: Old Req`\n- TO: `### Requirement: Renamed Req`\n' });
    const res = spawnSync(process.execPath, [CLI, 'archive', 'add-auth', '--sync'], { cwd: dir, encoding: 'utf-8', env: isolatedEnv(dir) });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /synced 1 main spec file\(s\)/);
    const main = readFileSync(join(dir, 'openspec/specs/auth/spec.md'), 'utf-8');
    assert.match(main, /^### Requirement: Renamed Req$/m);
    assert.doesNotMatch(main, /^### Requirement: Old Req$/m);
    assert.match(main, /original behavior/, 'renamed requirement keeps its body');
    assert.ok(readdirSync(join(dir, 'openspec/changes/archive')).some((d) => d.endsWith('-add-auth')));
  });
});
