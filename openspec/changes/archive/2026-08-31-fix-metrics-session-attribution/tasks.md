## 1. Канонічна роль і phaseForRole

- [x] 1.1 Переставити phaseForRole і додати canonicalRole
  Files: bin/agent-orchestrator.js
  Do: у `phaseForRole` перевіряти `/architect|propose/` **до** `/review/`. Додати `canonicalRole(role)` що повертає перший токен з множини `Explorer`, `Architect`, `Spec Reviewer`, `Implementer`, `Archiver`, `Design Intake` (два слова для Spec Reviewer / Design Intake; регістр ігнорується; сегмент до `—` або коми, якщо це токен), інакше обрізаний перший сегмент або порожній рядок. У `metricsRecordSessionEnd` писати `role: canonicalRole(fields.closedRole) || fields.closedRole || ''` і `phase: phaseForRole` від канонічного токена. Додати `canonicalRole` і `phaseForRole` до існуючого `export { formatMetricsCostLine, resolveSessionSpend }` внизу `bin/agent-orchestrator.js`.
  Done-when: `phaseForRole('Architect — propose complete, ready for Spec Reviewer')` повертає `spec`; `canonicalRole` того самого рядка повертає `Architect`; `canonicalRole('Archiver — blocked on leftover')` повертає `Archiver`

## 2. Вікно persist і leftover backfill

- [x] 2.1 Змінити collectWindowStart на pending.startedAt
  Files: bin/agent-orchestrator.js
  Do: `collectWindowStart(metrics, extra)` повертає `extra.startedAt` або `metrics.pending && metrics.pending.startedAt` або `null`. Прибрати використання `lastSessionEndedAt(metrics)` як нижньої межі persist. У `metricsRecordSessionEnd` передавати в `runCollectSpend` `windowStart` = цей `collectWindowStart`, `windowEnd` = `endedAt` сесії. Не ставити `last.endedAt` як start collect нової сесії.
  Done-when: виклик persist для нової сесії з `pending.startedAt` збирає лише події з `at >= pending.startedAt`; подія з `at` між `last.endedAt` і `pending.startedAt` відсутня в новій сесії

- [x] 2.2 Leftover-backfill останньої сесії перед collect поточної
  Files: bin/agent-orchestrator.js
  Do: додати **окрему** helper-функцію leftover останньої **закритої** сесії для persist / archive / `sessionEnd`. Не замінювати вікно `metricsBackfillFile` / `metrics --collect` на leftover-only. Вікно leftover: старт **інклюзивний** на `last.endedAt`; `leftoverEnd` = `metrics.pending.startedAt` якщо pending є (кінець **виключний**: `at < leftoverEnd`), інакше `last.endedAt + 120000` ms (кінець **інклюзивний**: `at <= leftoverEnd`). Dedup за `source.id`. Викликати helper на початку `metricsRecordSessionEnd` **до** `runCollectSpend` поточної сесії. Call-site persist MUST передавати `leftoverEnd` = `pending.startedAt` якщо pending є, інакше `last.endedAt + 120s`. MUST NOT передавати `now` як `leftoverEnd`. `metrics --collect` лишається окремим: attach до останньої сесії з вікном `[last.startedAt, now]` і dedup за `source.id` (рядки між `startedAt` і `endedAt` MUST лишатись). Після leftover-attach і після attach у `metrics --collect` перерахувати totals за правилом задачі 3.1 (не `keepReportedTotals` на placeholder).
  Done-when: persist B з `--collect` не містить hook `id` з `at = endedAt_A + 20s` у `sessions[B].sources`; той самий persist або наступний leftover додає цей `id` у `sessions[A].sources`; `metrics --collect` з рядком `at` між `last.startedAt` і `last.endedAt` додає цей рядок до останньої сесії

## 3. Resync totals і spendSource

- [x] 3.1 Не заморожувати leftover на placeholder self-report
  Files: bin/agent-orchestrator.js
  Do: у `metricsBackfillFile` / leftover прибрати умову `keepReportedTotals`, що спрацьовує на `spendSource === 'self-report'` або будь-який `spendSource !== adapter`. Freeze лише коли є прапорці (`hasSpendOverride`) або `reportedHasSpendNumbers` (хоч одне не-null число). Після merge sources, якщо freeze немає — викликати `applyCollectedSessionFields` або суму всіх sources у session-поля і поставити `spendSource: adapter`. `looksOverridden` MUST NOT сам по собі блокувати resync.
  Done-when: сесія з `spendSource: self-report`, null-числами і sources 954984 + 508064 після leftover має `inputTokens === 1463048` і `spendSource === 'adapter'`

