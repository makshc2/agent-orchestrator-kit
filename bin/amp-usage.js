function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseAmpUsageDetails(text) {
  const raw = String(text || '');
  const costMatch = /(?:^|\n)Cost:\s*\$([0-9]+(?:\.[0-9]+)?)/.exec(raw);
  const totalMatch = /Total tokens:\s*([\d,]+)/i.exec(raw);
  const inputMatch = /Input tokens:\s*([\d,]+)(?:\s*\(([\d,]+)\s*cache reads\))?/i.exec(raw);
  const outputMatch = /Output tokens:\s*([\d,]+)/i.exec(raw);
  const models = [];
  const tableStart = raw.search(/##\s*Models\b/i);
  if (tableStart >= 0) {
    const section = raw.slice(tableStart);
    const rowRe = /^\|\s*(?!Model\b|[-: ]+)([^|]+?)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*\$([0-9]+(?:\.[0-9]+)?)\s*\|/gim;
    let row;
    while ((row = rowRe.exec(section))) {
      models.push({
        model: row[1].trim(),
        requests: numOrNull(row[2]),
        inputTokens: numOrNull(row[3]),
        outputTokens: numOrNull(row[4]),
        costUsd: numOrNull(row[5]),
      });
    }
  }
  return {
    costUsd: costMatch ? numOrNull(costMatch[1]) : null,
    totalTokens: totalMatch ? numOrNull(totalMatch[1]) : null,
    inputTokens: inputMatch ? numOrNull(inputMatch[1]) : null,
    cacheReadTokens: inputMatch && inputMatch[2] ? numOrNull(inputMatch[2]) : null,
    outputTokens: outputMatch ? numOrNull(outputMatch[1]) : null,
    models,
  };
}

export function ampAgentMode(thread) {
  if (!thread || typeof thread !== 'object') return null;
  const direct = thread.agentMode || (thread.meta && thread.meta.agentMode);
  if (direct == null || String(direct).trim() === '') return null;
  return String(direct).trim();
}

function compactModel(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/(\d)p(\d)/g, '$1$2');
}

export function matchAmpUsageModel(displayName, sourceModels) {
  const wanted = compactModel(displayName);
  if (!wanted) return displayName;
  let best = null;
  for (const id of sourceModels || []) {
    const compact = compactModel(id);
    if (!compact) continue;
    if (compact === wanted || compact.includes(wanted) || wanted.includes(compact.replace(/^accountsfireworkmodels/, ''))) {
      best = id;
      break;
    }
  }
  return best || displayName;
}
