## MODIFIED Requirements

### Requirement: Файл metrics.json є git-tracked журналом change-у

Kit SHALL писати `openspec/changes/<name>/metrics.json` (після archive — у `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json`) зі схемою версії `1`: `version`, `change`, `createdAt`, `updatedAt`, `archivedAt` (`null` до фіналізації), `spend` (`inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`), `spendByPlatform` (ключі `cursor`, `claude`, `amp` → `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`, `ampCredits`, `source`), `spendByModel` (масив `{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, ampCredits }`), `totals` (`sessions`, `durationMs`, `leadTimeMs`, `cloudSessions`), `phases` (ключ фази → `sessions`, `durationMs`, spend-поля включно з `costUsd` і `costUsdEstimated`, `agents`, `models`), `sessions` (масив записів), `pending` (`{ startedAt, role, platform, threadId, clientSource }` або `null`). Запис сесії SHALL містити `spendSource` (непорожній рядок), `ampCredits` (число або `null`), `costUsdEstimated` (число або `null`), `threadId` (Amp id або `null`), `sources` (масив `{ id, platform, model, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, costSource, ampCredits, at }`; порожній, коли клієнт невідомий і немає `--collect`) і опційно `models` (масив id), коли моделей більше однієї. `costUsd` SHALL містити лише billed / self-report / Amp usage `Cost: $N`. `costUsdEstimated` SHALL містити лише оцінений USD і MUST NOT дублювати billed `costUsd`. `costSource` на source SHALL бути `"api-estimate"`, `"api-estimate-fallback"` або `"amp-usage"`, коли джерело відоме; інакше поле може бути відсутнім. Файл MUST бути git-tracked (не в gitignored cache). Пошкоджений або відсутній JSON SHALL замінюватись default-об'єктом з тими самими ключами, без падіння CLI. Відсутні нові поля в legacy-файлі SHALL мержитись з default (`spendByPlatform` з трьома ключами і `null`-полями включно з `costUsdEstimated`, `spendByModel: []`, `sources: []`, `spendSource: "unreported"`, `ampCredits: null`, `costUsdEstimated: null` на `spend` і сесіях).

#### Scenario: Restore створює валідний скелет