- [x] 3.2 Placeholder spend_source не є override на persist
  Files: bin/agent-orchestrator.js
  Do: у `resolveSessionSpend` не ставити `spendSource` з ключа `## Metrics` `spend_source`, якщо всі числові поля reported є null. Тоді ланцюжок лишається flag → self-report (лише коли `reportedHasSpendNumbers`) → adapter → unreported.
  Done-when: `resolveSessionSpend({}, { spendSource: 'self-report', inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null }, [{ inputTokens: 100, outputTokens: 0, totalTokens: 100 }])` дає `inputTokens === 100` і `spendSource === 'adapter'`

## 4. Модель з adapter product id

- [x] 4.1 Sources з model перемагають --model / ## Metrics / AOK_MODEL
  Files: bin/agent-orchestrator.js
  Do: змінити `applyCollectedSessionFields` так, щоб `session.model` = `primaryModelFromSources(sources)`, коли хоч один source має непорожній `model`; інакше лишити `resolvedModel` з `resolveModel` (`--model` → `## Metrics` → `AOK_MODEL`). Прибрати гілку «якщо session.model уже є — не чіпати». `session.models` = унікальні id з sources, коли їх більше одного.
  Done-when: persist з `--model cursor-grok-4.6` і source `cursor-grok-4.6-low` пише `session.model === 'cursor-grok-4.6-low'`; persist без sources і з `--model cursor-grok-4.6` лишає `cursor-grok-4.6`

## 5. Агрегати лише з sources

- [x] 5.1 recomputeSpendMaps не додає session.model коли sources є
  Files: bin/agent-orchestrator.js
  Do: у `recomputeSpendMaps` якщо `session.sources.length > 0` — додавати в `spendByPlatform` / `spendByModel` лише рядки sources (сума всіх). Не викликати `addModelRow(session.model, ...)` і не додавати `sessionNums` у цьому випадку. Якщо sources порожні — лишити поточну поведінку session-level полів.
  Done-when: сесія з `session.model === 'cursor-grok-4.6'` і одним source `cursor-grok-4.6-low` дає `spendByModel` без ключа `cursor-grok-4.6` і з рядком `cursor-grok-4.6-low`

- [x] 5.2 Phase spend = сума sources, не sessionFieldOrSources
  Files: bin/agent-orchestrator.js
  Do: у `recomputeMetricsAggregates` для ключів `METRICS_SPEND_KEYS` якщо `session.sources.length > 0` додавати в `phase` і `spend` суму відповідних полів усіх sources; якщо sources порожні — брати session-level як зараз. Не викликати `sessionFieldOrSources` для сесії з непорожніми sources (вона віддає заморожене перше число).
  Done-when: сесія apply з session.totalTokens 49412 і sources 49412 + 1052650 дає `phases.apply.totalTokens === 1102062`

## 6. Cursor conversationId

- [x] 6.1 Restore пише CURSOR_CONVERSATION_ID у pending.threadId
  Files: bin/session-client.js
  Do: у `detectSessionClient` для гілки Cursor (`CURSOR_AGENT` або `CURSOR_CONVERSATION_ID`) ставити `threadId: trim(env.CURSOR_CONVERSATION_ID) || null` замість завжди `null`.
  Done-when: `detectSessionClient({ env: { CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'c-1' }, parentComm: 'node' })` має `platform: 'cursor'` і `threadId: 'c-1'`

- [x] 6.2 collectCursor фільтрує за conversationId
  Files: bin/spend-collect.js
  Do: у `collectCursor` прийняти filter id з `ctx.env.CURSOR_CONVERSATION_ID` або `ctx.cursorConversationId` (нове поле `collectSpend` options). Якщо filter id непорожній — `continue` для рядків, де `row.conversationId` не дорівнює filter id (включно з порожнім). Якщо filter id немає — не фільтрувати за conversationId. У `runCollectSpend` у `bin/agent-orchestrator.js` передавати `cursorConversationId: pending.threadId` коли `platform === 'cursor'`.
  Done-when: `collectSpend` з `env.CURSOR_CONVERSATION_ID = 'Y'` і jsonl рядками `conversationId: X` / `Y` повертає лише рядок `Y`; без env обидва рядки в вікні входять

