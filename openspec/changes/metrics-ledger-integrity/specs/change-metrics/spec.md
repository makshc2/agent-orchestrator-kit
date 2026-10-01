## ADDED Requirements

### Requirement: Поле costUsdTotal у сесіях і агрегатах

Кожен запис сесії SHALL містити `costUsdTotal` = `roundUsd4(costUsd ?? costUsdEstimated)`, де `costUsd` і `costUsdEstimated` беруться з поля сесії, а коли воно `null` — із суми рядків `byModel` (та сама `sessionFieldOrSources`, що й для токенів); обидва `null` → `costUsdTotal: null`. `phases.*`, `spend`, `spendByPlatform.*` і `spendByModel[]` SHALL містити `costUsdTotal` = `roundUsd4(Σ)` неокруглених per-session значень через `addNullable` (усі доданки `null` → `null`). `costUsdTotal` MUST NOT додавати `ampCredits` до USD і MUST NOT додавати billed і estimated однієї сесії (estimated лише коли billed відсутній). Поле SHALL перераховуватись на кожному записі в `recomputeMetricsAggregates`; `metrics --migrate` MUST NOT його обчислювати. Legacy-файл `version: 2` без `spend.costUsdTotal` (архіви до появи ключа) SHALL читатись як валідний: default-merge дає `null`, наступний звичайний запис перераховує.

#### Scenario: Billed має пріоритет над estimate у costUsdTotal

- **GIVEN** сесія з `costUsd: 1.00005` і `costUsdEstimated: null` та сесія з `costUsd: null` і `costUsdEstimated: 2.5`
- **WHEN** виконується `recomputeMetricsAggregates`
- **THEN** `sessions[0].costUsdTotal` дорівнює `1.0001`, `sessions[1].costUsdTotal` дорівнює `2.5`
- **AND** `spend.costUsdTotal` дорівнює `3.5001`

#### Scenario: Legacy-архів без spend.costUsdTotal читається

- **GIVEN** архівний `metrics.json` `version: 2`, у якому `spend` не має ключа `costUsdTotal`
- **WHEN** виконується `metrics <name>`
- **THEN** команда завершується з exit 0 і показує зводку
- **AND** файл не переписується

### Requirement: Nullable cache-ключі cacheReadTokens і cacheCreationTokens

Запис сесії, рядки `byModel`, `phases.*`, `spend`, `spendByPlatform.*` і `spendByModel[]` SHALL містити `cacheReadTokens` і `cacheCreationTokens` (число або `null`). Ключі є адитивними: `inputTokens` і далі включає cache-токени за семантикою кожного адаптера (вимога «Три read-only адаптери»), а cache-ключі лише кажуть, яка частина входу прочитана з кешу / записана в кеш. Source-запис адаптера SHALL нести `cacheReadTokens` (Claude `cache_read_input_tokens`, Cursor `cacheReadTokens`, Amp — з `amp threads usage`) і `cacheCreationTokens` (Claude `cache_creation_input_tokens`, Cursor `cacheWriteTokens`), лише коли значення є числом. На сесії `cacheReadTokens` SHALL братись із thread-level Amp usage, коли воно є, інакше з суми source-записів; `cacheCreationTokens` — із суми source-записів; leftover-перерахунок SHALL брати значення з `byModel`, коли там є число. Відсутні ключі в legacy-файлі SHALL читатись як `null` і MUST NOT ставати `0`. Схема лишається `version: 2`; `--migrate` MUST NOT обчислювати cache-ключі.

#### Scenario: Claude cache split доходить до всіх рівнів

- **GIVEN** jsonl-рядок Claude з `input_tokens: 100`, `cache_read_input_tokens: 800`, `cache_creation_input_tokens: 100`, `output_tokens: 5`
- **WHEN** виконується `handoff <name> --collect`
- **THEN** `sessions[0].inputTokens` дорівнює `1000`, `cacheReadTokens` — `800`, `cacheCreationTokens` — `100`
- **AND** ті самі `800` / `100` є на `sessions[0].byModel[0]`, `phases.spec`, `spend`, `spendByPlatform.claude` і `spendByModel[0]`
- **AND** `spendByPlatform.cursor.cacheReadTokens` є `null`
- **AND** `version` дорівнює `2`

