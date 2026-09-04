## ADDED Requirements

### Requirement: Amp leftover scoped до last.platform і thread id

Leftover-collect без `--collect` SHALL запускати лише адаптер `last.platform`, коли `last.platform` є `amp`, `cursor` або `claude`. Cursor leftover на сесії з `last.platform === amp` MUST NOT причіплювати hook-рядки. Якщо `last.platform` є `null`, leftover MUST NOT запускати всі три адаптери; Amp leftover тоді дозволений лише коли є `last.threadId` або витягнутий з наявних `sources[].id` префікс — текст до першого `:`, якщо id починається з `T-` (`T-apply:8` → `T-apply`).

Amp leftover SHALL передавати `ampThreadId` = `last.threadId`, або — якщо `threadId` є `null` — той префікс. MUST NOT підставляти `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` з env, якщо це відкриє інший thread. `collectAmpCli` MUST NOT викликати `listRecentAmpThreadIds`, коли leftover thread id уже відомий **або** коли leftover не має ні `threadId`, ні префікса з sources.

Коли leftover-режим має явний `ampThreadId` (переданий `listRecentAmpThreads: false` і непорожній `ampThreadId`), `collectAmpCli` MUST зібрати **лише цей id**. MUST NOT додавати `ampCurrentThreadId(env)` / `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` до списку ids перед export. Чужий env-thread (`T-archive` при leftover `T-apply`) MUST NOT експортуватись і MUST NOT потрапляти в collected sources.

Incoming Amp leftover source MUST входити лише якщо `source.id` починається з `<resolvedThreadId>:`. Source `T-archive:2` MUST NOT потрапляти в сесію, чий thread є `T-apply` (або чиї наявні ids мають префікс `T-apply`). ExclusiveEnd leftover-вікна (`at >= pending.startedAt` наступної сесії) MUST лишатись; thread-фільтр діє зверху. Grace 120s MUST NOT змінюватись.

#### Scenario: Leftover Implementer без threadId не бере archive thread і Cursor hook

- **GIVEN** остання закрита сесія `role: Implementer`, `platform: amp`, `threadId: null`
- **AND** `sources` містять ids `T-apply:8` і `T-apply:9`
- **AND** Amp CLI може віддати usage `T-archive:2`, а `.agents/spend/cursor-usage.jsonl` має рядок у leftover-вікні
- **WHEN** виконується leftover наступного persist без `--collect`
- **THEN** `T-archive:2` відсутній у `Implementer.sources`
- **AND** Cursor hook-рядки відсутні в `Implementer.sources`
- **AND** `listRecentAmpThreadIds` не викликається

#### Scenario: Leftover з threadId T-apply теж ріже чужий thread

- **GIVEN** остання сесія має `platform: amp` і `threadId: T-apply`
- **AND** у leftover-вікні є Amp usage `T-apply:10` і `T-archive:2`
- **WHEN** виконується leftover без `--collect`
- **THEN** `T-apply:10` є в `sources`
- **AND** `T-archive:2` відсутній
- **AND** Cursor hook-рядки відсутні

#### Scenario: Leftover з явним T-apply не експортує env T-archive

- **GIVEN** leftover без `--collect` передає `ampThreadId: T-apply` і `listRecentAmpThreads: false`
- **AND** env має `AMP_CURRENT_THREAD=T-archive` (або `AMP_THREAD_ID=T-archive`)
- **AND** Amp CLI може експортувати обидва threads
- **WHEN** виконується leftover collect / `collectAmpCli`
- **THEN** `exportAmpThread` не викликається з `T-archive`
- **AND** зібрані sources не містять id з префіксом `T-archive:`
- **AND** зібрані Amp ids містять лише `T-apply`

#### Scenario: Amp leftover без thread і без префікса не кличе listRecent

- **GIVEN** остання сесія має `platform: amp`, `threadId: null`, `sources: []`
- **WHEN** виконується leftover без `--collect`
- **THEN** `collectAmpCli` не викликає `listRecentAmpThreadIds`
- **AND** нові Amp sources не з’являються з «останніх» threads

### Requirement: Leftover після amp-usage перераховує токени і лишає billed Cost

