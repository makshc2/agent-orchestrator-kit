## 1. Amp Cost один раз у rollup

- [x] 1.1 recompute додає session.costUsd один раз
      Files: bin/agent-orchestrator.js
      Do: у `recomputeSpendMaps` і `recomputeMetricsAggregates` для кожної сесії окремо порахувати суму `sources[].costUsd` лише цієї сесії. Якщо ця сума є `null`, а `session.costUsd` є числом — додати (`addNullable`) `session.costUsd` рівно один раз для цієї сесії у `spend.costUsd`, `spendByPlatform[session.platform].costUsd` і `phases[session.phase].costUsd`. Рішення fallback залежить лише від суми sources поточної сесії; не перевіряти, чи агрегат уже `null`, і не пропускати пізнішу сесію лише тому, що бакет уже має billed попередньої. Не писати це число в `sources[].costUsd`. Токени і `costUsdEstimated` лишити з sources. Додати `recomputeMetricsAggregates` до існуючого `export { formatMetricsCostLine, resolveSessionSpend, canonicalRole, phaseForRole }`.
      Done-when: виклик експортованої `recomputeMetricsAggregates` на одній сесії `phase: apply`, `platform: amp`, `costUsd: 12.69` і трьох sources з `costUsd: null` дає `spend.costUsd === 12.69`, `spendByPlatform.amp.costUsd === 12.69`, `phases.apply.costUsd === 12.69` і не `38.07`; той самий виклик на трьох Amp-сесіях з `costUsd` 4.42, 8.81 і 12.69 (у кожної sources з `costUsd: null`) дає `spend.costUsd === 25.92` і `spendByPlatform.amp.costUsd === 25.92`

- [x] 1.2 leftover rewrite collect-скрипта не зрізає Amp billed
      Files: scripts/cursor-spend-collect.cjs, templates/scripts/cursor-spend-collect.cjs
      Do: у `recompute` всередині циклу `for (const session of metrics.sessions)` після суми `sources[].costUsd` **цієї** сесії: якщо ця сума є `null`, а `session.costUsd` є числом — додати (`addNullable`) `session.costUsd` один раз у `spend.costUsd`, `byPlatform[session.platform].costUsd` (бакет `amp` / `cursor` / `claude` за `session.platform`) і `phases[session.phase].costUsd`. Не ставити умову «агрегат ще `null`»: fallback застосовується на кожну кваліфікуючу сесію, навіть коли `spend.costUsd` / `phases[*].costUsd` / бакет платформи уже містять billed попередньої сесії. Не копіювати Cost на кожен source. Скопіювати оновлений `scripts/cursor-spend-collect.cjs` у `templates/scripts/cursor-spend-collect.cjs` так, щоб `cmp` не бачив різниці.
      Done-when: `cmp scripts/cursor-spend-collect.cjs templates/scripts/cursor-spend-collect.cjs` порожній; leftover `recompute` на одній Amp-сесії з трьома sources `costUsd: null` і `session.costUsd: 12.69` лишає `spendByPlatform.amp.costUsd === 12.69`; той самий `recompute` на трьох Amp-сесіях з `costUsd` 4.42, 8.81 і 12.69 (у кожної sources `costUsd: null`) дає `spend.costUsd === 25.92` і `spendByPlatform.amp.costUsd === 25.92` (не зупиняється на першому внеску 4.42)

## 2. Restore lock amp-session-last

- [x] 2.1 detect бере свіжий lastThreadId коли батько не amp
      Files: bin/session-client.js
      Do: у `detectSessionClient` після гілок Amp-env, Cursor-env, Claude-env і Amp parent: якщо батько не `amp` і `readAmpSessionHint` повернув порожній tty-`threadId`, перевірити свіжість `session.json` `lastThreadId` (вікно `AMP_TTY_MAX_AGE_MS`; `updatedAt` у JSON, інакше `fs.statSync` mtime файла). Якщо свіжий — повернути `{ platform: 'amp', threadId: lastThreadId, source: 'amp-session-last' }`. Якщо `lastThreadId` порожній, але файл існує і свіжий — перший id з `listRecentAmpThreadIds`, `source: 'amp-session-list'`. Гілку «батько amp без tty → `amp-threads-list`, не `lastThreadId`» не змінювати. Amp-env лишає перемогу над Cursor-env.
      Done-when: `detectSessionClient` з `parentComm: 'node'`, без `AMP_*`/`CURSOR_*`, `ttyKey: 'tty:/dev/null'`, свіжий `session.json` `lastThreadId: T-lock` повертає `platform === 'amp'`, `threadId === 'T-lock'`, `source === 'amp-session-last'`; чинний кейс parent amp без tty лишає `source === 'amp-threads-list'` і id зі списку