#### Scenario: Legacy-сесія без cache-ключів лишається null-honest

- **GIVEN** `metrics.json` із сесією без ключів `cacheReadTokens` / `cacheCreationTokens`
- **WHEN** виконується наступний persist
- **THEN** `spend.cacheReadTokens` є `null` для цієї сесії і не дорівнює `0`

### Requirement: Інваріанти правдоподібності — попередження на запис, не блокування

`bin/agent-orchestrator.js` SHALL експортувати `metricsSessionInvariantIssues(session, metrics)` і `metricsLedgerInvariantIssues(metrics)`, які повертають масив рядків-порушень: `version` дорівнює `2`; `session.role` є канонічним токеном (вимога «Канонічна Closed role у metrics.json»); `durationMs` ≤ 24 год; `startedAt` ≥ `createdAt − 12 год` (propose-чат легітимно стартує до створення каталогу change-у, тож межа у хвилинах неприпустима); `endedAt` ≤ `archivedAt`, коли `archivedAt` є; `spendSource: "adapter"` ⇒ `sourceIds.length > 0` або хоча б одне з `inputTokens` / `outputTokens` / `totalTokens` не `null`; `costUsdTotal` сесії і `spend.costUsdTotal` узгоджені з вимогою «Поле costUsdTotal у сесіях і агрегатах». Відсутні поля (`durationMs: null`, `archivedAt: null`) MUST NOT вважатись порушенням.

`metricsRecordSessionEnd` і `metricsFinalizeArchive` SHALL викликати ту саму функцію для щойно записаної сесії: кожне порушення (крім перевірки `costUsdTotal`, що виконується після recompute на рівні леджера) SHALL друкуватись у stderr як `metrics: warning: <issue>` і дописуватись у `session.notes[]`; archive SHALL додатково друкувати порушення всього фінального файла. Сирі значення MUST NOT клампитись. Попередження MUST NOT робити persist, archive, `metrics --collect` чи gate-check non-zero, MUST NOT блокувати запис у `openspec/changes/archive/` і MUST NOT потрапляти в stdout persist (prompt лишається єдиним вмістом stdout). Сесія без порушень MUST NOT отримувати ключ `notes`.

#### Scenario: Хибний --started-at дає попередження і notes, exit 0

- **GIVEN** persist із `--started-at` на 10 днів раніше `createdAt`
- **WHEN** виконується `handoff <name> --started-at <iso>`
- **THEN** exit code дорівнює 0, stdout містить лише prompt
- **AND** stderr містить `metrics: warning: durationMs … exceeds 24h` і `metrics: warning: startedAt … is more than 12h before createdAt`
- **AND** `sessions[last].notes` містить обидва рядки, а `sessions[last].startedAt` дорівнює переданому значенню

#### Scenario: Сесія без порушень не має notes

- **GIVEN** persist після `--restore` тієї самої доби з канонічною роллю
- **WHEN** записується сесія
- **THEN** stderr не містить `metrics: warning:`
- **AND** запис сесії не має ключа `notes`

#### Scenario: Archive попереджає, але не падає

- **GIVEN** `metrics.json` зі старою сесією `spendSource: "adapter"` без `sourceIds` і токенів
- **WHEN** виконується `archive <name>`
- **THEN** stderr містить `metrics: warning: sessions[0]: spendSource "adapter" without sourceIds and without tokens`
- **AND** exit code дорівнює 0 і `archivedAt` встановлено

### Requirement: Contract-тест над архівними metrics.json

Тест-набір kit-а SHALL містити contract-тест, який для кожного `openspec/changes/archive/*/metrics.json` із `createdAt ≥ KIT_METRICS_CONTRACT_SINCE` (`2026-09-25T00:00:00.000Z`) імпортує `metricsLedgerInvariantIssues` з `bin/agent-orchestrator.js` і вимагає порожній масив. Архіви зі старішим `createdAt` SHALL виключатись за датою і MUST NOT переписуватись (рішення «historical archives are not migrated»); тест SHALL також перевіряти, що принаймні один архів у вікні існує і що історичний архів усе ще містить порушення — доказ, що його не чіпали.

