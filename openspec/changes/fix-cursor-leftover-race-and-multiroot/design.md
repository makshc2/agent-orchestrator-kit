## Context

`change-metrics` уже має два вікна (persist `[pending.startedAt, endedAt]` і leftover `[last.endedAt, leftoverEnd]`), Cursor-фільтр `conversationId` на persist (`bin/spend-collect.js` + `cursorConversationId: last.threadId`) і leftover `sessionEnd` у `scripts/cursor-spend-collect.cjs`. На kit v0.11.0 цього недостатньо.

Бойовий прогін registration-log-fe `workplace-warehouse-and-document-mask` (2026-09-02): persist/archive collect іде, поки jsonl порожній (`sources: []`, `spendSource: unreported`); hook `stop` / `afterAgentResponse` приходить на 15–35 с пізніше. Чинний тест «sessionEnd leftover after archive» пише jsonl **спочатку**, потім collect — інверсія live-порядку. Archiver finalize 16:20:21Z, hook 16:20:56Z (1 061 145 / 13 892, id `4f85ec6a`, у вікні `endedAt+120s`); sessionEnd торкнувся mtime архіву, але `updatedAt` лишився 16:20:21, `sources` лишились `[]`. 1.06M назавжди зникли.

Друга щілина: `incomingCursorSources` не фільтрує `last.threadId`. Persist leftover фільтрує. Якщо вікно leftover ретраїться, hotfix-чат `4d51c2c4` (~3.89M) не має потрапити в Implementer/Archiver.

Третя: hook `resolveBaseDir` перемагає перший cwd із `.agents` (часто kit у multi-root); collect — перший cwd із `openspec/changes`. Observer `22ac5d1c` протік у FE jsonl; sessionEnd без thread-фільтра + чужий cwd = miss або cross-repo write.

Четверта: `addNullable` дає `6.561400000000001` на сумі вже округлених per-source estimate.

П’ята: `phases.<phase>` не має `startedAt` / `endedAt`. Трекер (YouTrack-скрін 2026-09-02) ставить на Спека / Рев’ю / Apply / Усього одні й ті самі 02.09.2026 19:00–19:20, 20 хв 1 с, 2 коміти — це `totals.leadTimeMs` і git first-last, не межі фази. FE archive ended ~16:20:21Z = 19:20 Київ.

Design: none (немає UI). Не бекфілимо FE-архів цього прогону.

## Goals / Non-Goals

**Goals:**

- Рядок, який уже лежить у jsonl у leftover-вікні, причіплюється навіть після порожнього persist/archive collect.
- `stop` / `afterAgentResponse` самі запускають leftover одразу після append.
- `sessionEnd` leftover ідемпотентний і фільтрує `conversationId` як persist.
- Hook і collect обирають той самий consumer у multi-root; collect оновлює кожен кандидат.
- Кожен записаний агрегат `costUsdEstimated` з сум — рівно 4 знаки.
- Кожна фаза має власні `startedAt` / `endedAt` / `leadTimeMs`; `durationMs` лишається сумою work time і не клонує `totals.leadTimeMs`.

**Non-Goals:**

- Explorer без restore, rewrite `## Metrics`, `subagentStop` без токенів, розтяг `durationMs`, бекфіл архівів, live HTTP / Cursor SDK / нові npm-залежності, зміна grok table, протокол `session-handoff`, YouTrack UI, per-phase `git log` / лічильник комітів.

## Decisions

### D1. Leftover одразу після append, не ширше вікно і не повторний persist

Чинне вікно leftover (`pending.startedAt` або `endedAt+120s`) уже покриває live-затримку 15–35 с (Archiver: hook у `endedAt+35s`, вікно до +120s). Проблема — момент collect, не ширина вікна.

**Обрано:** після успішного `appendFileSync` у `cursor-usage.jsonl` hook `stop` / `afterAgentResponse` викликає той самий leftover-backfill, що `sessionEnd`. Fail-open, без stdout. `subagentStop` без token-полів як і раніше не пише рядок і не викликає leftover.

**Відхилено:** чекати лише `sessionEnd` (бойовий miss: sessionEnd збігся з hook або пішов у чужий cwd). **Відхилено:** розширити grace понад 120s (підхопить hotfix). **Відхилено:** повторний persist з батьківської сесії (протокол закритий).

### D2. sessionEnd лишається; collect експортує entry без другого stdin

`scripts/cursor-spend-collect.cjs` зараз реєструє stdin на load. `require` з hook підвісить другі listeners.

