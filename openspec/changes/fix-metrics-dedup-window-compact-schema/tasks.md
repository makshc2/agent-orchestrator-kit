## 1. Схема сесії v2 і міграція

- [x] 1.1 Нормалізація v1 → v2 при читанні
      Files: bin/agent-orchestrator.js
      Do: у `loadMetricsFile` / default-merge додати `normalizeMetricsV2(metrics)`: для кожної сесії з масивом `sources` побудувати `sourceIds` (унікальні `id`), `sourceTotals` (`id → totalTokens`, max при повторі), `byModel` (агрегат за `platform`+`model`: inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated (r4), optional `costSource` зі значень `api-estimate` | `api-estimate-fallback` | `amp-usage` | absent), детерміновано зберігаючи provenance і не вигадуючи billed Cost; видалити ключ `sources`. Для сесій без `sources` виставити `sourceIds: []`, `sourceTotals: {}`, `byModel: []`. `metrics.version = 2`; schema conversion не змінює жодне наявне session numeric field або top-level `spend`/`totals`/`spendByPlatform`/`spendByModel`/`phases` і не запускає numeric backfill/recompute. `saveMetricsFile` завжди пише v2 для наступних реальних writes. Експортувати `normalizeMetricsV2`.
      Done-when: internally consistent legacy-v1 fixture з 4 records / 2 models дає `version === 2`, `sourceIds.length === 4`, `byModel.length === 2`, допустимий/відсутній `costSource` на кожному bucket і без вигаданого `costUsd`, `'sources' in sessions[0] === false`; deep-equality snapshots усіх session numeric fields та top-level `spend`, `totals`, `spendByPlatform`, `spendByModel`, `phases` до/після normalization однакові

- [x] 1.2 Агрегати з byModel
      Files: bin/agent-orchestrator.js
      Do: переписати `recomputeSpendMaps` / `recomputeMetricsAggregates`: `spend`, `spendByPlatform[session.platform]`, `phases[phase]` беруть session-level `inputTokens`/`outputTokens`/`totalTokens`/`costUsd`/`costUsdEstimated`/`ampCredits` (`addNullable`, estimate через `roundUsd4`); `spendByModel` будується з `session.byModel` (ключ `platform|model`, costUsd і costUsdEstimated з рядків), а коли `byModel` порожній — з session-level полів під `session.model`; `phases.*.models` = унікальні `model` з `session.model` ∪ `session.models`; `source` бакета платформи = `cursor-hook` / `claude-jsonl` / `amp-cli` коли є хоч одна сесія з непорожнім `sourceIds` цієї платформи, інакше `none`. Видалити всі читання `session.sources`.
      Done-when: `grep -n "\.sources" bin/agent-orchestrator.js` не містить читань у recompute-функціях; тест «Карти з byModel, Cost один раз» (спека) проходить: `spendByModel` 2 рядки з costUsd 3.10/0.87, `spend.costUsd === 3.96`, `spendByPlatform.amp.inputTokens === 1320187`

- [x] 1.3 Collect повертає компакт і session запис без sources
      Files: bin/spend-collect.js, bin/agent-orchestrator.js
      Do: `collectSpend` додатково повертає `{ ids: string[], totals: { [id]: totalTokens }, byModel: [...] }` (обчислені з внутрішнього масиву подій через `aggregate`), приймає `existingSourceTotals` для Cursor upgrade. `applyCollectedSessionFields` пише `session.sourceIds`, `session.sourceTotals`, `session.byModel` замість `session.sources`; `uniqueSourceModels` працює над `byModel`, а primary-model resolver приймає transient export records окремо від persisted `byModel`, щоб зберегти chat product id і не вибрати usage display/helper row. `existingSourceIdSet` / `existingSourceRecords` читають `sourceIds`/`sourceTotals`. Leftover (`attachLeftoverSources`) мержить ids/totals/byModel (сума токенів, r4 estimate) і викликає той самий resync.
      Done-when: persist з Cursor фікстурою (2 id) дає `sessions[0].sourceIds.length === 2`, `sessions[0].byModel[0].totalTokens` = сума, ключа `sources` немає; leftover з рядком відомого id і більшим `totalTokens` оновлює `sourceTotals[id]` і session totals без дубля в `sourceIds`

