## Why

Factory Control Plane вигадує USD з токенів ($3/1M in, $15/1M out), бо в `metrics.json` часто `costUsd: null`. Джерелом вартості має бути **kit**, порівняно з **версійованими опублікованими ставками**, а не live HTTP і не самооцінка агента. Опублікована схема `change-metrics` досі описує `spend` лише як `costUsd`, хоча код уже агрегує `costUsdEstimated` — споживачі не можуть на це покладатись. Cursor-оцінка сьогодні є лише для grok-4.5 / grok-4.6; інші моделі з токенами лишають `null`.

Design: none

## What Changes

- **Схема `metrics.json` (версія `1`) робить `costUsdEstimated` first-class.** Поле SHALL бути на `spend`, `spendByPlatform.*`, `spendByModel[]`, `phases.*`, `sessions[]` і `sources[]`. `costUsd` лишається лише billed / self-report / Amp `Cost: $N`. Оцінка і рахунок NEVER змішуються в одне число.
- **Cursor — завжди оцінювати, коли є токени, з міткою, ніколи як invoice.** grok-4.5 / grok-4.6 лишають чинну xAI API-таблицю (`costSource: "api-estimate"`). Будь-яка інша Cursor-модель з input і/або output токенами пише `costUsdEstimated` за версійованим fallback у `bin/cursor-cost-estimate.js`: **$3 / 1M input + $15 / 1M output** (без cache-split; відсутня сторона = 0; якщо є лише `totalTokens` — **$3.50 / 1M**), `costSource: "api-estimate-fallback"`, `costUsd` лишається `null`. Немає токенів → `null`. MUST NOT видавати оцінку за Cursor invoice.
- **Amp — лише billed `Cost: $N` з `amp threads usage --details`.** `ampCredits` лишаються окремим полем. MUST NOT конвертувати credits у USD. MUST NOT вигадувати Amp USD з токенів, коли рядок Cost відсутній (fail-open, `null`).
- **Claude без змін у цьому change:** `costUsd` лише з jsonl `total_cost_usd`; pricing table і Claude-estimate MUST NOT з’являтись.
- **Самозвіт `## Metrics` `cost_usd`** лишається billed/self-report у `costUsd`, ніколи в `costUsdEstimated`. Агент MUST NOT вгадувати Cursor-ціни як billed.
- **Людський рядок `metrics` / archive** лишає `$X billed + ~$Y est.` через `formatMetricsCostLine`; Amp credits MUST NOT входити в цей рядок.
- README і CHANGELOG документують `costUsdEstimated` і Cursor fallback для споживачів (зокрема Factory Control Plane). Без live HTTP, без нових npm-залежностей, без бекфілу архівів.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `change-metrics`: схема `spend` / платформ / моделей / сесій / sources отримує first-class `costUsdEstimated` (і `costSource` на Cursor/Amp source); Cursor-оцінка стає обов’язковою для будь-якої моделі з токенами (grok = api-таблиця, інші = версійований fallback); Amp billed vs credits затискається (Cost line або `null`, ніколи credits→USD і ніколи tokens→Amp USD); самозвіт `cost_usd` не потрапляє в estimate; людський cost-рядок лишає billed + est без credits.

## Impact

- `bin/cursor-cost-estimate.js` — fallback-ставки для не-grok моделей; grok-таблиця без змін.
- `bin/spend-collect.js` — записувати `costSource` (`api-estimate` vs `api-estimate-fallback`) на Cursor sources; `costUsd` Cursor лишається `null`.
- `bin/amp-usage.js` — fail-open без рядка `Cost:` лишає `costUsd: null`; credits ніколи не стають `costUsd`.
- `bin/agent-orchestrator.js` — агрегати `costUsdEstimated` уже є (`emptySpendTotals`, `recomputeSpendMaps`, `formatMetricsCostLine`); чіпати експорт / warning / help лише коли вимога цього потребує. Default-скелет legacy-файлів SHALL мержити відсутній `costUsdEstimated` як `null`.
- `test/metrics-readable.test.js`, `test/spend-collect.test.js` — grok лишається; не-grok більше не `null`; Amp без Cost лишає `costUsd: null`.
- `README.md`, `CHANGELOG.md` — споживачі бачать `costUsdEstimated` і Cursor fallback.
- Main spec `openspec/specs/change-metrics/spec.md` мержиться на archive, не в apply.
- Factory Control Plane / board UI — **поза scope** (окремий репо, окремий change). Споживач зможе читати поле після бампу кіта.

## Non-goals

- Live price fetch / HTTP, Amp billing API, Cursor SDK, нові npm-залежності.
- Конвертація Amp credits у USD.
- Claude pricing table або Claude-estimate.
- Запис оцінок у billed `costUsd`.
- Factory Control Plane / board UI.
- Агент, що самозвітує Cursor-долари як billed.
- Бекфіл уже заархівованих `metrics.json`.

## Acceptance criteria

Кожен критерій перевіряється спостережуваною поведінкою CLI / схеми `metrics.json`. Оцінка і рахунок NEVER змішуються в одне поле.

