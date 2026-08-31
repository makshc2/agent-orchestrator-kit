## 1. Cursor fallback estimator

- [x] 1.1 Додати версійований fallback у `cursor-cost-estimate.js`
  Files: bin/cursor-cost-estimate.js
  Do: лишити чинну таблицю grok-4.5 / grok-4.6 (`cursor-` префікс, `grok-4-5` / `grok-4-6`, `-fast` ×2, cliff при `inputTokens >= 200000`, cache-split). Коли `ratesForModel` повертає `null`, рахувати fallback: `(inputTokens ?? 0) * 3 / 1e6 + (outputTokens ?? 0) * 15 / 1e6`, якщо є `inputTokens` і/або `outputTokens`; якщо обидва `null`, але є `totalTokens` — `totalTokens * 3.5 / 1e6`; округлення `Math.round(usd * 10000) / 10000` як у grok; без cache-split, без cliff, без множника `-fast`. Якщо немає жодного з трьох полів токенів — повернути `null`. Константи fallback (`3`, `15`, `3.5`) SHALL жити в цьому файлі. Не додавати HTTP і не імпортувати Cursor SDK.
  Done-when: `estimateCursorCostUsd({ model: 'cursor-grok-4.6', inputTokens: 100000, outputTokens: 1000 })` лишається `0.206`; `estimateCursorCostUsd({ model: 'gpt-5.6', inputTokens: 1000000, outputTokens: 1000000 })` дорівнює `18`; `estimateCursorCostUsd({ model: 'gpt-5.6', totalTokens: 1000000 })` дорівнює `3.5`; `estimateCursorCostUsd({ model: 'gpt-5.6' })` є `null`

- [x] 1.2 Експортувати `describeCursorCostEstimate`
  Files: bin/cursor-cost-estimate.js
  Do: додати `export function describeCursorCostEstimate(args)` що викликає `estimateCursorCostUsd(args)` і повертає `null`, коли usd є `null`, інакше `{ usd, costSource }`. `costSource` є `"api-estimate"`, коли `ratesForModel(model)` не `null` (grok), і `"api-estimate-fallback"` для будь-якого іншого випадку з ненульовим usd. `estimateCursorCostUsd` лишає повернення `number | null`.
  Done-when: `describeCursorCostEstimate({ model: 'cursor-grok-4.6-high-fast', inputTokens: 400, outputTokens: 40 })` має `costSource: 'api-estimate'` і числовий `usd`; `describeCursorCostEstimate({ model: 'gpt-5.6', inputTokens: 1000000, outputTokens: 0 })` має `{ usd: 3, costSource: 'api-estimate-fallback' }`; без токенів повертає `null`

- [x] 1.3 Юніт-тести estimator і fallback
  Files: test/metrics-readable.test.js
  Do: лишити чинний grok-4.6 / long-context тест. Прибрати assertion `unknown-model` + 10/1 токенів → `null`. Додати кейси: не-grok `1000000/1000000` → `18` і `api-estimate-fallback`; лише `totalTokens: 1000000` → `3.5`; `inputTokens: 1000000`, `outputTokens: null` → `3`; модель `gpt-5.6-fast` з 1M/1M → `18` (без ×2); порожня модель з 1M input → fallback `3`, не `null`; без токенів → `null`. Імпортувати `describeCursorCostEstimate` з `bin/cursor-cost-estimate.js`.
  Done-when: файл більше не очікує `null` для не-grok моделі з токенами; містить асерти `18`, `3.5`, `3`, `api-estimate-fallback` і `null` без токенів

## 2. Cursor collect: costSource на sources

- [x] 2.1 Писати `costSource` з `describeCursorCostEstimate` у collect
  Files: bin/spend-collect.js
  Do: у `collectCursor` замінити виклик `estimateCursorCostUsd` + хардкод `costSource: estimated != null ? 'api-estimate' : null` на `describeCursorCostEstimate({ model, inputTokens, outputTokens, cacheReadTokens })`. У `sourceRecord` передавати `costUsdEstimated: described?.usd ?? null` і `costSource: described?.costSource ?? null`. `costUsd` лишити `null`. Не змінювати skip рядків, де і `inputTokens`, і `outputTokens` є `null`. Не оцінювати Claude/Amp токени цим модулем. Імпорт `estimateCursorCostUsd` замінити на `describeCursorCostEstimate`.
  Done-when: grok-hook як і раніше дає `costSource: 'api-estimate'`; не-grok hook дає `api-estimate-fallback`; у `collectCursor` немає літерала `'api-estimate'` як єдиного costSource для всіх моделей

- [x] 2.2 Тест Cursor hook: grok лишається, не-grok пише fallback
  Files: test/spend-collect.test.js
  Do: лишити чинний тест `cursor-grok-4.6-high-fast` (`costUsd: null`, `costUsdEstimated: 0.0021`, `costSource: 'api-estimate'`). Додати окремий `test(...)` з `model: 'gpt-5.6'`, `inputTokens: 1000000`, `outputTokens: 1000000` у вікні collect: `costUsd === null`, `costUsdEstimated === 18`, `costSource === 'api-estimate-fallback'`, `platform === 'cursor'`.
  Done-when: обидва кейси (grok `api-estimate` і gpt-5.6 `api-estimate-fallback` = 18) присутні в `test/spend-collect.test.js`

## 3. Amp billed vs credits