`sessionSpendIsFrozen` SHALL повертати true лише коли `spendSource === "flag"` або коли `spendSource === "self-report"` і є хоч одне числове spend-поле (`inputTokens` / `outputTokens` / `totalTokens` / `costUsd` / `ampCredits`). `amp-usage`, `adapter`, `unreported` і placeholder self-report (усі числа `unknown` / null) MUST NOT заморожувати leftover resync токенів.

Після leftover сесії з `spendSource: amp-usage` CLI SHALL виставити `inputTokens` / `outputTokens` / `totalTokens` як суму **усіх** `sources`. `session.costUsd` MUST лишитись числовим Amp Cost, якщо usage його ще віддає або він уже записаний, а сума `sources[].costUsd` є `null`. Leftover MUST NOT затирати billed `null`-сумою sources. `spendSource` SHALL лишатись `amp-usage`, якщо `costUsd` прийшов з Amp usage/Cost. `spendSource` SHALL стати `adapter` лише коли і токени, і cost узяті лише з sources (немає billed Cost).

#### Scenario: amp-usage leftover resync токенів без drop Cost

- **GIVEN** сесія має `spendSource: amp-usage`, `inputTokens: 495184`, `costUsd: 12.69` і sources на 495184 токенів з `costUsd: null`
- **AND** leftover додає sources, сума всіх `inputTokens` стає `1176546`
- **WHEN** leftover завершується
- **THEN** `session.inputTokens` дорівнює `1176546`
- **AND** `session.costUsd` дорівнює `12.69`
- **AND** `session.spendSource` дорівнює `amp-usage`

### Requirement: usageModels лише цього thread без дублікатів

`session.usageModels` SHALL містити рядки таблиці Models **лише** з Amp thread(s) цієї сесії (`session.threadId` або префікс до `:` з `sources[].id`, що починається з `T-`). CLI MUST NOT мержити `usageModels` інших threads. Рядки SHALL бути унікальні за іменем моделі (після `matchAmpUsageModel`): залишити рядок з більшим `totalTokens` (або `inputTokens + outputTokens`); при рівності — останній. Leftover MUST перезаписати `usageModels` цією множиною, не конкатенувати попередню таблицю з новою.

#### Scenario: usageModels після leftover унікальні й цього thread

- **GIVEN** сесія має `threadId: T-apply` і leftover зібрав usage `T-apply` (Luna двічі) плюс usage `T-review` (Fable, Sol)
- **WHEN** leftover записує `usageModels`
- **THEN** кожна модель зустрічається щонайбільше один раз
- **AND** моделей з `T-review` немає
- **AND** Luna є рівно один рядок

## MODIFIED Requirements

### Requirement: Restore фіксує клієнта сесії, persist йде його флоу

`handoff --restore` SHALL визначити клієнта сесії і записати його в `pending`: `platform` (`cursor` | `claude` | `amp` | `null`), `threadId` (Amp thread id, або Cursor `conversationId`, або `null`), `clientSource` (непорожній рядок джерела). Резолв клієнта: `--platform` / `AOK_PLATFORM` → `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` → `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID` → Claude Code env → батьківський процес `amp` і/або свіжий `~/.local/share/amp/session.json` `lastThreadByTerminal[tty]` (вікно свіжості ≤ 2h; `/dev/null` і pipe MUST NOT рахуватись як tty) → якщо env і Amp parent не перемогли, свіжий `session.json` `lastThreadId` (те саме вікно ≤ 2h; свіжість з кореневого `updatedAt`, інакше mtime файла) з `clientSource: amp-session-last` → якщо `lastThreadId` порожній, але `session.json` існує і свіжий — перший id `amp threads list` з `clientSource: amp-session-list` → `null`. Якщо батько є `amp` і tty немає, `pending.threadId` SHALL братися з першого id `amp threads list` (`clientSource: amp-threads-list`), MUST NOT з `session.json` `lastThreadId`. Для cursor непорожній `CURSOR_CONVERSATION_ID` SHALL стати `pending.threadId`. Amp env MUST перемагати Cursor env. `agentMode` (`low`/`medium`/`high`/`ultra`) MUST NOT ставати `session.model`.