- [x] 1.4 Перевести всі operational readers на v2
      Files: bin/agent-orchestrator.js
      Do: перевести `sessionFieldOrSources`, `leftoverAmpThreadId`, `uniqueAmpSourceThreadPrefix`, `sessionAmpThreadKeys`, `sessionTotalsLookOverridden`, `metricsBackfillFile`, earliest-loop у `metricsRecordSessionEnd` і `metricsFinalizeArchive` з persisted `session.sources`: thread-prefix читати з `sourceIds`, totals — із session-level полів / `byModel`; legacy `sources` дозволити лише всередині `normalizeMetricsV2`, transient collector records не вважати persisted schema.
      Done-when: `grep -n "\.sources\\b" bin/agent-orchestrator.js` показує лише ізольовану v1-normalization або transient collector обробку; compact fixtures відновлюють Amp `T-*` із `sourceIds`, usageModels мають thread keys, backfill/finalize не читають persisted event arrays

- [x] 1.5 metrics --migrate і читання v1 без запису
      Files: bin/agent-orchestrator.js, README.md
      Do: `metrics <name> [--json]` читає v1/v2 через `normalizeMetricsV2` без запису на диск; додати прапорець `--migrate`, який після normalization одразу викликає `saveMetricsFile` без `recomputeMetricsAggregates` або numeric backfill (active і archive шляхи через `resolveMetricsFile`). Описати в README «Change metrics» (схема v2, `--migrate`, **BREAKING** для читачів `sessions[].sources`). Звичайний recompute лишається для подальших реальних writes, не для schema-only migration.
      Done-when: `metrics x --json` і human rendering на v1-архіві повертають/показують normalized v2 та не змінюють файл на диску; `metrics x --migrate` переписує лише schema і deep-equality assertions підтверджують збереження всіх session numeric fields та top-level `spend`, `totals`, `spendByPlatform`, `spendByModel`, `phases`; README містить `--migrate`

- [x] 1.6 Hook/collect .cjs на v2
      Files: scripts/cursor-spend-collect.cjs, scripts/cursor-spend-hook.cjs, templates/scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-hook.cjs
      Do: продублювати `normalizeMetricsV2` (без імпорту з ESM) у collect-скрипті; `incomingCursorSources`, dedup і `recompute` працюють з `sourceIds`/`sourceTotals`/`byModel`; запис завжди v2; `metricsHasConversationThread` без змін. Скопіювати у templates байт-у-байт.
      Done-when: `cmp scripts/cursor-spend-collect.cjs templates/scripts/cursor-spend-collect.cjs` і `cmp` для hook порожні; sessionEnd на v1 archive-файлі з рядком у leftover-вікні пише v2 з цим id у `sourceIds` останньої сесії

## 2. Вікно persist без pending і Amp без listRecent

- [x] 2.1 Нижня межа persist завжди існує
      Files: bin/agent-orchestrator.js
      Do: для нової сесії у `metricsRecordSessionEnd` і `metricsFinalizeArchive` обчислити `startedAt = --started-at || pending.startedAt || last.endedAt || metrics.createdAt`; її `windowStart = (startedAt взято з --started-at || pending.startedAt) ? startedAt − 120000 : startedAt` — grace залежить від походження start, а не від наявності pending: явний `--started-at` перемагає pending і сам задає grace anchor навіть без pending; `last.endedAt` / `metrics.createdAt` — без grace. `metricsPrepareArchiveStart` лише фіксує pending, а grace-вікно Archiver належить `metricsFinalizeArchive`; `collectWindowStart` MUST NOT повертати `null`; earliest подія більше не впливає на `startedAt`. Якщо для нової persist-сесії не було ні pending, ні `--started-at` — warning. Окремо, `metricsBackfillFile` MUST лишатись attach до вже наявної останньої сесії без append і без переписування її `startedAt`/`endedAt`: regular `metrics --collect` використовує вікно цієї last session від `last.startedAt || last.endedAt || metrics.createdAt` до now. Dedup в обох шляхах читає compact `sourceIds` усіх сесій; backfill читає/мержить `sourceIds`, `sourceTotals` і `byModel`, не persisted `sources`.
      Done-when: persist без pending на файлі з 6 сесіями (остання `endedAt` T) і Amp фікстурою з 74 старими тредами → `sessions[6].startedAt === T`, а membership assertions за timestamps transient fixture events підтверджують, що жоден event з `at < T` не представлений у `sourceIds`; stderr містить `persist without restore`, exit 0. Grace fixture задає попередню сесію з `endedAt` E, `platform: cursor`, `threadId: conv-old`, наступний `pending.startedAt` P = E + 10m з `platform: cursor`, `threadId: conv-new`, і Cursor-event id `grace-new`, `conversationId: conv-new`, на P − 40s, відсутній у всіх попередніх `sourceIds`; event строго пізніше E + 120s, входить у поточний grace і потрапляє в нову сесію. Окремий тест `metrics --collect` на файлі з однією last session підтверджує: `sessions.length` не змінюється, початкові `last.startedAt`/`last.endedAt` лишаються byte-for-byte рівними, подія в `[last.startedAt, now]` додається до compact `sourceIds`/`sourceTotals`/`byModel`, а подія до `last.startedAt` не додається

