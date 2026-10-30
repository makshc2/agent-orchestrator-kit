import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Offline harness for the opt-in spec verifier scripts: a temporary git project,
// copies of templates/scripts, fake amp/gh/curl on a controlled PATH, sentinel tokens.
// Real Amp, gh, curl and network are never reachable from the scripts under test.
const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = ['verify-specs.sh', 'post-pr-verdict-github.sh', 'post-mr-verdict.sh'];
const AMP_KEY = 'sentinel-amp-key-4f2a90';
const GH_KEY = 'sentinel-gh-token-9c1e77';
const GITLAB_KEY = 'sentinel-gitlab-token-7d3b15';
const SENSITIVE = 'SENTINEL_SENSITIVE_CONTENT_51ab';
const SYSTEM_TOOLS = ['bash', 'cat', 'mkdir', 'find', 'dirname', 'sed', 'head', 'wc', 'awk', 'mktemp', 'rm', 'git', 'python3', 'cp', 'tr', 'grep'];
const SPEC_PATH = 'openspec/specs/auth/spec.md';
const TIMEOUT = 60_000;

const toolPath = Object.fromEntries(SYSTEM_TOOLS.map((tool) => {
  const res = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf-8' });
  const path = res.stdout.trim();
  assert.ok(path.startsWith('/'), `system tool ${tool} not found`);
  return [tool, path];
}));

const FAKE_AMP = `#!${toolPath.bash}
cat > "$FAKE_CAPTURE_DIR/amp-stdin"
printf '%s\\n' "$@" > "$FAKE_CAPTURE_DIR/amp-argv"
cat "$AMP_FIXTURE"
`;

const FAKE_GH = `#!${toolPath.bash}
printf '%s\\n' "$@" > "$FAKE_CAPTURE_DIR/gh-argv"
while [ $# -gt 0 ]; do
  if [ "$1" = "--body-file" ]; then cat "$2" > "$FAKE_CAPTURE_DIR/gh-body"; shift 2; else shift; fi
done
`;

// The payload is copied while curl runs: the caller may delete its temp file afterwards.
// argv is recorded without the payload; an inline --data value is marked <inline>.
const FAKE_CURL = `#!${toolPath.bash}
cap="$FAKE_CAPTURE_DIR"
: > "$cap/curl-argv"
src=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data|--data-binary|--data-raw|-d)
      flag="$1"; val="$2"; shift 2
      if [ "$flag" = "--data-binary" ] && [ "\${val#@}" != "$val" ]; then
        f="\${val#@}"
        if [ "$f" = "-" ]; then cat > "$cap/curl-payload"; src=stdin
        else cat "$f" > "$cap/curl-payload"; src=file; fi
        printf '%s\\n' "$flag" "$val" >> "$cap/curl-argv"
      else
        printf '%s' "$val" > "$cap/curl-payload"; src=inline
        printf '%s\\n' "$flag" "<inline>" >> "$cap/curl-argv"
      fi ;;
    *) printf '%s\\n' "$1" >> "$cap/curl-argv"; shift ;;
  esac
done
printf '%s' "$src" > "$cap/curl-source"
printf '201'
`;

const SPEC = `# Auth

## Purpose

Login behaviour.

## Requirements

### Requirement: Login

The system SHALL check the password.

#### Scenario: Wrong password
- **WHEN** the password is wrong
- **THEN** login is refused
`;

function put(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function writeExec(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function linkTools(dir, tools) {
  mkdirSync(dir, { recursive: true });
  for (const tool of tools) symlinkSync(toolPath[tool], join(dir, tool));
}

function makeProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'aok-spec-verify-'));
  const p = {
    tmp,
    root: join(tmp, 'project'),
    home: join(tmp, 'home'),
    cap: join(tmp, 'capture'),
    fixture: join(tmp, 'amp-fixture.txt'),
    sys: join(tmp, 'sysbin'),
    sysNoPython: join(tmp, 'sysbin-nopython'),
    fakes: join(tmp, 'fakes'),
    fakesNoAmp: join(tmp, 'fakes-noamp'),
    outside: join(tmp, 'outside'),
  };
  for (const dir of [p.root, p.home, p.cap, p.fakes, p.fakesNoAmp, p.outside]) mkdirSync(dir, { recursive: true });
  linkTools(p.sys, SYSTEM_TOOLS);
  linkTools(p.sysNoPython, SYSTEM_TOOLS.filter((tool) => tool !== 'python3'));
  for (const dir of [p.fakes, p.fakesNoAmp]) {
    writeExec(join(dir, 'gh'), FAKE_GH);
    writeExec(join(dir, 'curl'), FAKE_CURL);
  }
  writeExec(join(p.fakes, 'amp'), FAKE_AMP);
  writeFileSync(p.fixture, '');

  for (const script of SCRIPTS) {
    cpSync(join(KIT_ROOT, 'templates/scripts', script), join(p.root, 'scripts', script));
    chmodSync(join(p.root, 'scripts', script), 0o755);
  }
  put(p.root, SPEC_PATH, SPEC);
  put(p.root, 'openspec/config.yaml', 'context: |\n  Small fixture project.\n');
  put(p.root, 'src/app.js', 'const a = 1;\n');
  git(p, 'init', '-q', '-b', 'main');
  git(p, 'add', '-A');
  git(p, 'commit', '-q', '-m', 'base');
  put(p.root, 'src/app.js', 'const a = 1;\n\nconst c = 3;\n');
  put(p.root, 'src/delims.js', 'first\n\\:\\:\\:\n\\:\n\nlast-no-newline');
  put(p.root, 'src/api-token.js', `export const token = '${SENSITIVE}';\n`);
  git(p, 'add', '-A');
  git(p, 'commit', '-q', '-m', 'change');
  return p;
}