`handoff <name>` SHALL резолвити `session.platform` так: `--platform` → `## Metrics` → `AOK_PLATFORM` → `pending.platform` → host env → sources. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, persist SHALL зібрати spend лише цього клієнта навіть без `--collect`. Amp-флоу: `amp threads export <pending.threadId>` (бінар `AOK_AMP_BIN` або `amp`; fail-open) плюс локальні `threads/*.json`. Cursor-флоу: hook-файл з фільтром conversationId. Claude-флоу: `~/.claude/projects`. `--collect` SHALL як і раніше запускати всі три адаптери. Відсутній Amp CLI MUST NOT валити persist.

#### Scenario: Amp restore + persist без Amp env збирає thread

- **GIVEN** `handoff --restore` з `AMP_CURRENT_THREAD=T-lock` записав `pending.platform: amp` і `pending.threadId: T-lock`
- **AND** після restore з’явився matching Amp usage у вікні
- **WHEN** виконується persist без `AMP_*` і без `--collect`
- **THEN** `sessions[0].platform` дорівнює `amp`
- **AND** `sessions[0].sources` містить usage цього thread

#### Scenario: Amp parent без tty бере id з threads list

- **GIVEN** батьківський процес є `amp`
- **AND** stdin є `/dev/null`
- **AND** `session.json` `lastThreadId` є іншим тредом
- **AND** `amp threads list` першим рядком дає поточний thread id
- **WHEN** виконується `handoff --restore`
- **THEN** `pending.platform` дорівнює `amp`
- **AND** `pending.threadId` дорівнює id з `amp threads list`
- **AND** `pending.threadId` не дорівнює `session.json` `lastThreadId`

#### Scenario: Restore без env бере свіжий lastThreadId

- **GIVEN** немає `AMP_*`, `CURSOR_*`, Claude env і батько не є `amp`
- **AND** немає usable tty
- **AND** `session.json` має `lastThreadId: T-lock` і свіжий `updatedAt` або mtime (≤ 2h)
- **WHEN** виконується `handoff --restore`
- **THEN** `pending.platform` дорівнює `amp`
- **AND** `pending.threadId` дорівнює `T-lock`
- **AND** `pending.clientSource` містить `amp-session-last`

#### Scenario: Persist після amp-session-last збирає цей thread без --collect

- **GIVEN** restore записав `pending.platform: amp`, `pending.threadId: T-lock`, `clientSource` з `amp-session-last`
- **AND** Amp usage цього thread є у вікні persist
- **WHEN** виконується persist без `AMP_*` і без `--collect`
- **THEN** `sessions[0].threadId` дорівнює `T-lock`
- **AND** `sessions[0].sources` містить usage `T-lock`

#### Scenario: Cursor restore не підхоплює Amp disk threads

- **GIVEN** `handoff --restore` з `CURSOR_AGENT=1` записав `pending.platform: cursor`
- **AND** у `AMP_DATA_DIR/threads` є matching usage цього cwd
- **WHEN** виконується persist без `--collect`
- **THEN** `sessions[0].platform` дорівнює `cursor`
- **AND** Amp usage відсутній у `sessions[0].sources`

#### Scenario: Persist без restore і без sources лишає duration null

- **GIVEN** немає `pending` і немає `--started-at`
- **AND** collect не повернув sources із полем `at`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].startedAt` є `null`
- **AND** `sessions[0].durationMs` є `null`
- **AND** команда завершується з exit 0

#### Scenario: Persist без restore ставить startedAt з earliest source.at

- **GIVEN** немає `pending` і немає `--started-at`
- **AND** collect повернув sources з `at: 2026-08-31T16:10:00.000Z` і `at: 2026-08-31T16:12:00.000Z`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].startedAt` дорівнює `2026-08-31T16:10:00.000Z`
- **AND** `sessions[0].durationMs` є різницею між `endedAt` і цим `startedAt`

#### Scenario: Сесія записана до друку промпта

- **GIVEN** persist завершився exit 0
- **WHEN** порівнюються stdout і `metrics.json`
- **THEN** `metrics.json` містить нову сесію
- **AND** stdout містить лише next-thread prompt без метрик