## 7. startedAt без restore

- [x] 7.1 Earliest source.at коли немає pending
  Files: bin/agent-orchestrator.js
  Do: у `metricsRecordSessionEnd` після collect: якщо `startedAt` досі null і є sources з `at` — поставити `startedAt` = найраніший валідний `source.at` і перерахувати `durationMs` від цього start до `endedAt`. Не зливати два persist в один запис.
  Done-when: persist без pending і без `--started-at` з двома sources `at` T1 < T2 дає `startedAt === T1` і `durationMs === endedAt - T1`; два такі persist підряд дають `sessions.length === 2`

## 8. Archive: pending, leftover, duration

- [x] 8.1 Pending start і leftover до move
  Files: bin/agent-orchestrator.js
  Do: у команді `archive` **до** `renameSync(changeRoot, targetDir)` якщо `metrics.json` існує і `pending` є null — записати `pending.startedAt = nowUtcIso()` (інші поля pending MAY лишити порожніми / platform з resolveRestoreClient). Відразу викликати leftover-backfill останньої не-Archiver сесії з `leftoverEnd = pending.startedAt`. Не collect-ити Archiver на цьому кроці.
  Done-when: hook з `at` між `lastNonArchiver.endedAt` і archive `pending.startedAt` після archive лежить у sources попередньої сесії, не в Archiver

- [x] 8.2 Finalize Archiver з durationMs
  Files: bin/agent-orchestrator.js
  Do: у `metricsFinalizeArchive` взяти `startedAt` з `metrics.pending.startedAt` (після move файл уже містить pending з 8.1); якщо pending не було — `startedAt = nowIso`. `endedAt = nowIso`. `durationMs` = дельта або `0`, ніколи штучний `null` коли обидва ISO валідні. `runCollectSpend` з `windowStart = startedAt`, не `lastSessionEndedAt`. Після push сесії `pending = null`.
  Done-when: archive з попереднім pending дає Archiver `durationMs` число (`!== null`); collect Archiver не підхоплює hook з `at < startedAt`

## 9. sessionEnd leftover у archive/

- [x] 9.1 Не скіпати archive/ і resync placeholder
  Files: scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
  Do: у `main()` після обходу активних change також знайти для кожного kebab-імені, якого немає в `openspec/changes/<name>/`, найсвіжіший каталог `openspec/changes/archive/*-<name>/` (найпізніший `archivedAt` у metrics.json, інакше mtime каталогу) і викликати той самий leftover на його `metrics.json`. Прибрати сліпий `if (name === 'archive') continue` як єдиний захист — `archive` як ім'я папки-індекса як і раніше не є change. У `syncAdapterSessionTotals` / гілці після incoming: не return на `spendSource === 'self-report'`, якщо session-числа null; тоді записати суму всіх sources і `spendSource: 'adapter'`. `leftoverWindowEnd` як у задачі 2.2 / D2: старт leftover **інклюзивний** на `last.endedAt`; якщо `metrics.pending.startedAt` є — `leftoverWindowEnd` = цей `pending.startedAt` навіть пізніше за 120s (кінець **виключний**: `at < pending.startedAt`); інакше `leftoverWindowEnd` = `last.endedAt + 120s` (кінець **інклюзивний**). MUST NOT ставити `leftoverWindowEnd` = now. Обидва файли (scripts і templates) SHALL мати ту саму семантику leftover/archive/resync (скопіювати поведінку 1:1).
  Done-when: після `archive` без активної папки `sessionEnd` додає hook +5s у `openspec/changes/archive/*-<name>/metrics.json`; сесія з placeholder self-report і двома leftover sources має totals = сума sources

## 10. Тести (існуючі інверсії + нові кейси)

- [x] 10.1 Інвертувати steal-тест наступного persist
  Files: test/smoke.test.js
  Do: у тесті `next persist collects hook rows written after the previous persist` змінити очікування: `late-after-persist` MUST бути в `sessions[0].sources`, MUST NOT бути в `sessions[1].sources`. Оновити assertion message. Якщо `at: endedAt` першої сесії, leftover усе одно причіплює до першої (інклюзивний старт + dedup).
  Done-when: тест більше не вимагає `sessions[1].sources` з `late-after-persist`; вимагає цей id на першій сесії