function baseEnv(p, sysDir = p.sys, fakeDir = p.fakes) {
  return {
    PATH: `${fakeDir}:${sysDir}`,
    HOME: p.home,
    XDG_CONFIG_HOME: join(p.home, '.config'),
    GIT_CONFIG_NOSYSTEM: '1',
    LC_ALL: 'C.UTF-8',
    FAKE_CAPTURE_DIR: p.cap,
    AMP_FIXTURE: p.fixture,
  };
}

function git(p, ...args) {
  const env = { ...baseEnv(p), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const res = spawnSync(toolPath.git, args, { cwd: p.root, env, encoding: 'utf-8', timeout: TIMEOUT });
  assert.equal(res.status, 0, res.stderr);
}

function withProject(fn) {
  const p = makeProject();
  try {
    return fn(p);
  } finally {
    rmSync(p.tmp, { recursive: true, force: true });
  }
}

function cap(p, name) {
  const file = join(p.cap, name);
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

// Runs a copied script with a clean env; cwd defaults to the project root (the original
// render blocks read the relative artifacts/verdict.json).
function run(p, script, { env = {}, cwd = p.root, noAmp = false, noPython = false } = {}) {
  rmSync(p.cap, { recursive: true, force: true });
  mkdirSync(p.cap);
  const fullEnv = { ...baseEnv(p, noPython ? p.sysNoPython : p.sys, noAmp ? p.fakesNoAmp : p.fakes), ...env };
  const res = spawnSync(toolPath.bash, [join(p.root, 'scripts', script)], { cwd, env: fullEnv, encoding: 'utf-8', timeout: TIMEOUT });
  assert.notEqual(res.status, null, `${script} timed out or was killed: ${res.signal}`);
  for (const secret of [AMP_KEY, GH_KEY, GITLAB_KEY]) {
    assert.ok(!res.stdout.includes(secret) && !res.stderr.includes(secret), `${script} leaked a sentinel token`);
  }
  return res;
}

function verify(p, response, opts = {}) {
  writeFileSync(p.fixture, response);
  const res = run(p, 'verify-specs.sh', { ...opts, env: { AMP_API_KEY: AMP_KEY, ...opts.env } });
  assert.equal(cap(p, 'curl-argv'), null, 'verify-specs.sh must not call curl');
  assert.equal(cap(p, 'gh-argv'), null, 'verify-specs.sh must not call gh');
  const verdictPath = join(p.root, 'artifacts/verdict.json');
  const raw = existsSync(verdictPath) ? readFileSync(verdictPath, 'utf-8') : null;
  return { res, raw, verdict: raw === null ? null : JSON.parse(raw) };
}

const GITHUB_ENV = { GH_TOKEN: GH_KEY, PR_NUMBER: '7', GITHUB_RUN_ID: '42' };
const GITLAB_ENV = {
  CI_API_V4_URL: 'https://gitlab.example.invalid/api/v4',
  CI_PROJECT_ID: '11',
  CI_MERGE_REQUEST_IID: '22',
  CI_PIPELINE_ID: '42',
  GITLAB_VERIFIER_TOKEN: GITLAB_KEY,
};

function writeVerdict(p, verdict) {
  put(p.root, 'artifacts/verdict.json', typeof verdict === 'string' ? verdict : JSON.stringify(verdict, null, 2));
}

function postGithub(p, opts = {}) {
  const res = run(p, 'post-pr-verdict-github.sh', { ...opts, env: { ...GITHUB_ENV, ...opts.env } });
  return { res, body: cap(p, 'gh-body'), argv: cap(p, 'gh-argv') };
}

function postGitlab(p, opts = {}) {
  const res = run(p, 'post-mr-verdict.sh', { ...opts, env: { ...GITLAB_ENV, ...opts.env } });
  const payload = cap(p, 'curl-payload');
  return {
    res,
    payload,
    source: cap(p, 'curl-source'),
    argv: cap(p, 'curl-argv'),
    body: payload === null ? null : JSON.parse(payload).body,
  };
}

const LEGACY_PASS = {
  pass: true,
  score: 97,
  summary: 'Legacy summary',
  findings: [{ severity: 'warning', spec: SPEC_PATH, requirement: 'Login', message: 'Weak check', file: 'src/app.js', line: 3 }],
};
const LEGACY_BLOCKED = {
  pass: false,
  score: 90,
  summary: 'Password check is absent',
  findings: [{ severity: 'error', spec: SPEC_PATH, requirement: 'Login', message: 'No password check', file: 'src/app.js', line: null }],
};

// ── 1.1 Baseline (legacy) ────────────────────────────────────

test('legacy harness: fake curl captures file, stdin and inline payloads without the payload in argv', () => withProject((p) => {
  const curl = join(p.fakes, 'curl');
  const payloadFile = put(p.tmp, 'payload.json', '{"body":"from file"}');
  const env = baseEnv(p);
  const call = (args, input) => {
    rmSync(p.cap, { recursive: true, force: true });
    mkdirSync(p.cap);
    const res = spawnSync(curl, ['-s', '-o', '/dev/null', '-w', '%{http_code}', ...args, 'https://x.invalid/notes'], { env, input, encoding: 'utf-8', timeout: TIMEOUT });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '201');
    return { payload: cap(p, 'curl-payload'), source: cap(p, 'curl-source'), argv: cap(p, 'curl-argv') };
  };

  const fromFile = call(['--data-binary', `@${payloadFile}`]);
  assert.deepEqual([fromFile.source, fromFile.payload], ['file', '{"body":"from file"}']);
  assert.ok(!fromFile.argv.includes('from file'));

  const fromStdin = call(['--data-binary', '@-'], '{"body":"from stdin"}');
  assert.deepEqual([fromStdin.source, fromStdin.payload], ['stdin', '{"body":"from stdin"}']);
  assert.ok(!fromStdin.argv.includes('from stdin'));

  const inline = call(['--data', '{"body":"inline"}']);
  assert.deepEqual([inline.source, inline.payload], ['inline', '{"body":"inline"}']);
  assert.match(inline.argv, /^<inline>$/m);
  assert.ok(!inline.argv.includes('"body"'));
}));

test('legacy: verify-specs stores the verdict returned by amp', () => withProject((p) => {
  const { res, verdict } = verify(p, `${JSON.stringify(LEGACY_PASS, null, 2)}\n`);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.score, 97);
  assert.deepEqual(verdict.findings, LEGACY_PASS.findings);
  assert.match(cap(p, 'amp-stdin'), /SPEC VERIFIER/);
  assert.equal(cap(p, 'amp-argv'), '-x\n');
}));

