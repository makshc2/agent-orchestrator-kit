import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEST_STATUSES, buildTestOutcome } from '../bin/hooks/workflow/test-outcomes.js';
import { receiptDigest, supportedProvenance, validateUserAuthorization } from '../bin/hooks/workflow/user-authorization.js';

const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENTS = ['claude', 'cursor', 'amp'];

function authorizedInput(client) {
  const baseline = { failureName: 'hooks-contract', exitCode: 1, digest: 'baseline-bytes' };
  const receipt = {
    id: `user-${client}-1`,
    digest: receiptDigest({ client, failureName: baseline.failureName, baseline: baseline.digest }),
  };
  return {
    client,
    command: 'node --test test/hooks-contract.test.js',
    exitCode: 1,
    passed: 1,
    total: 2,
    failureName: baseline.failureName,
    baseline,
    authorization: { source: 'observed-user', receipt },
  };
}

test('missing commands are skipped and never inferred', () => {
  for (const command of ['', '   ', null, undefined]) {
    const outcome = buildTestOutcome({ command, infer: 'npm test' });
    assert.equal(outcome.status, 'skipped-no-command');
    assert.equal(outcome.command, null);
    assert.equal(outcome.exitCode, null);
    assert.equal(outcome.testsLine, 'tests: skipped (no test_command)');
    assert.equal(JSON.stringify(outcome).includes('npm test'), false);
  }
});

test('a disclosed narrowed success stays narrowed', () => {
  const outcome = buildTestOutcome({
    command: 'npm test',
    narrowCommand: 'node --test test/hooks-install.test.js',
    scope: ['test/hooks-install.test.js'],
    reason: 'MemAvailable below 3000 MiB',
    exitCode: 0,
    passed: 4,
    total: 4,
  });
  assert.equal(outcome.status, 'narrowed');
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.command, 'npm test');
  assert.equal(outcome.narrowCommand, 'node --test test/hooks-install.test.js');
  assert.deepEqual(outcome.scope, ['test/hooks-install.test.js']);
  assert.equal(outcome.reason, 'MemAvailable below 3000 MiB');
  assert.equal(outcome.testsLine, 'tests: 4/4 (narrowed: MemAvailable below 3000 MiB)');
  assert.notEqual(outcome.status, 'full');

  const undisclosed = buildTestOutcome({ command: 'npm test', narrowCommand: 'node --test x', exitCode: 0 });
  assert.equal(undisclosed.status, 'failed');
  assert.notEqual(undisclosed.status, 'full');
});

test('full, not-run and failed lines stay compatible with apply test discipline', () => {
  assert.deepEqual(TEST_STATUSES, [
    'full',
    'narrowed',
    'skipped-no-command',
    'not-run',
    'failed',
    'accepted-preexisting-failure',
  ]);
  const full = buildTestOutcome({ command: 'node --test test/a.test.js', exitCode: 0, passed: 2, total: 2 });
  assert.equal(full.status, 'full');
  assert.equal(full.testsLine, 'tests: 2/2');
  const green = buildTestOutcome({ command: 'node --test test/a.test.js', exitCode: 0 });
  assert.equal(green.testsLine, 'tests: green (exit 0)');
  const paused = buildTestOutcome({ command: 'node --test test/a.test.js', ran: false, reason: 'paused: 2 tasks pending' });
  assert.equal(paused.status, 'not-run');
  assert.equal(paused.testsLine, 'tests: not run (paused: 2 tasks pending)');
  const failed = buildTestOutcome({ command: 'node --test test/a.test.js', exitCode: 1, failureName: 'hooks-contract' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.testsLine, 'tests: red (see Blocked)');
  assert.equal(failed.resolution, 'manual resolution required');
});

test('a matching user receipt validates without enabling production acceptance', () => {
  const input = authorizedInput('claude');
  const validation = validateUserAuthorization({
    client: input.client,
    receipt: input.authorization.receipt,
    baseline: input.baseline,
    failureName: input.failureName,
    source: input.authorization.source,
  });
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.receipt, { id: input.authorization.receipt.id, digest: input.authorization.receipt.digest });
  assert.equal(validation.production, false);
  assert.equal(JSON.stringify(validation).includes('transcript'), false);

  const outcome = buildTestOutcome(input);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.resolution, 'manual resolution required');
  assert.equal(outcome.receipt, null);
  assert.equal(outcome.testsLine, 'tests: red (see Blocked)');
});

test('agent self-approval and unverified claims are rejected', () => {
  const input = authorizedInput('cursor');
  const agent = validateUserAuthorization({
    client: input.client,
    receipt: input.authorization.receipt,
    baseline: input.baseline,
    failureName: input.failureName,
    source: 'observed-user',
    agentClaimed: true,
  });
  assert.equal(agent.ok, false);
  assert.equal(agent.reason, 'agent-self-approval');
  const claimed = buildTestOutcome({ ...input, authorization: { ...input.authorization, agentClaimed: true } });
  assert.equal(claimed.status, 'failed');
  assert.equal(claimed.exitCode, 1);
  assert.equal(claimed.resolution, 'manual resolution required');

  const unverified = validateUserAuthorization({
    client: 'amp',
    receipt: input.authorization.receipt,
    baseline: input.baseline,
    failureName: input.failureName,
    source: 'agent-flag',
  });
  assert.equal(unverified.ok, false);
  const prose = validateUserAuthorization({
    client: 'amp',
    receipt: { ...input.authorization.receipt, transcript: 'I accept this failure' },
    baseline: input.baseline,
    failureName: input.failureName,
    source: 'observed-user',
  });
  assert.equal(prose.ok, false);
  assert.equal(prose.reason, 'receipt-rejected');
});

test('shipped authorization fixture leaves claude, cursor and amp on manual resolution', async () => {
  const fixture = JSON.parse(await readFile(join(KIT_ROOT, 'test', 'fixtures', 'hooks', 'authorization', 'unsupported.json'), 'utf8'));
  for (const client of CLIENTS) {
    assert.equal(fixture.clients[client].observedAuthorization, false, client);
    assert.equal(fixture.clients[client].receipt, null, client);
    assert.equal(supportedProvenance(client), false, client);
    const outcome = buildTestOutcome(authorizedInput(client));
    assert.equal(outcome.status, 'failed', client);
    assert.equal(outcome.exitCode, 1, client);
    assert.equal(outcome.resolution, 'manual resolution required', client);
    assert.equal(outcome.testsLine, 'tests: red (see Blocked)', client);
  }
  assert.equal(supportedProvenance('unknown-client'), false);
});
