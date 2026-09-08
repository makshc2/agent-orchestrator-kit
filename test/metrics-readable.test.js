import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatKyivDisplay, formatUtcIso, parseFlexibleIso } from '../bin/metrics-time.js';
import { parseAmpUsageDetails, matchAmpUsageModel, ampAgentMode } from '../bin/amp-usage.js';
import { describeCursorCostEstimate, estimateCursorCostUsd } from '../bin/cursor-cost-estimate.js';
import { estimateClaudeCostUsd } from '../bin/claude-cost-estimate.js';
import {
  firstSpawnName,
  formatMetricsCostLine,
  normalizeMetricsV2,
  resolveSessionSpend,
  recomputeMetricsAggregates,
} from '../bin/agent-orchestrator.js';

test('parseFlexibleIso accepts broken Amp microsecond+.000Z stamps', () => {
  const broken = '2026-08-31T07:08:17.563464.000Z';
  const ms = parseFlexibleIso(broken);
  assert.equal(Number.isFinite(ms), true);
  assert.equal(formatUtcIso(broken), '2026-08-31T07:08:17.563Z');
});

test('formatUtcIso stores UTC and formatKyivDisplay prints Kyiv', () => {
  assert.equal(formatUtcIso('2026-08-29T06:00:00.000Z'), '2026-08-29T06:00:00.000Z');
  assert.equal(formatUtcIso('2026-08-29T09:00:00.000+03:00'), '2026-08-29T06:00:00.000Z');
  assert.match(formatKyivDisplay('2026-08-29T06:00:00.000Z'), /29\.08\.2026 09:00:00 \(Київ \+03:00\)/);
});

test('parseAmpUsageDetails reads cost, tokens, models', () => {
  const text = `# Thread Usage

Cost: $1.30
Total tokens: 1,909,489
Input tokens: 1,896,453 (1,694,539 cache reads)
Output tokens: 13,036

## Models

| Model | Requests | Input | Output | Cost |
| --- | ---: | ---: | ---: | ---: |
| GLM-5.2 | 27 | 1,368,960 | 10,531 | $0.67 |
| GPT-5.6 Sol | 15 | 522,970 | 2,463 | $0.63 |
`;
  const parsed = parseAmpUsageDetails(text);
  assert.equal(parsed.costUsd, 1.3);
  assert.equal(parsed.totalTokens, 1909489);
  assert.equal(parsed.inputTokens, 1896453);
  assert.equal(parsed.cacheReadTokens, 1694539);
  assert.equal(parsed.outputTokens, 13036);
  assert.equal(parsed.models.length, 2);
  assert.equal(parsed.models[0].model, 'GLM-5.2');
  assert.equal(parsed.models[0].costUsd, 0.67);
  assert.equal(matchAmpUsageModel('GLM-5.2', ['accounts/fireworks/models/glm-5p2']), 'accounts/fireworks/models/glm-5p2');
  assert.equal(ampAgentMode({ agentMode: 'low', meta: { agentMode: 'medium' } }), 'low');
});

test('parseAmpUsageDetails without Cost line leaves costUsd null', () => {
  const parsed = parseAmpUsageDetails(`Total tokens: 1,000
Input tokens: 800
Output tokens: 200
`);
  assert.equal(parsed.costUsd, null);
  assert.equal(parsed.totalTokens, 1000);
  assert.equal(parsed.inputTokens, 800);
  assert.equal(parsed.outputTokens, 200);
});

test('estimateCursorCostUsd uses grok-4.6 API rates and long-context cliff', () => {
  const short = estimateCursorCostUsd({
    model: 'cursor-grok-4.6',
    inputTokens: 100000,
    outputTokens: 1000,
  });
  assert.equal(short, 0.206);
  const longFast = estimateCursorCostUsd({
    model: 'cursor-grok-4.6-xhigh-fast',
    inputTokens: 1100393,
    outputTokens: 7425,
  });
  assert.ok(longFast > 8);
  const grokDescribed = describeCursorCostEstimate({
    model: 'cursor-grok-4.6-high-fast',
    inputTokens: 400,
    outputTokens: 40,
  });
  assert.equal(grokDescribed.costSource, 'api-estimate');
  assert.equal(typeof grokDescribed.usd, 'number');
});

test('estimateCursorCostUsd fallback for non-grok models', () => {
  assert.equal(estimateCursorCostUsd({ model: 'gpt-5.6', inputTokens: 1000000, outputTokens: 1000000 }), 18);
  assert.deepEqual(
    describeCursorCostEstimate({ model: 'gpt-5.6', inputTokens: 1000000, outputTokens: 1000000 }),
    { usd: 18, costSource: 'api-estimate-fallback' },
  );
  assert.equal(estimateCursorCostUsd({ model: 'gpt-5.6', totalTokens: 1000000 }), 3.5);
  assert.equal(estimateCursorCostUsd({ model: 'gpt-5.6', inputTokens: 1000000, outputTokens: null }), 3);
  assert.deepEqual(
    describeCursorCostEstimate({ model: 'gpt-5.6', inputTokens: 1000000, outputTokens: 0 }),
    { usd: 3, costSource: 'api-estimate-fallback' },
  );
  assert.equal(estimateCursorCostUsd({ model: 'gpt-5.6-fast', inputTokens: 1000000, outputTokens: 1000000 }), 18);
  assert.equal(estimateCursorCostUsd({ model: '', inputTokens: 1000000 }), 3);
  assert.equal(estimateCursorCostUsd({ model: 'gpt-5.6' }), null);
  assert.equal(describeCursorCostEstimate({ model: 'gpt-5.6' }), null);
});

