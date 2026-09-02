## 1. sessionEnd leftover: conversationId і export entry

- [x] 1.1 Фільтр conversationId у incomingCursorSources
  Files: scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
  Do: у `incomingCursorSources` додати аргумент `filterConversationId`. Коли `String(filterConversationId || '').trim()` непорожній — `continue` для рядка, де `row.conversationId` відсутній, порожній або не дорівнює filter (точний trim-збіг). У `backfillMetricsFile` передавати `last.threadId` як filter. Коли `last.threadId` є `null` або `''` — не фільтрувати за conversationId (time-only). Не змінювати вікно leftover (`leftoverWindowEnd` / `leftoverEndExclusive`). Скопіювати `scripts/cursor-spend-collect.cjs` у `templates/scripts/cursor-spend-collect.cjs` так, щоб `cmp` не бачив різниці.
  Done-when: leftover з `last.threadId === 'A'` і jsonl рядками `conversationId: A` / `B` додає лише рядок A; з `last.threadId === null` обидва рядки у вікні входять

- [x] 1.2 Collect експортує leftover-entry без stdin на require
  Files: scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
  Do: винести поточний `main(raw)` у функцію, яку можна викликати з об'єкта або JSON-рядка payload. Додати `module.exports` з цією функцією (ім'я `main` або `backfillLeftover`). Блок `process.stdin` / `isTTY` виконувати лише коли `require.main === module`. `require('./cursor-spend-collect.cjs')` з іншого CJS MUST NOT підписувати stdin і MUST NOT викликати leftover на load. Після змін знову скопіювати файл у `templates/scripts/cursor-spend-collect.cjs` (`cmp` порожній).
  Done-when: `node -e "require('./scripts/cursor-spend-collect.cjs'); console.log('ok')"` друкує `ok` і завершується без читання stdin; `require.main === module` шлях як і раніше обробляє stdin/`isTTY`

## 2. Multi-root resolve і leftover по всіх кандидатах

- [x] 2.1 Спільний ranking resolveBaseDir
  Files: scripts/cursor-spend-collect.cjs, scripts/cursor-spend-hook.cjs, templates/scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-hook.cjs
  Do: замінити чинний `resolveBaseDir` (перший cwd з `.agents` у hook; перший cwd з `openspec/changes` у collect) на спільну семантику. Кандидати = унікальні існуючі абсолютні шляхи з `process.cwd()` і `payload.workspace_roots`. Для **запису** jsonl обрати один корінь: (1) active або newest-archive `metrics.json` з `pending.threadId` або `sessions[last].threadId` === непорожній `conversation_id`; (2) інакше корінь з active `openspec/changes/<name>/` (не лише `archive/`); (3) інакше корінь, у чиєму `.agents/spend/cursor-usage.jsonl` уже є цей `conversationId`; (4) інакше cwd, якщо він кандидат і має `openspec/changes` або `.agents`; (5) інакше перший шлях після стабільного сортування. MUST NOT повертати «перший `.agents`» / «перший `openspec`». Реалізувати ranking один раз у collect і викликати з hook через `require('./cursor-spend-collect.cjs')` **або** скопіювати ту саму функцію байт-в-байт в обидва скрипти; після змін `cmp` scripts↔templates для обох пар.
  Done-when: payload з `conversation_id` що збігається з `last.threadId` consumer і `workspace_roots: [kit, consumer]`, `cwd=kit` дає write-root = consumer, не kit

- [x] 2.2 Collect leftover по кожному кандидату з openspec/changes
  Files: scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
  Do: у `main` / `backfillLeftover` замість одного `resolveBaseDir()` обійти кожен кандидат, у якого існує `openspec/changes`. Для кожного кореня виконати чинний обхід active names + newest archive per name (`backfillChange` / `backfillMetricsFile`), читаючи `<root>/.agents/spend/cursor-usage.jsonl` і пишучи в metrics цього кореня. Помилка одного кореня не зупиняє інші (`try/catch`, fail-open). Скопіювати в templates (`cmp`).
  Done-when: `cwd=kit`, `workspace_roots` містить consumer з archive metrics і jsonl-рядком у leftover-вікні — цей рядок з’являється в `consumer/openspec/changes/archive/*-<name>/metrics.json`

## 3. Hook leftover після append

