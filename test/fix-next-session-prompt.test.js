import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildNextSessionPrompt, readOrchestratorMeta } from '../bin/agent-orchestrator.js';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;

function isolatedEnv(dir) {
  const home = join(dir, '.aok-home');
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'cfg'), XDG_DATA_HOME: join(home, 'data') };
  env.AOK_AMP_BIN = join(dir, '.no-amp-bin');
  for (const key of ['AOK_MODEL', 'AOK_PLATFORM', 'CURSOR_AGENT', 'CURSOR_CONVERSATION_ID', 'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'AMP_CURRENT_THREAD', 'AMP_THREAD_ID']) {
    delete env[key];
  }
  return env;
}

function cliExec(dir, args) {
  return execSync(`node "${CLI}" ${args}`, { cwd: dir, stdio: 'pipe', encoding: 'utf-8', env: isolatedEnv(dir) }).replace(ANSI_RE, '');
}

function runInit(dir, args) {
  execSync(`node "${CLI}" init ${args}`, { cwd: dir, stdio: 'pipe' });
}

function writeMinimalChange(dir, name) {
  const changeDir = join(dir, 'openspec/changes', name);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
  return changeDir;
}

function persistHandoff(dir, name, extra = '') {
  return cliExec(
    dir,
    `handoff ${name} --closed-role architect --done "specs ready" --next-command "/opsx:review ${name}" --next-role spec-reviewer --spawn '- \`spec-reviewer\`' --no-metrics ${extra}`,
  );
}