#### Scenario: Новий архів порушує інваріант

- **GIVEN** архів із `createdAt` після `KIT_METRICS_CONTRACT_SINCE`, де одна сесія має `durationMs` > 24 год
- **WHEN** виконується `npm test`
- **THEN** contract-тест падає з назвою каталогу і текстом порушення

#### Scenario: Історичний архів виключено

- **GIVEN** архів `2026-09-07-fix-metrics-dedup-window-compact-schema` з рядком `durationMs` 5 913 634 789
- **WHEN** виконується `npm test`
- **THEN** contract-тест не падає через цей архів
- **AND** файл архіву не змінений

### Requirement: Notes адаптерів друкуються в stderr

`runCollectSpend` SHALL друкувати кожен елемент `collected.notes[]` у stderr як `metrics: <note>` на всіх collect-шляхах (persist, archive, leftover, `metrics --collect`). Виняток `collectSpend` MUST NOT ковтатись у `notes: []`: результат SHALL містити нотатку `collect: adapters failed: <message>`, яка так само друкується, а CLI продовжує без падіння. Stdout persist MUST NOT містити ці рядки.

#### Scenario: Відсутній cursor-usage.jsonl видно в stderr

- **GIVEN** `pending.platform` є `cursor` і файла `.agents/spend/cursor-usage.jsonl` немає
- **WHEN** виконується `handoff <name>`
- **THEN** stderr містить `metrics: cursor: usage file missing`
- **AND** stdout містить prompt і не містить `usage file missing`
- **AND** exit code дорівнює 0

### Requirement: Рядок cache hit у зводці

`renderMetricsSummary` (спільна для `metrics <name>` і `archive`) SHALL після рядка `cost:` друкувати `cache hit: N% (R cache-read of I input tokens)`, де `R = spend.cacheReadTokens`, `I = spend.inputTokens`, `N = R / I × 100` з одним знаком після коми, обрізано до 100; коли `I` є `null` або `0` — `cache hit: R cache-read tokens`. Рядок MUST NOT друкуватись, коли `spend.cacheReadTokens` є `null`.

#### Scenario: Зводка показує частку cache

- **GIVEN** `spend.inputTokens` дорівнює `1000`, `spend.cacheReadTokens` — `800`
- **WHEN** виконується `metrics <name>`
- **THEN** stdout містить рядок `cache hit: 80.0% (800 cache-read of 1000 input tokens)`

#### Scenario: Без cache-даних рядка немає

- **GIVEN** `spend.cacheReadTokens` є `null`
- **WHEN** виконується `metrics <name>`
- **THEN** stdout не містить рядка, що починається з `cache hit:`

### Requirement: Ставки Claude Opus 5.5 і fallback cache-read

`bin/claude-cost-estimate.js` SHALL містити ставку `claude-opus-5-5` `{ input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 }` ($/M), яка перемагає префікс `claude-opus` як довший. Для моделі без відомої ставки estimator SHALL рахувати input і cache-write за $3/M, cache-read за $0.3/M (0.1× input, як у всіх опублікованих ставках) і output за $15/M з `costSource: "api-estimate-fallback"`. `ratesForModel` SHALL експортуватись.

#### Scenario: Opus 5.5 не отримує ставки Opus 5

- **GIVEN** jsonl-рядок Claude з `model: "claude-opus-5-5"`, `input_tokens: 100`, `cache_read_input_tokens: 800`, `cache_creation_input_tokens: 100`, `output_tokens: 5`
- **WHEN** виконується persist із collect
- **THEN** `session.costUsdEstimated` дорівнює `0.0012`
- **AND** `session.byModel[0].costSource` є `api-estimate`

#### Scenario: Невідома модель рахує cache-read дешевше