- [x] 2.2 Amp persist без listRecent і без сканування threads без id
      Files: bin/spend-collect.js, bin/agent-orchestrator.js
      Do: `collectAmpCli`: `listRecentAmpThreadIds` викликати лише коли `ctx.listRecentAmpThreads === true` (persist/archive передають `false`; `metrics --collect` і `--collect` теж `false`; лише `detectSessionClient` лишається з listRecent). `collectAmp` (локальні файли): якщо `ctx.ampThreadId` порожній і `ctx.collectAll !== true` — повернути `[]` з note `amp: skipped local threads without thread id`; з `ampThreadId` читати лише файл(и) цього id. `ampThreadTotals`: Cost треда додається лише якщо `thread.id` не є `threadId` жодної попередньої сесії (передати `existingThreadIds`).
      Done-when: persist з `## Metrics platform: amp`, без `AMP_*`/pending/`--amp-thread` і з matching локальними тредами → `sourceIds` порожній, stderr містить `skipped local threads`, `listAmpThreads` не викликаний; persist з `pending.threadId T-a` після сесії з `threadId T-a` і Cost 2.85 → `spend.costUsd` не отримує 2.85 вдруге

## 3. Claude адаптер: dedup, subagents, cwd, estimate

- [x] 3.1 Dedup за message.id, subagent-файли, prefix cwd
      Files: bin/spend-collect.js
      Do: у `collectClaude` зібрати файли: `readdirSync(projectDir)` `*.jsonl` + для кожного підкаталогу `<dir>/subagents/*.jsonl` + `agent-*.jsonl`; cwd-перевірка `row.cwd === cwd || row.cwd.startsWith(cwd + sep)`; `bestById` за `message.id` (лишити max `inputTokens + outputTokens`, `at` — найраніший); лише після циклу перетворити в події.
      Done-when: фікстура з 15 рядками на 6 id → 6 подій і `inputTokens 359148`; фікстура `<sid>/subagents/agent-a.jsonl` (15 msg) + батько (10 msg) → 25 id; рядок `cwd = <cwd>/openspec/changes/x` входить, `/other/project` — ні

- [x] 3.2 Модуль claude-cost-estimate і estimate для Amp без Cost
      Files: new file: bin/claude-cost-estimate.js, bin/spend-collect.js, bin/agent-orchestrator.js
      Do: створити `bin/claude-cost-estimate.js` за зразком `bin/cursor-cost-estimate.js` з таблицею `{ 'claude-fable-5': {input 10, cacheRead 0.25, cacheWrite 12.5, output 50}, 'claude-opus': {5, 0.5, 6.25, 25}, 'claude-sonnet-5': {2, 0.2, 2.5, 10}, 'claude-sonnet-4-6': {3, 0.3, 3.75, 15}, 'claude-haiku-4-5': {1, 0.1, 1.25, 5} }` (USD за MTok, match за найдовшим префіксом model id), `estimateClaudeCostUsd({ model, inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens })` → `{ usd (r4), costSource: 'api-estimate' }`, невідома модель → fallback $3/$15 без cache-split, `costSource: 'api-estimate-fallback'`. `collectClaude` рахує per message з реальним cache-split і кладе в подію `costUsdEstimated`; `byModel` сумує. Amp: у `applyCollectedSessionFields`, якщо `session.costUsd == null`, порахувати `costUsdEstimated` для кожного рядка `byModel` тією ж функцією (нормалізувати `Claude Opus 5` → `claude-opus-5`, інакше fallback) і в session; за наявності Cost estimate лишити `null`.
      Done-when: `estimateClaudeCostUsd({ model: 'claude-opus-5', inputTokens: 100000, cacheReadTokens: 900000, cacheCreationTokens: 0, outputTokens: 10000 }).usd === 1.2`; Claude persist-фікстура дає `session.costUsdEstimated === 1.2`, `costUsd === null`; Amp без Cost `gpt-6-astra` 1M/10k → `3.15` і `api-estimate-fallback`; Amp з `Cost: $3.96` → `costUsdEstimated === null`