1. **Схема v1 — `costUsdEstimated` first-class.** Після persist без `--no-metrics` `metrics.json` має `version: 1` і ключ `costUsdEstimated` (число або `null`) на `spend`, `spendByPlatform.*`, `spendByModel[]`, `phases.*`, `sessions[]` і `sources[]`. `costUsd` SHALL містити лише billed / self-report / Amp `Cost: $N`. `costUsd` і `costUsdEstimated` MUST лишатись окремими полями і MUST NOT зливатись в одне число. `costSource` на source SHALL бути `"api-estimate"`, `"api-estimate-fallback"` або `"amp-usage"`, коли джерело відоме.
2. **Cursor grok — api-estimate, ніколи invoice.** Collect cursor з `model: cursor-grok-4.6-high-fast`, `inputTokens: 400`, `outputTokens: 40` пише `sources[0].costUsd: null`, числовий `costUsdEstimated` і `costSource: "api-estimate"`. `estimateCursorCostUsd({ model: 'cursor-grok-4.6', inputTokens: 100000, outputTokens: 1000 })` лишається `0.206`. Оцінка MUST NOT видаватись за Cursor invoice.
3. **Cursor non-grok — версійований fallback.** Для будь-якої іншої Cursor-моделі (включно з порожнім id) з токенами kit SHALL писати `costUsd: null`, `costUsdEstimated` і `costSource: "api-estimate-fallback"`. Ставки в `bin/cursor-cost-estimate.js`: **$3 / 1M input + $15 / 1M output** (відсутня сторона = 0; без cache-split, без cliff, без множника `-fast`); лише `totalTokens` — **$3.50 / 1M**. Спостережувані значення: `gpt-5.6` 1M/1M → `18`; лише `totalTokens: 1000000` → `3.5`; `inputTokens: 1000000`, `outputTokens: null` → `3`; `gpt-5.6-fast` 1M/1M → `18`; порожній model id з 1M input → `3`. Немає `inputTokens` / `outputTokens` / `totalTokens` → `costUsdEstimated: null` і `costSource` MUST NOT ставитись.
4. **Amp billed лише з `Cost: $N`.** `parseAmpUsageDetails` на тексті з токенами без рядка `Cost:` дає `costUsd: null` і збережені токени (fail-open). З `Cost: $1.30` дає `1.3`; `costSource: "amp-usage"` лише коли Cost реально спарсився. Kit MUST NOT конвертувати `ampCredits` у USD і MUST NOT множити Amp-токени на ставки. `ampCredits` SHALL лишатись окремим полем.
5. **Claude без змін у цьому change.** `costUsd` Claude SHALL братися лише з jsonl `total_cost_usd` (відсутній → `null`). Pricing table і `costUsdEstimated` з токенів Claude MUST NOT з’являтись. Claude і Amp MUST NOT отримувати `costUsdEstimated` з токенів.
6. **Самозвіт `cost_usd` не стає estimate.** Persist на `## Metrics` з `cost_usd: 0.42` без Cursor sources дає `sessions[0].costUsd === 0.42` і `sessions[0].costUsdEstimated === null`. Прапорець `--cost-usd` SHALL потрапляти лише в `costUsd`. `resolveSessionSpend({}, { costUsd: 0.42 }, [])` і `resolveSessionSpend({ costUsd: 9.99 }, {}, [])` дають `costUsdEstimated === null`. Агент MUST NOT підставляти Cursor-оцінку як billed `cost_usd`.
7. **Агрегати не змішують billed і estimate.** Сесія cursor з `costUsd: null`, `costUsdEstimated: 1.25` і сесія claude з `costUsd: 0.42`, `costUsdEstimated: null` дають `spend.costUsd === 0.42` і `spend.costUsdEstimated === 1.25` (і відповідні бакети `spendByPlatform`). `emptySpendTotals()` / `emptyPlatformSpend()` мають `costUsdEstimated: null`. Amp credits MUST NOT входити ні в `costUsd`, ні в `costUsdEstimated`.
8. **Людський рядок `metrics` / archive.** `formatMetricsCostLine({ costUsd: 1.3, costUsdEstimated: 8.98 })` SHALL дорівнювати `$1.30 billed + ~$8.98 est.`. З `ampCredits: 20` рядок MUST NOT містити `20`. Гілки: обидва числа → `$X billed + ~$Y est.`; лише billed → `$X`; лише estimate → `~$Y est.`; обидва `null` → `—`. `metrics <name>` без `--json` друкує той самий рядок; Amp credits MUST NOT входити в нього.
9. **Legacy merge, без бекфілу архівів.** `metrics.json` без `costUsdEstimated` після persist містить `spend.costUsdEstimated` (число або `null`) і ключ на `spendByPlatform.cursor`; exit 0. Заархівовані `metrics.json` MUST NOT перераховуватись.
10. **Немає live HTTP.** Ставки Cursor SHALL жити константами в `bin/cursor-cost-estimate.js` (чинна grok-таблиця + fallback `3` / `15` / `3.5`). MUST NOT бути HTTP, Amp billing API, Cursor SDK або нових npm-залежностей. Імпорт CLI у тести MUST NOT запускати commander (`isDirectCliRun()`).
11. **Документація для споживачів; Factory Control Plane поза scope.** README (Session end) і CHANGELOG `[Unreleased]` SHALL згадувати first-class `costUsdEstimated`, Cursor fallback `$3/$15` (або `$3.50/1M` total), `costSource: api-estimate-fallback`, і що оцінка не є Cursor invoice; Amp без `Cost:` лишає `costUsd: null`; самозвіт `cost_usd` не стає estimate. Немає обіцянки live HTTP або credits→USD. Factory Control Plane / board UI MUST NOT змінюватись у цьому change.