- [x] 2.2 Тести restore lock
      Files: test/session-client.test.js
      Do: додати тест «без env / без amp parent / без tty, свіжий lastThreadId=T-lock → amp-session-last». Додати тест, що Amp-env з `AMP_CURRENT_THREAD` і одночасним свіжим `lastThreadId` іншого id лишає `amp-env`. Не видаляти тест `parent amp without tty uses threads list, not lastThreadId`.
      Done-when: у `test/session-client.test.js` є асерт `source === 'amp-session-last'` і `threadId === 'T-lock'`; тест parent amp без tty лишається і очікує `amp-threads-list`

## 3. Leftover scoped до platform і thread

- [x] 3.1 collectAmpCli не кличе listRecent і не додає env id на leftover
      Files: bin/spend-collect.js
      Do: пробросити `listRecentAmpThreads` з `collectSpend` `options` у `ctx` (`ctx.listRecentAmpThreads = options.listRecentAmpThreads`). У `collectAmpCli` побудувати `ids` так: завжди `push(ampThreadId)`; `push(ampCurrentThreadId(env))` виконувати лише коли `ctx.listRecentAmpThreads !== false`; `listRecentAmpThreadIds(ctx)` викликати лише коли після цих push `ids` порожній **і** `ctx.listRecentAmpThreads !== false`. У leftover-режимі (`listRecentAmpThreads === false`) з непорожнім `ctx.ampThreadId` масив `ids` SHALL містити лише цей id — не додавати `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` з `env` і не викликати `listRecentAmpThreadIds`. Не копіювати `usage.costUsd` у кожен `extracted` source (лише `costSource: 'amp-usage'` і `ampThreads[].costUsd`, як зараз).
      Done-when: `collectSpend({ platforms: ['amp'], listRecentAmpThreads: false, listAmpThreads: () => { throw new Error('listed'); } })` не кидає і не додає sources з «останніх» threads; `collectSpend` з `ampThreadId: 'T-apply'` і `listRecentAmpThreads: false` не викликає `listAmpThreads`; `collectSpend({ platforms: ['amp'], ampThreadId: 'T-apply', listRecentAmpThreads: false, env: { AMP_CURRENT_THREAD: 'T-archive' }, exportAmpThread: (id) => { exported.push(id); return null; } })` має `exported` без `'T-archive'` (лише `'T-apply'` або порожньо після fail-open export)

- [x] 3.2 runCollectSpend прокидає listRecentAmpThreads
      Files: bin/agent-orchestrator.js
      Do: у `runCollectSpend` додати в об'єкт `collectSpend` поле `listRecentAmpThreads: extra.listRecentAmpThreads`. Інші поля (`platforms`, `ampThreadId`, `ampCli`, `cursorConversationId`) не прибирати.
      Done-when: `runCollectSpend(..., { listRecentAmpThreads: false })` передає `false` у `collectSpend`

- [x] 3.3 attachLeftoverSources передає platforms і thread
      Files: bin/agent-orchestrator.js
      Do: у `attachLeftoverSources` без `extra.collect === true` передати `platforms: [session.platform]`, якщо platform є `amp`/`cursor`/`claude`. Префікс thread = текст `sources[].id` до першого `:`, якщо id починається з `T-` (`T-apply:8` → `T-apply`). Якщо `session.platform` є `null`, а префікс унікальний — передати `platforms: ['amp']`. `ampThreadId` = `session.threadId` або цей префікс; не брати `ampThreadIdFromEnv(process.env)` і не підставляти `AMP_CURRENT_THREAD` / `AMP_THREAD_ID`. Передати в `runCollectSpend` і `collectSpend` поля `ampThreadId` (лише резолвлений id) і `listRecentAmpThreads: false`, щоб `collectAmpCli` зібрав лише цей id і не робив `push(ampCurrentThreadId(env))`. Після collect відкинути Amp incoming, чий `id` не починається з `<ampThreadId>:`. Якщо немає ні `threadId`, ні префікса — не збирати Amp leftover (не викликати `runCollectSpend` з `platforms: ['amp']` і без `ampThreadId`). Виклики leftover у `metricsRecordSessionEnd` і `metricsPrepareArchiveStart` передають `collect: true` лише коли persist/archive викликано з `--collect`.
      Done-when: leftover Implementer `platform: amp`, `threadId: null`, sources `T-apply:8` не додає `T-archive:2` і не додає Cursor hook-рядки; те саме при `threadId: 'T-apply'`; leftover з `threadId: 'T-apply'` і env `AMP_CURRENT_THREAD=T-archive` не експортує і не додає `T-archive`; leftover з `sources: []` і `threadId: null` не викликає `listRecentAmpThreadIds`