test('legacy: verify-specs skips without AMP_API_KEY and never calls amp', () => withProject((p) => {
  writeFileSync(p.fixture, JSON.stringify(LEGACY_BLOCKED));
  const res = run(p, 'verify-specs.sh');
  assert.equal(res.status, 0, res.stderr);
  const verdict = JSON.parse(readFileSync(join(p.root, 'artifacts/verdict.json'), 'utf-8'));
  assert.equal(verdict.pass, true);
  assert.equal(verdict.skipped, true);
  assert.equal(cap(p, 'amp-stdin'), null);
}));

for (const [label, verdict, icon, status, row] of [
  ['PASS', LEGACY_PASS, '✅', 'PASS', `| 🟡 | warning | ${SPEC_PATH} | Login | Weak check | src/app.js:3 |`],
  ['BLOCKED', LEGACY_BLOCKED, '❌', 'BLOCKED', `| 🔴 | error | ${SPEC_PATH} | Login | No password check | src/app.js |`],
]) {
  const invariants = (body) => {
    assert.ok(body.includes(`## ${icon} Spec Verifier — ${status}`), body);
    assert.ok(body.includes(`**Score:** ${verdict.score}/100`));
    assert.ok(body.includes(`**Verdict:** ${status}`));
    assert.ok(body.includes(`### Summary\n${verdict.summary}\n`));
    assert.ok(body.includes('| | Severity | Spec | Requirement | Message | File |'));
    assert.ok(body.includes(row), body);
  };

  test(`legacy: GitHub comment for a ${label} verdict goes through --body-file`, () => withProject((p) => {
    writeVerdict(p, verdict);
    const { res, body, argv } = postGithub(p);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /PR comment posted successfully/);
    assert.ok(argv.startsWith('pr\ncomment\n7\n--body-file\n'), argv);
    invariants(body);
  }));

  test(`legacy: GitLab comment for a ${label} verdict posts a JSON payload`, () => withProject((p) => {
    writeVerdict(p, verdict);
    const { res, body, source, argv } = postGitlab(p);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /MR comment posted successfully \(HTTP 201\)/);
    assert.ok(['file', 'stdin', 'inline'].includes(source), source);
    for (const arg of ['--request', 'POST', `PRIVATE-TOKEN: ${GITLAB_KEY}`, 'Content-Type: application/json', 'https://gitlab.example.invalid/api/v4/projects/11/merge_requests/22/notes']) {
      assert.ok(argv.split('\n').includes(arg), arg);
    }
    invariants(body);
  }));
}

test('legacy: comment scripts skip without PR/MR context or token', () => withProject((p) => {
  writeVerdict(p, LEGACY_PASS);
  const cases = [
    ['post-pr-verdict-github.sh', { GH_TOKEN: GH_KEY }, /Not running in a pull_request context/],
    ['post-pr-verdict-github.sh', { PR_NUMBER: '7' }, /GH_TOKEN\/GITHUB_TOKEN not set/],
    ['post-mr-verdict.sh', { GITLAB_VERIFIER_TOKEN: GITLAB_KEY }, /Not running in MR context/],
    ['post-mr-verdict.sh', { ...GITLAB_ENV, GITLAB_VERIFIER_TOKEN: '' }, /GITLAB_VERIFIER_TOKEN not set/],
  ];
  for (const [script, env, message] of cases) {
    const res = run(p, script, { env });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, message);
    assert.equal(cap(p, 'gh-argv'), null);
    assert.equal(cap(p, 'curl-argv'), null);
  }
}));

