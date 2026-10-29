import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Artifact mutation evals: each case copies a frozen fixture project
// (test/fixtures/mutations/) into a fresh temp root, applies exactly one defect
// and runs the production `gate-check --review <name> --json` with the locally
// installed OpenSpec validator. Profile: task_contract strict, artifact_budget off.

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
const OPENSPEC_PKG = join(KIT_ROOT, 'node_modules', '@fission-ai', 'openspec');
const FIXTURES_DIR = join(KIT_ROOT, 'test', 'fixtures', 'mutations');
const CLI_TIMEOUT_MS = 60000;
const MAX_BUFFER_BYTES = 1048576;
const TEMP_PREFIX = 'aok-mutation-eval-';

const FIXTURES = {
  synthetic: { dir: 'synthetic', change: 'synthetic-change' },
  'real-tier1': { dir: 'real-tier1', change: 'tier1-delta-heading-check' },
};

const STRIPPED_ENV_KEYS = ['AOK_MODEL', 'AOK_PLATFORM', 'CURSOR_AGENT', 'CURSOR_CONVERSATION_ID', 'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'AMP_CURRENT_THREAD', 'AMP_THREAD_ID'];

// Setup check: the validator must be the lockfile-installed local package.
// No npx/npm install fallback, no global openspec, no success stub.
function resolveOpenspecBin(pkgDir = OPENSPEC_PKG) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`setup failure: local OpenSpec package not found at ${pkgDir} (run npm ci; the eval never downloads or stubs the validator)`);
  }
  const binRel = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))?.bin?.openspec;
  if (typeof binRel !== 'string' || !binRel) {
    throw new Error(`setup failure: ${pkgJsonPath} has no bin.openspec entry`);
  }
  const bin = join(pkgDir, binRel);
  if (!existsSync(bin)) {
    throw new Error(`setup failure: local OpenSpec bin not found at ${bin} (run npm ci)`);
  }
  return bin;
}

// CommonJS on purpose: the temp root has no package.json, so `.js` loads as CJS.
function launcherSource(openspecBin) {
  return `'use strict';
const { spawnSync } = require('node:child_process');
const OPENSPEC_BIN = ${JSON.stringify(openspecBin)};
const args = process.argv.slice(2);
const accepted = args.length === 6
  && args[0] === 'openspec'
  && args[1] === 'validate'
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args[2])
  && args[3] === '--strict'
  && args[4] === '--type'
  && args[5] === 'change';
if (!accepted) {
  process.stderr.write('mutation-eval npx launcher: rejected call "npx ' + args.join(' ') + '": only "npx openspec validate <name> --strict --type change" is allowed\\n');
  process.exit(2);
}
const res = spawnSync(process.execPath, [OPENSPEC_BIN, 'validate', args[2], '--strict', '--type', 'change'], {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf-8',
  timeout: 60000,
  maxBuffer: 1048576,
});
if (res.error || res.signal || res.status === null) {
  process.stderr.write('mutation-eval npx launcher: local openspec validate did not finish normally: ' + (res.error ? res.error.message : 'signal ' + res.signal) + '\\n');
  process.exit(1);
}
process.stdout.write(res.stdout || '');
process.stderr.write(res.stderr || '');
process.exitCode = res.status;
`;
}

