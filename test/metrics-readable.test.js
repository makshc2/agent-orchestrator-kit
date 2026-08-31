import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatKyivDisplay, formatUtcIso, parseFlexibleIso } from '../bin/metrics-time.js';
import { parseAmpUsageDetails, matchAmpUsageModel, ampAgentMode } from '../bin/amp-usage.js';
import { estimateCursorCostUsd } from '../bin/cursor-cost-estimate.js';

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
  assert.equal(estimateCursorCostUsd({ model: 'unknown-model', inputTokens: 10, outputTokens: 1 }), null);
});