## 4. Thread id, leftover cap, Amp usage totals, свіжий Cost

- [x] 4.1 Cursor threadId з env на persist без pending
      Files: bin/agent-orchestrator.js
      Do: у `metricsRecordSessionEnd` після резолву `platform`: якщо `platform === 'cursor'` і `pending.threadId` порожній — `session.threadId = trim(process.env.CURSOR_CONVERSATION_ID) || null`; передати той самий id у `cursorConversationId` collect.
      Done-when: persist без pending з `CURSOR_CONVERSATION_ID=c39e1057` → `sessions[0].threadId === 'c39e1057'`, `sourceIds` лише рядки цього conversationId

- [x] 4.2 Leftover cap 120s для threadId null
      Files: bin/agent-orchestrator.js, scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
      Do: у всіх місцях обчислення `leftoverEnd` (persist, archive start, sessionEnd/hook leftover): `leftoverEnd = last.threadId ? (pending.startedAt || grace) : min(pending.startedAt || +∞, last.endedAt + 120000)`; `exclusiveEnd` лишається для pending-межі. Скопіювати у templates.
      Done-when: Claude-сесія `threadId: null`, `endedAt` E, next pending E+17m, рядки E+30s і E+6m → перший у `sourceIds`, другий ні; Cursor-сесія з `threadId X` і pending E+17m → обидва рядки `conversationId X` причеплено

- [x] 4.3 Amp usage totals, модель чату, свіжий Cost на leftover
      Files: bin/spend-collect.js, bin/agent-orchestrator.js
      Do: `parseAmpUsageDetails` додатково повертає usage totals і Models. У `resolveSessionSpend` для Amp usage totals перемагають export-суму, `byModel` = Models, а `session.model` = chat model з export. У `resyncLeftoverSessionSpend` / `attachLeftoverSources`: якщо свіжий usage має totals — session totals = usage totals і `byModel` = свіжа Models table; лише без usage totals використовувати суму transient export events. Свіжий числовий Cost перемагає `priorCost`, інакше prior зберігається.
      Done-when: usage `1,320,187` input + export `355,976` дає `session.inputTokens === 1320187`; leftover зі свіжими usage totals лишає `1320187`, замінює `byModel` свіжою Models table і оновлює Cost `1.91` → `2.51`; без usage totals fallback дорівнює сумі events

## 5. Spawn name і правило Session Exit

- [x] 5.1 firstSpawnName без вільного тексту
      Files: bin/agent-orchestrator.js
      Do: `firstSpawnName(value, role)`: backtick-токен `[a-z0-9-]+` → його; інакше карта `canonicalRole(value)`: Explorer→`explorer`, Architect→`spec-architect`, Spec Reviewer→`spec-reviewer`, Implementer/Archiver→`''`; регулярку по першому слову видалити. У `buildNextSessionPrompt` порожнє ім'я → `<phase-specialist>` (уже є).
      Done-when: `firstSpawnName('Implementer — відновити verification після усунення baseline lint') === ''`; `firstSpawnName('Architect (spawn `spec-architect`)') === 'spec-architect'`; `firstSpawnName('Spec Reviewer') === 'spec-reviewer'`; промпт не містить `subagent-baseline`