function createSandbox(fixtureKey, openspecBin) {
  const fixture = FIXTURES[fixtureKey];
  const root = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
  try {
    const project = join(root, 'project');
    cpSync(join(FIXTURES_DIR, fixture.dir), project, { recursive: true });
    for (const sub of ['bin', 'home', 'xdg-config', 'xdg-data', 'xdg-cache']) mkdirSync(join(root, sub), { recursive: true });
    writeFileSync(join(root, 'bin', 'launcher.js'), launcherSource(openspecBin));
    writeFileSync(join(root, 'bin', 'npx'), `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'bin', 'launcher.js')}" "$@"\n`, { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH || ''}`,
      HOME: join(root, 'home'),
      XDG_CONFIG_HOME: join(root, 'xdg-config'),
      XDG_DATA_HOME: join(root, 'xdg-data'),
      XDG_CACHE_HOME: join(root, 'xdg-cache'),
      OPENSPEC_TELEMETRY: '0',
      DO_NOT_TRACK: '1',
    };
    for (const key of STRIPPED_ENV_KEYS) delete env[key];
    return { root, project, env, openspecBin, fixture };
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
}

async function withSandbox(fixtureKey, openspecBin, fn) {
  const sandbox = createSandbox(fixtureKey, openspecBin);
  try {
    return await fn(sandbox);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

function parseJson(stdout) {
  if (!stdout || !stdout.trim()) return { json: null, parseError: 'empty stdout' };
  try {
    return { json: JSON.parse(stdout), parseError: null };
  } catch (e) {
    return { json: null, parseError: e.message };
  }
}

function spawnResult(res) {
  return { status: res.status, signal: res.signal, error: res.error || null, stdout: res.stdout || '', stderr: res.stderr || '', ...parseJson(res.stdout || '') };
}

function runGate(sandbox, name) {
  return spawnResult(spawnSync(process.execPath, [CLI, 'gate-check', '--review', name, '--json'], {
    cwd: sandbox.project,
    env: sandbox.env,
    encoding: 'utf-8',
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
  }));
}

// Direct call (not through the launcher): JSON output with items[0].valid / issues[].
function runOracle(sandbox, name) {
  return spawnResult(spawnSync(process.execPath, [sandbox.openspecBin, 'validate', name, '--strict', '--type', 'change', '--json'], {
    cwd: sandbox.project,
    env: sandbox.env,
    encoding: 'utf-8',
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
  }));
}

function oracleItem(oracle) {
  const item = oracle.json && Array.isArray(oracle.json.items) ? oracle.json.items[0] : null;
  if (!item || typeof item.valid !== 'boolean' || !Array.isArray(item.issues)) return null;
  return item;
}

// Throws (test failure) unless the pristine fixture passes validate and gate cleanly.
function assertBaseline(sandbox) {
  const name = sandbox.fixture.change;
  const oracle = runOracle(sandbox, name);
  assert.equal(oracle.error, null, `baseline failure: validate spawn error: ${oracle.error?.message}`);
  assert.equal(oracle.status, 0, `baseline failure: validate exit ${oracle.status}: ${oracle.stdout}${oracle.stderr}`);
  const item = oracleItem(oracle);
  assert.ok(item, `baseline failure: validate JSON has unexpected shape (${oracle.parseError || 'items[0].valid/issues missing'})`);
  assert.equal(item.valid, true, `baseline failure: validate reports invalid: ${JSON.stringify(item.issues)}`);

  const gate = runGate(sandbox, name);
  assert.equal(gate.error, null, `baseline failure: gate spawn error: ${gate.error?.message}`);
  assert.equal(gate.status, 0, `baseline failure: gate exit ${gate.status}: ${gate.stdout}${gate.stderr}`);
  assert.ok(gate.json && typeof gate.json === 'object', `baseline failure: gate stdout is not JSON (${gate.parseError})`);
  assert.equal(gate.json.pass, true, 'baseline failure: gate pass is not true');
  assert.deepEqual(gate.json.errors, [], 'baseline failure: gate errors are not empty');
}

function leftoverTempRoots() {
  return readdirSync(tmpdir()).filter((entry) => entry.startsWith(TEMP_PREFIX));
}

// --- Causal classification ---

// A matcher is a predicate on one error (or oracle issue message) string.
function matcher(description, predicate) {
  const fn = (text) => typeof text === 'string' && predicate(text);
  fn.description = description;
  return fn;
}

function includesAll(...parts) {
  return matcher(parts.map((p) => JSON.stringify(p)).join(' + '), (text) => parts.every((p) => text.includes(p)));
}

function includesAny(...parts) {
  return matcher(parts.map((p) => JSON.stringify(p)).join(' | '), (text) => parts.some((p) => text.includes(p)));
}

function isGateShape(json) {
  return json !== null && typeof json === 'object' && !Array.isArray(json)
    && typeof json.pass === 'boolean'
    && Array.isArray(json.errors) && json.errors.every((e) => typeof e === 'string');
}

// Pure: { gate, oracle } process results + case data -> { result: caught|missed|invalid, detail }.
function classify({ gate, oracle }, testCase) {
  const invalid = (detail) => ({ result: 'invalid', detail });

  if (gate.error) return invalid(`gate spawn error: ${gate.error.code || gate.error.message}`);
  if (gate.signal !== null && gate.signal !== undefined) return invalid(`gate terminated by signal ${gate.signal}`);
  if (gate.status === null || gate.status === undefined) return invalid('gate exit status is null');
  if (gate.status !== 0 && gate.status !== 1) return invalid(`gate exit status ${gate.status} is outside {0, 1}`);
  if (!gate.json) return invalid(`gate stdout is not JSON (${gate.parseError || 'empty stdout'})`);
  if (!isGateShape(gate.json)) return invalid('gate JSON is not {pass: boolean, errors: string[]}');

  const { pass, errors } = gate.json;
  let gateResult;
  if (gate.status === 0) {
    if (!pass || errors.length) return invalid('gate exit 0 contradicts pass/errors');
    gateResult = 'missed';
  } else {
    if (pass || !errors.length) return invalid('gate exit 1 contradicts pass/errors');
    const missingRequired = testCase.required.filter((m) => !errors.some((e) => m(e)));
    if (missingRequired.length) return invalid(`gate failed without the target diagnostic: ${missingRequired.map((m) => m.description).join('; ')}`);
    const stray = errors.filter((e) => !testCase.allowed.some((m) => m(e)));
    if (stray.length) return invalid(`stray gate error(s): ${stray.join(' || ')}`);
    gateResult = 'caught';
  }

  if (!oracle) return invalid('validate oracle was not run');
  if (oracle.error) return invalid(`validate oracle spawn error: ${oracle.error.code || oracle.error.message}`);
  if (oracle.signal !== null && oracle.signal !== undefined) return invalid(`validate oracle terminated by signal ${oracle.signal}`);
  const item = oracleItem(oracle);
  if (!item) return invalid(`validate oracle JSON has unexpected shape (${oracle.parseError || 'items[0].valid/issues missing'})`);

  if (testCase.oracle === 'pass') {
    if (oracle.status !== 0 || item.valid !== true) return invalid(`validate oracle expected a valid change, got exit ${oracle.status}: ${item.issues.map((i) => i.message).join(' || ')}`);
    return { result: gateResult, detail: '' };
  }
  if (gateResult === 'caught') {
    if (oracle.status !== 1 || item.valid !== false) return invalid(`validate oracle expected exit 1 and valid:false, got exit ${oracle.status} valid:${item.valid}`);
    const hit = item.issues.some((issue) => issue && issue.level === 'ERROR' && testCase.oracle(issue.message));
    if (!hit) return invalid(`validate failed without the expected ERROR issue (${testCase.oracle.description})`);
  }
  return { result: gateResult, detail: '' };
}

// Pure: expectation + classification -> { pass, newlyCaught, message }. Never rewrites expectation.
function verdict(testCase, classification) {
  const { result, detail } = classification;
  if (result === 'invalid') return { pass: false, newlyCaught: false, message: `${testCase.id}: invalid result — ${detail}` };
  if (testCase.expectation === 'must-catch') {
    return result === 'caught'
      ? { pass: true, newlyCaught: false, message: `${testCase.id}: caught` }
      : { pass: false, newlyCaught: false, message: `${testCase.id}: must-catch defect was missed (gate exit 0, pass true, errors [])` };
  }
  if (testCase.expectation === 'known-gap') {
    return result === 'missed'
      ? { pass: true, newlyCaught: false, message: `${testCase.id}: known gap still missed` }
      : { pass: true, newlyCaught: true, message: `${testCase.id}: newly caught` };
  }
  return { pass: false, newlyCaught: false, message: `${testCase.id}: unknown expectation ${testCase.expectation}` };
}

function fakeGate({ status = 1, signal = null, error = null, stdout } = {}) {
  return { status, signal, error, stdout, stderr: '', ...parseJson(stdout) };
}

function fakeOracle({ status = 0, valid = true, issues = [], stdout } = {}) {
  const out = stdout !== undefined ? stdout : JSON.stringify({ items: [{ id: 'x', type: 'change', valid, issues }] });
  return { status, signal: null, error: null, stdout: out, stderr: '', ...parseJson(out) };
}

const gateJson = (pass, errors) => JSON.stringify({ pass, errors });

test('classifier: causal truth table for gate and validate oracle results', async (t) => {
  const missingDone = includesAll('task "Add marker"', 'missing Done-when:');
  const mustCatch = { id: 'T01', expectation: 'must-catch', required: [missingDone], allowed: [missingDone], oracle: 'pass' };
  const knownGap = { ...mustCatch, id: 'T02', expectation: 'known-gap' };
  const validatePrefix = includesAll('openspec validate --strict failed:');
  const validateCase = {
    id: 'T03',
    expectation: 'must-catch',
    required: [validatePrefix],
    allowed: [validatePrefix],
    oracle: includesAll('must include at least one scenario'),
  };
  const caughtGate = fakeGate({ stdout: gateJson(false, ['task "Add marker": missing Done-when:']) });
  const missedGate = fakeGate({ status: 0, stdout: gateJson(true, []) });

  const scenarios = [
    { name: 'correct caught', testCase: mustCatch, gate: caughtGate, oracle: fakeOracle(), result: 'caught', pass: true },
    { name: 'must-catch missed', testCase: mustCatch, gate: missedGate, oracle: fakeOracle(), result: 'missed', pass: false },
    { name: 'known-gap missed', testCase: knownGap, gate: missedGate, oracle: fakeOracle(), result: 'missed', pass: true },
    { name: 'known-gap newly caught', testCase: knownGap, gate: caughtGate, oracle: fakeOracle(), result: 'caught', pass: true, newlyCaught: true },
    {
      name: 'caught-like result with a stray error',
      testCase: mustCatch,
      gate: fakeGate({ stdout: gateJson(false, ['task "Add marker": missing Done-when:', 'openspec validate --strict failed: Change has issues']) }),
      oracle: fakeOracle(),
      result: 'invalid',
      pass: false,
    },
    { name: 'signal/timeout (status null)', testCase: mustCatch, gate: fakeGate({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' }), stdout: '' }), oracle: fakeOracle(), result: 'invalid', pass: false },
    { name: 'corrupted JSON', testCase: mustCatch, gate: fakeGate({ stdout: '{"pass": false, "errors": [' }), oracle: fakeOracle(), result: 'invalid', pass: false },
    { name: 'status 0 with pass false', testCase: mustCatch, gate: fakeGate({ status: 0, stdout: gateJson(false, ['task "Add marker": missing Done-when:']) }), oracle: fakeOracle(), result: 'invalid', pass: false },
    { name: 'status 1 with pass true', testCase: mustCatch, gate: fakeGate({ status: 1, stdout: gateJson(true, []) }), oracle: fakeOracle(), result: 'invalid', pass: false },
    {
      name: 'validate oracle with a generic validate failure and no expected issue',
      testCase: validateCase,
      gate: fakeGate({ stdout: gateJson(false, ["openspec validate --strict failed: Change 'x' has issues"]) }),
      oracle: fakeOracle({ status: 1, valid: false, issues: [{ level: 'ERROR', path: 'file', message: 'Change must have at least one delta.' }] }),
      result: 'invalid',
      pass: false,
    },
  ];

  for (const s of scenarios) {
    await t.test(`${s.name} -> ${s.result}, verdict ${s.pass ? 'passes' : 'fails'}`, () => {
      const classification = classify({ gate: s.gate, oracle: s.oracle }, s.testCase);
      assert.equal(classification.result, s.result, classification.detail);
      const v = verdict(s.testCase, classification);
      assert.equal(v.pass, s.pass, v.message);
      assert.equal(v.newlyCaught, Boolean(s.newlyCaught));
    });
  }
});

test('launcher rejects any call other than "openspec validate <name> --strict --type change"', async () => {
  const openspecBin = resolveOpenspecBin();
  await withSandbox('synthetic', openspecBin, (sandbox) => {
    const npx = join(sandbox.root, 'bin', 'npx');
    const opts = { cwd: sandbox.project, env: sandbox.env, encoding: 'utf-8', timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES };
    for (const args of [
      ['openspec', 'validate', 'x', '--strict', '--type', 'change', '--json'],
      ['openspec', 'list'],
      ['openspec', 'validate', '../x', '--strict', '--type', 'change'],
      ['openspec', 'show', 'x', '--strict', '--type', 'change'],
    ]) {
      const rejected = spawnSync(npx, args, opts);
      assert.equal(rejected.status, 2, `expected exit 2 for ${args.join(' ')}`);
      assert.equal(rejected.stdout, '', 'a rejected call must not run openspec');
      assert.match(rejected.stderr, /mutation-eval npx launcher: rejected call/);
    }

    const accepted = spawnSync(npx, ['openspec', 'validate', 'synthetic-change', '--strict', '--type', 'change'], opts);
    const direct = spawnSync(process.execPath, [openspecBin, 'validate', 'synthetic-change', '--strict', '--type', 'change'], opts);
    assert.equal(direct.status, 0, direct.stderr);
    assert.equal(accepted.status, direct.status);
    assert.equal(accepted.stdout, direct.stdout);
  });
});

test('setup check fails with an explanation when the local OpenSpec package is missing', () => {
  assert.throws(() => resolveOpenspecBin(join(KIT_ROOT, 'node_modules', '@fission-ai', 'openspec-does-not-exist')), /setup failure: local OpenSpec package not found/);
});

// --- Mutations ---

function invalidSetup(message) {
  return new Error(`invalid setup: ${message}`);
}

function readRel(project, rel) {
  const path = join(project, rel);
  if (!existsSync(path)) throw invalidSetup(`${rel} not found`);
  return readFileSync(path, 'utf-8');
}

function writeRel(project, rel, content) {
  writeFileSync(join(project, rel), content);
}

function snapshotFiles(dir, base = dir, out = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) snapshotFiles(path, base, out);
    else out.set(relative(base, path), readFileSync(path, 'utf-8'));
  }
  return out;
}

function diffSnapshots(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

const TASK_LINE = /^\s*- \[[ xX]\]\s+(.*)$/;

// Mirrors the production task parser: a task block runs until the next task
// line or the next non-indented line.
function firstTaskSpan(lines) {
  const start = lines.findIndex((line) => TASK_LINE.test(line));
  if (start === -1) throw invalidSetup('tasks.md has no task line');
  let end = start + 1;
  while (end < lines.length && !TASK_LINE.test(lines[end]) && !/^\S/.test(lines[end])) end++;
  return { start, end, title: lines[start].match(TASK_LINE)[1].trim() };
}

function firstTaskLabel(tasksText) {
  return firstTaskSpan(tasksText.split('\n')).title.slice(0, 60);
}

// Replaces (or deletes, when `edit` returns null) the single `<field>:` line of the first task.
function editFirstTaskField(tasksText, field, edit) {
  const lines = tasksText.split('\n');
  const span = firstTaskSpan(lines);
  const fieldRe = new RegExp(`^\\s+${field}:`);
  const hits = [];
  for (let i = span.start + 1; i < span.end; i++) if (fieldRe.test(lines[i])) hits.push(i);
  if (hits.length !== 1) throw invalidSetup(`first task: expected exactly one "${field}:" line, found ${hits.length}`);
  const replacement = edit(lines[hits[0]]);
  if (replacement === null) lines.splice(hits[0], 1);
  else lines[hits[0]] = replacement;
  return lines.join('\n');
}

function headingLevel(line) {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

function isFence(line) {
  return /^\s*(```|~~~)/.test(line);
}

// Line indexes of headings matching `re` outside code fences within [from, to).
function findHeadings(lines, re, from = 0, to = lines.length) {
  const hits = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (isFence(lines[i])) inFence = !inFence;
    else if (!inFence && i >= from && i < to && headingLevel(lines[i]) && re.test(lines[i])) hits.push(i);
  }
  return hits;
}