**Обрано:** collect SHALL експортувати leftover-entry (`main` / `backfillLeftover(payload)`) і реєструвати stdin **лише** коли `require.main === module`. Hook після append робить `require` сусіднього `cursor-spend-collect.cjs` і викликає entry з тим самим payload (включно з `workspace_roots` / `conversation_id`). Помилка require/backfill ковтається. Немає `spawn` і немає зайвого stdout.

`sessionEnd` leftover MUST лишатись. Dedup за `source.id` і fingerprint — повторний прохід не подвоює рядок і MAY no-op (без зміни `updatedAt`, якщо incoming порожній і enrich не змінив файл).

`templates/scripts/*` байт-синхронні з `scripts/*` (як у попередньому metrics change).

**Відхилено:** `spawnSync node collect` (зайвий процес у hook). **Відхилено:** третій спільний файл, поки hook+collect достатньо. **Відхилено:** імпорт ESM `bin/spend-collect.js` з CJS hook (ламає fail-open і dual-packaging).

### D3. Leftover sessionEnd фільтрує як persist; `threadId: null` — time-only

**Обрано:** `incomingCursorSources` (і будь-який шлях leftover у collect) MUST приймати filter id = `last.threadId` (непорожній рядок). Якщо filter є — skip рядок з відсутнім або іншим `conversationId`. Persist `attachLeftoverSources` уже передає `cursorConversationId: last.threadId` — не регресувати; не вимагати змін `bin/spend-collect.js`, якщо sessionEnd фільтр живе в CJS. Спільний helper у `bin/spend-collect.js` дозволений лише якщо тести не ламають CJS hook.

Коли `last.threadId` є `null` / порожній — time-only, як чинний persist без filter (Explorer без restore не втрачає всі рядки).

**Відхилено:** фільтрувати завжди (зламає Explorer без restore і фікстури без `conversationId`). **Відхилено:** брати filter лише з env `CURSOR_CONVERSATION_ID` на sessionEnd (після archive env може бути інший чат).

### D4. Один ranking `resolveBaseDir` для запису jsonl

Кандидати = унікальні існуючі абсолютні шляхи з `process.cwd()` і `payload.workspace_roots[]`.

**Обрано** (перший унікальний матч перемагає):

1. Корінь, у якого active `openspec/changes/<name>/metrics.json` **або** найсвіжіший `openspec/changes/archive/*-<name>/metrics.json` має `pending.threadId` або `sessions[last].threadId` рівний цьому `conversation_id` (непорожній).
2. Інакше корінь, де є хоча б один active `openspec/changes/<name>/` (не лише `archive/`).
3. Інакше корінь, у чиєму `.agents/spend/cursor-usage.jsonl` уже є цей `conversationId`.
4. Інакше `cwd`, якщо cwd є кандидатом і має `openspec/changes` або `.agents`.
5. Інакше перший кандидат після **стабільного сортування шляхів** (не порядок `workspace_roots`).

MUST NOT повертати «перший `.agents`» (чинний hook) і MUST NOT «перший `openspec/changes`» (чинний collect). У вікні kit+consumer kit часто має обидва маркери і програє лише на кроці 1, коли conversation належить consumer.

Той самий ranking у hook (один jsonl на запис) і як default single-root, якщо комусь потрібен один cwd.

**Відхилено:** лишити різні евристики hook vs collect. **Відхилено:** завжди писати в усі корені (подвійний jsonl, observer leak).

### D5. Collect leftover по кожному кандидату з `openspec/changes`

**Обрано:** `sessionEnd` і hook post-append leftover SHALL обійти **кожний** кандидат, у якого є `openspec/changes`, і для кожного викликати чинний backfill (active names + newest archive per name), читаючи **цей** корінь `.agents/spend/cursor-usage.jsonl`. Один sessionEnd з cwd=kit усе одно оновлює archive consumer.

Fail-open на кожному корені: помилка одного не зупиняє інші.

**Відхилено:** leftover лише в `resolveBaseDir()` (бойовий miss, коли sessionEnd стартує з kit).

### D6. Округлення estimate на записі, не в `addNullable`

**Обрано:** `roundUsd4(x) = x == null ? null : Math.round(Number(x) * 10000) / 10000`. Застосовувати до кожного `costUsdEstimated`, який є сумою, **після** циклу сум, перед `writeFileSync` / `saveMetricsFile`: `spend`, `spendByPlatform.*`, `spendByModel[]`, `phases.*`, session-level після `sourceTotals` / `applyCollectedSessionFields`. Те саме в `recompute` collect-скрипта. Токени і `costUsd` не чіпати в `addNullable`.

**Відхилено:** округляти всередині `addNullable` (непотрібно для цілих токенів; ризик сховати інші баги). **Відхилено:** лишити float і округляти лише в human `metrics` (журнал уже кривий).