- **GIVEN** активна зміна без `metrics.json`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --restore` без `--no-metrics`
- **THEN** файл `openspec/changes/<name>/metrics.json` існує
- **AND** містить `version: 1`, `change: <name>`, `sessions: []`, `pending` з `startedAt`, `archivedAt: null`
- **AND** містить ключі `spendByPlatform` і `spendByModel`
- **AND** `spend` містить ключ `costUsdEstimated` зі значенням `null`

#### Scenario: Пошкоджений JSON не валить persist

- **GIVEN** `metrics.json` містить невалідний JSON
- **WHEN** виконується persist без `--no-metrics`
- **THEN** команда завершується з exit 0
- **AND** файл перезаписаний валідним об'єктом схеми версії `1` із новою сесією

#### Scenario: Legacy файл без spendByPlatform лишається читабельним

- **GIVEN** `metrics.json` без полів `spendByPlatform` і `spendByModel`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** файл після запису містить `spendByPlatform` з ключами `cursor`, `claude`, `amp`
- **AND** exit code 0

#### Scenario: Legacy сесія без spendSource читається як unreported

- **GIVEN** `metrics.json` із записом сесії без поля `spendSource`
- **WHEN** виконується `metrics <name>`
- **THEN** ця сесія трактується як `unreported`
- **AND** exit code 0

#### Scenario: Legacy файл без costUsdEstimated лишається читабельним

- **GIVEN** `metrics.json` без поля `costUsdEstimated` на `spend`, платформах і сесіях
- **WHEN** виконується persist без `--no-metrics`
- **THEN** файл після запису містить `spend.costUsdEstimated` (число або `null`)
- **AND** `spendByPlatform.cursor` містить ключ `costUsdEstimated`
- **AND** exit code 0

### Requirement: Агрегати перераховуються на кожному записі

Кожен виклик, що зберігає `metrics.json` (persist, archive finalize), SHALL перераховувати `phases`, `totals`, `spend`, `spendByPlatform` і `spendByModel` з масиву `sessions` і їхніх `sources`. `totals.durationMs` — сума `session.durationMs` (null-honest). `totals.leadTimeMs` — різниця між найранішим `startedAt` і найпізнішим `endedAt`, або `null`. `totals.cloudSessions` — кількість сесій з `runtime: cloud`. `phases.<phase>.agents` — унікальні Closed role; `phases.<phase>.models` — унікальні непорожні `session.model` і `session.models`. `spend.costUsd` SHALL підсумовувати лише billed / self-report / Amp usage USD (не Amp credits і не оцінки). `spend.costUsdEstimated` SHALL підсумовувати `session.costUsdEstimated` і `source.costUsdEstimated` за тим самим правилом без подвійного рахунку, що й токени. `spend.costUsd` і `spend.costUsdEstimated` MUST лишатись окремими полями і MUST NOT зливатись в одне число. Amp credits MUST NOT входити ні в `costUsd`, ні в `costUsdEstimated`.

`spendByPlatform` SHALL наповнюватись із **двох** джерел: (1) сесії з непорожнім `session.platform` додають свої session-level токени, `costUsd`, `costUsdEstimated` і `ampCredits` у відповідний бакет; (2) `session.sources` (лише коли вони є) додають свої значення в бакет своєї платформи, і лише тоді бакет отримує `source` з іменем адаптера. Одна й та сама сесія MUST NOT рахуватись двічі: коли totals сесії збігаються із сумою її `sources`, у бакет додається один раз. Бакет без внеску MUST лишатись null-honest із `source: "none"`. `spendByModel` SHALL будуватись із пар (`session.model`, `session.platform`) і з `session.sources`, за тим самим правилом без подвійного рахунку, і SHALL містити `costUsdEstimated`. `spendByPlatform.*.ampCredits` SHALL лишатись окремим полем і MUST NOT входити в жодну суму USD.

#### Scenario: Дві сесії однієї фази агрегуються

- **GIVEN** уже є сесія `phase: spec`, `model: claude-fable-5`, `role: Architect`
- **WHEN** persist додає другу сесію `phase: spec`, `model: claude-opus-5`, `role: Architect`
- **THEN** `phases.spec.sessions` дорівнює `2`
- **AND** `phases.spec.agents` дорівнює `["Architect"]`
- **AND** `phases.spec.models` містить обидва id моделей

#### Scenario: spendByPlatform з самозвіту без адаптерів

- **GIVEN** сесія з `platform: cursor`, `totalTokens: 1200`, `costUsd: 0.30` і порожніми `sources`
- **WHEN** агрегати перераховуються
- **THEN** `spendByPlatform.cursor.totalTokens` дорівнює `1200`
- **AND** `spendByPlatform.cursor.costUsd` дорівнює `0.30`
- **AND** `spendByPlatform.cursor.source` дорівнює `none`

#### Scenario: Дві платформи на одному change складаються

- **GIVEN** сесія `platform: cursor` з `totalTokens: 1000` і сесія `platform: amp` з `totalTokens: 500` і `ampCredits: 12`
- **WHEN** агрегати перераховуються
- **THEN** `spendByPlatform.cursor.totalTokens` дорівнює `1000`
- **AND** `spendByPlatform.amp.totalTokens` дорівнює `500`
- **AND** `spendByPlatform.amp.ampCredits` дорівнює `12`
- **AND** `spend.totalTokens` дорівнює `1500`

#### Scenario: Самозвіт і sources не подвоюються

- **GIVEN** сесія з `totalTokens: 1000`, `platform: claude` і `sources`, сума яких теж `1000`
- **WHEN** агрегати перераховуються
- **THEN** `spendByPlatform.claude.totalTokens` дорівнює `1000`

#### Scenario: costUsdEstimated агрегується окремо від billed

- **GIVEN** сесія cursor з `costUsd: null`, `costUsdEstimated: 1.25` і сесія claude з `costUsd: 0.42`, `costUsdEstimated: null`
- **WHEN** агрегати перераховуються
- **THEN** `spend.costUsd` дорівнює `0.42`
- **AND** `spend.costUsdEstimated` дорівнює `1.25`
- **AND** `spendByPlatform.cursor.costUsdEstimated` дорівнює `1.25`
- **AND** `spendByPlatform.claude.costUsd` дорівнює `0.42`

### Requirement: Команда metrics показує ролі, моделі, платформи окремо

CLI SHALL надавати `npx agent-orchestrator-kit metrics [name] [--json]`. Без `--json` людський вивід MUST містити підсумок (`sessions`, work time, lead time, tokens, cost) і таблицю фаз з колонками `roles` (Closed role з `phases.*.agents`) і `models` (LLM id з `phases.*.models`). Колонка `models` MUST NOT друкувати Closed role замість моделей. Вивід MUST містити таблицю **by platform** (cursor / claude / amp з токенами, `costUsd`, `costUsdEstimated`, `ampCredits`, `source`) і таблицю **by model** (`model`, `platform`, токени, `costUsd`, `costUsdEstimated`, `ampCredits`). Вивід MUST показувати кількість сесій зі `spendSource: "unreported"`, а список сесій MUST показувати `spendSource` кожної сесії. MUST NOT друкувати єдиний «total $», що додає Amp credits до Claude/Cursor USD. Рядок підсумку `cost` SHALL рендеритись функцією `formatMetricsCostLine(spend)`: коли є і `costUsd`, і `costUsdEstimated` — `$X billed + ~$Y est.`; лише billed — `$X`; лише estimate — `~$Y est.`; обидва `null` — `—`. Amp `ampCredits` MUST NOT входити в цей рядок і MUST NOT друкуватись як долари. `--json` SHALL друкувати сирий об'єкт файлу в stdout. Команда SHALL знаходити файл активної зміни або найновіший `openspec/changes/archive/*-<name>/metrics.json`. Відсутній файл — non-zero з повідомленням `No metrics.json`.

Рендеринг людського виводу SHALL бути винесений у спільну функцію, яку перевикористовує stdout-зводка `archive`.

#### Scenario: Людська таблиця розрізняє roles і models

- **GIVEN** `metrics.json` із сесією `role: Architect`, `model: claude-opus-5`, `phase: spec`
- **WHEN** виконується `npx agent-orchestrator-kit metrics <name>` без `--json`
- **THEN** stdout містить заголовок колонки `models`
- **AND** рядок фази `spec` містить `claude-opus-5` у колонці моделей
- **AND** `Architect` не надрукований як значення колонки `models`

#### Scenario: Таблиці by platform і by model без unified bill

- **GIVEN** `spendByPlatform.claude.costUsd` є `1.5`, `spendByPlatform.amp.ampCredits` є `20`, `spendByPlatform.cursor.costUsd` є `null`
- **WHEN** виконується `metrics <name>` без `--json`
- **THEN** stdout містить окремі таблиці platform і model
- **AND** stdout не містить одного total $, що є сумою `1.5 + 20`

#### Scenario: Рядок cost показує billed і estimate без credits

- **GIVEN** `spend.costUsd` є `1.30`, `spend.costUsdEstimated` є `8.98`, `spendByPlatform.amp.ampCredits` є `20`
- **WHEN** виконується `metrics <name>` без `--json`
- **THEN** stdout містить `$1.30 billed + ~$8.98 est.`
- **AND** stdout не містить суми credits і USD як одного total

#### Scenario: Вивід показує unreported сесії

- **GIVEN** дві сесії з `spendSource: "unreported"` і одна з `self-report`
- **WHEN** виконується `metrics <name>`
- **THEN** stdout повідомляє про дві сесії без самозвіту

#### Scenario: --json для активної зміни

- **WHEN** виконується `metrics <name> --json` для активної зміни з файлом
- **THEN** stdout є JSON з полем `sessions`
- **AND** exit code 0

#### Scenario: metrics знаходить заархівовану зміну

- **GIVEN** немає активної `openspec/changes/<name>/metrics.json`
- **AND** існує `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json`
- **WHEN** виконується `metrics <name>`
- **THEN** команда читає архівний файл і завершується з exit 0

#### Scenario: Немає файлу — помилка

- **WHEN** виконується `metrics missing-change`
- **THEN** exit code ≠ 0
- **AND** вивід містить `No metrics.json`

### Requirement: Джерело spend — прапорці, потім самозвіт, потім опційні адаптери

Session-level spend SHALL резолвитись пополе, перше не-null значення виграє: явний прапорець (`--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`) → відповідний ключ `## Metrics` (для archive — після drop stale-копії попередньої сесії) → зібрані `sources` (locked client або `--collect`) → `null`. Дефолтний persist і archive MUST NOT читати адаптери інших платформ, ніж резолвлений клієнт, якщо немає `--collect`.

`session.ampCredits` SHALL зберігатись окремим полем сесії з ключа `amp_credits` і MUST NOT входити в `costUsd` чи в будь-яку суму USD. Відсутнє число MUST лишатись `null`, ніколи штучним `0`. CLI MUST NOT писати оцінений з токенів USD у `costUsd`. CLI MUST NOT конвертувати Amp credits у USD. Cursor-оцінка з токенів SHALL писатись лише в `costUsdEstimated` (див. «Cursor estimate не змішується з billed USD»). Ключ самозвіту `cost_usd` і прапорець `--cost-usd` SHALL потрапляти в `costUsd` як billed/self-report і MUST NOT копіюватись у `costUsdEstimated`. Агент MUST NOT підставляти Cursor-оцінку як billed `cost_usd`.

Коли `--collect` передано, зібрані `sources` SHALL записуватись у `session.sources` і наповнювати `spendByPlatform` / `spendByModel`, але MUST NOT перекривати totals, що прийшли з прапорців або самозвіту.

#### Scenario: Прапорець перемагає самозвіт

- **GIVEN** `## Metrics` містить `input_tokens: 100`, `output_tokens: 50`, `cost_usd: 0.10`
- **WHEN** виконується persist з `--input-tokens 7 --cost-usd 9.99`
- **THEN** `sessions[0].inputTokens` дорівнює `7`
- **AND** `sessions[0].outputTokens` дорівнює `50`
- **AND** `sessions[0].costUsd` дорівнює `9.99`

#### Scenario: Дефолтний persist не читає адаптери

- **GIVEN** tmp `HOME` з валідною Claude JSONL фікстурою у вікні сесії
- **AND** `handoff.md` без `## Metrics`
- **WHEN** виконується persist без `--collect`
- **THEN** `sessions[0].sources` є `[]`
- **AND** `sessions[0].totalTokens` є `null`
- **AND** `spendByPlatform.claude.source` дорівнює `none`

#### Scenario: Amp credits не входять у costUsd

- **GIVEN** `## Metrics` містить `amp_credits: 20` і `cost_usd: unknown`
- **WHEN** виконується persist
- **THEN** `sessions[0].ampCredits` дорівнює `20`
- **AND** `sessions[0].costUsd` є `null`
- **AND** `spend.costUsd` є `null`
- **AND** `spendByPlatform.amp.ampCredits` дорівнює `20`

#### Scenario: Самозвіт не перекривається зібраними sources

- **GIVEN** `## Metrics` містить `input_tokens: 1000`, `output_tokens: 200`
- **AND** адаптерна фікстура дає source з `inputTokens: 5`, `outputTokens: 5`
- **WHEN** виконується persist з `--collect`
- **THEN** `sessions[0].inputTokens` дорівнює `1000`
- **AND** `sessions[0].sources` містить зібраний запис
- **AND** `spendByPlatform` містить токени зібраного запису

#### Scenario: Самозвіт cost_usd не стає estimate

- **GIVEN** `## Metrics` містить `cost_usd: 0.42` і немає Cursor hook-записів
- **WHEN** виконується persist
- **THEN** `sessions[0].costUsd` дорівнює `0.42`
- **AND** `sessions[0].costUsdEstimated` є `null`

### Requirement: Amp CLI віддає mode і billed USD

Коли locked client є `amp` (або `--collect`), адаптер `amp-cli` SHALL після `amp threads export <id>` викликати `amp threads usage <id> --details` (бінар `AOK_AMP_BIN` або `amp`, fail-open, без сирого HTTP). З export SHALL братися `usage.model`, токени і `agentMode` (`low` / `medium` / `high` / `ultra` з `thread.agentMode` або `thread.meta.agentMode`). З usage SHALL братися рядок `Cost: $N` у `session.costUsd` / `spendByPlatform.amp.costUsd` і таблиця Models у `session.usageModels`. Рядок `Cost: $N` є єдиним Amp billed USD: він SHALL писатись зі `costSource: "amp-usage"` на source, коли Cost реально спарсився. Відсутній рядок `Cost:` MUST лишати `costUsd: null` (fail-open), навіть коли usage містить токени або таблицю Models. Kit MUST NOT множити Amp-токени на ставки і MUST NOT ділити чи множити `ampCredits`, щоб отримати USD. `ampCredits` SHALL лишатись окремим полем і MUST NOT записуватись як `costUsd`. `agentMode` SHALL писатись у `session.agentMode` і MUST NOT ставати `session.model`. Плейсхолдер `amp-default` трактується як відсутня модель, тож primary id з sources перемагає. Amp credits MUST NOT конвертуватись у USD.

#### Scenario: Amp usage inject заповнює costUsd і agentMode

- **GIVEN** `exportAmpThread` повертає thread з `agentMode: "low"` і usage GLM
- **AND** `usageAmpThread` повертає `{ costUsd: 1.3 }`
- **WHEN** виконується collect Amp CLI
- **THEN** `sources[0].agentMode` є `"low"`
- **AND** `ampThreads[0].costUsd` є `1.3`

#### Scenario: Amp usage без рядка Cost лишає costUsd null

- **GIVEN** текст `amp threads usage --details` містить токени і не містить рядка `Cost: $N`
- **WHEN** викликається `parseAmpUsageDetails`
- **THEN** `costUsd` є `null`
- **AND** токени збережені, якщо вони були в тексті
- **AND** жодне поле не отримує USD, порахований з токенів або з `ampCredits`

### Requirement: Cursor estimate не змішується з billed USD

Адаптер cursor SHALL оцінювати USD з токенів, коли є хоча б одне з `inputTokens`, `outputTokens`, `totalTokens`, і SHALL писати результат у `costUsdEstimated`, ніколи в `costUsd` (`costUsd` на Cursor-adapter source лишається `null`). Оцінка MUST NOT видаватись за Cursor invoice. Ставки SHALL жити у версійованому модулі `bin/cursor-cost-estimate.js` без HTTP і без Cursor SDK.

1. Моделі `grok-4.6` / `grok-4.5` (включно з префіксом `cursor-`, записом `grok-4-6` / `grok-4-5` і суфіксом `-fast`) SHALL використовувати чинну xAI API-таблицю, з подвоєнням для `-fast` і long-context cliff при `inputTokens >= 200000`. Відсутній cache-split MUST рахувати весь input як fresh (оцінка зверху). `costSource: "api-estimate"`.
2. Будь-яка інша Cursor-модель (включно з порожнім або невідомим id) з `inputTokens` і/або `outputTokens` SHALL використовувати fallback **$3 / 1M input + $15 / 1M output**, без cache-split, без long-context cliff і без множника `-fast`; відсутня сторона рахується як `0`. `costSource: "api-estimate-fallback"`.
3. Якщо `inputTokens` і `outputTokens` обидва `null`, але є `totalTokens`, SHALL використовуватись fallback **$3.50 / 1M** total з `costSource: "api-estimate-fallback"`.
4. Якщо немає жодного з `inputTokens`, `outputTokens`, `totalTokens` — `costUsdEstimated` SHALL бути `null` і `costSource` MUST NOT ставитись.

`spend.costUsd` MUST містити лише billed / self-report / Amp usage. Human summary SHALL друкувати `$X billed + ~$Y est.` через `formatMetricsCostLine`. Claude і Amp MUST NOT отримувати `costUsdEstimated` з токенів у цьому change. Live HTTP для цін MUST NOT використовуватись.

#### Scenario: Cursor hook з grok-4.6-fast пише estimate, не costUsd

- **GIVEN** `cursor-usage.jsonl` з `model: cursor-grok-4.6-high-fast`, `inputTokens: 400`, `outputTokens: 40`
- **WHEN** виконується collect cursor
- **THEN** `sources[0].costUsd` є `null`
- **AND** `sources[0].costUsdEstimated` є числом
- **AND** `sources[0].costSource` є `"api-estimate"`

#### Scenario: Cursor hook з не-grok моделлю пише fallback estimate

- **GIVEN** `cursor-usage.jsonl` з `model: gpt-5.6`, `inputTokens: 1000000`, `outputTokens: 1000000`
- **WHEN** виконується collect cursor
- **THEN** `sources[0].costUsd` є `null`
- **AND** `sources[0].costUsdEstimated` дорівнює `18`
- **AND** `sources[0].costSource` є `"api-estimate-fallback"`

#### Scenario: Cursor fallback з лише totalTokens

- **GIVEN** не-grok модель з `totalTokens: 1000000` і без `inputTokens` / `outputTokens`
- **WHEN** рахується оцінка в `bin/cursor-cost-estimate.js`
- **THEN** `costUsdEstimated` дорівнює `3.5`
- **AND** `costSource` є `"api-estimate-fallback"`

#### Scenario: Cursor без токенів не пише estimate

- **GIVEN** модель `gpt-5.6` без `inputTokens`, `outputTokens` і `totalTokens`
- **WHEN** рахується оцінка
- **THEN** `costUsdEstimated` є `null`

#### Scenario: Відсутня сторона токенів рахується як нуль

- **GIVEN** не-grok модель з `inputTokens: 1000000` і `outputTokens: null`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `3`
- **AND** `costSource` є `"api-estimate-fallback"`

#### Scenario: Cursor fallback не подвоює суфікс -fast

- **GIVEN** модель `gpt-5.6-fast` з `inputTokens: 1000000` і `outputTokens: 1000000`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `18`
- **AND** `costSource` є `"api-estimate-fallback"`

#### Scenario: Порожня Cursor-модель з токенами все одно оцінюється

- **GIVEN** порожній model id і `inputTokens: 1000000`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `3`
- **AND** `costSource` є `"api-estimate-fallback"`
