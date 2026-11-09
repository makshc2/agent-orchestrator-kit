import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { syncInstructionMirrors, MIRROR_TARGET } from '../bin/instruction-mirrors.js';

// The session-start, session-exit and routing blocks of the agent-orchestration
// skill are generated from the always-on rules; drift between them fails here.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
const RULE = '.agents/rules/session-handoff.mdc';
const PROBE = (rule) => rule.replace('\n\n## Archive exception', ' MIRROR-DRIFT-PROBE.\n\n## Archive exception');

function copyMirrorFiles(dir) {
  for (const rel of [RULE, '.agents/rules/agent-orchestration.mdc', MIRROR_TARGET]) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(join(KIT_ROOT, 'templates', rel), join(dir, rel));
  }
}

test('shipped skill mirror blocks match their source rules', () => {
  const { drift } = syncInstructionMirrors(join(KIT_ROOT, 'templates'), { check: true });
  assert.deepEqual(drift, [], `mirror drift in: ${drift.join(', ')}; run syncInstructionMirrors on templates/ to regenerate`);
});

test('a rule edit is reported as drift and regenerated once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mirrors-'));
  try {
    copyMirrorFiles(dir);
    const rule = readFileSync(join(dir, RULE), 'utf-8');
    const probed = PROBE(rule);
    assert.notEqual(probed, rule);
    writeFileSync(join(dir, RULE), probed);
    const before = readFileSync(join(dir, MIRROR_TARGET), 'utf-8');
    const checked = syncInstructionMirrors(dir, { check: true });
    assert.deepEqual(checked.drift, ['session-exit']);
    assert.equal(readFileSync(join(dir, MIRROR_TARGET), 'utf-8'), before);
    assert.deepEqual(syncInstructionMirrors(dir).changed, ['session-exit']);
    assert.ok(readFileSync(join(dir, MIRROR_TARGET), 'utf-8').includes('MIRROR-DRIFT-PROBE.'));
    assert.deepEqual(syncInstructionMirrors(dir).changed, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a skill without markers is left byte-identical and reported as skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mirrors-'));
  try {
    copyMirrorFiles(dir);
    const skill = readFileSync(join(dir, MIRROR_TARGET), 'utf-8');
    const stripped = skill.replace(/<!-- aok:mirror:[^\n]*-->\n?/g, '');
    writeFileSync(join(dir, MIRROR_TARGET), stripped);
    const result = syncInstructionMirrors(dir);
    assert.deepEqual(result.skipped, ['session-start', 'session-exit', 'routing']);
    assert.deepEqual(result.changed, []);
    assert.equal(readFileSync(join(dir, MIRROR_TARGET), 'utf-8'), stripped);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init and sync regenerate the blocks in the project and the IDE copies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-mirrors-'));
  try {
    execSync(`node "${CLI}" init --profile generic --name Mirrors --lang en`, { cwd: dir, stdio: 'pipe' });
    const rulePath = join(dir, RULE);
    writeFileSync(rulePath, PROBE(readFileSync(rulePath, 'utf-8')));
    execSync(`node "${CLI}" sync --target all`, { cwd: dir, stdio: 'pipe' });
    assert.ok(readFileSync(join(dir, MIRROR_TARGET), 'utf-8').includes('MIRROR-DRIFT-PROBE.'));
    assert.ok(readFileSync(join(dir, '.claude/skills/agent-orchestration/SKILL.md'), 'utf-8').includes('MIRROR-DRIFT-PROBE.'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
