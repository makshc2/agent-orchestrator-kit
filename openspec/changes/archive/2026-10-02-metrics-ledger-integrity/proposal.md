## Why

Леджер `metrics.json` сьогодні не можна використати для рішень про вартість і маршрутизацію моделей: у 9 архівних файлах kit-а 40 із 61 сесій не мають токенів, 31 із них при цьому заявляє `spendSource: "adapter"`; 11 рядків зберігають неканонічну роль (`Spec Architect`, `Conductor`, `Code Reviewer` і речення з `—`) попри CHANGELOG 0.11.0; один рядок має `durationMs` 1643,5 год зі `startedAt` 2026-07-01 (до появи репозиторію) і був записаний першим коммітом файла; жоден рядок не має `cacheRead*`-ключа, хоча адаптери їх уже парсять; `runCollectSpend` повертає `notes` адаптерів, які ніхто не друкує, і ковтає їхні винятки у `notes: []`; `grep -i 'sanity\|implausib\|clamp' bin/ test/` порожній. `costUsdTotal` має 15 входжень у `bin/` і 0 у `openspec/specs/`. Estimator для `claude-opus-5-5` бере ставки Opus 5 через префікс `claude-opus` (на 25 % дорожче за реальні), а fallback невідомої моделі рахує cache-read за повні $3/M. 7 із 9 dogfood-змін із metrics.json були лагодженням самої метрики (~48 сесій, ~$95) — зіпсований леджер їде мовчки й коштує окремого fix-release кожного разу.

Design: none

## What Changes