// ── 2.1 Prompt contract, skip and fallback verdicts ──────────

const GROUPS = ['implemented', 'missing', 'scope_creep'];
const VERBATIM_PROMPT_LINES = [
  'Conformance groups (additive; findings stay the only source of pass and score):',
  '- implemented: provided code satisfies a relevant requirement; message cites the evidence.',
  '- missing: a positive requirement whose behavior is absent or incomplete in a provided file where the behavior is expected. "file" MUST be that provided file (line may be null). If you cannot name such a file, do NOT add a missing item; add a warning or info finding about the uncertainty instead.',
  '- scope_creep: provided code does what a requirement or an explicit boundary forbids or excludes (SHALL NOT, MUST NOT, an explicit exclusion or non-goal in the provided specs). "file" MUST be that provided file. A changed file without a related spec is an info finding, never scope_creep.',
  '- One discrepancy goes to exactly one group: an unmet positive requirement is missing; a violated prohibition or exclusion is scope_creep.',
  'Every missing or scope_creep item MUST have exactly one mirrored finding with the same spec, requirement, file and line (null stays null). A mirrored finding counts once in the score; the group item itself adds no penalty; never add a second finding for the same discrepancy.',
  'Severity of the mirrored finding: missing -> "error" if the requirement is SHALL or MUST and the behavior is wholly absent from that file, otherwise "warning"; scope_creep -> "error" if it violates SHALL NOT or MUST NOT, otherwise "warning". implemented items have no finding.',
];
const NUMBERING_SENTENCE = 'Source files are shown with line numbers: each line is its 1-based line number, a TAB character, then the original text; the number prefix is not part of the code and the numbers are the line coordinates for findings and groups.';
const INCONCLUSIVE_VERDICT = {
  pass: true,
  score: 50,
  skipped: false,
  inconclusive: true,
  summary: 'Verifier did not return valid JSON — result inconclusive.',
  findings: [{ severity: 'warning', spec: 'N/A', requirement: 'N/A', message: 'Verifier agent response was not valid JSON. Manual review recommended.', file: 'N/A', line: null }],
  implemented: [],
  missing: [],
  scope_creep: [],
};

function prompt(p) {
  const { res } = verify(p, JSON.stringify(LEGACY_PASS));
  assert.equal(res.status, 0, res.stderr);
  const text = readFileSync(join(p.root, 'artifacts/verifier-prompt.md'), 'utf-8');
  assert.equal(cap(p, 'amp-stdin'), text);
  return text;
}

function assertNoResponseLeftovers(p) {
  assert.ok(!existsSync(join(p.root, 'artifacts/amp-response.txt')), 'amp-response.txt must be removed');
  assert.ok(!existsSync(join(p.root, 'artifacts/verdict.json.tmp')), 'verdict.json.tmp must be removed');
}

test('prompt: conformance, mirrored-finding and severity lines are present verbatim', () => withProject((p) => {
  const text = prompt(p);
  for (const line of VERBATIM_PROMPT_LINES) assert.ok(text.split('\n').includes(line), line);
  assert.ok(text.includes('Rules for verdict:\n- "pass": false if ANY finding has severity "error"\n- "pass": true if only "warning" or "info" findings, or no findings\n- "score": 100 minus 10 per error, 3 per warning (minimum 0)\n'));
  assert.ok(!text.includes('без подвійного штрафу'));
}));

test('prompt: output example shows three groups with five fields and no literal null line', () => withProject((p) => {
  const text = prompt(p);
  const example = text.slice(text.indexOf('with this structure:\n'), text.indexOf('\nRules for verdict:'));
  assert.ok(example.length > 100, 'output example not found');
  for (const group of GROUPS) assert.ok(example.includes(`"${group}": [`), group);
  for (const field of ['spec', 'requirement', 'message', 'file', 'line']) {
    assert.equal(example.split(`"${field}":`).length - 1, 4, `field ${field} in findings and three groups`);
  }
  assert.ok(!example.includes('"line": null'));
  assert.equal(example.split('positive integer or null').length - 1, 4);
}));