### Requirement: Вікно collect, cwd-match і dedup

Є рівно два вікна. Третього вікна MUST NOT бути.

**Persist цієї сесії.** Коли collect запущено (`--collect`, locked client, або `metrics --collect` для нової сесії), вікно SHALL бути `[pending.startedAt || --started-at, endedAt]`. Якщо немає ні pending, ні `--started-at`, нижня межа MAY бути відсутня лише для collect sources цієї сесії; `startedAt` сесії тоді береться з earliest `source.at`. CLI MUST NOT ставити нижню межу persist на `last.endedAt`.

**Leftover останньої закритої сесії.** Persist (перед collect поточної), archive (перед collect Archiver), Cursor `sessionEnd` і Cursor hook після успішного append `stop` / `afterAgentResponse` SHALL причіплювати до **останньої вже закритої** сесії події, яких ще немає за `source.id`, з `at >= last.endedAt` і `at < leftoverEnd`. `leftoverEnd` SHALL бути `pending.startedAt`, коли наступний `pending` існує (навіть якщо це пізніше за 120s); інакше `last.endedAt + 120s` (інклюзивно). Подія після `last.endedAt` і до `next.pending.startedAt` MUST належати останній закритій сесії і MUST NOT входити в persist нової сесії.

Leftover без `--collect` MUST бути scoped до `last.platform` і Amp leftover MUST різатись за thread id (див. «Amp leftover scoped до last.platform і thread id»). Після attach leftover MUST перерахувати session-level **токени** як суму **усіх** `sources` цієї сесії, якщо немає явного прапорця або числового (не-placeholder) самозвіту. `session.costUsd` з Amp Cost MUST лишитись, якщо сума `sources[].costUsd` є `null`. `spendSource` SHALL лишатись `amp-usage`, якщо billed прийшов з usage; SHALL стати `adapter`, якщо totals і cost узяті лише з sources. `amp-usage` MUST NOT заморожувати token resync (див. «Leftover після amp-usage перераховує токени і лишає billed Cost»). Рядок, який існує на диску в момент leftover-collect і входить у вікно, MUST причепитись навіть якщо перший persist/archive collect записав `sources: []`.

Подія MUST входити лише якщо її timestamp у відповідному вікні: Claude — поле рядка `timestamp`; Amp — `usage.timestamp`; Cursor — поле `at` hook-запису. Проєктний match порівнює з аргументом `collectSpend({ cwd })` (якщо опущено — `process.cwd()`). Claude: поле рядка `cwd` === цей шлях; без поля `cwd` подію MUST NOT включати. Amp: thread з непорожнім `trees` входить лише за збігом `trees[].uri`; без `trees` — за cwd-полями, `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` або точною згадкою cwd у JSON; MUST NOT вигадувати `meta.cwd`. Cursor: файл `<root>/.agents/spend/cursor-usage.jsonl` читається для **кожного** резолвленого кореня leftover (див. «Спільний multi-root resolveBaseDir»); додатково діє фільтр conversationId на persist **і** на sessionEnd/hook leftover. Dedup: пропустити `source.id`, яке вже є в будь-якому `session.sources` поточного `metrics.json`.

#### Scenario: Подія до last session.endedAt не потрапляє в нову сесію

- **GIVEN** уже є сесія з `endedAt` пізнішим за timestamp usage-події в фікстурі
- **WHEN** виконується наступний persist з `--collect`
- **THEN** ця подія відсутня в новій сесії `sources`

#### Scenario: Пізня подія після попереднього persist не потрапляє в наступну сесію

- **GIVEN** попередня сесія A уже закрита
- **AND** usage-подія має `id: late-a`, timestamp = `endedAt_A + 20s` і раніше за `pending.startedAt` сесії B
- **WHEN** виконується persist B з `--collect`
- **THEN** `late-a` відсутній у `sessions[B].sources`
- **AND** leftover (той самий persist або `sessionEnd`) додає `late-a` до `sessions[A].sources`
- **AND** `sessions[A].inputTokens` дорівнює сумі всіх `sessions[A].sources` (не лише першого source)