- **A. Експортовані інваріанти леджера.** `bin/agent-orchestrator.js` отримує `metricsSessionInvariantIssues(session, metrics)` і `metricsLedgerInvariantIssues(metrics)`: `version` = 2, `session.role` ∈ канонічні токени, `durationMs` ≤ 24 год, `startedAt` ≥ `createdAt − 12 год` (не −120 с: перша Architect-сесія у 3 із 9 архівів легітимно стартує до створення каталогу change-у), `endedAt` ≤ `archivedAt`, `spendSource: "adapter"` ⇒ `sourceIds.length > 0` або токени не `null`, `costUsdTotal = round4(costUsd ?? costUsdEstimated)` на сесії і `spend.costUsdTotal = round4(Σ)` — та сама арифметика `addNullable` / `roundUsd4`, що в `recomputeMetricsAggregates`.
- **B. Попередження на запис, fail-open.** `metricsRecordSessionEnd` і `metricsFinalizeArchive` проганяють ту саму функцію: порушення друкуються в stderr як `metrics: warning: …` і зберігаються в `session.notes[]`; сирі значення не клампляться, exit code не змінюється, запис у `archive/` не блокується.
- **C. Notes адаптерів видно.** `runCollectSpend` друкує кожен `collected.notes[]` у stderr як `metrics: <note>` (stdout persist лишається prompt-only); виняток `collectSpend` більше не ковтається в `notes: []`, а стає нотаткою `collect: adapters failed: <message>`. Відсутній `cursor-usage.jsonl` → `metrics: cursor: usage file missing …` у stderr.
- **D. Cache-колонки.** Нові nullable ключі `cacheReadTokens` / `cacheCreationTokens` на сесії, `byModel`, `phases.*`, `spend`, `spendByPlatform.*`, `spendByModel[]` — з source-записів (`spend-collect.js` `sourceRecord` отримує `cacheCreationTokens`; Claude передає `cache_creation_input_tokens`, Cursor — `cacheWriteTokens`; Amp — `cacheReadTokens` з `amp threads usage`). Семантика `inputTokens` (cache включено) не змінюється; схема лишається `version: 2`. Зводка `metrics` / `archive` отримує рядок `cache hit: N% (R cache-read of I input tokens)`, коли `spend.cacheReadTokens` не `null`.
- **E. Ставки estimator-а.** `bin/claude-cost-estimate.js`: `claude-opus-5-5` → `{ input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 }`; fallback невідомої моделі рахує cache-read за $0.3/M (0.1× input) замість $3/M; `ratesForModel` експортується.
- **F. canonicalRole.** `Spec Architect` → `Architect` (ім'я субагента kit-а). `Conductor` і `Code Reviewer` не є Closed role жодного шаблону і не стають токенами: вони лишаються сирим рядком, а інваріант (A/B) позначає їх як неканонічні.
- **G. Мертвий конфіг.** `roles.*.model_hint` видалено з `templates/orchestrator.yaml` і `profiles/{generic,node,vue3,mvp}/orchestrator.yaml` (0 читань у `bin/`, `test/`, `templates/`).
- **H. Contract-тест.** Новий `test/metrics-ledger-integrity.test.js`: для кожного `openspec/changes/archive/*/metrics.json` із `createdAt ≥ KIT_METRICS_CONTRACT_SINCE` (`2026-09-25`) — `metricsLedgerInvariantIssues` порожній; старіші архіви виключаються за датою і не переписуються.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `change-metrics`: нові вимоги для `costUsdTotal`, cache-ключів, інваріантів-попереджень, contract-тесту, друку notes, рядка cache hit і ставок Opus 5.5; MODIFIED «Канонічна Closed role у metrics.json» (alias `Spec Architect`, рішення щодо `Conductor` / `Code Reviewer`).
- `design-intake`: MODIFIED «Роль design_intake у конфігурації» — без `model_hint: strong`.

## Impact

- `bin/agent-orchestrator.js` — константи `METRICS_CACHE_KEYS`, `METRICS_MAX_SESSION_MS`, `METRICS_START_BEFORE_CREATED_MS`; `emptySpendTotals` / `emptyPlatformSpend` / `compactModelRows` / `mergeModelRows` / `sessionTotalsFromModels` / `sessionTotalsFromSources` / `ampThreadTotals` / `resolveSessionSpend` / `applyCollectedSessionFields` / `resyncLeftoverSessionSpend` / `spendTuple` / `addSpendNums` / `recomputeSpendMaps` — cache-ключі; `CANONICAL_ROLE_TOKENS`, `isCanonicalRole`, `canonicalRole`; `metricsSessionInvariantIssues`, `metricsLedgerInvariantIssues`, `warnMetricsIssues`, `annotateSessionInvariants`; `printCollectNotes` / `runCollectSpend`; `metricsRecordSessionEnd`, `metricsFinalizeArchive`; `formatCacheHitLine` / `renderMetricsSummary`; експорти.
- `bin/spend-collect.js` — `sourceRecord({ cacheCreationTokens })`, Claude і Cursor передають його.
- `bin/claude-cost-estimate.js` — рядок `claude-opus-5-5`, `FALLBACK_RATES`, `export ratesForModel`.
- `templates/orchestrator.yaml`, `profiles/*/orchestrator.yaml` — без `model_hint`.
- Новий `test/metrics-ledger-integrity.test.js`; `test/smoke.test.js` не змінюється.
- `README.md` і `CHANGELOG.md` не змінюються в цьому change (docs pass після merge): README рядок 586 ще показує `model_hint: strong`, таблиця ставок у CHANGELOG — для docs pass.
- Без **BREAKING**: схема v2, `inputTokens`, dedup-ключі Cursor, Amp Cost-once-per-thread, conversationId-first атрибуція і запис у `changes/archive/` не змінюються.

## Non-goals

- Не міняти семантику `inputTokens` (cache включено) — spec «Три read-only адаптери», Cursor-семантика і `cursorSpendFingerprint`.
- Не блокувати запис під `openspec/changes/archive/`: `metricsBackfillFile`, `metrics --migrate` і `cursor-spend-collect.cjs` `backfillRoot` пишуть туди за дизайном.
- Не переходити на schema v3; нові ключі адитивні й nullable, `normalizeMetricsV2` їх терпить.
- Не переписувати історичні архіви (рішення 2026-08-29 «historical archives are not migrated»): contract-тест виключає їх за `createdAt`.
- Не робити persist / archive / gate-check non-zero через інваріанти (spec «Persist і archive не падають лише через відсутні model або spend»).
- Amp per-session delta через snapshot `amp threads usage` на restore — окремий change зі своєю дельтою (змінює Cost-once-per-thread).
- Не міняти `scripts/cursor-spend-collect.cjs` / `templates/scripts/cursor-spend-collect.cjs` (byte-identical копії; cache-ключі для рядків, які пише hook-скрипт, лишаються `null`).
- Не чіпати `README.md`, `CHANGELOG.md`, `package.json`.

## Acceptance criteria

1. **Інваріанти експортовано.** `node -e "import('./bin/agent-orchestrator.js').then(m=>console.log(typeof m.metricsSessionInvariantIssues, typeof m.metricsLedgerInvariantIssues))"` друкує `function function`; синтетична сесія з роллю `Conductor`, `durationMs` 25 год, `startedAt` на день раніше `createdAt`, `endedAt` після `archivedAt`, `spendSource: "adapter"` без `sourceIds` і токенів та `costUsdTotal` ≠ `round4(costUsd ?? costUsdEstimated)` дає рівно 6 issues.
2. **Fail-open попередження.** `handoff <name> --started-at <10 днів тому>` завершується з exit 0, stderr містить `metrics: warning: durationMs … exceeds 24h` і `metrics: warning: startedAt … is more than 12h before createdAt`, `sessions[last].notes` має ці два рядки, `startedAt` збережено сирим; stdout містить лише prompt.
3. **Notes у stderr.** Persist на клієнті cursor без `.agents/spend/cursor-usage.jsonl` друкує `metrics: cursor: usage file missing` у stderr і не друкує його в stdout.
4. **Cache-колонки.** Persist `--collect` з Claude jsonl `input_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 100` дає `session.inputTokens` 1000, `cacheReadTokens` 800 і `cacheCreationTokens` 100 на сесії, `byModel[0]`, `phases.spec`, `spend`, `spendByPlatform.claude`, `spendByModel[0]`; `metrics <name>` друкує `cache hit: 80.0% (800 cache-read of 1000 input tokens)`; `version` лишається 2.
5. **Ставки.** `ratesForModel('claude-opus-5-5')` дорівнює `{ input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 }`; `estimateClaudeCostUsd({ model: 'gpt-6-astra', cacheReadTokens: 1000000 })` дорівнює `0.3`; наявний тест `estimateClaudeCostUsd({ model: 'gpt-6-astra', inputTokens: 1000000, outputTokens: 10000 }) === 3.15` лишається зеленим.
6. **Ролі.** `canonicalRole('Spec Architect — propose complete')` дорівнює `Architect`; `canonicalRole('Conductor')` дорівнює `Conductor`, а `isCanonicalRole('Conductor')` — `false`.
7. **Contract-тест.** `node --test test/metrics-ledger-integrity.test.js` зелений; кожен архів із `createdAt ≥ 2026-09-25` (зараз `2026-09-25-propose-review-pregate`) має 0 issues; архів `2026-09-07-fix-metrics-dedup-window-compact-schema` не переписаний (git diff порожній для `openspec/changes/archive/`).
8. **Конфіг.** `grep -rn model_hint templates/orchestrator.yaml profiles/*/orchestrator.yaml` порожній; роль `design_intake` з `command: /opsx:design` і `mode: brief-only` лишається в усіх п'яти файлах.
9. **Регресії.** `npm test` зелений, крім відомого падіння `sync-local-agent-skills.sh` через відсутній `rsync` у контейнері; `npx openspec validate metrics-ledger-integrity --strict --type change` і `gate-check --review metrics-ledger-integrity` дають exit 0.