- [x] 10.2 Інвертувати archive-hook між endedAt і archive start
  Files: test/smoke.test.js
  Do: у `archive collects Cursor hook into the Archiver session without --collect` рядок з `at: 2026-08-30T12:00:00.000Z` (після Implementer `endedAt` 07:00 і до archive now) очікувати в sources Implementer, не Archiver. Додати окремий тест: hook з `at` після archive (написати рядок з `new Date().toISOString()` безпосередньо перед `cliSpawn archive`, або після штучного `pending.startedAt` у минулому і hook пізніше) потрапляє в Archiver. У `archive ignores leftover apply ## Metrics` рядок `2026-08-30T12:00:00.000Z` також іде в leftover Implementer; Archiver не отримує 55 токенів з цього рядка; stale `## Metrics` 1000 як і раніше не стає `Archiver.inputTokens`.
  Done-when: три assertions вище присутні; Archiver.durationMs у новому або оновленому тесті є числом, не `null`

- [x] 10.3 sessionEnd leftover після archive + conversationId + role + maps
  Files: test/smoke.test.js, test/spend-collect.test.js, test/session-client.test.js
  Do: у `test/session-client.test.js` для Cursor env додати `assert.equal(client.threadId, 'c-1')`. У `test/spend-collect.test.js` додати кейс filter `CURSOR_CONVERSATION_ID=Y` пропускає рядок `conversationId: X`. У `test/smoke.test.js` додати: (1) persist Closed role `Architect — propose complete, ready for Spec Reviewer` → `role === 'Architect'`, `phase === 'spec'`; (2) `--model cursor-grok-4.6` + hook `cursor-grok-4.6-low` → `session.model` і `spendByModel` без family-рядка; (3) `## Metrics` усі unknown + `spend_source: self-report` + два leftover sources → totals = сума, `spendSource === 'adapter'`; (4) після archive запустити `node scripts/cursor-spend-collect.cjs` з hook +5s і перевірити архівний `metrics.json`; (5) AC6: persist без pending і без `--started-at` з двома sources `at` T1 < T2 → `startedAt === T1` і `durationMs === endedAt - T1`.
  Done-when: усі п'ять кейсів і conversationId/threadId асерти є у вказаних файлах

## 11. Протокол і документація

- [x] 11.1 Session Exit: product id і placeholder spend_source
  Files: templates/.agents/rules/session-handoff.mdc, .agents/rules/session-handoff.mdc, templates/.agents/skills/agent-orchestration/SKILL.md, templates/.agents/subagents/session-handoff.md, templates/.agents/subagents/spec-archiver.md
  Do: прибрати формулювання, що `## Metrics` з `unknown` є primary spend source. Записати: `unknown` для невідомих чисел; не ставити `spend_source: self-report` коли токени `unknown`; `--model` / `model` = product id (приклад `cursor-grok-4.6-xhigh-fast`); family `cursor-grok-4.6` лише fallback; CLI бере product id з hook sources, коли вони є; Closed role MAY мати речення після `—`, metrics зберігає канонічний токен. Ті самі три речення в усіх п’яти файлах, де є блок `## Metrics` / `--model`.
  Done-when: жоден з п’яти файлів не каже, що самозвіт з `unknown` є primary spend; усі згадують заборону `spend_source: self-report` при unknown токенах

- [x] 11.2 README і CHANGELOG для споживачів
  Files: README.md, CHANGELOG.md
  Do: у README секції Change metrics замінити речення про `session.model` (`--model` → Metrics → AOK_MODEL → sources) на: sources product id перемагає, flag/Metrics/env лише коли sources без model. Замінити archive-вікно `[last session.endedAt, now]` на `[pending.startedAt, now]` і leftover попередньої сесії. Додати: persist-вікно `[pending.startedAt, endedAt]`; пізній hook іде в leftover, не в наступний persist; `sessionEnd` читає найсвіжіший archive metrics.json; Cursor filter за `conversationId`; канонічна роль. У CHANGELOG `[Unreleased]` той самий контракт одним абзацом. Не бекфілити архіви й не обіцяти HTTP.
  Done-when: README більше не містить рядка, що archive collect є `[last session.endedAt, now]`; `[Unreleased]` згадує leftover, product id і conversationId