- [x] 3.1 Зафіксувати fail-open без рядка `Cost:`
  Files: test/metrics-readable.test.js, bin/amp-usage.js
  Do: додати тест `parseAmpUsageDetails` на тексті з `Total tokens: 1,000` / `Input tokens: 800` / `Output tokens: 200` без рядка `Cost: $N`: `costUsd === null`, `totalTokens === 1000`, `inputTokens === 800`, `outputTokens === 200`. Не конвертувати credits у USD і не додавати множення токенів на ставки в `parseAmpUsageDetails`. Чинний тест з `Cost: $1.30` лишити.
  Done-when: `parseAmpUsageDetails` без `Cost:` дає `costUsd: null` і зчитані токени; з `Cost: $1.30` як і раніше дає `1.3`; у `bin/amp-usage.js` немає формули токени→USD (немає множення на `1e6` / `3` / `15` / `3.5`)

## 4. Схема, рядок cost, самозвіт

- [x] 4.1 Залишити `costUsdEstimated` окремим полем агрегатів
  Files: bin/agent-orchestrator.js
  Do: залишити `METRICS_SPEND_KEYS` рівним `['inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'costUsdEstimated']`. Залишити `emptySpendTotals()` і `emptyPlatformSpend()` з `costUsdEstimated: null`. Залишити `addSpendNums` / `recomputeSpendMaps` такими, що додають `costUsdEstimated` окремо від `costUsd`. Не присвоювати `costUsdEstimated` у `costUsd` і не сумувати їх в одне поле.
  Done-when: `emptySpendTotals()` і `emptyPlatformSpend()` мають `costUsdEstimated: null`; `METRICS_SPEND_KEYS` містить рівно ці п’ять ключів; у `recomputeSpendMaps` / `addSpendNums` `costUsd` і `costUsdEstimated` лишаються різними полями

- [x] 4.2 Покрити `formatMetricsCostLine` без змішування credits
  Files: bin/agent-orchestrator.js, test/metrics-readable.test.js
  Do: додати `export { formatMetricsCostLine }` (файл уже має `isDirectCliRun`, тож імпорт у тест не запускає CLI). Не змінювати гілки функції: обидва числа → `$X billed + ~$Y est.`; лише billed → `$X`; лише estimate → `~$Y est.`; обидва null → `—`. Не читати `ampCredits` у рядку. Додати юніт-тести на чотири гілки і кейс `{ costUsd: 1.3, costUsdEstimated: 8.98, ampCredits: 20 }` — рядок містить `billed` і `est.`, не містить `20`.
  Done-when: `formatMetricsCostLine({ costUsd: 1.3, costUsdEstimated: 8.98 })` дорівнює `$1.30 billed + ~$8.98 est.`; `formatMetricsCostLine({ costUsd: 1.3, costUsdEstimated: 8.98, ampCredits: 20 })` не містить `20`; чотири гілки покриті в `test/metrics-readable.test.js`

- [x] 4.3 Самозвіт `cost_usd` не копіювати в `costUsdEstimated`
  Files: bin/agent-orchestrator.js, test/metrics-readable.test.js
  Do: у `resolveSessionSpend` залишити `costUsd = firstNonNull(flagCost, self.costUsd, fromAmp.costUsd, fromSources.costUsd)` і `costUsdEstimated = sourceEstimatedUsd(sources || [])`. Не присвоювати `flagCost` / `self.costUsd` у `costUsdEstimated`. Експортувати `resolveSessionSpend` разом із `formatMetricsCostLine`. Додати тест: `resolveSessionSpend({}, { costUsd: 0.42 }, [])` дає `costUsd === 0.42` і `costUsdEstimated === null`; `resolveSessionSpend({ costUsd: 9.99 }, {}, [])` дає `costUsd === 9.99` і `costUsdEstimated === null`.
  Done-when: обидва виклики вище повертають `costUsdEstimated === null`; єдине присвоєння `costUsdEstimated` у `resolveSessionSpend` іде з `sourceEstimatedUsd`

## 5. Документація для споживачів

- [x] 5.1 README: `costUsdEstimated` і Cursor fallback
  Files: README.md
  Do: у буллеті Session end (речення, що зараз каже «xAI API rates for grok-4.6/4.5») записати: Cursor завжди пише мічений `costUsdEstimated`, коли є токени — grok за xAI API (`costSource: api-estimate`), інші моделі за версійованим fallback $3/1M in + $15/1M out (або $3.50/1M якщо є лише totalTokens, `costSource: api-estimate-fallback`); це не Cursor invoice і не входить у billed `costUsd`. Amp — лише `Cost: $N`, credits окремо. У `## Changelog` додати секцію `### Unreleased` з тим самим контрактом. Не переписувати історичний буллет `### 0.9.0` так, ніби fallback уже був у 0.9.0.
  Done-when: README згадує `costUsdEstimated`, `api-estimate-fallback` і що оцінка не є invoice; Session end більше не формулює оцінку як існуючу лише для grok

- [x] 5.2 CHANGELOG: first-class estimate + fallback
  Files: CHANGELOG.md
  Do: у секцію `[Unreleased]` додати запис: `costUsdEstimated` first-class у `metrics.json`; Cursor non-grok fallback $3/$15 (або $3.50/1M total); `costSource: api-estimate-fallback`; Amp без рядка Cost лишає `costUsd: null`; самозвіт `cost_usd` не стає estimate. Не бекфілити архіви. Не обіцяти live HTTP і не обіцяти credits→USD.
  Done-when: `[Unreleased]` містить `costUsdEstimated` і `api-estimate-fallback`; немає обіцянки live HTTP або credits→USD