const FIELDS = {
  changeName: 'add-thing',
  nextCommand: '/opsx:review add-thing',
  nextRole: 'spec-reviewer',
  spawn: '- `spec-reviewer`',
  done: '- specs ready',
  attach: '- `bin/agent-orchestrator.js:1428-1565`',
};

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `${heading} not found`);
  const afterHeading = text.slice(start + heading.length);
  const rest = afterHeading.slice(afterHeading.indexOf('\n') + 1);
  const next = rest.search(/\n## /);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

test('prompt (en) follows the parent-driven protocol: no Memory read, no routine session-handoff spawn, no Decisions', () => {
  const out = buildNextSessionPrompt(FIELDS, 'en', { spawnHandoffSubagent: false });
  assert.match(out, /^\/opsx:review add-thing\n/);
  assert.match(out, /You are the conductor/);
  assert.match(out, /HARD STOP/);
  assert.match(out, /subagent-spec-reviewer/);
  assert.match(out, /npx agent-orchestrator-kit handoff add-thing --restore/);
  for (const line of ['- Closed role:', '- Change:', '- Done:', '- Blocked:', '- Attach:', '- Subagents for this session:', '- Constraints:']) {
    assert.ok(out.includes(line), `missing ${line}`);
  }
  assert.match(out, /bin\/agent-orchestrator\.js:1428-1565/);
  assert.doesNotMatch(out, /Read Memory MCP/);
  assert.doesNotMatch(out, /Spawn `session-handoff` in persist mode/);
  assert.doesNotMatch(out, /Spawn `session-handoff` in restore mode/);
  assert.doesNotMatch(out, /`session-handoff`|subagent-session-handoff/);
  assert.match(out, /Full protocol: `\.agents\/rules\/session-handoff\.mdc`/);
  assert.doesNotMatch(out, /Memory MCP/);
  assert.doesNotMatch(out, /- Decisions:/);
  assert.doesNotMatch(out, /Mandatory start/);
  assert.doesNotMatch(out, /agent-orchestrator-kit status/);
  assert.doesNotMatch(out, /^\d+\. /m, 'no numbered step lists remain');
});

test('prompt (uk) follows the parent-driven protocol', () => {
  const out = buildNextSessionPrompt(FIELDS, 'uk', { spawnHandoffSubagent: false });
  assert.match(out, /^\/opsx:review add-thing\n/);
  assert.match(out, /Ти — conductor/);
  assert.match(out, /HARD STOP/);
  assert.match(out, /project\.agent_language: uk/);
  assert.doesNotMatch(out, /Прочитай Memory MCP/);
  assert.doesNotMatch(out, /у режимі persist/);
  assert.doesNotMatch(out, /у режимі restore/);
  assert.doesNotMatch(out, /`session-handoff`|subagent-session-handoff/);
  assert.doesNotMatch(out, /- Рішення:/);
  assert.doesNotMatch(out, /^\d+\. /m);
  assert.match(out, /- Attach:/);
  assert.match(out, /- Блокери:/);
});

test('prompt Start is one CLI call and Exit HARD STOP is two lines', () => {
  for (const lang of ['en', 'uk']) {
    const out = buildNextSessionPrompt(FIELDS, lang, { spawnHandoffSubagent: false });
    const start = section(out, lang === 'uk' ? '## Старт' : '## Start');
    assert.equal(start.split('\n').length, 1, `${lang} Start is one paragraph`);
    assert.match(start, /handoff add-thing --restore/);
    const exit = section(out, lang === 'uk' ? '## HARD STOP на виході' : '## Exit HARD STOP');
    const exitLines = exit.split('\n').filter((l) => l.trim());
    assert.equal(exitLines.length, 2, `${lang} Exit is two lines`);
    assert.match(exitLines[0], /openspec\/changes\/add-thing\/handoff\.md/);
    assert.match(exitLines[0], /npx agent-orchestrator-kit handoff add-thing/);
    assert.match(exitLines[0], /\/opsx:…/);
    assert.match(exitLines[1], /\.agents\/rules\/session-handoff\.mdc/);
  }
});

test('prompt names session-handoff only when handoff.spawn_handoff_subagent is true', () => {
  const en = buildNextSessionPrompt(FIELDS, 'en', { spawnHandoffSubagent: true });
  assert.match(en, /Spawn `session-handoff` in restore mode only if both the CLI and handoff\.md are unavailable/);
  assert.match(en, /If the CLI failed, spawn `session-handoff` in persist mode/);
  assert.equal((en.match(/subagent-session-handoff/g) || []).length, 2);
  assert.doesNotMatch(en, /never skip/);
  const uk = buildNextSessionPrompt(FIELDS, 'uk', { spawnHandoffSubagent: true });
  assert.match(uk, /у режимі restore лише якщо/);
  assert.match(uk, /Якщо CLI впав — заспавни `session-handoff` у режимі persist/);
  // Missing meta behaves like the documented default (false).
  assert.doesNotMatch(buildNextSessionPrompt(FIELDS, 'en'), /`session-handoff`|subagent-session-handoff/);
  assert.doesNotMatch(buildNextSessionPrompt(FIELDS, 'uk', {}), /`session-handoff`|subagent-session-handoff/);
});

test('prompt skeleton stays within the size budget', () => {
  const minimal = { changeName: 'add-thing', nextCommand: '/opsx:review add-thing', nextRole: 'spec-reviewer', spawn: '- `spec-reviewer`' };
  const en = buildNextSessionPrompt(minimal, 'en', { spawnHandoffSubagent: false });
  assert.ok(Buffer.byteLength(en, 'utf-8') <= 1536, `en prompt is ${Buffer.byteLength(en, 'utf-8')} bytes; keep <= 1536`);
  const uk = buildNextSessionPrompt(minimal, 'uk', { spawnHandoffSubagent: false });
  assert.ok(uk.length <= 1600, `uk prompt is ${uk.length} chars; keep <= 1600`);
});

test('readOrchestratorMeta reads handoff.spawn_handoff_subagent with a false default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-meta-'));
  try {
    assert.deepEqual(readOrchestratorMeta(dir), { agentLanguage: 'en', spawnHandoffSubagent: false });
    runInit(dir, '--profile generic --name MetaFlag --lang uk');
    assert.deepEqual(readOrchestratorMeta(dir), { agentLanguage: 'uk', spawnHandoffSubagent: false });
    const orchPath = join(dir, '.agents/orchestrator.yaml');
    const orch = readFileSync(orchPath, 'utf-8');
    assert.match(orch, /spawn_handoff_subagent:\s*false/);
    writeFileSync(orchPath, orch.replace(/spawn_handoff_subagent:\s*false/, 'spawn_handoff_subagent: true'));
    assert.equal(readOrchestratorMeta(dir).spawnHandoffSubagent, true);
    writeFileSync(orchPath, orch.replace(/\s*spawn_handoff_subagent:\s*false/, ''));
    assert.equal(readOrchestratorMeta(dir).spawnHandoffSubagent, false, 'missing key reads as false');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handoff persist honours spawn_handoff_subagent from orchestrator.yaml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-spawn-flag-'));
  try {
    runInit(dir, '--profile generic --name SpawnFlag --lang en');
    writeMinimalChange(dir, 'add-x');
    const off = persistHandoff(dir, 'add-x');
    assert.match(off, /^\/opsx:review add-x/m);
    assert.match(off, /HARD STOP/);
    assert.doesNotMatch(off, /`session-handoff`|subagent-session-handoff/);
    assert.doesNotMatch(off, /Read Memory MCP/);
    assert.doesNotMatch(off, /- Decisions:/);

    const orchPath = join(dir, '.agents/orchestrator.yaml');
    writeFileSync(orchPath, readFileSync(orchPath, 'utf-8').replace(/spawn_handoff_subagent:\s*false/, 'spawn_handoff_subagent: true'));
    const on = persistHandoff(dir, 'add-x');
    assert.match(on, /subagent-session-handoff/);
    assert.match(on, /If the CLI failed, spawn `session-handoff` in persist mode/);
    assert.doesNotMatch(on, /Spawn `session-handoff` in persist mode \(Amp: isolated `subagent-session-handoff`\)\. If spawn is unavailable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function decisionsFile(name, count) {
  const lines = [`# Decisions — ${name}`, '', '<!-- append-only -->', ''];
  for (let i = 1; i <= count; i += 1) lines.push(`- 2026-09-${String(i).padStart(2, '0')} topic-${i}: option ${i}`);
  return `${lines.join('\n')}\n`;
}

test('handoff --restore prints Attach and the last 10 decisions with a trailer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aok-restore-cap-'));
  try {
    runInit(dir, '--profile generic --name RestoreCap --lang en');
    const changeDir = writeMinimalChange(dir, 'add-x');
    persistHandoff(dir, 'add-x', `--attach '- \`bin/agent-orchestrator.js:1428-1565\` — prompt builder'`);

    writeFileSync(join(changeDir, 'decisions.md'), decisionsFile('add-x', 13));
    const capped = cliExec(dir, 'handoff add-x --restore --no-metrics');
    assert.match(capped, /^attach:$/m);
    assert.match(capped, /^- `bin\/agent-orchestrator\.js:1428-1565` — prompt builder$/m);
    assert.match(capped, /decisions\.md:/);
    for (let i = 4; i <= 13; i += 1) assert.ok(capped.includes(`topic-${i}: option ${i}`), `entry ${i} printed`);
    for (let i = 1; i <= 3; i += 1) assert.ok(!capped.includes(`topic-${i}: option ${i}\n`), `entry ${i} not printed`);
    assert.match(capped, /^\(3 older entries in openspec\/changes\/add-x\/decisions\.md\)$/m);
    assert.match(capped, /Memory entities: \d+/);

    writeFileSync(join(changeDir, 'decisions.md'), decisionsFile('add-x', 10));
    const full = cliExec(dir, 'handoff add-x --restore --no-metrics');
    for (let i = 1; i <= 10; i += 1) assert.ok(full.includes(`topic-${i}: option ${i}`), `entry ${i} printed`);
    assert.doesNotMatch(full, /older entries/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('templates agree with the parent-driven protocol', () => {
  const rule = readFileSync(join(KIT_ROOT, 'templates/.agents/rules/session-handoff.mdc'), 'utf-8');
  const start = section(rule, '## Session Start');
  assert.equal((start.match(/^\d+\. /gm) || []).length, 3, 'Session Start has 3 steps');
  assert.match(start, /handoff <name> --restore/);
  assert.match(start, /No separate Memory MCP read step/);
  assert.match(start, /ONLY if both are unavailable/);
  assert.doesNotMatch(start, /^\d+\. `npx agent-orchestrator-kit status`/m);
  assert.match(rule, /Done\/Blocked\/Attach\/spawn\/HARD STOP/);
  assert.doesNotMatch(rule, /Done\/Decisions\/Blocked/);
  assert.match(rule, /[Ss]elf-contained/);
  assert.match(rule, /spawn_handoff_subagent: true/);
  assert.equal(readFileSync(join(KIT_ROOT, '.agents/rules/session-handoff.mdc'), 'utf-8'), rule, 'kit root rule mirrors the template');

  const orchestration = readFileSync(join(KIT_ROOT, 'templates/.agents/rules/agent-orchestration.mdc'), 'utf-8');
  assert.doesNotMatch(orchestration, /persist via `session-handoff`/);
  assert.match(orchestration, /Exit HARD STOP: parent writes `handoff\.md` → `npx agent-orchestrator-kit handoff <name>` \(exit 0\)/);
  assert.match(orchestration, /`session-handoff` persist only if the CLI failed/);
  assert.match(orchestration, /Start: honor pasted `\/opsx:\*` → `npx agent-orchestrator-kit handoff <name> --restore`/);

  const skill = readFileSync(join(KIT_ROOT, 'templates/.agents/skills/agent-orchestration/SKILL.md'), 'utf-8');
  assert.doesNotMatch(skill, /Read Memory entities/);
  assert.doesNotMatch(skill, /Memory is empty/);
  assert.doesNotMatch(skill, /Done\/Decisions\/Blocked/);
  assert.doesNotMatch(skill, /Done, Decisions, Blocked/);
  assert.doesNotMatch(skill, /restore at start, persist at exit/);
  assert.equal((skill.match(/no separate Memory MCP read step/gi) || []).length, 2, 'Session Rules and the protocol paragraph agree');
  const sessionStart = skill.slice(skill.indexOf('**Start of each session:**'), skill.indexOf('**During session:**'));
  assert.equal((sessionStart.match(/^\d+\. /gm) || []).length, 6);

  const sub = readFileSync(join(KIT_ROOT, 'templates/.agents/subagents/session-handoff.md'), 'utf-8');
  const restore = sub.slice(sub.indexOf('## Restore mode'), sub.indexOf('## Persist mode'));
  assert.equal((restore.match(/^\d+\. /gm) || []).length, 4);
  assert.doesNotMatch(restore, /read `Change:<name>`, `Handoff:<name>`, and `Decision:\*`/);
  assert.match(restore, /No separate Memory MCP read step/);
  assert.match(sub, /FALLBACK ONLY/);
});