## 4. Freeze, usageModels, pending.role

- [x] 4.1 sessionSpendIsFrozen лише flag і числовий self-report
      Files: bin/agent-orchestrator.js
      Do: змінити `sessionSpendIsFrozen` так: `true` лише якщо `session.spendSource === 'flag'` або (`session.spendSource === 'self-report'` і `reportedHasSpendNumbers(session)`). Для `amp-usage`, `adapter`, `unreported` повертати `false`. Додати `sessionSpendIsFrozen` до того самого `export { ... }`, куди 1.1 додає `recomputeMetricsAggregates`.
      Done-when: імпорт `sessionSpendIsFrozen` дає `false` для `{ spendSource: 'amp-usage', costUsd: 12.69, inputTokens: 495184 }`, `true` для `{ spendSource: 'flag', inputTokens: 1 }` і `{ spendSource: 'self-report', inputTokens: 100 }`, `false` для `{ spendSource: 'self-report' }` без чисел

- [x] 4.2 leftover resync токенів не дропає Cost
      Files: bin/agent-orchestrator.js
      Do: у гілці leftover `applyCollectedSessionFields` зберегти наявний числовий `session.costUsd`, якщо після merge сума `sources[].costUsd` є `null`. Виставити токени як суму всіх sources. Якщо до leftover `spendSource === 'amp-usage'` і `costUsd` лишився з Cost — залишити `spendSource: 'amp-usage'`. Не викликати `resolveSessionSpend` так, щоб `fromSources.costUsd === null` затер billed.
      Done-when: leftover на сесії `spendSource: amp-usage`, `inputTokens: 495184`, `costUsd: 12.69` плюс нові sources з сумою input 1176546 дає `session.inputTokens === 1176546`, `session.costUsd === 12.69`, `session.spendSource === 'amp-usage'`

- [x] 4.3 usageModels дедуп цього thread
      Files: bin/agent-orchestrator.js
      Do: у `applyCollectedSessionFields` зібрати `usageModels` лише з `extra.ampThreads`, чий `id` дорівнює `session.threadId` або префіксу до `:` з `session.sources[].id` (id починається з `T-`). Унікальність за `row.model`: залишити рядок з більшим `totalTokens` (або `inputTokens+outputTokens`); при рівності — останній. Записати `session.usageModels` цією множиною (замінити, не конкатенувати зі старим масивом).
      Done-when: leftover з `ampThreads` `T-apply` (Luna двічі) і `T-review` (Fable) на сесії `threadId: T-apply` дає `usageModels` без Fable і з Luna рівно один раз

- [x] 4.4 pending.role через canonicalRole
      Files: bin/agent-orchestrator.js
      Do: у `metricsRecordSessionStart` записати `role: canonicalRole(role) || role || ''`. Не змінювати `canonicalRole` так, щоб kebab `spec-reviewer` став `Spec Reviewer`.
      Done-when: restore з next/closed role `Archiver — deferred until the CI-green…` пише `pending.role === 'Archiver'`; чинний persist/restore з next role `spec-reviewer` лишає `pending.role === 'spec-reviewer'`

## 5. Тести acceptance

