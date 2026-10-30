import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateProjectedSpecs } from '../bin/spec-preflight.js';
import { planSpecSync } from '../bin/agent-orchestrator.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Optional second installation for release compatibility checks; never install in tests.
const MODULES = process.env.AOK_TEST_OPENSPEC_MODULES || join(ROOT, 'node_modules');
const OPENSPEC = join(MODULES, '@fission-ai/openspec/bin/openspec.js');
const VERSION = JSON.parse(readFileSync(join(MODULES, '@fission-ai/openspec/package.json'), 'utf-8')).version;
const PREFIX = '# Auth\n\n## Purpose\n\nDescribe authentication behavior and its observable acceptance scenarios for this project.\n\n## Requirements\n\n';
const req = (name, description, scenario = 'the system returns a result') => `### Requirement: ${name}\n\n${description}\n\n#### Scenario: Works\n- **WHEN** invoked\n- **THEN** ${scenario}\n`;

function put(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function withProject(fn) {
  const root = mkdtempSync(join(tmpdir(), 'aok-preflight-test-'));
  try {
    symlinkSync(MODULES, join(root, 'node_modules'), 'junction');
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function plan(root, delta) {
  const file = put(root, 'openspec/changes/update/specs/auth/spec.md', delta);
  const result = planSpecSync(root, [file], 'update');
  assert.deepEqual(result.conflicts, []);
  return result.plan;
}

test('projected validation accepts a 500-character description and long scenarios without changing main specs', () => {
  withProject((root) => {
    const original = PREFIX + req('Login', 'The system SHALL authenticate the user.');
    const main = put(root, 'openspec/specs/auth/spec.md', original);
    put(root, 'openspec/specs/.scratch/spec.md', 'Ignored by OpenSpec discovery.');
    const description = 'The system SHALL '.padEnd(500, 'x');
    const sync = plan(root, '## MODIFIED Requirements\n\n' + req('Login', description, 'x'.repeat(2000)));
    const report = validateProjectedSpecs(root, sync);
    assert.deepEqual(report.errors, [], JSON.stringify(report));
    assert.ok(!report.warnings.some((message) => /500 characters/.test(message)), JSON.stringify(report));
    assert.equal(readFileSync(main, 'utf-8'), original);
  });
});

test('a 501-character MODIFIED requirement reaches main-spec validation with the installed version severity', () => {
  withProject((root) => {
    const main = put(root, 'openspec/specs/auth/spec.md', PREFIX + req('Login', 'The system SHALL authenticate the user.'));
    const original = readFileSync(main, 'utf-8');
    const sync = plan(root, '## MODIFIED Requirements\n\n' + req('Login', 'The system SHALL '.padEnd(501, 'x')));
    const report = validateProjectedSpecs(root, sync);
    const findings = VERSION === '1.4.1' ? report.warnings : report.errors;
    assert.ok(findings.some((message) => message.includes('openspec/specs/auth/spec.md (after delta sync)')
      && message.includes('500 characters')), JSON.stringify({ VERSION, report }));
    if (VERSION === '1.4.1') assert.deepEqual(report.errors, []);
    assert.equal(readFileSync(main, 'utf-8'), original);
  });
});

test('CLI gate reports a projected MODIFIED length finding even when delta validation passes', () => {
  withProject((root) => {
    put(root, 'openspec/specs/auth/spec.md', PREFIX + req('Login', 'The system SHALL authenticate.'));
    plan(root, '## MODIFIED Requirements\n\n' + req('Login', 'The system SHALL '.padEnd(501, 'x')));
    put(root, 'openspec/changes/update/proposal.md', '# Update\n\n## Why\n\nCheck the requirement before it is merged into the main specification.\n\n## What Changes\n\n- Update authentication.\n\n## Non-goals\n\n- Other features.\n\n## Acceptance criteria\n\n- Valid specs.\n');
    put(root, 'openspec/changes/update/tasks.md', '- [ ] 1.1 Update login\n  Files: src/auth.js\n  Do: update login validation\n  Done-when: authentication tests pass\n');
    put(root, 'src/auth.js', 'export const auth = true;\n');
    const env = { ...process.env, OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' };
    const direct = spawnSync(process.execPath, [OPENSPEC, 'validate', 'update', '--strict', '--type', 'change'], { cwd: root, encoding: 'utf-8', env, timeout: 15000 });
    assert.equal(direct.status, 0, direct.stdout + direct.stderr);
    const gate = spawnSync(process.execPath, [join(ROOT, 'bin/agent-orchestrator.js'), 'gate-check', '--review', 'update', '--json'], { cwd: root, encoding: 'utf-8', env, timeout: 15000 });
    assert.equal(gate.status, VERSION === '1.4.1' ? 0 : 1, gate.stdout + gate.stderr);
    const report = JSON.parse(gate.stdout);
    if (VERSION === '1.4.1') {
      assert.deepEqual(report, { pass: true, errors: [] });
      const human = spawnSync(process.execPath, [join(ROOT, 'bin/agent-orchestrator.js'), 'gate-check', '--review', 'update'], { cwd: root, encoding: 'utf-8', env, timeout: 15000 });
      assert.equal(human.status, 0, human.stdout + human.stderr);
      assert.match(human.stdout + human.stderr, /after delta sync.*500 characters/);
    } else {
      assert.ok(report.errors.some((message) => message.includes('after delta sync') && message.includes('500 characters')), gate.stdout);
    }
  });
});

test('existing main specs outside the change are validated and clearly identified', () => {
  withProject((root) => {
    put(root, 'openspec/specs/legacy/spec.md', '# Legacy without required sections\n');
    put(root, 'openspec/specs/legacy-length/spec.md', PREFIX + req('Long', 'The system SHALL '.padEnd(501, 'x')));
    const sync = plan(root, '## ADDED Requirements\n\n' + req('Login', 'The system SHALL authenticate.'));
    const report = validateProjectedSpecs(root, sync);
    assert.ok(report.errors.some((message) => message.includes('openspec/specs/legacy/spec.md (existing main spec; outside this change)') && message.includes('Purpose')), JSON.stringify(report));
    const lengths = VERSION === '1.4.1' ? report.warnings : report.errors;
    assert.ok(lengths.some((message) => message.includes('legacy-length/spec.md (existing main spec; outside this change)') && message.includes('500 characters')), JSON.stringify(report));
    assert.equal(existsSync(join(root, 'openspec/specs/auth')), false);
  });
});

test('REMOVED requirements do not cause stale main-spec failures and RENAMED requirements are checked after MODIFIED', () => {
  withProject((root) => {
    put(root, 'openspec/specs/auth/spec.md', PREFIX + req('Login', 'The system SHALL authenticate.') + '\n### Requirement: Broken\n\nThe system SHALL expire sessions.\n');
    const sync = plan(root, '## REMOVED Requirements\n\n### Requirement: Broken\n\n## RENAMED Requirements\n\n- FROM: `### Requirement: Login`\n- TO: `### Requirement: Sign in`\n\n## MODIFIED Requirements\n\n' + req('Sign in', 'The system SHALL authenticate with a password.'));
    assert.deepEqual(validateProjectedSpecs(root, sync).errors, []);
    assert.match(readFileSync(join(root, 'openspec/specs/auth/spec.md'), 'utf-8'), /Requirement: Broken/);
  });
});

test('new capabilities use a Purpose accepted by strict validation even with short names', () => {
  withProject((root) => {
    const file = put(root, 'openspec/changes/x/specs/a/spec.md', '## ADDED Requirements\n\n' + req('Login', 'The system SHALL authenticate.'));
    const sync = planSpecSync(root, [file], 'x');
    assert.deepEqual(validateProjectedSpecs(root, sync.plan).errors, []);
    assert.equal(existsSync(join(root, 'openspec/specs')), false);
  });
});

test('preview cleans up on success and fails closed on CLI failure or malformed JSON', () => {
  const valid = JSON.stringify({ items: [{ id: 'auth', type: 'spec', valid: true, issues: [] }] });
  for (const [output, status] of [[valid, 0], [valid, 1], ['not json', 0], [JSON.stringify({ items: [] }), 0], [JSON.stringify({ items: [{ id: 'wrong', type: 'spec', valid: true, issues: [] }] }), 1]]) {
    const root = mkdtempSync(join(tmpdir(), 'aok-preflight-bad-cli-'));
    try {
      const log = join(root, 'preview-path.txt');
      put(root, 'node_modules/openspec/cli.cjs', `require('node:fs').writeFileSync(${JSON.stringify(log)}, process.cwd()); console.log(${JSON.stringify(output)}); process.exitCode = ${status};\n`);
      const bin = put(root, 'node_modules/.bin/openspec', '#!/usr/bin/env node\nrequire("../openspec/cli.cjs");\n');
      // npx invokes executable local bins, just as it does for the real package.
      chmodSync(bin, 0o755);
      put(root, 'openspec/specs/auth/spec.md', PREFIX + req('Login', 'The system SHALL authenticate.'));
      const report = validateProjectedSpecs(root, []);
      if (output === valid && status === 0) assert.deepEqual(report.errors, []);
      else assert.ok(report.errors.length > 0, JSON.stringify(report));
      const preview = readFileSync(log, 'utf-8');
      assert.match(preview, /aok-spec-preview-/);
      assert.equal(existsSync(preview), false);
      assert.ok(existsSync(bin), 'cleanup must not follow the node_modules junction');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