test('prompt: no inconclusive marker and no shell metacharacters in the template text', () => withProject((p) => {
  assert.ok(!prompt(p).includes('inconclusive'));
  const script = readFileSync(join(KIT_ROOT, 'templates/scripts/verify-specs.sh'), 'utf-8');
  const body = script.slice(script.indexOf('<<PROMPT\n') + 9, script.indexOf('\nPROMPT\n'));
  const substitutions = ['${PROJECT_CONTEXT}', '${SPECS_CONTENT}', '${CHANGED_CONTENT}'];
  for (const line of body.split('\n')) {
    if (substitutions.includes(line)) continue;
    assert.doesNotMatch(line, /[`$\\]/, line);
  }
  for (const line of [...VERBATIM_PROMPT_LINES, NUMBERING_SENTENCE]) assert.ok(body.includes(line), line);
}));

test('prompt: source lines are numbered from 1 after the sensitive-path filter', () => withProject((p) => {
  const text = prompt(p);
  assert.ok(text.includes(`## CHANGED SOURCE FILES\n\n${NUMBERING_SENTENCE}\n`));
  assert.ok(text.includes('--- FILE: src/app.js ---\n1\tconst a = 1;\n2\t\n3\tconst c = 3;\n'));
  assert.ok(text.includes('--- FILE: src/delims.js ---\n1\tfirst\n2\t\\:\\:\\:\n3\t\\:\n4\t\n5\tlast-no-newline\n'));
  assert.ok(!text.includes('src/api-token.js'));
  assert.ok(!text.includes(SENSITIVE));
  assert.ok(text.includes('--- FILE: openspec/specs/auth/spec.md ---\n# Auth\n'), 'specs are not numbered');
}));

for (const [label, setup, opts] of [
  ['no changed source files', () => {}, { env: { CI_MERGE_REQUEST_DIFF_BASE_SHA: 'HEAD' } }],
  ['no spec files', (p) => rmSync(join(p.root, 'openspec/specs'), { recursive: true }), {}],
  ['amp CLI missing', () => {}, { noAmp: true }],
  ['AMP_API_KEY missing', () => {}, { env: { AMP_API_KEY: '' } }],
]) {
  test(`skip: ${label} writes a skipped verdict with three empty groups`, () => withProject((p) => {
    setup(p);
    const { res, verdict } = verify(p, JSON.stringify(LEGACY_BLOCKED), opts);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(verdict.pass, true);
    assert.equal(verdict.score, 100);
    assert.equal(verdict.skipped, true);
    assert.deepEqual(verdict.findings, []);
    for (const group of GROUPS) assert.deepEqual(verdict[group], [], group);
    assert.ok(!('inconclusive' in verdict));
    assert.equal(cap(p, 'amp-stdin'), null, 'amp must not run');
  }));
}

test('fallback: invalid response writes the inconclusive verdict', () => withProject((p) => {
  const { res, verdict } = verify(p, 'I could not finish the review.\n');
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(verdict, INCONCLUSIVE_VERDICT);
  assert.match(res.stdout, /Failed to parse verifier response as JSON\.\nRaw response \(first 500 chars\):\nI could not finish the review\./);
  assertNoResponseLeftovers(p);
}));

// ── 2.2 Complete JSON responses ──────────────────────────────

const item = (i, extra = '') => ({ spec: SPEC_PATH, requirement: `Requirement ${i}`, message: `Evidence ${i}${extra}`, file: 'src/app.js', line: (i % 3) + 1 });

test('JSON: a response over 200 lines is stored without loss', () => withProject((p) => {
  const verdict = { ...LEGACY_PASS, implemented: Array.from({ length: 40 }, (_, i) => item(i)), missing: [], scope_creep: [] };
  const response = `${JSON.stringify(verdict, null, 2)}\n`;
  assert.ok(response.split('\n').length > 200);
  const { res, raw, verdict: stored } = verify(p, response);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(stored, verdict);
  assert.equal(raw, response);
  assertNoResponseLeftovers(p);
}));

test('JSON: a response over 131072 bytes is stored without loss', () => withProject((p) => {
  const verdict = { ...LEGACY_PASS, implemented: [], missing: Array.from({ length: 1200 }, (_, i) => item(i, ' — '.repeat(40))), scope_creep: [] };
  const response = `Here is the verdict.\n${JSON.stringify(verdict, null, 2)}\nDone.\n`;
  assert.ok(Buffer.byteLength(response) > 131_072 + 50_000);
  const { res, raw, verdict: stored } = verify(p, response);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(stored, verdict);
  assert.ok(Buffer.byteLength(raw) > 131_072);
  assertNoResponseLeftovers(p);
}));

test('JSON: compact and fenced responses keep every field', () => withProject((p) => {
  const verdict = { ...LEGACY_BLOCKED, implemented: [item(1)], missing: [item(2)], scope_creep: [] };
  for (const response of [
    JSON.stringify(verdict),
    `Sure.\n\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\`\nAnything else?\n`,
    `  ${JSON.stringify(verdict)}   trailing words\n`,
  ]) {
    const { res, verdict: stored } = verify(p, response);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(stored, verdict);
  }
}));

test('JSON: a verdict without groups is kept without migration', () => withProject((p) => {
  const { res, verdict } = verify(p, JSON.stringify(LEGACY_BLOCKED, null, 2));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(verdict, LEGACY_BLOCKED);
}));

test('response: a malformed outer object with a valid nested finding falls back', () => withProject((p) => {
  const response = '{\n  "pass": false,\n  "findings": [\n    {"severity": "error", "spec": "s", "requirement": "r", "message": "m", "file": null, "line": null}\n  ]\n  "score": 80\n}\n';
  const { res, verdict } = verify(p, response);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(verdict, INCONCLUSIVE_VERDICT);
  assert.doesNotMatch(res.stderr, /Traceback/);
}));

test('response: an object after text on the same line falls back to inconclusive', () => withProject((p) => {
  const { res, verdict } = verify(p, `Verdict: ${JSON.stringify(LEGACY_BLOCKED)}\n`);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(verdict.inconclusive, true);
  assert.deepEqual(verdict, INCONCLUSIVE_VERDICT);
}));

test('response: an invalid first candidate falls back without a traceback', () => withProject((p) => {
  const { res, verdict } = verify(p, `{ not json at all\n${JSON.stringify(LEGACY_BLOCKED)}\n`);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(verdict, INCONCLUSIVE_VERDICT);
  assert.doesNotMatch(res.stderr, /Traceback/);
  assertNoResponseLeftovers(p);
}));

test('response: a missing python3 falls back with exit 0', () => withProject((p) => {
  const { res, verdict } = verify(p, JSON.stringify(LEGACY_PASS), { noPython: true });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(verdict, INCONCLUSIVE_VERDICT);
  assertNoResponseLeftovers(p);
}));

// ── 3.1 Provider comments ────────────────────────────────────

const NOT_REPORTED = '_Not reported by this verifier._';
const NONE_REPORTED = '_None reported._';
const NOT_CHECKED_SKIPPED = '_Not checked — verification skipped._';
const NOT_CHECKED_INCONCLUSIVE = '_Not checked — verifier response was inconclusive._';
const GROUP_HEADINGS = { implemented: '### Implemented', missing: '### Missing', scope_creep: '### Scope creep' };
const GROUP_TABLE = '| Spec | Requirement | Evidence | File |\n|------|-------------|----------|------|';

function section(body, heading) {
  const start = body.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `${heading} not found in:\n${body}`);
  const from = start + heading.length + 2;
  return body.slice(from, body.indexOf('\n\n', from));
}

const groups = (body) => GROUPS.map((group) => section(body, GROUP_HEADINGS[group]));
const statusLine = (body) => body.split('\n')[0];
const fromFindings = (body) => body.slice(body.indexOf('### Findings'), body.lastIndexOf('\n---\n'));

// Renders the verdict with both providers, checks exit 0, no exception and parity.
function renderBoth(p, verdict) {
  writeVerdict(p, verdict);
  const gh = postGithub(p);
  const gl = postGitlab(p);
  for (const { res } of [gh, gl]) {
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /Traceback|UnicodeEncodeError|Error/);
  }
  assert.match(gh.res.stdout, /PR comment posted successfully/);
  assert.match(gl.res.stdout, /MR comment posted successfully \(HTTP 201\)/);
  assert.ok(['file', 'stdin'].includes(gl.source), `GitLab payload source: ${gl.source}`);
  assert.equal(fromFindings(gh.body), fromFindings(gl.body));
  assert.equal(statusLine(gh.body), statusLine(gl.body));
  return { gh, gl, body: gh.body };
}

const entry = (requirement, message, file, line) => ({ spec: SPEC_PATH, requirement, message, file, line });
const WARNING_ONLY = {
  pass: true,
  score: 94,
  summary: 'Lockout is incomplete',
  findings: [
    { severity: 'warning', ...entry('Lockout', 'Lockout counter is never reset', 'src/app.js', 3) },
    { severity: 'warning', ...entry('No plaintext', 'Password is logged', 'src/app.js', null) },
  ],
  implemented: [entry('Login', 'Password is compared with the hash', 'src/app.js', 1), entry('Login', 'Wrong password is refused', null, null)],
  missing: [entry('Lockout', 'Lockout counter is never reset', 'src/app.js', 3)],
  scope_creep: [entry('No plaintext', 'Password is logged', 'src/app.js', null)],
};
const ERROR_VERDICT = {
  pass: false,
  score: 90,
  summary: 'Lockout is absent',
  findings: [{ severity: 'error', ...entry('Lockout', 'No lockout at all', 'src/app.js', null) }],
  implemented: [],
  missing: [entry('Lockout', 'No lockout at all', 'src/app.js', null)],
  scope_creep: [],
};

test('comment: full verdict renders groups identically on GitHub and GitLab', () => withProject((p) => {
  const { body, gl } = renderBoth(p, WARNING_ONLY);
  assert.equal(statusLine(body), '## ✅ Spec Verifier — PASS');
  assert.ok(body.includes('**Score:** 94/100\n**Verdict:** PASS\n'));
  assert.equal(section(body, '### Findings'), [
    '| | Severity | Spec | Requirement | Message | File |',
    '|---|----------|------|-------------|---------|------|',
    `| 🟡 | warning | ${SPEC_PATH} | Lockout | Lockout counter is never reset | src/app.js:3 |`,
    `| 🟡 | warning | ${SPEC_PATH} | No plaintext | Password is logged | src/app.js |`,
  ].join('\n'));
  assert.deepEqual(groups(body), [
    `${GROUP_TABLE}\n| ${SPEC_PATH} | Login | Password is compared with the hash | src/app.js:1 |\n| ${SPEC_PATH} | Login | Wrong password is refused | — |`,
    `${GROUP_TABLE}\n| ${SPEC_PATH} | Lockout | Lockout counter is never reset | src/app.js:3 |`,
    `${GROUP_TABLE}\n| ${SPEC_PATH} | No plaintext | Password is logged | src/app.js |`,
  ]);
  assert.ok(gl.body.endsWith('---\n_AI Spec Verifier • agent-orchestrator-kit • Pipeline: 42_\n'));
}));

test('comment: warning-only verdict with missing items stays PASS, error verdict stays BLOCKED', () => withProject((p) => {
  assert.equal(statusLine(renderBoth(p, WARNING_ONLY).body), '## ✅ Spec Verifier — PASS');
  const { body } = renderBoth(p, ERROR_VERDICT);
  assert.equal(statusLine(body), '## ❌ Spec Verifier — BLOCKED');
  assert.ok(body.includes('**Score:** 90/100\n**Verdict:** BLOCKED\n'));
  assert.deepEqual(groups(body), [NONE_REPORTED, `${GROUP_TABLE}\n| ${SPEC_PATH} | Lockout | No lockout at all | src/app.js |`, NONE_REPORTED]);
}));

test('comment: verdict without groups shows Not reported, empty groups show None reported', () => withProject((p) => {
  assert.deepEqual(groups(renderBoth(p, LEGACY_PASS).body), [NOT_REPORTED, NOT_REPORTED, NOT_REPORTED]);
  const empty = renderBoth(p, { ...LEGACY_PASS, implemented: [], missing: [], scope_creep: [] }).body;
  assert.deepEqual(groups(empty), [NONE_REPORTED, NONE_REPORTED, NONE_REPORTED]);
}));

test('comment: skipped and inconclusive verdicts are never shown as checked', () => withProject((p) => {
  const skipped = { pass: true, score: 100, skipped: true, summary: 'No src/ files changed — verification skipped.', findings: [] };
  for (const verdict of [skipped, { ...skipped, implemented: [], missing: [entry('Login', 'x', 'src/app.js', 1)], scope_creep: [] }, { ...skipped, inconclusive: true }]) {
    const { body } = renderBoth(p, verdict);
    assert.equal(statusLine(body), '## ⏭️ Spec Verifier — SKIPPED');
    assert.deepEqual(groups(body), [NOT_CHECKED_SKIPPED, NOT_CHECKED_SKIPPED, NOT_CHECKED_SKIPPED]);
    assert.ok(!body.includes(NONE_REPORTED));
  }
  const { body } = renderBoth(p, INCONCLUSIVE_VERDICT);
  assert.equal(statusLine(body), '## ✅ Spec Verifier — PASS');
  assert.ok(body.includes('**Score:** 50/100'));
  assert.deepEqual(groups(body), [NOT_CHECKED_INCONCLUSIVE, NOT_CHECKED_INCONCLUSIVE, NOT_CHECKED_INCONCLUSIVE]);
  assert.ok(!body.includes(NONE_REPORTED));
}));

test('comment: non-boolean skipped or inconclusive values are not JSON true', () => withProject((p) => {
  const asString = renderBoth(p, { ...LEGACY_PASS, skipped: 'true' }).body;
  assert.equal(statusLine(asString), '## ⏭️ Spec Verifier — SKIPPED');
  assert.deepEqual(groups(asString), [NOT_REPORTED, NOT_REPORTED, NOT_REPORTED]);
  const asNumber = renderBoth(p, { ...LEGACY_PASS, skipped: 1, inconclusive: 1, implemented: [], missing: [], scope_creep: [] }).body;
  assert.equal(statusLine(asNumber), '## ✅ Spec Verifier — PASS');
  assert.deepEqual(groups(asNumber), [NONE_REPORTED, NONE_REPORTED, NONE_REPORTED]);
}));

test('comment: null, non-array and non-object-only groups are Not reported; non-objects are skipped', () => withProject((p) => {
  const { body } = renderBoth(p, { ...LEGACY_PASS, implemented: null, missing: { spec: 'x' }, scope_creep: [1, 'a', null, []] });
  assert.deepEqual(groups(body), [NOT_REPORTED, NOT_REPORTED, NOT_REPORTED]);
  const mixed = renderBoth(p, { ...LEGACY_PASS, implemented: 'yes', missing: [7, entry('Login', 'gap', 'src/app.js', 2), 'x'], scope_creep: [] }).body;
  assert.deepEqual(groups(mixed), [NOT_REPORTED, `${GROUP_TABLE}\n| ${SPEC_PATH} | Login | gap | src/app.js:2 |`, NONE_REPORTED]);
}));

test('comment: line and file values outside the contract never produce file:line', () => withProject((p) => {
  const variants = [
    ['"a.js"', 'true', 'a.js'], ['"a.js"', '3.0', 'a.js'], ['"a.js"', '"3"', 'a.js'], ['"a.js"', '0', 'a.js'],
    ['"a.js"', '-1', 'a.js'], ['"a.js"', 'null', 'a.js'], ['"a.js"', '7', 'a.js:7'],
    ['null', '5', '—'], [null, '5', '—'], ['""', '5', '—'], ['12', '5', '—'],
  ];
  const json = (extra) => variants.map(([file, line], i) => `{${extra}"spec": "S", "requirement": "R${i}", "message": "m"${file === null ? '' : `, "file": ${file}`}, "line": ${line}}`).join(',\n');
  const raw = `{"pass": true, "score": 100, "summary": "s",\n"findings": [\n${json('"severity": "info", ')}],\n"implemented": [\n${json('')}],\n"missing": [], "scope_creep": []}\n`;
  const { body } = renderBoth(p, raw);
  const findingRows = section(body, '### Findings').split('\n').slice(2);
  const groupRows = section(body, '### Implemented').split('\n').slice(2);
  variants.forEach(([, , expected], i) => {
    assert.equal(findingRows[i], `| 🔵 | info | S | R${i} | m | ${expected} |`);
    assert.equal(groupRows[i], `| S | R${i} | m | ${expected} |`);
  });
}));

test('comment: findings tolerate non-list, non-object entries, null fields and odd severity', () => withProject((p) => {
  for (const findings of ['oops', { severity: 'error' }, null, [1, 'x', null], []]) {
    assert.equal(section(renderBoth(p, { ...LEGACY_PASS, findings }).body, '### Findings'), '_No findings._');
  }
  const noKey = { ...LEGACY_PASS };
  delete noKey.findings;
  assert.equal(section(renderBoth(p, noKey).body, '### Findings'), '_No findings._');
  const raw = '{"pass": true, "score": 100, "summary": "s", "findings": ["text", 3, null,'
    + ' {"severity": null, "spec": null, "requirement": null, "message": null, "file": null, "line": null},'
    + ' {"severity": ["error"], "spec": {"a": 1}, "requirement": 5, "message": true, "file": "b.js", "line": 2},'
    + ' {}, {"severity": "error", "spec": "S", "requirement": "R", "message": "ё", "file": "c.js", "line": 4}]}';
  assert.equal(section(renderBoth(p, raw).body, '### Findings').split('\n').slice(2).join('\n'), [
    '| ⚪ | — | — | — | — | — |',
    '| ⚪ | ["error"] | {"a": 1} | 5 | true | b.js:2 |',
    '| ⚪ | — | — | — | — | — |',
    '| 🔴 | error | S | R | ё | c.js:4 |',
  ].join('\n'));
}));

test('comment: pipes, CR, LF and CRLF stay inside every cell', () => withProject((p) => {
  const odd = { spec: 'sp|ec\nx', requirement: 'r\r\nq|', message: 'm\ry|z\nw', file: 'src/a|b\r\nc.js', line: 2 };
  const { body } = renderBoth(p, { ...LEGACY_PASS, findings: [{ severity: 'x|y\r\nz', ...odd }], implemented: [odd], missing: [], scope_creep: [] });
  assert.equal(section(body, '### Findings').split('\n')[2], '| ⚪ | x\\|y z | sp\\|ec x | r q\\| | m y\\|z w | src/a\\|b c.js:2 |');
  assert.equal(section(body, '### Implemented').split('\n')[2], '| sp\\|ec x | r q\\| | m y\\|z w | src/a\\|b c.js:2 |');
}));

test('comment: headings come in order before the footer even when the summary has a --- line', () => withProject((p) => {
  const { body } = renderBoth(p, { ...WARNING_ONLY, summary: 'line one\n---\nline three' });
  const lines = body.split('\n');
  const at = (heading) => lines.indexOf(heading);
  const footer = lines.lastIndexOf('---');
  const order = ['### Summary', '### Findings', '### Implemented', '### Missing', '### Scope creep'].map(at);
  assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), order.join(','));
  assert.ok(order[4] < footer);
  for (const index of [...order.slice(1), footer]) assert.equal(lines[index - 1], '', `blank line before ${lines[index]}`);
  assert.match(lines[footer + 1], /^_AI Spec Verifier • agent-orchestrator-kit • Run: 42_$/);
}));