#### Scenario: Leftover resync після двох sources

- **GIVEN** сесія A має `spendSource: self-report`, null-числа і вже один source на 954984 токенів
- **AND** leftover додає другий source на 508064 токени
- **WHEN** leftover завершується
- **THEN** `sessions[A].inputTokens` дорівнює `1463048`
- **AND** `sessions[A].spendSource` дорівнює `adapter`

#### Scenario: Повторний collect не дублює source.id

- **GIVEN** `metrics.json` уже містить `sessions[0].sources` з id `msg-1`
- **WHEN** наступний persist з `--collect` знову бачить ту саму подію
- **THEN** новий запис сесії не містить повторного `msg-1`

#### Scenario: Чужа cwd відкидається

- **GIVEN** claude jsonl рядок з `cwd`, що не дорівнює аргументу `collectSpend({ cwd })`
- **WHEN** виконується persist з `--collect`
- **THEN** ця подія відсутня в `sources`

#### Scenario: Пізній hook після порожнього archive collect причіплюється leftover

- **GIVEN** archive finalize записав Archiver з `sources: []`
- **AND** hook-рядок з’явився +35s після `Archiver.endedAt` і `at <= endedAt + 120s`
- **WHEN** виконується leftover (`sessionEnd` або hook post-append)
- **THEN** цей рядок є в `Archiver.sources`

### Requirement: Агрегати перераховуються на кожному записі

Кожен виклик, що зберігає `metrics.json` (persist, archive finalize, leftover backfill), SHALL перераховувати `phases`, `totals`, `spend`, `spendByPlatform` і `spendByModel` з масиву `sessions` і їхніх `sources`. `totals.durationMs` — сума `session.durationMs` (null-honest). `totals.leadTimeMs` — різниця між найранішим `startedAt` і найпізнішим `endedAt` **по всіх сесіях**, або `null`. `totals.cloudSessions` — кількість сесій з `runtime: cloud`. `phases.<phase>.startedAt` / `endedAt` / `leadTimeMs` — лише сесії цієї фази (див. «Межі фази — з сесій цієї фази, не клон totals»). `phases.<phase>.durationMs` — сума `session.durationMs` фази, не `totals.leadTimeMs` і не phase lead. `phases.<phase>.agents` — унікальні канонічні ролі; `phases.<phase>.models` — унікальні непорожні product id з `session.model` і `session.models` після резолву «Модель сесії». `spend.costUsd` SHALL підсумовувати лише billed / self-report / Amp usage USD (не Amp credits і не оцінки). `spend.costUsdEstimated` SHALL підсумовувати оцінки за тим самим правилом без подвійного рахунку, що й токени. `spend.costUsd` і `spend.costUsdEstimated` MUST лишатись окремими полями і MUST NOT зливатись в одне число. Amp credits MUST NOT входити ні в `costUsd`, ні в `costUsdEstimated`.

Коли `session.sources.length > 0`, токени, `costUsdEstimated` і token-поля `spendByModel` SHALL наповнюватись **з `sources`** (сума всіх sources сесії / фази). Session-level токени і `session.model` MUST NOT додаватись у карти як другий внесок. Для `costUsd` рішення fallback MUST прийматись **на кожну сесію окремо**: якщо сума `sources[].costUsd` **цієї** сесії є числом — карти додають лише цю суму для цієї сесії; якщо сума `sources[].costUsd` **цієї** сесії є `null`, а `session.costUsd` є числом (Amp Cost / self-report / flag) — `spend.costUsd`, `spendByPlatform.<session.platform>.costUsd` і `phases.<phase>.costUsd` MUST додати цей `session.costUsd` **один раз для цієї сесії** через накопичення (`addNullable`), навіть коли агрегат уже містить billed попередньої сесії. MUST NOT пропускати fallback сесії лише тому, що агрегат уже не `null`. MUST NOT копіювати `session.costUsd` на кожен source і MUST NOT множити $N × кількість sources. `spendByModel` MAY взяти Amp billed з унікальних `usageModels` цього thread; MUST NOT ставити `session.costUsd` на кожен рядок моделі. Коли `sources` порожні, карти SHALL брати session-level поля (самозвіт / flag без адаптера). Бакет без внеску MUST лишатись null-honest із `source: "none"`. `spendByPlatform.*.ampCredits` SHALL лишатись окремим полем і MUST NOT входити в жодну суму USD.