test('Claude estimate uses cache split and fallback', () => {
  assert.equal(estimateClaudeCostUsd({
    model: 'claude-opus-5',
    inputTokens: 100000,
    cacheReadTokens: 900000,
    cacheCreationTokens: 0,
    outputTokens: 10000,
  }), 1.2);
  assert.equal(estimateClaudeCostUsd({ model: 'gpt-6-astra', inputTokens: 1000000, outputTokens: 10000 }), 3.15);
});

test('normalizeMetricsV2 compacts legacy sources without changing numeric summaries', () => {
  const metrics = {
    version: 1,
    spend: { totalTokens: 46, costUsd: 3.96 },
    totals: { sessions: 1, durationMs: 100 },
    spendByPlatform: { amp: { totalTokens: 46, costUsd: 3.96 } },
    spendByModel: [{ model: 'm1', totalTokens: 30 }],
    phases: { apply: { totalTokens: 46, costUsd: 3.96 } },
    sessions: [{
      model: 'm1',
      platform: 'amp',
      inputTokens: 40,
      outputTokens: 6,
      totalTokens: 46,
      costUsd: 3.96,
      sources: [
        { id: 'a', model: 'm1', platform: 'amp', inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        { id: 'b', model: 'm1', platform: 'amp', inputTokens: 15, outputTokens: 3, totalTokens: 18 },
        { id: 'c', model: 'm2', platform: 'amp', inputTokens: 9, outputTokens: 1, totalTokens: 10 },
        { id: 'd', model: 'm2', platform: 'amp', inputTokens: 6, outputTokens: 0, totalTokens: 6 },
      ],
    }],
  };
  const numericBefore = JSON.parse(JSON.stringify({
    spend: metrics.spend,
    totals: metrics.totals,
    spendByPlatform: metrics.spendByPlatform,
    spendByModel: metrics.spendByModel,
    phases: metrics.phases,
    session: Object.fromEntries(Object.entries(metrics.sessions[0]).filter(([, value]) => typeof value === 'number')),
  }));
  normalizeMetricsV2(metrics);
  assert.equal(metrics.version, 2);
  assert.equal(metrics.sessions[0].sourceIds.length, 4);
  assert.equal(metrics.sessions[0].byModel.length, 2);
  assert.equal('sources' in metrics.sessions[0], false);
  assert.deepEqual({
    spend: metrics.spend,
    totals: metrics.totals,
    spendByPlatform: metrics.spendByPlatform,
    spendByModel: metrics.spendByModel,
    phases: metrics.phases,
    session: Object.fromEntries(Object.entries(metrics.sessions[0]).filter(([, value]) => typeof value === 'number')),
  }, numericBefore);
});

test('firstSpawnName only accepts backticks or canonical role mapping', () => {
  assert.equal(firstSpawnName('Implementer — restore verification after baseline lint'), '');
  assert.equal(firstSpawnName('Architect (spawn `spec-architect`)'), 'spec-architect');
  assert.equal(firstSpawnName('Spec Reviewer'), 'spec-reviewer');
});

test('formatMetricsCostLine shows billed and estimate without mixing credits', () => {
  assert.equal(formatMetricsCostLine({ costUsd: 1.3, costUsdEstimated: 8.98 }), '$10.28 ($1.30 billed + ~$8.98 est.)');
  assert.equal(
    formatMetricsCostLine({ costUsd: 14.48, costUsdEstimated: 6.5979, costUsdTotal: 21.0779 }),
    '$21.08 ($14.48 billed + ~$6.60 est.)',
  );
  assert.equal(formatMetricsCostLine({ costUsd: 1.3, costUsdEstimated: null }), '$1.30');
  assert.equal(formatMetricsCostLine({ costUsd: null, costUsdEstimated: 8.98 }), '~$8.98 est.');
  assert.equal(formatMetricsCostLine({ costUsd: null, costUsdEstimated: null }), '—');
  const mixed = formatMetricsCostLine({ costUsd: 1.3, costUsdEstimated: 8.98, ampCredits: 20 });
  assert.match(mixed, /billed/);
  assert.match(mixed, /est\./);
  assert.equal(mixed.includes('20'), false);
});

test('resolveSessionSpend keeps self-report and flags out of costUsdEstimated', () => {
  const fromSelf = resolveSessionSpend({}, { costUsd: 0.42 }, []);
  assert.equal(fromSelf.costUsd, 0.42);
  assert.equal(fromSelf.costUsdEstimated, null);
  const fromFlag = resolveSessionSpend({ costUsd: 9.99 }, {}, []);
  assert.equal(fromFlag.costUsd, 9.99);
  assert.equal(fromFlag.costUsdEstimated, null);
});

function ampNullCostSources(prefix, count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}:${i + 1}`,
    platform: 'amp',
    costUsd: null,
    inputTokens: 10,
    outputTokens: 1,
  }));
}

test('recomputeMetricsAggregates adds session.costUsd once when sources costUsd are null', () => {
  const metrics = {
    sessions: [{
      phase: 'apply',
      platform: 'amp',
      role: 'Implementer',
      costUsd: 12.69,
      sources: ampNullCostSources('T-apply', 3),
    }],
  };

  recomputeMetricsAggregates(metrics);

  assert.equal(metrics.spend.costUsd, 12.69);
  assert.equal(metrics.spendByPlatform.amp.costUsd, 12.69);
  assert.equal(metrics.phases.apply.costUsd, 12.69);
  assert.notEqual(metrics.spend.costUsd, 38.07);
});

test('recomputeMetricsAggregates sums Cost fallback across three Amp sessions', () => {
  const metrics = {
    sessions: [
      { phase: 'apply', platform: 'amp', costUsd: 4.42, sources: ampNullCostSources('T-a', 2) },
      { phase: 'apply', platform: 'amp', costUsd: 8.81, sources: ampNullCostSources('T-b', 2) },
      { phase: 'apply', platform: 'amp', costUsd: 12.69, sources: ampNullCostSources('T-c', 2) },
    ],
  };

  recomputeMetricsAggregates(metrics);

  assert.equal(metrics.spend.costUsd, 25.92);
  assert.equal(metrics.spendByPlatform.amp.costUsd, 25.92);
});

test('recomputeMetricsAggregates derives costUsdTotal per session (billed, else estimate) and rounds billed sums', () => {
  const ampSession = (phase, costUsd, astra, sol) => ({
    phase,
    platform: 'amp',
    model: 'gpt-6-astra',
    costUsd,
    costUsdEstimated: null,
    byModel: [
      { model: 'gpt-6-astra', platform: 'amp', costUsd: astra, costUsdEstimated: null },
      { model: 'GPT-5.6 Sol', platform: 'amp', costUsd: sol, costUsdEstimated: null },
    ],
  });
  const metrics = {
    sessions: [
      { phase: 'explore', platform: 'cursor', model: 'cursor-grok-4.6', costUsd: null, costUsdEstimated: 1.4344 },
      ampSession('spec', 3.96, 3.1, 0.87),
      { phase: 'review', platform: 'claude', model: 'claude-fable-5-1', costUsd: null, costUsdEstimated: 3.9108 },
      ampSession('spec', 2.51, 2.26, 0.25),
      ampSession('apply', 8.01, 4.59, 3.32),
      { phase: 'apply', platform: 'claude', model: 'claude-opus-5', costUsd: null, costUsdEstimated: 0.9276 },
      { phase: 'archive', platform: 'claude', model: 'claude-opus-5', costUsd: null, costUsdEstimated: 0.3251 },
    ],
  };

  recomputeMetricsAggregates(metrics);

  assert.equal(metrics.spend.costUsd, 14.48, 'billed stays Amp-only');
  assert.equal(metrics.spend.costUsdEstimated, 6.5979, 'estimate stays Cursor + Claude');
  assert.equal(metrics.spend.costUsdTotal, 21.0779, 'total = billed Amp + estimated Cursor + estimated Claude');
  assert.equal(metrics.spendByPlatform.amp.costUsdTotal, 14.48);
  assert.equal(metrics.spendByPlatform.claude.costUsdTotal, 5.1635);
  assert.equal(metrics.spendByPlatform.cursor.costUsdTotal, 1.4344);
  assert.equal(metrics.phases.spec.costUsdTotal, 6.47);
  assert.equal(metrics.phases.review.costUsdTotal, 3.9108);
  assert.equal(metrics.phases.apply.costUsdTotal, 8.9376, 'a mixed phase adds billed Amp and estimated Claude');
  assert.equal(metrics.sessions[1].costUsdTotal, 3.96);
  assert.equal(metrics.sessions[5].costUsdTotal, 0.9276);
  const sol = metrics.spendByModel.find((row) => row.model === 'GPT-5.6 Sol');
  assert.equal(sol.costUsd, 4.44, 'billed model sum is rounded, not 4.4399999999999995');
  assert.equal(sol.costUsdTotal, 4.44);
  const opus = metrics.spendByModel.find((row) => row.model === 'claude-opus-5');
  assert.equal(opus.costUsd, null);
  assert.equal(opus.costUsdTotal, 1.2527);
});

test('recomputeMetricsAggregates keeps costUsdTotal null when nothing was reported', () => {
  const metrics = { sessions: [{ phase: 'spec', platform: 'claude', costUsd: null, costUsdEstimated: null }] };
  recomputeMetricsAggregates(metrics);
  assert.equal(metrics.spend.costUsdTotal, null);
  assert.equal(metrics.phases.spec.costUsdTotal, null);
  assert.equal(metrics.spendByPlatform.claude.costUsdTotal, null);
  assert.equal(metrics.sessions[0].costUsdTotal, null);
});