// End (exclusive) of the block starting at heading `start`: the next heading of
// level <= `endLevel` outside code fences, or `limit`.
function blockEnd(lines, start, endLevel = headingLevel(lines[start]), limit = lines.length) {
  let inFence = false;
  for (let i = start + 1; i < limit; i++) {
    if (isFence(lines[i])) inFence = !inFence;
    else if (!inFence && headingLevel(lines[i]) && headingLevel(lines[i]) <= endLevel) return i;
  }
  return limit;
}

function singleHeading(lines, re, what, from, to) {
  const hits = findHeadings(lines, re, from, to);
  if (hits.length !== 1) throw invalidSetup(`${what}: expected exactly one target heading, found ${hits.length}`);
  return hits[0];
}

function removeBlock(text, re, what) {
  const lines = text.split('\n');
  const start = singleHeading(lines, re, what);
  lines.splice(start, blockEnd(lines, start) - start);
  return lines.join('\n');
}

function replaceLine(text, exactLine, replacement, what) {
  const lines = text.split('\n');
  const hits = lines.flatMap((line, i) => (line === exactLine ? [i] : []));
  if (hits.length !== 1) throw invalidSetup(`${what}: expected exactly one line "${exactLine}", found ${hits.length}`);
  lines[hits[0]] = replacement;
  return lines.join('\n');
}