Кожне записане поле `costUsdEstimated`, яке є сумою (`spend`, `spendByPlatform.*`, `spendByModel[]`, `phases.*`, session-level після суми sources), SHALL зберігатись як `Math.round(x * 10000) / 10000`. `null` лишається `null`.

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

#### Scenario: Sources непорожні — карти лише з sources, без family

- **GIVEN** сесія з `--model` / `session.model: cursor-grok-4.6`, `session.totalTokens: 49412` і `sources` з `cursor-grok-4.6-low` на 49412 і ще одним source на 1052650
- **WHEN** агрегати перераховуються
- **THEN** `spendByModel` містить `cursor-grok-4.6-low` і не містить рядка `cursor-grok-4.6`
- **AND** phase spend цієї фази дорівнює сумі обох sources (`1102062`), не `49412`

#### Scenario: Самозвіт і sources не подвоюються

- **GIVEN** сесія з `totalTokens: 1000`, `platform: claude` і `sources`, сума яких теж `1000`
- **WHEN** агрегати перераховуються
- **THEN** `spendByPlatform.claude.totalTokens` дорівнює `1000`

#### Scenario: Amp Cost один раз у rollup коли sources без costUsd

- **GIVEN** сесія `phase: apply`, `platform: amp`, `session.costUsd: 12.69`
- **AND** `sources` має щонайменше три записи з `costUsd: null`
- **WHEN** агрегати перераховуються (persist або leftover rewrite)
- **THEN** `spend.costUsd` дорівнює `12.69`
- **AND** `spendByPlatform.amp.costUsd` дорівнює `12.69`
- **AND** `phases.apply.costUsd` дорівнює `12.69`
- **AND** жодне з цих полів не дорівнює `38.07`

#### Scenario: Три Amp-сесії з Cost складаються у rollup

- **GIVEN** три сесії `platform: amp` з `session.costUsd` `4.42`, `8.81` і `12.69`
- **AND** у кожної `sources` непорожні і всі `sources[].costUsd` є `null`
- **WHEN** агрегати перераховуються (persist, leftover rewrite або `recompute`)
- **THEN** `spend.costUsd` дорівнює `25.92`
- **AND** `spendByPlatform.amp.costUsd` дорівнює `25.92`
- **AND** жодне з цих полів не дорівнює лише `4.42` і не дорівнює лише `12.69`

#### Scenario: costUsdEstimated агрегується окремо від billed

- **GIVEN** сесія cursor з `costUsd: null`, `costUsdEstimated: 1.25` і сесія claude з `costUsd: 0.42`, `costUsdEstimated: null`
- **WHEN** агрегати перераховуються
- **THEN** `spend.costUsd` дорівнює `0.42`
- **AND** `spend.costUsdEstimated` дорівнює `1.25`
- **AND** `spendByPlatform.cursor.costUsdEstimated` дорівнює `1.25`
- **AND** `spendByPlatform.claude.costUsd` дорівнює `0.42`

#### Scenario: Сума estimate округлюється до 4 знаків

- **GIVEN** три sources з `costUsdEstimated` `2.3911`, `2.8153` і `1.355`
- **WHEN** агрегати перераховуються
- **THEN** `spend.costUsdEstimated` дорівнює `6.5614`
- **AND** значення не містить хвоста `00000001`

#### Scenario: Фази не клонують totals.leadTimeMs

- **GIVEN** сесії `phase: spec` і `phase: review` з різними `startedAt` / `endedAt` / `durationMs` і розривом між ними
- **WHEN** агрегати перераховуються
- **THEN** `phases.spec.startedAt` і `phases.review.startedAt` різні
- **AND** `phases.spec.durationMs` не дорівнює `totals.leadTimeMs`
- **AND** `totals.leadTimeMs` є earliest→latest по всіх сесіях

