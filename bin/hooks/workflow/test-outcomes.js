import { supportedProvenance, validateUserAuthorization } from './user-authorization.js';

export const TEST_STATUSES = Object.freeze([
  'full',
  'narrowed',
  'skipped-no-command',
  'not-run',
  'failed',
  'accepted-preexisting-failure',
]);

function countsLine(passed, total, suffix) {
  if (Number.isInteger(passed) && Number.isInteger(total)) return `tests: ${passed}/${total}${suffix}`;
  return null;
}

function failedOutcome(exitCode, extra = {}) {
  return {
    status: 'failed',
    exitCode,
    command: extra.command ?? null,
    narrowCommand: extra.narrowCommand ?? null,
    failureName: extra.failureName ?? null,
    resolution: 'manual resolution required',
    testsLine: 'tests: red (see Blocked)',
    receipt: null,
  };
}

function acceptanceFor(input) {
  const validation = validateUserAuthorization({
    client: input.client,
    receipt: input.authorization?.receipt,
    baseline: input.baseline,
    failureName: input.failureName,
    source: input.authorization?.source,
    agentClaimed: input.authorization?.agentClaimed === true || input.agentClaimed === true,
  });
  if (!validation.ok || supportedProvenance(input.client) !== true) {
    return { accepted: false, reason: validation.reason ?? 'provenance-unsupported' };
  }
  return { accepted: true, receipt: validation.receipt };
}

export function buildTestOutcome(input = {}) {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (command === '' && (input.narrowCommand == null || String(input.narrowCommand).trim() === '')) {
    return {
      status: 'skipped-no-command',
      exitCode: null,
      command: null,
      narrowCommand: null,
      testsLine: 'tests: skipped (no test_command)',
      warning: true,
      resolution: null,
      receipt: null,
    };
  }
  if (input.ran === false) {
    const reason = typeof input.reason === 'string' && input.reason !== '' ? input.reason : 'not run';
    return {
      status: 'not-run',
      exitCode: null,
      command: command || null,
      reason,
      testsLine: `tests: not run (${reason})`,
      resolution: null,
      receipt: null,
    };
  }
  const narrow = typeof input.narrowCommand === 'string' ? input.narrowCommand.trim() : '';
  if (narrow !== '') {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const scope = Array.isArray(input.scope) ? input.scope.filter((item) => typeof item === 'string') : [];
    if (reason === '' || scope.length === 0) {
      return failedOutcome(Number.isInteger(input.exitCode) ? input.exitCode : 1, { command, narrowCommand: narrow });
    }
    if (input.exitCode === 0) {
      return {
        status: 'narrowed',
        exitCode: 0,
        command: command || null,
        narrowCommand: narrow,
        scope,
        reason,
        testsLine: countsLine(input.passed, input.total, ` (narrowed: ${reason})`)
          ?? `tests: green (exit 0) (narrowed: ${reason})`,
        resolution: null,
        receipt: null,
      };
    }
  }
  if (input.exitCode === 0 && narrow === '') {
    return {
      status: 'full',
      exitCode: 0,
      command,
      narrowCommand: null,
      testsLine: countsLine(input.passed, input.total, '') ?? 'tests: green (exit 0)',
      resolution: null,
      receipt: null,
    };
  }
  const exitCode = Number.isInteger(input.exitCode) ? input.exitCode : 1;
  const acceptance = acceptanceFor({ ...input, command });
  if (acceptance.accepted) {
    const failureName = input.failureName;
    return {
      status: 'accepted-preexisting-failure',
      exitCode,
      command: command || null,
      failureName,
      receipt: acceptance.receipt,
      resolution: null,
      testsLine: countsLine(input.passed, input.total, ` (accepted by user: ${failureName})`)
        ?? `tests: red (see Blocked) (accepted by user: ${failureName})`,
    };
  }
  return failedOutcome(exitCode, { command: command || null, failureName: input.failureName ?? null, narrowCommand: narrow || null });
}