- **GIVEN** `estimateClaudeCostUsd({ model: 'gpt-6-astra', cacheReadTokens: 1000000 })`
- **WHEN** обчислюється оцінка
- **THEN** результат дорівнює `0.3`
- **AND** `estimateClaudeCostUsd({ model: 'gpt-6-astra', inputTokens: 1000000, outputTokens: 10000 })` і далі дорівнює `3.15`

## MODIFIED Requirements

### Requirement: Канонічна Closed role у metrics.json

`session.role`, `pending.role` і `phases.*.agents` MUST зберігати канонічний токен ролі, не повний рядок Closed role з `handoff.md`. Канонічні токени: `Explorer`, `Architect`, `Spec Reviewer`, `Implementer`, `Archiver`, `Design Intake`; `bin/agent-orchestrator.js` SHALL експортувати їх як `CANONICAL_ROLE_TOKENS` разом із `isCanonicalRole`. CLI SHALL брати перший відомий токен з Closed role або next role (регістр ігнорується; `Spec Reviewer` — два слова) або перший сегмент до `—` / коми, якщо він збігається з токеном. `Spec Architect` (ім'я субагента kit-а `spec-architect`) SHALL канонізуватись у `Architect`. `Conductor` і `Code Reviewer` не є Closed role жодного шаблону і MUST NOT додаватись як токени: `canonicalRole` лишає їх сирим рядком, а інваріант «Інваріанти правдоподібності — попередження на запис, не блокування» позначає такий запис як неканонічний (warning + `session.notes`, contract-тест над новими архівами падає). Текст після `—` MUST NOT записуватись у `session.role`, MUST NOT записуватись у `pending.role` і MUST NOT потрапляти в `phases.*.agents`. `handoff.md` MAY лишати повне речення Closed role. `metricsRecordSessionStart` SHALL пропускати роль через ту саму `canonicalRole`, що й persist.

`phaseForRole` SHALL визначати фазу з канонічного токена: `Explorer`→`explore`, `Architect` / propose→`spec`, `Spec Reviewer` / review→`review`, `Implementer` / apply→`apply`, `Design Intake` / design→`design`, `Archiver`→`archive`, інакше `other`. Перевірка Architect / propose MUST виконуватись **до** перевірки review, щоб рядок `Architect — … ready for Spec Reviewer` давав `spec`, не `review`.

#### Scenario: Речення Architect не стає фазою review

- **GIVEN** persist читає Closed role `Architect — propose complete, ready for Spec Reviewer`
- **WHEN** записується сесія
- **THEN** `sessions[0].role` дорівнює `Architect`
- **AND** `sessions[0].phase` дорівнює `spec`
- **AND** `phases.spec.agents` містить `Architect` і не містить повного речення
- **AND** `phases.review` не отримує цю сесію

#### Scenario: Archiver з поясненням лишається Archiver

- **GIVEN** Closed role `Archiver — blocked on leftover`
- **WHEN** записується сесія archive
- **THEN** `session.role` дорівнює `Archiver`
- **AND** `session.phase` дорівнює `archive`

#### Scenario: Restore пише pending.role як Archiver

- **GIVEN** next role або Closed role на restore є `Archiver — deferred until the CI-green…`
- **WHEN** виконується `handoff --restore`
- **THEN** `pending.role` дорівнює `Archiver`
- **AND** `pending.role` не містить тексту після `—`

#### Scenario: Spec Architect канонізується в Architect

- **GIVEN** Closed role `Spec Architect — propose complete, ready for Spec Reviewer`
- **WHEN** записується сесія
- **THEN** `session.role` дорівнює `Architect`
- **AND** `session.phase` дорівнює `spec`
- **AND** stderr не містить `metrics: warning: role`

#### Scenario: Conductor лишається неканонічним і помічається

- **GIVEN** Closed role `Conductor`
- **WHEN** записується сесія
- **THEN** `session.role` дорівнює `Conductor`
- **AND** stderr містить `metrics: warning: role "Conductor" is not a canonical Closed role token`
- **AND** `session.notes` містить цей рядок, exit code дорівнює 0
