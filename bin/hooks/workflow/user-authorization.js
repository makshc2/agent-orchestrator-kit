import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE_URL = new URL('../../../test/fixtures/hooks/authorization/unsupported.json', import.meta.url);

const PRODUCTION_VERIFIERS = {};

function productionFixture() {
  try {
    return JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), 'utf8'));
  } catch {
    return { clients: {} };
  }
}

export function supportedProvenance(client) {
  const entry = productionFixture().clients?.[client];
  if (!entry || entry.observedAuthorization !== true) return false;
  if (!authorizationReceipt(entry.receipt)) return false;
  return typeof PRODUCTION_VERIFIERS[client] === 'function';
}

export function receiptDigest(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function authorizationReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  if (typeof receipt.id !== 'string' || receipt.id === '') return null;
  if (typeof receipt.digest !== 'string' || receipt.digest === '') return null;
  if (['transcript', 'text', 'message', 'body'].some((key) => receipt[key] != null)) return null;
  return { id: receipt.id, digest: receipt.digest };
}

export function validateUserAuthorization({
  client,
  receipt,
  baseline,
  failureName,
  source,
  agentClaimed = false,
} = {}) {
  if (agentClaimed === true || source === 'agent' || source === 'agent-flag') {
    return { ok: false, reason: 'agent-self-approval' };
  }
  if (source !== 'observed-user') return { ok: false, reason: 'unverified-claim' };
  const stored = authorizationReceipt(receipt);
  if (!stored) return { ok: false, reason: 'receipt-rejected' };
  if (!baseline || baseline.failureName !== failureName || !(Number(baseline.exitCode) > 0)) {
    return { ok: false, reason: 'baseline-mismatch' };
  }
  if (typeof client !== 'string' || client === '') return { ok: false, reason: 'client-missing' };
  if (typeof baseline.digest !== 'string' || baseline.digest === '') return { ok: false, reason: 'baseline-mismatch' };
  if (stored.digest !== receiptDigest({ client, failureName, baseline: baseline.digest })) {
    return { ok: false, reason: 'baseline-mismatch' };
  }
  return { ok: true, receipt: stored, production: supportedProvenance(client) };
}