### Requirement: Amp CLI віддає mode і billed USD

Коли locked client є `amp` (або `--collect`), адаптер `amp-cli` SHALL після `amp threads export <id>` викликати `amp threads usage <id> --details` (бінар `AOK_AMP_BIN` або `amp`, fail-open, без сирого HTTP). З export SHALL братися `usage.model`, токени і `agentMode` (`low` / `medium` / `high` / `ultra` з `thread.agentMode` або `thread.meta.agentMode`). З usage SHALL братися рядок `Cost: $N` у `session.costUsd` / `spendByPlatform.amp.costUsd` і таблиця Models у `session.usageModels`. Після persist і будь-якого `recomputeSpendMaps` / `recomputeMetricsAggregates` `spend.costUsd` і `spendByPlatform.amp.costUsd` MUST дорівнювати цьому Cost, навіть коли всі `sources[].costUsd` є `null` (див. «Агрегати перераховуються на кожному записі»). Рядок `Cost: $N` є єдиним Amp billed USD: він SHALL писатись зі `costSource: "amp-usage"` на source, коли Cost реально спарсився. MUST NOT копіювати те саме `costUsd` на кожен message source. Відсутній рядок `Cost:` MUST лишати `costUsd: null` (fail-open), навіть коли usage містить токени або таблицю Models. Kit MUST NOT множити Amp-токени на ставки і MUST NOT ділити чи множити `ampCredits`, щоб отримати USD. `ampCredits` SHALL лишатись окремим полем і MUST NOT записуватись як `costUsd`. `agentMode` SHALL писатись у `session.agentMode` і MUST NOT ставати `session.model`. Плейсхолдер `amp-default` трактується як відсутня модель, тож primary id з sources перемагає. Amp credits MUST NOT конвертуватись у USD. `usageModels` SHALL відповідати «usageModels лише цього thread без дублікатів».

#### Scenario: Amp usage inject заповнює costUsd і agentMode

- **GIVEN** `exportAmpThread` повертає thread з `agentMode: "low"` і usage GLM
- **AND** `usageAmpThread` повертає `{ costUsd: 1.3 }`
- **WHEN** виконується collect Amp CLI
- **THEN** `sources[0].agentMode` є `"low"`
- **AND** `ampThreads[0].costUsd` є `1.3`

#### Scenario: Persist+recompute пише Cost у spend maps

- **GIVEN** Amp collect повернув щонайменше один source з `costUsd: null` і `ampThreads[0].costUsd: 1.3`
- **WHEN** persist записує сесію і перераховує агрегати
- **THEN** `sessions[0].costUsd` дорівнює `1.3`
- **AND** `spend.costUsd` дорівнює `1.3`
- **AND** `spendByPlatform.amp.costUsd` дорівнює `1.3`
- **AND** жоден `sources[].costUsd` не дорівнює `1.3`

#### Scenario: Amp usage без рядка Cost лишає costUsd null

- **GIVEN** текст `amp threads usage --details` містить токени і не містить рядка `Cost: $N`
- **WHEN** викликається `parseAmpUsageDetails`
- **THEN** `costUsd` є `null`
- **AND** токени збережені, якщо вони були в тексті
- **AND** жодне поле не отримує USD, порахований з токенів або з `ampCredits`

### Requirement: Канонічна Closed role у metrics.json

`session.role`, `pending.role` і `phases.*.agents` MUST зберігати канонічний токен ролі, не повний рядок Closed role з `handoff.md`. Канонічні токени: `Explorer`, `Architect`, `Spec Reviewer`, `Implementer`, `Archiver`, `Design Intake`. CLI SHALL брати перший відомий токен з Closed role або next role (регістр ігнорується; `Spec Reviewer` — два слова) або перший сегмент до `—` / коми, якщо він збігається з токеном. Текст після `—` MUST NOT записуватись у `session.role`, MUST NOT записуватись у `pending.role` і MUST NOT потрапляти в `phases.*.agents`. `handoff.md` MAY лишати повне речення Closed role. `metricsRecordSessionStart` SHALL пропускати роль через ту саму `canonicalRole`, що й persist.

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
