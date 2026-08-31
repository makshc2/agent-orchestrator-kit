## Context

Kit v0.9.0 уже збирає spend у git-tracked `metrics.json`. Агрегати (`emptySpendTotals`, `recomputeSpendMaps` у `bin/agent-orchestrator.js`) мають поле `costUsdEstimated`, людський рядок `formatMetricsCostLine` друкує `$X billed + ~$Y est.`, Amp billed береться з `amp threads usage --details` (`Cost: $N` → `costUsd`, `costSource: "amp-usage"` лише коли Cost спарсився), Cursor-оцінка в `bin/cursor-cost-estimate.js` працює лише для grok-4.5 / grok-4.6. Опублікована вимога в `openspec/specs/change-metrics/spec.md` досі описує `spend` як `(inputTokens, outputTokens, totalTokens, costUsd)` і дозволяє Cursor-оцінку лише як MAY для grok — тому Factory Control Plane не може покладатись на kit і вигадує USD з токенів.

Обмеження, які лишаються чинними: без мережі, без Amp billing API, без Cursor SDK, без нових npm-залежностей, без Claude pricing table, `metrics.json` схема версії `1` (аддитивно).

## Goals / Non-Goals

**Goals:**

- Зробити `costUsdEstimated` first-class у схемі `metrics.json`, щоб споживачі (Factory Control Plane) читали оцінку з кіта, а не рахували самі.
- Cursor: завжди оцінювати, коли є токени; grok — чинна xAI-таблиця; інші моделі — версійований fallback у тому самому файлі; мітка `costSource`; ніколи не invoice.
- Amp: єдине джерело доларів — рядок `Cost: $N`; credits окремо; відсутній Cost → `null`.
- Claude без змін: лише `total_cost_usd` у `costUsd`.
- Самозвіт `cost_usd` лишається billed у `costUsd`.
- Зберегти людський рядок billed + est. без Amp credits.

**Non-Goals:**

- Live price fetch / HTTP.
- Конвертація Amp credits у USD.
- Claude-estimate або pricing table.
- Змішування оцінок у billed `costUsd`.
- Factory Control Plane / board UI.
- Агент, що самозвітує Cursor-долари як billed.
- Бекфіл заархівованих `metrics.json`.

## Decisions

### D1. Схема: `costUsdEstimated` first-class, `costUsd` лишається billed

Схема версії `1` лишається; поле аддитивне. `costUsdEstimated` SHALL бути на `spend`, `spendByPlatform.*`, `spendByModel[]`, `phases.*`, `sessions[]` і `sources[]`. `costSource` SHALL бути на source (`"api-estimate"` | `"api-estimate-fallback"` | `"amp-usage"`). `costUsd` = лише billed / self-report / Amp `Cost: $N`. Оцінка і рахунок NEVER сумуються в одне поле. Legacy-файл без поля мержиться з `null` (як інші нові ключі). Бекфіл архівів не робиться.

Альтернатива — схема `version: 2` або перейменування `costUsd` на union billed|estimated — відкинута: ламає наявні файли і змішує семантики в одному числі, що якраз і треба прибрати.

### D2. Cursor: grok = api-таблиця, інші = версійований fallback

У `bin/cursor-cost-estimate.js`:

- grok-4.5 / grok-4.6 (префікс `cursor-`, запис `grok-4-5` / `grok-4-6`, суфікс `-fast` ×2, cliff при `inputTokens >= 200000`, cache-split якщо є): без змін формули. `costSource: "api-estimate"`.
- Будь-яка інша модель (включно з порожнім id) з `inputTokens` і/або `outputTokens`: **$3 / 1M in + $15 / 1M out**, без cache-split, без cliff, без `-fast`. Відсутня сторона = 0. `costSource: "api-estimate-fallback"`.
- Лише `totalTokens`: **$3.50 / 1M**. Той самий `costSource`.
- Жодних токенів → `null`, `costSource` не ставити.
- `costUsd` на Cursor source лишається `null`.

`estimateCursorCostUsd` лишає повернення `number | null` (існуючі grok-тести). Окремий експорт `describeCursorCostEstimate` повертає `{ usd, costSource }` або `null`, щоб `bin/spend-collect.js` ставив правильний `costSource`, а не хардкодив `"api-estimate"`.

Альтернатива — live HTTP / Cursor SDK — відкинута (D4). Альтернатива — лишити unknown-model як `null` — відкинута власником («в курсорі рахувати приблизно але рахувати»).

### D3. Amp: billed `Cost: $N`, credits ніколи не USD

`parseAmpUsageDetails` уже читає `Cost: $N` у `costUsd`. Це єдине Amp billed число на thread. `ampCredits` лишаються окремим полем. Відсутній рядок Cost → `costUsd: null` (fail-open), навіть якщо є токени. MUST NOT множити Amp-токени на ставки. MUST NOT конвертувати credits. `costSource: "amp-usage"` лише коли Cost реально спарсився (`usage.costUsd != null`). Долари з таблиці Models у виводі Amp CLI лишаються Amp-наданими рядками таблиці і MUST NOT підставлятись як `session.costUsd`, коли рядка `Cost:` немає.

Альтернатива — оцінити Amp з токенів тим самим fallback — відкинута: Amp уже віддає billed долари; вигадувати друге число було б брехнею.

### D4. Немає live-цін

Жодного HTTP, Amp billing API, Cursor SDK, нових npm-залежностей. Ставки Cursor — константи у `bin/cursor-cost-estimate.js`, змінюються релізом кіта, не запитом до мережі. Адаптери лишаються read-only / offline.

Альтернатива — підтягувати прайси з xAI/OpenAI/Anthropic на persist — відкинута: мережа, ключі, нестабільний CI, розбіжність із «kit є джерелом».

### D5. Claude без змін

`costUsd` лише з jsonl `total_cost_usd` (або аналога). Pricing table і `costUsdEstimated` з токенів Claude в цьому change MUST NOT з’являтись. Відсутній `total_cost_usd` → `null`.

Альтернатива — той самий $3/$15 fallback для Claude — відкинута: у Claude вже є billed у jsonl; оцінка була б другим, гіршим числом.

## Risks / Trade-offs

- **Fallback-ставки застаріють** → мітка `api-estimate-fallback` чесно відрізняє їх від grok `api-estimate`; оновлення — реліз кіта, не HTTP. Споживач бачить, що це не invoice.
- **Amp без рядка `Cost:`** → `costUsd: null`, fail-open; токени лишаються. Краще чесний null, ніж вигадані долари.
- **Board / Factory Control Plane на старому кіті** → до бампу й парсингу `costUsdEstimated` споживач і далі може вигадувати USD. Документуємо поле в README/CHANGELOG; UI-change окремий. Бекфіл архівів не робимо — історичні `metrics.json` лишаються як є.
- **Дрібні токени округлюються до 4 знаків** (як grok) → тести фіксують круглі 1M-приклади (`18`, `3`, `3.5`), щоб не спекулювати на `0.0000`.

## Migration Plan

1. Apply змінює лише kit-код, тести, README, CHANGELOG.
2. Нові `metrics.json` одразу мають `costUsdEstimated`.
3. Наявні файли без поля читаються; persist/archive дописує ключ як `null` або перераховану суму з сесій.
4. Заархівовані change не перераховуються.
5. Rollback: відкат релізу кіта; схема v1 сумісна назад (зайве поле ігнорується старим парсером).

## Open Questions

Немає — продуктові рішення зафіксовані в decision brief (Amp billed, Cursor always-estimate + fallback, Claude без таблиці, без HTTP, схема `costUsdEstimated`).