- [x] 5.2 Текст правила session-handoff.mdc
      Files: .agents/rules/session-handoff.mdc, templates/.agents/rules/session-handoff.mdc, templates/.agents/skills/agent-orchestration/SKILL.md, templates/.agents/subagents/session-handoff.md, templates/.agents/subagents/spec-archiver.md
      Do: додати однакові семантичні речення в компактне kit-правило та канонічний template, не копіюючи kit поверх template: platform/model required, `--no-metrics`, no repeated persist, CLI-only decisions, stop/new chat. Зберегти canonical template-перевірки `git-tracked`, `Runtime`, `cloud-check`; стисло прибрати дубльований prose, щоб сума template rules з `alwaysApply: true` була < 12000 символів (поточна baseline 11607). У трьох точних mirrors внести лише відповідні role-specific protocol amendments: orchestration skill і session-handoff mirror повторюють handoff semantics, spec-archiver — ті самі stop/metrics/CLI-only semantics для archive; не копіювати повні rules і не розширювати інший scope.
      Done-when: обидва rules і три перелічені mirrors не суперечать новим semantics; canonical template досі проходить assertions `git-tracked` / `Runtime` / `cloud-check`; сумарний budget template `alwaysApply` < 12000 символів; byte identity між навмисно різними kit rule та canonical template не вимагається

## 6. Тести, документація, реліз

- [x] 6.1 Фікстури і тести з live-даних
      Files: test/spend-collect.test.js, test/smoke.test.js, test/metrics-readable.test.js
      Do: додати тести на всі 13 acceptance-критеріїв proposal; явно переписати smoke test `persist without pending uses earliest source.at as startedAt...` під `last.endedAt || createdAt` і всі приблизно 95 assertions/fixtures у `test/`, що трактують persisted `sessions[].sources` як event arrays, під `sourceIds` / `sourceTotals` / `byModel`; `sources` лишити лише в explicit legacy-v1 migration fixtures або transient collector results. Покрити usage-total leftover resync і compact readers із 1.4.
      Done-when: `npm test` зелений; у тестах є асерти `sourceIds.length === 6`, `inputTokens === 359148`, `costUsdEstimated === 1.2`, `startedAt === T` для persist без pending, `firstSpawnName(...) === ''`

- [x] 6.2 README, CHANGELOG, версія
      Files: README.md, CHANGELOG.md, package.json, package-lock.json
      Do: README «Change metrics»: схема v2 (`sourceIds`, `sourceTotals`, `byModel`), `--migrate`, вікно без pending = `last.endedAt`, leftover cap 120s без thread id, Claude/Amp estimate таблиця і її версія; CHANGELOG `[Unreleased]` → `0.14.0` з **BREAKING** (немає `sessions[].sources`); синхронно оновити version у `package.json` та `package-lock.json` до `0.14.0`; оновити рядок «Already have the kit installed? Upgrade…» у README.
      Done-when: `grep -c 'sourceIds' README.md` ≥ 1; CHANGELOG містить `0.14.0` і `BREAKING`; `node -e "console.log(require('./package.json').version)"` друкує `0.14.0`; lockfile root version дорівнює `0.14.0`; `npm test` і `npm run release:check` exit 0

- [x] 6.3 metrics --summary-json і розділ «Для дашбордів»
      Files: bin/agent-orchestrator.js, README.md, test/metrics-readable.test.js
      Do: додати прапорець `--summary-json` до команди `metrics`: після нормалізації v2 і `recomputeMetricsAggregates` друкувати `JSON.stringify({ version, change, createdAt, archivedAt, totals, phases, spend, spendByPlatform, spendByModel }, null, 2)` без `sessions`/`pending`; ключа `commits` ніде не додавати. У README «Change metrics» додати розділ «Для дашбордів» (межі/тривалість фази лише з `phases.<phase>`, `totals.leadTimeMs` лише для підсумку, git log не використовувати, приклад виклику `--summary-json`). Тест: фікстура з spec/review різними межами → різні `startedAt`, `durationMs` 539356/459267, немає `sessions` і `commits`.
      Done-when: `npx agent-orchestrator-kit metrics <name> --summary-json | node -e "const j=JSON.parse(require('fs').readFileSync(0));console.log('sessions' in j, JSON.stringify(j).includes('commits'))"` друкує `false false`; README містить «Для дашбордів»