- [x] 5.1 Rollup Cost після persist/recompute
      Files: test/metrics-readable.test.js, test/spend-collect.test.js
      Do: додати тест, що імпортує `recomputeMetricsAggregates` з `bin/agent-orchestrator.js` і проганяє фікстуру з трьома Amp sources `costUsd: null` і `session.costUsd: 12.69` — `spend.costUsd`, `spendByPlatform.amp.costUsd`, `phases.apply.costUsd` суворо `=== 12.69`. Додати другий кейс: три Amp-сесії з `costUsd` 4.42, 8.81 і 12.69, у кожної непорожні sources з `costUsd: null` — після `recomputeMetricsAggregates` `spend.costUsd === 25.92` і `spendByPlatform.amp.costUsd === 25.92`. У `test/spend-collect.test.js` залишити асерт `ampThreads[0].costUsd`; додати асерт, що після collect+recompute `sources[].costUsd` не дорівнює Cost (не ×N).
      Done-when: обидва кейси є в `test/metrics-readable.test.js` і падають на поточному `recomputeSpendMaps` без per-session Cost fallback; після 1.1 проходять

- [x] 5.2 Restore persist збирає T-lock без --collect
      Files: test/smoke.test.js, test/session-client.test.js
      Do: додати кейс restore у tmp з `session.json` `lastThreadId: T-lock` (без AMP_*/CURSOR_*, parent не amp, tty `/dev/null`) → `pending.threadId === 'T-lock'` і `clientSource` містить `amp-session-last`. Якщо smoke вже вміє інжектити Amp export — persist без `--collect` має `sessions[0].sources` цього thread; інакше достатньо асерта pending плюс окремий `collectSpend({ ampThreadId: pending.threadId })` у `test/session-client.test.js`.
      Done-when: тест є і падає на поточному `detectSessionClient` (source `none`); після 2.1 проходить

- [x] 5.3 Leftover thread filter і amp-usage resync
      Files: test/smoke.test.js, test/spend-collect.test.js
      Do: додати чотири кейси. (1) Implementer `threadId: null`, sources ids `T-apply:8`, leftover бачить export `T-archive:2` і Cursor hook у вікні — жоден не в `Implementer.sources`; `listAmpThreads` не викликається. (2) Те саме з `threadId: T-apply` — входить лише `T-apply:*`. (3) Сесія `amp-usage` 495184 / Cost 12.69, leftover додає sources до суми 1176546 — `inputTokens === 1176546`, `costUsd === 12.69`, `spendSource === 'amp-usage'`. (4) У `test/spend-collect.test.js`: `collectSpend({ platforms: ['amp'], ampThreadId: 'T-apply', listRecentAmpThreads: false, env: { AMP_CURRENT_THREAD: 'T-archive' }, exportAmpThread })` — `exportAmpThread` не викликається з `'T-archive'`, зібрані sources не містять id з префіксом `T-archive:`.
      Done-when: усі чотири асерти присутні в указаних файлах

- [x] 5.4 usageModels і pending.role
      Files: test/smoke.test.js, test/session-client.test.js
      Do: додати тест leftover `usageModels`: двічі Luna на `T-apply` і Fable на іншому thread — після leftover Luna один раз, Fable немає. Додати тест restore з Closed/next role `Archiver — deferred until the CI-green…` → `pending.role === 'Archiver'`.
      Done-when: обидва асерти є; restore-тест падає на поточному `metricsRecordSessionStart` без `canonicalRole`

## 6. Документація для споживачів

- [x] 6.1 README і CHANGELOG [Unreleased]
      Files: README.md, CHANGELOG.md
      Do: у README секції Change metrics додати: Amp `Cost: $N` після recompute один раз **на кожну кваліфікуючу сесію** у `spend.costUsd` / `spendByPlatform.amp.costUsd` / `phases.*.costUsd` (не ×N sources; кілька сесій складаються); restore без Amp parent читає свіжий `session.json lastThreadId` як `amp-session-last`; leftover без `--collect` ріже за `last.platform` і Amp thread id / префікс `T-…` і з явним `ampThreadId` не додає env-thread; leftover після `amp-usage` resync токени з sources і лишає billed; `usageModels` унікальні цього thread; `pending.role` — канонічний токен. У CHANGELOG `[Unreleased]` додати `### Fixed` з тим самим контрактом одним або двома абзацами. Не обіцяти бекфіл архівів, HTTP, credits parser або ширше leftover-вікно.
      Done-when: README згадує Cost-once rollup, `amp-session-last`, leftover thread-scope і leftover token resync; `[Unreleased]` містить той самий контракт