function trimTrailingBlank(lines) {
  const out = [...lines];
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// S09: one logical operation change MODIFIED -> ADDED for a single requirement.
function moveModifiedToAdded(text, requirement) {
  let lines = text.split('\n');
  const modStart = singleHeading(lines, /^## MODIFIED Requirements$/, 'MODIFIED section');
  const modEnd = blockEnd(lines, modStart);
  const reqStart = singleHeading(lines, new RegExp(`^### Requirement: ${escapeRe(requirement)}$`), `MODIFIED requirement "${requirement}"`, modStart, modEnd);
  if (findHeadings(lines, /^### Requirement:/, modStart, modEnd).length !== 1) throw invalidSetup('MODIFIED section must hold exactly one requirement');
  if (lines.slice(modStart + 1, reqStart).some((line) => line.trim())) throw invalidSetup('MODIFIED section has content before its requirement');
  const block = trimTrailingBlank(lines.slice(reqStart, modEnd));
  lines = [...lines.slice(0, modStart), ...lines.slice(modEnd)];

  const addStart = singleHeading(lines, /^## ADDED Requirements$/, 'ADDED section');
  const addEnd = blockEnd(lines, addStart);
  const head = trimTrailingBlank(lines.slice(0, addEnd));
  const tail = lines.slice(addEnd);
  return [...head, '', ...block, ...(tail.length && tail.some((l) => l.trim()) ? ['', ...tail] : [''])].join('\n');
}

function assertNoMainRequirement(project, capability, requirement) {
  if (readRel(project, `openspec/specs/${capability}/spec.md`).includes(`### Requirement: ${requirement}`)) {
    throw invalidSetup(`main spec ${capability} already has "${requirement}"`);
  }
}

// Every mutator must hit its target exactly once, change the project, and touch
// exactly one file (or, with `newFilesUnder`, only add files below that prefix).
function applyMutation(project, testCase, ctx) {
  const before = snapshotFiles(project);
  testCase.mutate(project, ctx);
  const after = snapshotFiles(project);
  const changed = diffSnapshots(before, after);
  if (!changed.length) throw invalidSetup(`${testCase.id}: mutation left the fixture unchanged`);
  if (testCase.newFilesUnder) {
    const bad = changed.filter((p) => before.has(p) || !p.startsWith(testCase.newFilesUnder));
    if (bad.length) throw invalidSetup(`${testCase.id}: mutation may only add files under ${testCase.newFilesUnder}, touched ${bad.join(', ')}`);
  } else if (changed.length !== 1 || !before.has(changed[0]) || !after.has(changed[0])) {
    throw invalidSetup(`${testCase.id}: mutation must modify exactly one existing file, touched ${changed.join(', ')}`);
  }
  return changed;
}

const SYN_TASKS = 'openspec/changes/synthetic-change/tasks.md';
const SYN_PROPOSAL = 'openspec/changes/synthetic-change/proposal.md';
const SYN_DELTA = 'openspec/changes/synthetic-change/specs/sample-capability/spec.md';
const REAL_TASKS = 'openspec/changes/tier1-delta-heading-check/tasks.md';
const REAL_TIERED_DELTA = 'openspec/changes/tier1-delta-heading-check/specs/tiered-review/spec.md';
const VALIDATE_PREFIX = 'openspec validate --strict failed:';
const AS_NEEDED = 'as needed';

function removeFirstDoneWhen(project, rel) {
  writeRel(project, rel, editFirstTaskField(readRel(project, rel), 'Done-when', () => null));
}

function appendVagueDo(project, rel) {
  writeRel(project, rel, editFirstTaskField(readRel(project, rel), 'Do', (line) => `${line.replace(/\s+$/, '')} ${AS_NEEDED}`));
}

function removeProposalSection(project, heading) {
  const re = new RegExp(`^#{2,}\\s*${escapeRe(heading)}\\b`, 'im');
  const next = removeBlock(readRel(project, SYN_PROPOSAL), new RegExp(`^## ${escapeRe(heading)}\\s*$`), `proposal "${heading}"`);
  if (re.test(next)) throw invalidSetup(`proposal still matches ${re}`);
  return next;
}

const labelMatchers = (fragment) => (ctx) => {
  const m = includesAll(`task "${ctx.label}"`, fragment);
  return { required: [m], allowed: [m] };
};

const single = (m) => () => ({ required: [m], allowed: [m] });

// Known-gap matchers name the cause of the gap; "any error" is never accepted.
function doneWhenQualityMatcher(label) {
  return matcher(`"task \\"${label}\\"" + "Done-when" and not "missing Done-when:"`,
    (text) => text.includes(`task "${label}"`) && text.includes('Done-when') && !text.includes('missing Done-when:'));
}

function collisionMatcher() {
  return includesAll('sample-capability', 'Sample modified requirement', 'synthetic-change', 'neighbor-change');
}

const NEIGHBOR_DELTA = `## MODIFIED Requirements

### Requirement: Sample modified requirement

The system SHALL reject the new value.

#### Scenario: New value is rejected

- **WHEN** the new value is submitted
- **THEN** the system rejects it
`;

// Stable order S01..S11, R01..R03 (the report keeps this order).
const CASES = [
  {
    id: 'S01',
    fixture: 'synthetic',
    defectClass: 'task contract: missing Done-when',
    expectation: 'must-catch',
    reason: 'structural task-contract lint (strict)',
    mutate: (project) => removeFirstDoneWhen(project, SYN_TASKS),
    matchers: labelMatchers('missing Done-when:'),
    oracle: 'pass',
  },
  {
    id: 'S02',
    fixture: 'synthetic',
    defectClass: 'task contract: vague Do',
    expectation: 'must-catch',
    reason: 'VAGUE_DO_PATTERNS lint (strict)',
    mutate: (project) => appendVagueDo(project, SYN_TASKS),
    matchers: labelMatchers('vague wording in Do:'),
    oracle: 'pass',
  },
  {
    id: 'S03',
    fixture: 'synthetic',
    defectClass: 'task contract: missing Files path',
    expectation: 'must-catch',
    reason: 'Files path existence lint (strict)',
    mutate: (project) => {
      if (existsSync(join(project, 'src/missing-sample.txt'))) throw invalidSetup('src/missing-sample.txt exists in the fixture');
      writeRel(project, SYN_TASKS, editFirstTaskField(readRel(project, SYN_TASKS), 'Files', (line) => {
        if (line.split('src/sample.txt').length !== 2 || /new file:/i.test(line)) throw invalidSetup('first task Files must name src/sample.txt once without "new file:"');
        return line.replace('src/sample.txt', 'src/missing-sample.txt');
      }));
    },
    matchers: labelMatchers('Files: path does not exist: src/missing-sample.txt'),
    oracle: 'pass',
  },
  {
    id: 'S04',
    fixture: 'synthetic',
    defectClass: 'proposal: missing Non-goals',
    expectation: 'must-catch',
    reason: 'proposal section check',
    mutate: (project) => {
      const next = removeProposalSection(project, 'Non-goals');
      if (!/^## Acceptance criteria$/m.test(next)) throw invalidSetup('S04 removed Acceptance criteria too');
      writeRel(project, SYN_PROPOSAL, next);
    },
    matchers: single(includesAll('proposal.md: missing "Non-goals" section')),
    oracle: 'pass',
  },
  {
    id: 'S05',
    fixture: 'synthetic',
    defectClass: 'proposal: missing Acceptance criteria',
    expectation: 'must-catch',
    reason: 'proposal section check',
    mutate: (project) => writeRel(project, SYN_PROPOSAL, removeProposalSection(project, 'Acceptance criteria')),
    matchers: single(includesAll('proposal.md: missing "Acceptance criteria" section')),
    oracle: 'pass',
  },
  {
    id: 'S06',
    fixture: 'synthetic',
    defectClass: 'delta: empty operation section',
    expectation: 'must-catch',
    reason: 'delta entry check plus upstream validate',
    mutate: (project) => {
      readRel(project, SYN_DELTA);
      writeRel(project, SYN_DELTA, '## ADDED Requirements\n');
    },
    matchers: () => {
      const empty = includesAll(SYN_DELTA, 'no non-empty ADDED/MODIFIED/REMOVED/RENAMED Requirements section');
      const validate = includesAll(VALIDATE_PREFIX);
      return { required: [empty, validate], allowed: [empty, validate] };
    },
    oracle: includesAny('no requirement entries parsed', 'Change must have at least one delta'),
  },
  {
    id: 'S07',
    fixture: 'synthetic',
    defectClass: 'delta: MODIFIED heading not in main',
    expectation: 'must-catch',
    reason: 'delta heading vs main spec (planSpecSync)',
    mutate: (project) => {
      assertNoMainRequirement(project, 'sample-capability', 'Nonexistent modified requirement');
      writeRel(project, SYN_DELTA, replaceLine(readRel(project, SYN_DELTA), '### Requirement: Sample modified requirement', '### Requirement: Nonexistent modified requirement', 'S07'));
    },
    matchers: single(includesAll('sample-capability: MODIFIED requirement not found in main spec: "Nonexistent modified requirement"')),
    oracle: 'pass',
  },
  {
    id: 'S08',
    fixture: 'synthetic',
    defectClass: 'delta: requirement without scenario',
    expectation: 'must-catch',
    reason: 'upstream validate (scenario check)',
    mutate: (project) => {
      const lines = readRel(project, SYN_DELTA).split('\n');
      const modStart = singleHeading(lines, /^## MODIFIED Requirements$/, 'MODIFIED section');
      const modEnd = blockEnd(lines, modStart);
      const scenario = singleHeading(lines, /^#### Scenario:/, 'MODIFIED scenario', modStart, modEnd);
      lines.splice(scenario, blockEnd(lines, scenario, 2, modEnd) - scenario);
      const next = lines.join('\n');
      if (!/SHALL/.test(next.slice(0, next.indexOf('## ADDED Requirements'))) || !/^## ADDED Requirements$/m.test(next)) throw invalidSetup('S08 must keep the SHALL text and the ADDED section');
      writeRel(project, SYN_DELTA, next);
    },
    matchers: single(includesAll(VALIDATE_PREFIX)),
    oracle: matcher('message === MODIFIED "Sample modified requirement" must include at least one scenario', (text) => text === 'MODIFIED "Sample modified requirement" must include at least one scenario'),
  },
  {
    id: 'S09',
    fixture: 'synthetic',
    defectClass: 'delta: ADDED heading already in main',
    expectation: 'must-catch',
    reason: 'delta heading vs main spec (planSpecSync)',
    mutate: (project) => {
      const next = moveModifiedToAdded(readRel(project, SYN_DELTA), 'Sample modified requirement');
      const lines = next.split('\n');
      const addStart = singleHeading(lines, /^## ADDED Requirements$/, 'ADDED section after S09');
      const addEnd = blockEnd(lines, addStart);
      for (const name of ['Sample added requirement', 'Sample modified requirement']) {
        singleHeading(lines, new RegExp(`^### Requirement: ${name}$`), `S09 ADDED "${name}"`, addStart, addEnd);
        if (findHeadings(lines, new RegExp(`^### Requirement: ${name}$`)).length !== 1) throw invalidSetup(`S09 duplicated "${name}"`);
      }
      if (/^## MODIFIED Requirements$/m.test(next)) throw invalidSetup('S09 left a MODIFIED section');
      writeRel(project, SYN_DELTA, next);
    },
    matchers: single(includesAll('sample-capability: ADDED requirement already exists in main spec: "Sample modified requirement"')),
    oracle: 'pass',
  },
  {
    id: 'S10',
    fixture: 'synthetic',
    defectClass: 'task contract: Done-when checks only the old state',
    expectation: 'known-gap',
    reason: 'Done-when is structurally filled; nothing checks its semantics',
    mutate: (project) => writeRel(project, SYN_TASKS, editFirstTaskField(readRel(project, SYN_TASKS), 'Done-when', (line) => {
      if (!line.includes('New marker is present')) throw invalidSetup('first task Done-when must check the new marker (S10 premise)');
      return `${line.match(/^\s*/)[0]}Done-when: Old marker is absent`;
    })),
    matchers: (ctx) => {
      const m = doneWhenQualityMatcher(ctx.label);
      return { required: [m], allowed: [m] };
    },
    oracle: 'pass',
  },
  {
    id: 'S11',
    fixture: 'synthetic',
    defectClass: 'cross-change: conflicting MODIFIED bodies',
    expectation: 'known-gap',
    reason: 'gate checks a change only against the main spec, not against another active change',
    newFilesUnder: 'openspec/changes/neighbor-change/',
    mutate: (project, ctx) => {
      const neighbor = join(project, 'openspec/changes/neighbor-change');
      if (existsSync(neighbor)) throw invalidSetup('neighbor-change already exists in the fixture');
      cpSync(join(project, 'openspec/changes/synthetic-change'), neighbor, { recursive: true });
      writeRel(project, 'openspec/changes/neighbor-change/specs/sample-capability/spec.md', NEIGHBOR_DELTA);
      const oracle = runOracle(ctx.sandbox, 'neighbor-change');
      const item = oracleItem(oracle);
      if (oracle.error || oracle.status !== 0 || !item || item.valid !== true) {
        throw invalidSetup(`neighbor-change is not valid on its own (exit ${oracle.status}): ${item ? item.issues.map((i) => i.message).join(' || ') : oracle.parseError}`);
      }
    },
    matchers: single(collisionMatcher()),
    oracle: 'pass',
  },
  {
    id: 'R01',
    fixture: 'real-tier1',
    defectClass: 'task contract: missing Done-when',
    expectation: 'must-catch',
    reason: 'structural task-contract lint (strict)',
    mutate: (project) => removeFirstDoneWhen(project, REAL_TASKS),
    matchers: labelMatchers('missing Done-when:'),
    oracle: 'pass',
  },
  {
    id: 'R02',
    fixture: 'real-tier1',
    defectClass: 'task contract: vague Do',
    expectation: 'must-catch',
    reason: 'VAGUE_DO_PATTERNS lint (strict)',
    mutate: (project) => appendVagueDo(project, REAL_TASKS),
    matchers: labelMatchers('vague wording in Do:'),
    oracle: 'pass',
  },
  {
    id: 'R03',
    fixture: 'real-tier1',
    defectClass: 'delta: MODIFIED heading not in main',
    expectation: 'must-catch',
    reason: 'delta heading vs main spec (planSpecSync)',
    mutate: (project) => {
      assertNoMainRequirement(project, 'tiered-review', 'Nonexistent modified requirement');
      assertNoMainRequirement(project, 'lean-archive', 'Nonexistent modified requirement');
      writeRel(project, REAL_TIERED_DELTA, replaceLine(readRel(project, REAL_TIERED_DELTA), '### Requirement: Скриптовий Tier 1 перед LLM-review', '### Requirement: Nonexistent modified requirement', 'R03'));
    },
    matchers: single(includesAll('tiered-review: MODIFIED requirement not found in main spec: "Nonexistent modified requirement"')),
    oracle: 'pass',
  },
];

function caseContext(sandbox) {
  const change = sandbox.fixture.change;
  return { sandbox, change, label: firstTaskLabel(readRel(sandbox.project, `openspec/changes/${change}/tasks.md`)) };
}

// Binds the label-dependent matchers of a case to its pristine copy.
function resolveCase(testCase, ctx) {
  const { required, allowed } = testCase.matchers(ctx);
  return { ...testCase, required, allowed };
}

async function runCase(testCase, openspecBin) {
  return withSandbox(testCase.fixture, openspecBin, (sandbox) => {
    try {
      const ctx = caseContext(sandbox);
      const resolved = resolveCase(testCase, ctx);
      applyMutation(sandbox.project, testCase, ctx);
      const gate = runGate(sandbox, ctx.change);
      const oracle = runOracle(sandbox, ctx.change);
      return classify({ gate, oracle }, resolved);
    } catch (e) {
      // Sanitized: the report must not carry absolute temp paths.
      return { result: 'invalid', detail: String(e.message).split(sandbox.root).join('<tmp>') };
    }
  });
}

test('mutation runs start from a pristine fixture copy and never touch the source fixture', async () => {
  const openspecBin = resolveOpenspecBin();
  const source = snapshotFiles(join(FIXTURES_DIR, 'synthetic'));
  const s01 = CASES.find((c) => c.id === 'S01');
  await withSandbox('synthetic', openspecBin, (sandbox) => {
    applyMutation(sandbox.project, s01, caseContext(sandbox));
    assert.doesNotMatch(readRel(sandbox.project, SYN_TASKS).split('\n- [ ] 1.2')[0], /Done-when:/);
  });
  await withSandbox('synthetic', openspecBin, (sandbox) => {
    assert.deepEqual(snapshotFiles(sandbox.project), source);
  });
  assert.deepEqual(snapshotFiles(join(FIXTURES_DIR, 'synthetic')), source);
});

test('mutator without a target or with two targets fails as invalid setup', async () => {
  const openspecBin = resolveOpenspecBin();
  const s01 = CASES.find((c) => c.id === 'S01');
  const s07 = CASES.find((c) => c.id === 'S07');
  await withSandbox('synthetic', openspecBin, (sandbox) => {
    const ctx = caseContext(sandbox);
    applyMutation(sandbox.project, s01, ctx);
    assert.throws(() => applyMutation(sandbox.project, s01, ctx), /invalid setup: first task: expected exactly one "Done-when:" line, found 0/);
  });
  await withSandbox('synthetic', openspecBin, (sandbox) => {
    const tasks = readRel(sandbox.project, SYN_TASKS);
    const doneWhen = tasks.split('\n').find((line) => /^\s+Done-when:/.test(line));
    writeRel(sandbox.project, SYN_TASKS, tasks.replace(doneWhen, `${doneWhen}\n${doneWhen}`));
    assert.throws(() => applyMutation(sandbox.project, s01, caseContext(sandbox)), /invalid setup: first task: expected exactly one "Done-when:" line, found 2/);
  });
  await withSandbox('synthetic', openspecBin, (sandbox) => {
    const delta = readRel(sandbox.project, SYN_DELTA);
    writeRel(sandbox.project, SYN_DELTA, `${delta}\n### Requirement: Sample modified requirement\n`);
    assert.throws(() => applyMutation(sandbox.project, s07, caseContext(sandbox)), /invalid setup: S07: expected exactly one line/);
  });
  await withSandbox('synthetic', openspecBin, (sandbox) => {
    assert.throws(() => applyMutation(sandbox.project, { id: 'NOOP', mutate: () => {} }, caseContext(sandbox)), /invalid setup: NOOP: mutation left the fixture unchanged/);
    assert.throws(() => removeBlock('## A\n\n## A\n', /^## A$/, 'dup'), /invalid setup: dup: expected exactly one target heading, found 2/);
    assert.throws(() => removeBlock('```\n## A\n```\n', /^## A$/, 'fenced'), /invalid setup: fenced: expected exactly one target heading, found 0/);
  });
});

// --- Report ---

const REPORT_HEADER = '| ID | Profile | Fixture | Defect class | Expectation | Result | Reason |';

// No absolute temp paths and no "<n> / <n>" ratio may leak into free-text details.
function sanitizeDetail(text) {
  return String(text).split(tmpdir()).join('<tmp>').replace(/(\d)\s+\/\s+(\d)/g, '$1/$2').replace(/\s+/g, ' ');
}

// Pure: deterministic Markdown report (no timestamps, no temp paths, nothing persisted).
function formatReport(results, incompleteReason = null) {
  const order = new Map(CASES.map((c, i) => [c.id, i]));
  const rank = (id) => (order.has(id) ? order.get(id) : Number.MAX_SAFE_INTEGER);
  const rows = [...results].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const lines = [
    REPORT_HEADER,
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${[r.id, 'strict', r.fixture, r.defectClass, r.expectation, r.result, r.reason].map(cell).join(' | ')} |`),
    '',
  ];

  const problems = [];
  if (incompleteReason) problems.push(incompleteReason);
  for (const r of rows.filter((row) => row.result === 'invalid')) problems.push(`${r.id} invalid: ${r.detail || 'no detail'}`);
  if (problems.length) {
    lines.push(`incomplete: ${sanitizeDetail(problems.join('; '))}`);
    lines.push('No detection ratio is reported: a partial run is not a valid measurement of the corpus.');
    return lines.join('\n');
  }

  const caught = rows.filter((r) => r.result === 'caught').length;
  const missedGaps = rows.filter((r) => r.result === 'missed' && r.expectation === 'known-gap');
  const missedMust = rows.filter((r) => r.result === 'missed' && r.expectation === 'must-catch');
  const newly = rows.filter((r) => r.newlyCaught);
  lines.push(`caught / total: ${caught} / ${rows.length}`);
  lines.push(missedGaps.length ? 'Missed known gaps:' : 'Missed known gaps: none');
  for (const r of missedGaps) lines.push(`- ${r.id}: ${r.reason}`);
  if (missedMust.length) lines.push(`Missed must-catch (regression): ${missedMust.map((r) => r.id).join(', ')}`);
  lines.push(`Newly caught: ${newly.length ? newly.map((r) => r.id).join(', ') : 'none'}`);
  lines.push('Scope: the ratio covers only this corpus in the strict profile (task_contract: strict, artifact_budget: off); it is not a rate over all possible defects and does not describe the default warn configuration.');
  return lines.join('\n');
}

function reportRows(overrides = {}) {
  return CASES.map((c) => ({
    ...c,
    result: c.expectation === 'known-gap' ? 'missed' : 'caught',
    detail: '',
    newlyCaught: false,
    ...(overrides[c.id] || {}),
  }));
}

test('formatReport: stable table, ratio only for a complete run', async (t) => {
  const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const assertClean = (out) => {
    assert.ok(!out.includes(tmpdir()), 'report contains a temp path');
    assert.doesNotMatch(out, ISO_TIMESTAMP);
  };

  await t.test('full result set', () => {
    const out = formatReport([...reportRows()].reverse());
    const lines = out.split('\n');
    assert.equal(lines[0], REPORT_HEADER);
    for (const name of ['ID', 'Profile', 'Fixture', 'Defect class', 'Expectation', 'Result', 'Reason']) assert.ok(lines[0].includes(` ${name} |`), name);
    const rows = lines.filter((line) => /^\| [SR]\d\d \|/.test(line));
    assert.deepEqual(rows.map((line) => line.split(' | ')[0].slice(2)), ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'R01', 'R02', 'R03']);
    const caughtRows = rows.filter((line) => line.includes('| caught |')).length;
    assert.ok(lines.includes(`caught / total: ${caughtRows} / ${rows.length}`), out);
    assert.match(out, /^- S10: /m);
    assert.match(out, /^- S11: /m);
    assert.match(out, /^Newly caught: none$/m);
    assert.match(out, /strict profile/);
    assertClean(out);
  });

  await t.test('newly caught known gap is listed', () => {
    const out = formatReport(reportRows({ S11: { result: 'caught', newlyCaught: true } }));
    assert.match(out, /^caught \/ total: 13 \/ 14$/m);
    assert.match(out, /^Newly caught: S11$/m);
  });

  await t.test('one invalid row -> incomplete, no ratio', () => {
    const out = formatReport(reportRows({ S03: { result: 'invalid', detail: `stray gate error(s) in ${join(tmpdir(), 'aok-mutation-eval-x')} 3 / 4` } }));
    assert.match(out, /incomplete/);
    assert.match(out, /S03 invalid/);
    assert.doesNotMatch(out, /\d+ \/ \d+/);
    assert.ok(!out.includes('caught / total'));
    assertClean(out);
  });

  await t.test('baseline failure -> incomplete, no ratio', () => {
    const out = formatReport(reportRows().filter((r) => r.fixture === 'synthetic'), 'baseline failure: real-tier1/tier1-delta-heading-check (mutants not run: R01, R02, R03)');
    assert.match(out, /incomplete: baseline failure: real-tier1/);
    assert.doesNotMatch(out, /\d+ \/ \d+/);
    assertClean(out);
  });
});

test('classifier: known-gap matchers accept only the target diagnostic', async (t) => {
  const label = 'Add the new marker to the sample file';
  const s10 = resolveCase(CASES.find((c) => c.id === 'S10'), { label });
  const s11 = resolveCase(CASES.find((c) => c.id === 'S11'), { label });
  const failing = (errors) => fakeGate({ stdout: gateJson(false, errors) });

  await t.test('S10-like error for another task -> invalid', () => {
    const c = classify({ gate: failing(['task "Create the second sample file": Done-when checks only an old state']), oracle: fakeOracle() }, s10);
    assert.equal(c.result, 'invalid', c.detail);
    assert.equal(verdict(s10, c).pass, false);
  });
  await t.test('S10 missing Done-when is not a quality diagnostic -> invalid', () => {
    const c = classify({ gate: failing([`task "${label}": missing Done-when:`]), oracle: fakeOracle() }, s10);
    assert.equal(c.result, 'invalid', c.detail);
  });
  await t.test('S11-like error without neighbor-change -> invalid', () => {
    const c = classify({ gate: failing(['sample-capability: "Sample modified requirement" of synthetic-change conflicts with another active change']), oracle: fakeOracle() }, s11);
    assert.equal(c.result, 'invalid', c.detail);
    assert.equal(verdict(s11, c).pass, false);
  });
  await t.test('error with every required substring -> newly caught', () => {
    for (const [testCase, error] of [
      [s10, `task "${label}": Done-when does not verify the state added by Do`],
      [s11, 'sample-capability: MODIFIED "Sample modified requirement" in synthetic-change conflicts with neighbor-change'],
    ]) {
      const c = classify({ gate: failing([error]), oracle: fakeOracle() }, testCase);
      assert.equal(c.result, 'caught', c.detail);
      const v = verdict(testCase, c);
      assert.equal(v.pass, true);
      assert.equal(v.newlyCaught, true);
    }
  });
});

function printReport(t, report) {
  for (const line of report.split('\n')) t.diagnostic(line);
}

test('artifact mutation evals (strict profile)', async (t) => {
  const tempBefore = new Set(leftoverTempRoots());
  let openspecBin = null;
  await t.test('setup: local OpenSpec validator is installed', () => {
    openspecBin = resolveOpenspecBin();
  });
  if (!openspecBin) {
    printReport(t, formatReport([], 'setup failure: local OpenSpec validator is unavailable (mutants not run)'));
    assert.fail('setup failure: local OpenSpec validator is unavailable');
  }

  const baselineOk = {};
  for (const fixtureKey of Object.keys(FIXTURES)) {
    baselineOk[fixtureKey] = false;
    await t.test(`baseline ${fixtureKey}/${FIXTURES[fixtureKey].change}`, async () => {
      await withSandbox(fixtureKey, openspecBin, (sandbox) => assertBaseline(sandbox));
      baselineOk[fixtureKey] = true;
    });
  }

  // Sequential awaited subtests: each case gets a fresh fixture copy.
  const results = [];
  for (const testCase of CASES) {
    if (!baselineOk[testCase.fixture]) continue;
    await t.test(`${testCase.id} ${testCase.defectClass} (${testCase.expectation})`, async () => {
      const classification = await runCase(testCase, openspecBin);
      const v = verdict(testCase, classification);
      results.push({ ...testCase, result: classification.result, detail: classification.detail, newlyCaught: v.newlyCaught });
      assert.ok(v.pass, v.message);
    });
  }

  const failedBaselines = Object.keys(FIXTURES).filter((key) => !baselineOk[key]);
  const incompleteReason = failedBaselines.length
    ? failedBaselines.map((key) => `baseline failure: ${key}/${FIXTURES[key].change} (mutants not run: ${CASES.filter((c) => c.fixture === key).map((c) => c.id).join(', ')})`).join('; ')
    : null;
  t.diagnostic(`baseline (not a mutation, not counted): ${Object.keys(FIXTURES).map((key) => `${key}/${FIXTURES[key].change} ${baselineOk[key] ? 'pass' : 'FAIL'}`).join('; ')}`);
  printReport(t, formatReport(results, incompleteReason));

  const leaked = leftoverTempRoots().filter((entry) => !tempBefore.has(entry));
  assert.deepEqual(leaked, [], 'temp roots were not cleaned up');
});