- [x] 3.1 stop / afterAgentResponse викликають leftover після append
  Files: scripts/cursor-spend-hook.cjs, templates/scripts/cursor-spend-hook.cjs
  Do: після успішного `appendFileSync` рядка для подій `stop` і `afterAgentResponse` викликати експортований leftover з задачі 1.2 (`require` сусіднього `cursor-spend-collect.cjs` і `main`/`backfillLeftover` з тим самим payload-об'єктом, включно з `workspace_roots` і `conversation_id`). Обгорнути в `try/catch`. Не друкувати stdout/stderr. Не викликати leftover, якщо рядок не записано (немає `input_tokens` / `output_tokens`). `subagentStop` без токенів як і раніше виходить до append. Скопіювати hook у `templates/scripts/cursor-spend-hook.cjs` (`cmp`).
  Done-when: запуск hook `stop` з токенами проти репо, де `metrics.json` має останню сесію з matching `threadId` і `sources: []` і `endedAt` у межах 120s, додає `id` і в jsonl, і в `sources` без окремого `sessionEnd`; stdout порожній; exit 0

## 4. Округлення estimate і persist leftover без регресії

- [x] 4.1 roundUsd4 на кожному записі агрегатів
  Files: bin/agent-orchestrator.js, scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
  Do: додати `roundUsd4(x)` = `x == null ? null : Math.round(Number(x) * 10000) / 10000`. Після сум у `recomputeMetricsAggregates` застосувати до `spend.costUsdEstimated` і кожного `phases.*.costUsdEstimated`. Після сум у `recomputeSpendMaps` (кінець функції, не всередині `addNullable`) застосувати до кожного `spendByPlatform.*.costUsdEstimated` і `spendByModel[].costUsdEstimated`. Після `sourceTotals` / `applyCollectedSessionFields` / `syncAdapterSessionTotals` записати session-level `costUsdEstimated` уже округленим. Те саме в `recompute` і `sourceTotals` collect-скрипта. Не змінювати семантику `addNullable` для токенів і `costUsd`. Скопіювати collect у templates (`cmp`).
  Done-when: перерахунок з sources `2.3911 + 2.8153 + 1.355` дає `spend.costUsdEstimated === 6.5614` (суворе `===`, не `6.561400000000001`); `null` лишається `null`

- [x] 4.2 Persist leftover і далі передає last.threadId
  Files: bin/agent-orchestrator.js, bin/spend-collect.js
  Do: не прибирати `cursorConversationId` з `attachLeftoverSources` / `runCollectSpend` / `metricsBackfillLastSession` / archive leftover. Для cursor далі передавати `last.threadId` (або `pending.threadId` на persist поточної). `collectCursor` у `bin/spend-collect.js` лишає чинний filter: непорожній filter id пропускає чужий/порожній `conversationId`. Не додавати HTTP і нові npm-залежності.
  Done-when: `attachLeftoverSources` для `session.platform === 'cursor'` передає `cursorConversationId` з `session.threadId`; існуючі тести `collectSpend` з `CURSOR_CONVERSATION_ID=Y` у `test/spend-collect.test.js` лишаються зеленими

## 5. Тести

- [x] 5.1 Live-order leftover після порожнього archive
  Files: test/smoke.test.js
  Do: залишити чинний тест `sessionEnd leftover after archive attaches hook to archived metrics.json` (jsonl спочатку). Додати окремий тест: `makeArchiveFixture` + `archive` з `CURSOR_AGENT=1` **без** рядків у jsonl на момент finalize; прочитати Archiver `endedAt`; дописати jsonl рядок `id: archive-late-35s` з `at = endedAt + 35000` і `conversationId` = `Archiver.threadId` (або без conversationId, якщо threadId null); запустити `node scripts/cursor-spend-collect.cjs` з cwd фікстури; assert id у `Archiver.sources`, `spendSource === 'adapter'`, `inputTokens` дорівнює сумі sources. `at` MUST бути `<= endedAt + 120000`.
  Done-when: новий тест є в `test/smoke.test.js` і падає на поточному collect без post-empty attach; після імплементації 1–3 проходить

- [x] 5.2 Hook leftover, conversationId hotfix, multi-root, 4 знаки
  Files: test/spend-collect.test.js, test/smoke.test.js
  Do: додати чотири кейси. (1) `execFileSync` `scripts/cursor-spend-hook.cjs` (не лише templates) з payload `stop`, токенами і `conversation_id` = `last.threadId` сесії з `sources: []` у leftover-вікні — id у jsonl і в `sources` без виклику collect; повторний collect не дублює id; stdout порожній. (2) Archiver `threadId: A`, jsonl рядки `conversationId: A` і `B` у leftover-вікні — collect додає лише A. (3) Два tmp-корені (kit cwd з `.agents`+`openspec/changes`, consumer з archive metrics `threadId` = payload `conversation_id` і `workspace_roots` обидва) — hook пише jsonl у consumer, не в kit; collect з cwd=kit оновлює archive consumer. (4) persist або leftover з трьома cursor sources `costUsdEstimated` 2.3911, 2.8153, 1.355 → `spend.costUsdEstimated === 6.5614`.
  Done-when: усі чотири асерти присутні в указаних файлах

## 6. Документація для споживачів

- [x] 6.1 README і CHANGELOG [Unreleased]
  Files: README.md, CHANGELOG.md
  Do: у README секції Change metrics (`sessionEnd` leftover, Cursor `conversationId`, Cursor spend hook) додати: `stop` / `afterAgentResponse` після append запускають leftover; sessionEnd leftover фільтрує `last.threadId`; hook і collect резолвлять consumer у multi-root (не перший `.agents` / `openspec`); collect leftover іде по кожному кандидату з `openspec/changes`; агрегати `costUsdEstimated` пишуться з 4 знаками; `phases.<phase>` має `startedAt` / `endedAt` / `leadTimeMs` з сесій фази, а `durationMs` лишається сумою work time і не клонує `totals.leadTimeMs`. У CHANGELOG `[Unreleased]` додати `### Fixed` з тим самим контрактом (включно з per-phase clock) одним або двома абзацами. Не обіцяти бекфіл архівів, HTTP, Cursor SDK, YouTrack UI або per-phase git commits.
  Done-when: README згадує hook leftover, conversationId на sessionEnd, multi-root, 4 знаки і per-phase `startedAt`/`endedAt`/`leadTimeMs`; `[Unreleased]` містить той самий контракт

## 7. Per-phase wall clock

- [x] 7.1 recompute пише startedAt/endedAt/leadTimeMs фази
  Files: bin/agent-orchestrator.js, scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
  Do: у `recomputeMetricsAggregates` для кожної фази після циклу сесій записати `startedAt` = найраніший валідний `session.startedAt` сесій цієї фази (інакше `null`), `endedAt` = найпізніший валідний `session.endedAt` (інакше `null`), `leadTimeMs` = різниця цих двох у ms коли обидва відомі (інакше `null`). `phase.durationMs` лишити сумою `session.durationMs` (чинний `addNullable`); не ставити `endedAt - startedAt` і не копіювати `totals.leadTimeMs`. `totals.leadTimeMs` / `totals.durationMs` не змінювати за семантикою. Те саме в `recompute` collect-скрипта, щоб leftover rewrite не зрізав нові ключі. У `renderMetricsSummary` колонка time фази лишається `formatMetricsDuration(phase.durationMs)`; якщо друкуєш startedAt/endedAt — брати `phase.startedAt` / `phase.endedAt`, не `totals`. MUST NOT друкувати той самий timestamp/duration для двох фаз з різними session bounds. Скопіювати collect у templates (`cmp`).
  Done-when: після persist двох сесій `spec` (T0–T1, duration 300000) і `review` (T2–T3, duration 120000, T2 > T1) файл має `phases.spec.startedAt === T0`, `phases.review.startedAt === T2`, `phases.spec.durationMs === 300000`, `phases.spec.leadTimeMs === T1-T0`, і `phases.spec.durationMs !== totals.leadTimeMs`

- [x] 7.2 Тест: дві фази не клонують Усього
  Files: test/smoke.test.js
  Do: додати тест з двома сесіями різних фаз (spec і review або spec і apply) з різними `startedAt`/`endedAt`/`durationMs` і розривом між ними. Після persist або прямого `recomputeMetricsAggregates` (якщо експортовано) assert: `phases.spec.startedAt`/`endedAt`/`durationMs` лише зі spec-сесії; `phases.review.*` (або apply) не дорівнюють spec, коли межі різні; жоден `phase.durationMs` не дорівнює `totals.leadTimeMs`; `totals.leadTimeMs` = earliest→latest по всіх сесіях; `phase.leadTimeMs` = endedAt−startedAt цієї фази. Якщо `metrics` без `--json` друкує таблицю фаз — два рядки не мають однакового duration, коли `durationMs` різні.
  Done-when: тест є в `test/smoke.test.js` і падає на поточному `recomputeMetricsAggregates` без `phases.*.startedAt`; після 7.1 проходить
