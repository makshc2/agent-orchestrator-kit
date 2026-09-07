function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const RATES = {
  'claude-fable-5': { input: 10, cacheRead: 0.25, cacheWrite: 12.5, output: 50 },
  'claude-opus': { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-sonnet-5': { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  'claude-sonnet-4-6': { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
  'claude-haiku-4-5': { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 },
};

function ratesForModel(model) {
  const id = String(model || '').toLowerCase();
  return Object.entries(RATES)
    .sort(([a], [b]) => b.length - a.length)
    .find(([prefix]) => id.startsWith(prefix))?.[1] || null;
}

export function estimateClaudeCostUsd({
  model,
  inputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  outputTokens,
} = {}) {
  const input = numOrNull(inputTokens);
  const cacheRead = numOrNull(cacheReadTokens);
  const cacheWrite = numOrNull(cacheCreationTokens);
  const output = numOrNull(outputTokens);
  if (input == null && cacheRead == null && cacheWrite == null && output == null) return null;
  const rates = ratesForModel(model);
  const usd = rates
    ? ((input ?? 0) * rates.input
      + (cacheRead ?? 0) * rates.cacheRead
      + (cacheWrite ?? 0) * rates.cacheWrite
      + (output ?? 0) * rates.output) / 1e6
    : (((input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)) * 3 + (output ?? 0) * 15) / 1e6;
  return Math.round(usd * 10000) / 10000;
}

export function describeClaudeCostEstimate(args = {}) {
  const usd = estimateClaudeCostUsd(args);
  if (usd == null) return null;
  return {
    usd,
    costSource: ratesForModel(args.model) ? 'api-estimate' : 'api-estimate-fallback',
  };
}