test('comment: verdict is read from the project root, not from a decoy in cwd', () => withProject((p) => {
  put(p.outside, 'artifacts/verdict.json', JSON.stringify({ pass: false, score: 1, summary: 'DECOY', findings: [], implemented: [entry('DECOY', 'DECOY', 'x', 1)] }));
  writeVerdict(p, WARNING_ONLY);
  const gh = postGithub(p, { cwd: p.outside });
  const gl = postGitlab(p, { cwd: p.outside });
  for (const { res, body } of [gh, gl]) {
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!body.includes('DECOY'));
    assert.ok(body.includes('Password is compared with the hash'));
  }
}));

test('comment: a lone surrogate in valid JSON does not break either script', () => withProject((p) => {
  const raw = '{"pass": true, "score": 100, "summary": "x\\ud800y", "findings": [{"severity": "info", "spec": "s\\udfff", "requirement": "r", "message": "m", "file": null, "line": null}],'
    + ' "implemented": [{"spec": "a\\ud800b", "requirement": "r", "message": "m", "file": "src/app.js", "line": 1}], "missing": [], "scope_creep": []}';
  const { body } = renderBoth(p, raw);
  assert.ok(body.includes('### Summary\nx?y\n'));
  assert.ok(body.includes('| 🔵 | info | s? | r | m | — |'));
  assert.ok(body.includes('| a?b | r | m | src/app.js:1 |'));
}));

test('comment: GitLab payload above 131072 bytes is sent from a file, GitHub uses --body-file', () => withProject((p) => {
  const letters = 'я'.repeat(25_000);
  const verdict = { ...WARNING_ONLY, missing: [entry('Lockout', letters, 'src/app.js', 3)] };
  const { gh, gl } = renderBoth(p, verdict);
  assert.ok(Buffer.byteLength(gl.payload) > 131_072, `payload ${Buffer.byteLength(gl.payload)} bytes`);
  assert.ok(gl.body.includes(letters));
  assert.ok(gl.body.endsWith('---\n_AI Spec Verifier • agent-orchestrator-kit • Pipeline: 42_\n'));
  assert.ok(!gl.argv.includes('яяя') && !gl.argv.includes('\\u044f'), 'payload content in curl argv');
  assert.ok(gl.argv.split('\n').includes('--data-binary'));
  assert.ok(gh.argv.split('\n').includes('--body-file'));
  assert.ok(gh.body.includes(letters));
}));
