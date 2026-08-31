function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const GROK_46 = {
  inputPerM: 2,
  cachedPerM: 0.5,
  outputPerM: 6,
  longInputPerM: 4,
  longCachedPerM: 1,
  longOutputPerM: 12,
  longAt: 200000,
};

const FALLBACK_INPUT_PER_M = 3;
const FALLBACK_OUTPUT_PER_M = 15;
const FALLBACK_TOTAL_PER_M = 3.5;

function ratesForModel(model) {
  const id = String(model || '').toLowerCase();
  if (!id) return null;
  let rates = null;
  if (id.includes('grok-4.6') || id.includes('grok-4-6')) rates = { ...GROK_46 };
  else if (id.includes('grok-4.5') || id.includes('grok-4-5')) {
    rates = { ...GROK_46, cachedPerM: 0.3, longCachedPerM: 0.6 };
  } else {
    return null;
  }
  if (id.includes('fast')) {
    for (const key of ['inputPerM', 'cachedPerM', 'outputPerM', 'longInputPerM', 'longCachedPerM', 'longOutputPerM']) {
      rates[key] *= 2;
    }
  }
  return rates;
}

export function estimateCursorCostUsd({ model, inputTokens, outputTokens, cacheReadTokens, totalTokens } = {}) {
  const rates = ratesForModel(model);
  if (rates) {
    const input = numOrNull(inputTokens);
    const output = numOrNull(outputTokens) ?? 0;
    if (input == null && output == 0) return null;
    const totalInput = input ?? 0;
    const cached = Math.min(numOrNull(cacheReadTokens) ?? 0, totalInput);
    const fresh = Math.max(0, totalInput - cached);
    const long = totalInput >= rates.longAt;
    const inputRate = long ? rates.longInputPerM : rates.inputPerM;
    const cachedRate = long ? rates.longCachedPerM : rates.cachedPerM;
    const outputRate = long ? rates.longOutputPerM : rates.outputPerM;
    const usd = (fresh * inputRate + cached * cachedRate + output * outputRate) / 1e6;
    return Math.round(usd * 10000) / 10000;
  }
  const input = numOrNull(inputTokens);
  const output = numOrNull(outputTokens);
  if (input != null || output != null) {
    const usd = ((input ?? 0) * FALLBACK_INPUT_PER_M + (output ?? 0) * FALLBACK_OUTPUT_PER_M) / 1e6;
    return Math.round(usd * 10000) / 10000;
  }
  const total = numOrNull(totalTokens);
  if (total != null) {
    const usd = total * FALLBACK_TOTAL_PER_M / 1e6;
    return Math.round(usd * 10000) / 10000;
  }
  return null;
}

export function describeCursorCostEstimate(args) {
  const usd = estimateCursorCostUsd(args);
  if (usd == null) return null;
  return {
    usd,
    costSource: ratesForModel(args && args.model) != null ? 'api-estimate' : 'api-estimate-fallback',
  };
}
