import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readHooksConfig } from '../adapters/shared.js';
import { resolveBinding } from '../binding.js';
import { resolvePolicyOptions } from '../install.js';
import { fingerprint } from './fingerprint.js';
import { withLease } from './jobs.js';
import { recordOutcome } from './outcomes.js';
import { changeStore } from './stores.js';
import { buildTestOutcome } from './test-outcomes.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readYamlScalar(raw) {
  const value = String(raw || '').trim();
  const quoted = value.match(/^"([^"]*)"|^'([^']*)'/);
  if (quoted) return quoted[1] !== undefined ? quoted[1] : quoted[2];
  return value.replace(/(^|\s)#.*$/, '').trim();
}

function readTestCommand(content) {
  let inVerifier = false;
  let childIndent = null;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (/^verifier:\s*(#.*)?$/.test(line)) {
      inVerifier = true;
      childIndent = null;
      continue;
    }
    if (inVerifier && (/^#/.test(line) || /^\S/.test(line))) {
      if (/^\S/.test(line)) break;
      continue;
    }
    if (!inVerifier || /^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const entry = line.match(/^(\s+)([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!entry) continue;
    if (childIndent === null) childIndent = entry[1];
    if (entry[1] !== childIndent) continue;
    if (entry[2] === 'test_command') return readYamlScalar(entry[3]);
  }
  return '';
}

function git(projectDir, args) {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function evidenceKey(base, actual, scope) {
  return sha256(JSON.stringify({ base, actual, scope })).slice(0, 16);
}

function runProcess(command, cwd, timeoutMs) {
  return new Promise((resolvePromise) => {
    const lines = [];
    let timedOut = false;
    let settled = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const push = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line === '') continue;
        lines.push(line);
        if (lines.length > 20) lines.shift();
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), 500);
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolvePromise(result);
    };
    child.on('error', () => finish({ exitCode: 1, signal: null, timedOut, lines }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal, timedOut, lines }));
  });
}

async function persist(projectDir, ids, changeId, key, record) {
  const store = changeStore(projectDir, ids, changeId);
  if (!store) return null;
  await store.transact('verification-evidence', key, () => record);
  await store.transact('verification-evidence', 'latest', () => record);
  return record;
}

export async function runVerification({
  projectDir,
  ids,
  changeId,
  narrowCommand = null,
  reason = null,
  sessionId = null,
  agentId = null,
  taskId = null,
  ownerToken = null,
} = {}) {
  const store = changeStore(projectDir, ids, changeId);
  if (!store) return { ok: false, reason: 'change-required', record: null, reportLines: [] };
  const binding = await resolveBinding({ projectDir, ids, sessionId, agentId: agentId ?? null });
  if (!binding || binding.changeId !== changeId || binding.task !== (taskId ?? binding.task) || (taskId && binding.task !== taskId)) {
    return { ok: false, reason: 'binding-mismatch', record: null, reportLines: [] };
  }
  if (!sessionId || binding.sessionId !== sessionId || (binding.agentId ?? null) !== (agentId ?? null)) {
    return { ok: false, reason: 'binding-mismatch', record: null, reportLines: [] };
  }
  const config = readHooksConfig(projectDir);
  let orch = '';
  try {
    orch = readFileSync(resolve(projectDir, '.agents', 'orchestrator.yaml'), 'utf8');
  } catch {
    orch = '';
  }
  const resolved = resolvePolicyOptions('verification', config.hooks?.policies?.verification?.options ?? {});
  if (!resolved.ok) return { ok: false, reason: 'config-invalid', record: null, reportLines: [] };
  const options = resolved.options;
  const base = readTestCommand(orch);
  const actual = narrowCommand ? String(narrowCommand) : base;
  const scope = narrowCommand
    ? { mode: 'narrowed', reason: reason ?? '', files: binding.files ?? [] }
    : { mode: 'full', files: binding.files ?? [] };
  const key = evidenceKey(base, actual, scope);
  const headBefore = git(projectDir, ['rev-parse', 'HEAD'])?.trim() ?? null;

  if (!actual.trim()) {
    const outcome = buildTestOutcome({ command: '' });
    const record = {
      status: outcome.status,
      testsLine: outcome.testsLine,
      baseDigest: sha256(base),
      actualDigest: sha256(''),
      scope,
      reusable: true,
      unstable: false,
      head: headBefore,
      inputDigest: null,
      tasksDigest: null,
      handoffDigest: null,
    };
    await persist(projectDir, ids, changeId, key, record);
    await recordOutcome({
      projectDir,
      ids,
      outcome: {
        policy: 'verification',
        status: record.status,
        reason: 'no-test-command',
        changeId,
        sessionId,
        agentId,
        taskId: binding.task,
        evidence: { digest: null, freshness: 'skipped', scope },
      },
    });
    return { ok: true, reused: false, record, reportLines: [], head: headBefore };
  }

  return withLease({ projectDir, ids, ownerToken, timeoutMs: options.timeoutMs }, async () => {
    const pre = await fingerprint(projectDir, changeId, options);
    if (pre.unstable) return { ok: false, reason: 'unstable-read', record: null, reportLines: [] };
    const existing = await store.read('verification-evidence', key);
    if (existing && existing.reusable === true && existing.unstable !== true && existing.inputDigest === pre.digest
      && (existing.status === 'full' || existing.status === 'narrowed' || existing.status === 'skipped-no-command')) {
      return { ok: true, reused: true, record: existing, reportLines: [], head: headBefore };
    }
    const started = Date.now();
    const ran = await runProcess(actual, projectDir, options.timeoutMs);
    const post = await fingerprint(projectDir, changeId, options);
    const drifted = pre.digest !== post.digest || post.unstable;
    const outcome = buildTestOutcome({
      command: base,
      narrowCommand: narrowCommand ? actual : null,
      scope: scope.files,
      reason: reason ?? '',
      exitCode: ran.timedOut ? null : ran.exitCode,
      ran: !ran.timedOut,
    });
    const status = ran.timedOut ? 'timeout' : (drifted ? 'not-run' : outcome.status);
    const record = {
      status,
      testsLine: ran.timedOut ? 'tests: not run (timeout)' : (drifted ? 'tests: not run (concurrent write)' : outcome.testsLine),
      baseDigest: sha256(base),
      actualDigest: sha256(actual),
      scope,
      exitCode: ran.exitCode,
      signal: ran.signal,
      reusable: !ran.timedOut && !drifted && (status === 'full' || status === 'narrowed'),
      unstable: drifted,
      head: post.head,
      inputDigest: pre.digest,
      postDigest: post.digest,
      tasksDigest: post.tasksDigest,
      handoffDigest: post.handoffDigest,
      environment: post.environment,
      durationMs: Date.now() - started,
      counts: null,
    };
    await persist(projectDir, ids, changeId, key, record);
    await recordOutcome({
      projectDir,
      ids,
      outcome: {
        policy: 'verification',
        status: record.status,
        reason: ran.timedOut ? 'timeout' : (drifted ? 'concurrent-change' : record.status),
        duration: record.durationMs,
        changeId,
        sessionId,
        agentId,
        taskId: binding.task,
        evidence: { digest: record.inputDigest, freshness: drifted ? 'unstable' : 'current', scope },
      },
    });
    return { ok: true, reused: false, record, reportLines: ran.lines, head: headBefore };
  });
}