### D7. Тест live-order, не інверсія чинних +5s

Чинний «sessionEnd leftover after archive» (jsonl → collect +5s) лишається. Додати окремий регресійний тест: finalize archive при порожньому jsonl → append `stop` +35s (`<= endedAt+120s`) → collect (sessionEnd **або** post-append hook) → Archiver містить id, `spendSource === 'adapter'`, totals = сума sources.

Тести multi-root і hotfix conversationId — у `test/smoke.test.js` / `test/spend-collect.test.js`. Новий файл лише якщо існуючі стануть нечитабельними.

### D8. Межі фази з сесій фази; durationMs лишається work time

Трекер без per-phase bounds копіює change-wide `totals.leadTimeMs` (і git first-last) на кожен рядок фази.

**Обрано:**

- `phases.<phase>.startedAt` = найраніший валідний `session.startedAt` серед сесій з цим `phase` (немає жодного — `null`).
- `phases.<phase>.endedAt` = найпізніший валідний `session.endedAt` серед тих самих сесій (немає — `null`).
- `phases.<phase>.durationMs` = сума `session.durationMs` цих сесій (чинна семантика work time). MUST NOT бути `endedAt − startedAt` і MUST NOT бути `totals.leadTimeMs`.
- `phases.<phase>.leadTimeMs` = `endedAt − startedAt` **лише цієї фази**, коли обидва кінці відомі; інакше `null`. Додаємо поле, щоб експортер не брав `durationMs` як lead і не клонував `totals.leadTimeMs`.
- `totals.leadTimeMs` / `totals.durationMs` без зміни семантики (весь change: earliest `startedAt` → latest `endedAt`; сума всіх `session.durationMs`).
- `recomputeMetricsAggregates` у `bin/agent-orchestrator.js` і `recompute` у `scripts/cursor-spend-collect.cjs` (байт-синхронний template) пишуть нові поля на кожному записі, щоб leftover rewrite не зрізав їх.
- `renderMetricsSummary` / `metrics` CLI: колонка duration фази = `phase.durationMs`. MAY додати startedAt/endedAt (або lead) у таблицю чи рядок фази. MUST NOT друкувати той самий timestamp/duration для двох фаз, у яких session bounds різні.

Порівняння меж — через epoch ms (`parseFlexibleIso` / `Date.parse`), не рядкове порівняння ISO.

**Відхилено:** копіювати `totals` на кожну фазу (бойовий скрін). **Відхилено:** рахувати `phase.durationMs` як `endedAt − startedAt` (змішає lead і work). **Відхилено:** виводити межі фази з `git log` / кількості комітів (немає ledger; 2 коміти на всіх рядках — артефакт експортера).

## Risks / Trade-offs

- **[Ризик] Hook `require` collect підвантажить важкі залежності або stdin.** → collect лишається чистим CJS без ESM; stdin тільки під `require.main === module`; hook обгортає виклик у `try/catch`.
- **[Ризик] Обидва репо мають active change; без збігу threadId hook пише не туди.** → крок 1 (threadId) закриває бойовий випадок; крок 2 обирає active, не archive-only; документ у README: multi-root без restore (немає threadId) менш надійний, ніж з restore.
- **[Ризик] Leftover на всіх коренях причепить observer-рядок до kit, якщо kit jsonl має той самий час і `threadId: null`.** → filter за `last.threadId`, коли він є; kit-сесія з іншим threadId не бере FE-рядок.
- **[Ризик] Два leftover (hook + sessionEnd) гонять write.** → dedup за id; другий прохід incoming порожній → no-op без обов’язкового rewrite.
- **[Ризик] Історичні архіви (1.06M miss) лишаються кривими.** → свідомо; бекфіл поза scope.
- **[Ризик] Persist цього change без restore уже поставив Architect `startedAt` з observer hook і `durationMs` ~79 хв при `threadId: null`.** → не розширюємо в unbounded-collect rewrite; фазний годинник лише агрегує вже записані session bounds (одна згадка, без нового вікна collect).
- **[Ризик] Експортер і далі клонує `totals`, ігноруючи нові поля.** → `leadTimeMs` на фазі + README; YouTrack UI поза scope.

## Migration Plan

Немає міграції файлів. Нові hook/collect/persist пишуть за новими правилами. Rollback = попередня версія кіта. Споживачі читають ту саму схему v1. `update` / `sync` копіюють байт-синхронні скрипти.

## Open Questions

Немає. D1–D8 закривають бойові баги без нового вікна leftover, без HTTP і без git-фаз.
