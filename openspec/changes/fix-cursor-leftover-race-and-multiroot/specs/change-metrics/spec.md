## ADDED Requirements

### Requirement: Leftover attach після порожнього persist/archive collect

Якщо persist або archive finalize уже записали сесію з `sources: []` (jsonl ще не існував або був порожній), Cursor-рядок, який згодом з’явився на диску з `at` у leftover-вікні цієї сесії (`at >= last.endedAt` і `at <= last.endedAt + 120s`, коли pending немає), MUST бути причеплений leftover-backfill (`sessionEnd` або hook post-append) до **цієї** останньої сесії. Dedup за `source.id` / fingerprint. Після attach leftover MUST перерахувати session totals з усіх sources, якщо немає прапорця або числового самозвіту, і виставити `spendSource: adapter`. `updatedAt` MUST оновитись, коли sources змінились.

Рядок у вікні, який існує на диску в момент collect, MUST NOT ігноруватись лише тому, що перший persist/archive collect уже записав порожні `sources`.

#### Scenario: Live-order leftover після порожнього archive

- **GIVEN** `archive <name>` фіналізував Archiver при порожньому `.agents/spend/cursor-usage.jsonl`
- **AND** `Archiver.sources` є `[]` і `spendSource` є `unreported`
- **AND** згодом з’являється hook-рядок `id: 4f85ec6a` з `at = Archiver.endedAt + 35s` і `at <= Archiver.endedAt + 120s`
- **WHEN** виконується leftover-collect (`node scripts/cursor-spend-collect.cjs` як `sessionEnd` або leftover після append hook)
- **THEN** `Archiver.sources` містить `id: 4f85ec6a`
- **AND** `Archiver.spendSource` дорівнює `adapter`
- **AND** session totals Archiver дорівнюють сумі всіх його sources
- **AND** `updatedAt` пізніший за час finalize

#### Scenario: Порожній persist потім пізній stop

- **GIVEN** persist записав сесію з `sources: []` і `endedAt` T
- **AND** hook-рядок з `id: late-stop` має `at = T + 20s` і входить у leftover-вікно
- **WHEN** виконується leftover-collect
- **THEN** `late-stop` є в `sources` цієї сесії
- **AND** `spendSource` дорівнює `adapter`

### Requirement: Hook leftover після успішного append

Після успішного допису рядка в `<project>/.agents/spend/cursor-usage.jsonl` hook подій `stop` і `afterAgentResponse` SHALL виконати той самий leftover-backfill, що й `scripts/cursor-spend-collect.cjs` на `sessionEnd`, проти резолвлених коренів (див. «Спільний multi-root resolveBaseDir»). Виклик MUST бути fail-open: будь-яка помилка leftover MUST NOT змінювати exit hook і MUST NOT друкувати stdout. `sessionEnd` leftover MUST лишатись і MUST бути ідемпотентним: повторний прохід з тим самим `source.id` / fingerprint MUST NOT дублювати рядок.

`subagentStop` без `input_tokens` / `output_tokens` MUST NOT писати рядок і MUST NOT запускати leftover. Hook MUST реєструвати leftover лише після успішного append (не коли рядок відхилено через відсутні токени).

#### Scenario: stop після append причіплює leftover без sessionEnd

- **GIVEN** `metrics.json` з останньою сесією `endedAt` T, `threadId` рівним `conversation_id` payload, `sources: []`
- **AND** payload `stop` має токени і `at` у leftover-вікні буде T+N де N ≤ 120s
- **WHEN** виконується `scripts/cursor-spend-hook.cjs` з цим payload (без окремого `sessionEnd`)
- **THEN** рядок з’являється в jsonl
- **AND** той самий `id` є в `sources` останньої сесії
- **AND** stdout hook порожній
- **AND** exit code 0

#### Scenario: Повторний sessionEnd не дублює id

- **GIVEN** hook уже причепив `id: g-1` leftover-ом
- **WHEN** виконується `node scripts/cursor-spend-collect.cjs` (`sessionEnd`)
- **THEN** `sources` містить `g-1` рівно один раз
- **AND** exit code 0
- **AND** stdout порожній

#### Scenario: afterAgentResponse теж запускає leftover

- **GIVEN** остання сесія з порожніми `sources` і matching `threadId`
- **WHEN** hook `afterAgentResponse` успішно дописує рядок з токенами
- **THEN** leftover цього рядка виконується так само, як після `stop`

### Requirement: Спільний multi-root resolveBaseDir для hook і collect

`resolveBaseDir` у `scripts/cursor-spend-hook.cjs` і `scripts/cursor-spend-collect.cjs` (і їхні `templates/scripts/` копії) MUST розглядати одні й ті самі кандидати: `process.cwd()` плюс `payload.workspace_roots` (масив існуючих абсолютних шляхів; дублікати прибрати).

Для **запису** jsonl hook SHALL обрати один корінь у такому порядку (перший унікальний матч):

1. Корінь, у якого active `openspec/changes/<name>/metrics.json` або найсвіжіший `openspec/changes/archive/*-<name>/metrics.json` має `pending.threadId` або `sessions[last].threadId` точно рівний непорожньому `conversation_id` payload.
2. Інакше корінь, де є хоча б один active `openspec/changes/<name>/` (каталог зміни, не лише `archive/`).
3. Інакше корінь, у чиєму `.agents/spend/cursor-usage.jsonl` уже є цей `conversationId`.
4. Інакше `cwd`, якщо cwd є кандидатом і містить `openspec/changes` або `.agents`.
5. Інакше перший кандидат після стабільного сортування шляхів.

Hook і collect MUST NOT обирати sibling лише тому, що його cwd першим має `.agents` або `openspec/changes` (типове вікно kit + consumer).

Collect (`sessionEnd` і leftover після append) SHALL виконати leftover-backfill для **кожного** кандидата, у якого є `openspec/changes`, читаючи **цей** корінь `.agents/spend/cursor-usage.jsonl` і пишучи в **його** active / newest-archive `metrics.json`. Помилка одного кореня MUST NOT зупиняти інші (fail-open). Один `sessionEnd` у multi-root вікні MUST оновити archive consumer, не лише kit.

`scripts/` і `templates/scripts/` відповідних файлів MUST лишатись байт-синхронними.

#### Scenario: Hook пише jsonl у consumer, не в kit

- **GIVEN** multi-root вікно: kit (cwd, має `.agents` і `openspec/changes`) і consumer (`workspace_roots` містить обидва)
- **AND** consumer має active або найсвіжіший archive `metrics.json` з `pending.threadId` або `last.threadId` рівним `conversation_id` payload
- **AND** kit не має цього `threadId` у pending/last
- **WHEN** hook `stop` дописує рядок
- **THEN** рядок з’являється в `consumer/.agents/spend/cursor-usage.jsonl`
- **AND** рядок відсутній у `kit/.agents/spend/cursor-usage.jsonl` як єдиний запис цього id (kit не є цільовим коренем запису)

#### Scenario: sessionEnd з cwd=kit оновлює archive consumer

- **GIVEN** немає `consumer/openspec/changes/<name>/`
- **AND** існує `consumer/openspec/changes/archive/*-<name>/metrics.json` з останньою сесією
- **AND** hook-рядок лежить у `consumer/.agents/spend/cursor-usage.jsonl` у leftover-вікні
- **AND** payload `workspace_roots` містить kit і consumer; `process.cwd()` є kit
- **WHEN** виконується `node scripts/cursor-spend-collect.cjs`
- **THEN** рядок є в `sources` останньої сесії архівного `metrics.json` consumer
- **AND** leftover читав jsonl consumer, не kit

#### Scenario: Перший openspec у kit не перемагає consumer з active change

- **GIVEN** kit cwd має `openspec/changes`, consumer у `workspace_roots` має active `openspec/changes/<name>/`
- **AND** немає збігу `conversation_id` з threadId жодного metrics
- **WHEN** резолвиться корінь для запису jsonl
- **THEN** обрано consumer (active change), не kit лише через порядок cwd / `.agents`

### Requirement: Оцінені USD-агрегати округлюються до 4 знаків

Кожен запис `metrics.json`, що перераховує `spend.costUsdEstimated`, `spendByPlatform.*.costUsdEstimated`, `spendByModel[].costUsdEstimated`, `phases.*.costUsdEstimated` або session-level `costUsdEstimated` **із сум**, SHALL зберігати число з 4 десятковими знаками: `Math.round(x * 10000) / 10000`. `null` MUST лишатись `null`. Per-source оцінки вже округлені так само; агрегат MUST повторно округлювати суму, щоб не зберігати бінарний float на кшталт `6.561400000000001`. `costUsd` і токени MUST NOT змішуватись з цим правилом у `addNullable`.

#### Scenario: Сума трьох estimate стає 6.5614

- **GIVEN** sources з `costUsdEstimated` `2.3911`, `2.8153` і `1.355`
- **WHEN** агрегати перераховуються і файл записується
- **THEN** `spend.costUsdEstimated` суворо дорівнює `6.5614`
- **AND** значення не є `6.561400000000001`
- **AND** відповідні `spendByPlatform.cursor.costUsdEstimated`, рядок `spendByModel` і `phases.*.costUsdEstimated` цієї фази теж дорівнюють `6.5614`, якщо всі три sources належать одній платформі/моделі/фазі

#### Scenario: null estimate лишається null

- **GIVEN** сесії без жодного ненульового `costUsdEstimated`
- **WHEN** агрегати перераховуються
- **THEN** `spend.costUsdEstimated` є `null`

### Requirement: Межі фази — з сесій цієї фази, не клон totals

Кожен запис `metrics.json` SHALL ставити на `phases.<phase>`:

- `startedAt` — найраніший валідний `session.startedAt` серед сесій з цим `phase`, інакше `null`;
- `endedAt` — найпізніший валідний `session.endedAt` серед тих самих сесій, інакше `null`;
- `durationMs` — сума `session.durationMs` цих сесій (work time, null-honest);
- `leadTimeMs` — `endedAt − startedAt` **лише цієї фази**, коли обидва кінці відомі, інакше `null`.

`phases.<phase>.durationMs` MUST NOT дорівнювати `endedAt − startedAt` і MUST NOT копіюватись з `totals.leadTimeMs`. `totals.leadTimeMs` SHALL лишатись earliest `session.startedAt` → latest `session.endedAt` по **всіх** сесіях change-у. `totals.durationMs` SHALL лишатись сумою всіх `session.durationMs`. Kit MUST NOT виводити межі або тривалість фази з `git log` і MUST NOT писати per-phase лічильник комітів.

`renderMetricsSummary` / `metrics` без `--json` SHALL показувати duration фази з `phase.durationMs` і MUST NOT друкувати той самий timestamp або ту саму duration для двох фаз, у яких session bounds різні. MAY показати `startedAt` / `endedAt` або `leadTimeMs` фази. `--json` віддає сирий об'єкт з новими ключами.

#### Scenario: Спека і рев’ю мають різні межі

- **GIVEN** сесія `phase: spec` з `startedAt: 2026-09-02T16:00:00.000Z`, `endedAt: 2026-09-02T16:08:00.000Z`, `durationMs: 480000`
- **AND** сесія `phase: review` з `startedAt: 2026-09-02T16:10:00.000Z`, `endedAt: 2026-09-02T16:12:00.000Z`, `durationMs: 120000`
- **WHEN** агрегати перераховуються
- **THEN** `phases.spec.startedAt` дорівнює `2026-09-02T16:00:00.000Z`
- **AND** `phases.spec.endedAt` дорівнює `2026-09-02T16:08:00.000Z`
- **AND** `phases.spec.durationMs` дорівнює `480000`
- **AND** `phases.spec.leadTimeMs` дорівнює `480000`
- **AND** `phases.review.startedAt` дорівнює `2026-09-02T16:10:00.000Z`
- **AND** `phases.review.endedAt` дорівнює `2026-09-02T16:12:00.000Z`
- **AND** `phases.review.durationMs` дорівнює `120000`
- **AND** `phases.review.startedAt` не дорівнює `phases.spec.startedAt`
- **AND** `phases.review.endedAt` не дорівнює `phases.spec.endedAt`
- **AND** `phases.review.durationMs` не дорівнює `phases.spec.durationMs`

#### Scenario: durationMs фази не є lead усього change

- **GIVEN** сесія `phase: spec` з `startedAt` T0, `endedAt` T1, `durationMs` 300000
- **AND** сесія `phase: apply` з `startedAt` T1+600000, `endedAt` T1+720000, `durationMs` 120000
- **WHEN** агрегати перераховуються
- **THEN** `totals.leadTimeMs` дорівнює різниці між T0 і `T1+720000` (earliest→latest по всіх сесіях)
- **AND** `phases.spec.durationMs` дорівнює `300000`
- **AND** `phases.apply.durationMs` дорівнює `120000`
- **AND** жоден `phase.durationMs` не дорівнює `totals.leadTimeMs`
- **AND** `phases.spec.leadTimeMs` дорівнює `T1 − T0` і не дорівнює `totals.leadTimeMs`

#### Scenario: Дві сесії однієї фази — earliest/latest і сума work

- **GIVEN** дві сесії `phase: spec` з `startedAt`/`endedAt`/`durationMs` (T0–T1, 100000) і (T2–T3, 50000), T2 > T1
- **WHEN** агрегати перераховуються
- **THEN** `phases.spec.startedAt` дорівнює T0
- **AND** `phases.spec.endedAt` дорівнює T3
- **AND** `phases.spec.durationMs` дорівнює `150000`
- **AND** `phases.spec.leadTimeMs` дорівнює `T3 − T0` і не дорівнює `150000`

## MODIFIED Requirements

### Requirement: Вікно collect, cwd-match і dedup

Є рівно два вікна. Третього вікна MUST NOT бути.

**Persist цієї сесії.** Коли collect запущено (`--collect`, locked client, або `metrics --collect` для нової сесії), вікно SHALL бути `[pending.startedAt || --started-at, endedAt]`. Якщо немає ні pending, ні `--started-at`, нижня межа MAY бути відсутня лише для collect sources цієї сесії; `startedAt` сесії тоді береться з earliest `source.at`. CLI MUST NOT ставити нижню межу persist на `last.endedAt`.

**Leftover останньої закритої сесії.** Persist (перед collect поточної), archive (перед collect Archiver), Cursor `sessionEnd` і Cursor hook після успішного append `stop` / `afterAgentResponse` SHALL причіплювати до **останньої вже закритої** сесії події, яких ще немає за `source.id`, з `at >= last.endedAt` і `at < leftoverEnd`. `leftoverEnd` SHALL бути `pending.startedAt`, коли наступний `pending` існує (навіть якщо це пізніше за 120s); інакше `last.endedAt + 120s` (інклюзивно). Подія після `last.endedAt` і до `next.pending.startedAt` MUST належати останній закритій сесії і MUST NOT входити в persist нової сесії. Після attach leftover MUST перерахувати session-level токени / `costUsd` / `costUsdEstimated` як суму **усіх** `sources` цієї сесії, якщо немає явного прапорця або числового (не-placeholder) самозвіту; `spendSource` тоді SHALL стати `adapter`, якщо totals узято з sources. Рядок, який існує на диску в момент leftover-collect і входить у вікно, MUST причепитись навіть якщо перший persist/archive collect записав `sources: []`.

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

Коли `session.sources.length > 0`, `spendByPlatform`, `spendByModel` і `phases.<phase>` spend-поля SHALL наповнюватись **лише** з `sources` (сума всіх sources сесії / фази). Session-level `inputTokens` / `outputTokens` / `totalTokens` / `costUsd` / `costUsdEstimated` / `session.model` MUST NOT додаватись у карти в цьому випадку. `phases.<phase>.spend` MUST дорівнювати сумі всіх sources усіх сесій цієї фази, не замороженим session-полям першого source. Коли `sources` порожні, карти SHALL брати session-level поля (самозвіт / flag без адаптера). Бакет без внеску MUST лишатись null-honest із `source: "none"`. `spendByPlatform.*.ampCredits` SHALL лишатись окремим полем і MUST NOT входити в жодну суму USD.

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

### Requirement: Cursor spend hook — опційне доповнення, ensure лише в setup-командах

Kit SHALL і надалі постачати `templates/scripts/cursor-spend-hook.cjs` і `templates/scripts/cursor-spend-collect.cjs` з такою поведінкою: hook читає stdin payload подій `stop` / `subagentStop` / `afterAgentResponse` і дописує запис у `<project>/.agents/spend/cursor-usage.jsonl`, лише якщо payload містить хоча б одне з `input_tokens` / `output_tokens` (включно з `conversationId`); корінь `<project>` резолвиться за «Спільний multi-root resolveBaseDir». Після успішного append подій `stop` і `afterAgentResponse` hook SHALL викликати leftover-backfill collect-скрипта проти всіх кандидатних коренів (fail-open, без stdout). Collect-скрипт на `sessionEnd` мержить нові рядки в **останню** сесію цільового `metrics.json` без додавання нової сесії і MUST фільтрувати за `last.threadId`, коли він непорожній. Цільові файли **на кожному** кандидатному корені з `openspec/changes`: кожна активна `openspec/changes/<name>/metrics.json` **і** найсвіжіший `openspec/changes/archive/*-<name>/metrics.json` для імен, яких більше немає в active. MUST NOT скіпати каталог `archive/` наосліп. Після attach leftover MUST resync totals за «Вікно collect» / «Джерело spend» (`looksOverridden` / `syncAdapterSessionTotals` MUST NOT трактувати placeholder `self-report` як override). `scripts/cursor-spend-collect.cjs` і `templates/scripts/cursor-spend-collect.cjs` MUST лишатись поведінково синхронними; те саме для пари hook. Обидва скрипти MUST бути fail-open: будь-яка помилка завершується exit 0 без stdout.

`ensureCursorSpendHook(projectDir)` SHALL викликатись лише в `init`, `update`, `sync` і `mcp-setup`. Виклики з `handoff --restore`, `handoff <name>` persist і `metrics` MUST бути видалені — жодна сесійна команда не переписує `.cursor/hooks.json` і не друкує статус hook. Merge `.cursor/hooks.json` MUST NOT видаляти чужі hooks; битий `hooks.json` MUST NOT перезаписуватись — лише warning. `.agents/spend/` MUST лишатись у GITIGNORE_LINES. `status` SHALL і далі друкувати секцію `Spend capture`, позначаючи hook як опційний.

`npx agent-orchestrator-kit metrics [name] --collect` SHALL лишатись доступним: повний collectSpend, attach до останньої сесії з вікном `[last.startedAt, now]`, dedup за `source.id`, без додавання нової сесії. MUST NOT підміняти це вікно leftover-only (`[last.endedAt, leftoverEnd)`). Після attach leftover resync (див. «Вікно collect») SHALL застосовуватись.

#### Scenario: Persist не чіпає hooks.json

- **GIVEN** проєкт без `scripts/cursor-spend-hook.cjs` і без `.cursor/hooks.json`
- **WHEN** виконується `handoff <name>` persist
- **THEN** `.cursor/hooks.json` не створюється
- **AND** stderr не містить рядка про встановлення spend hook
- **AND** exit code 0

#### Scenario: Update ставить hook

- **GIVEN** проєкт з кітом без spend-скриптів
- **WHEN** виконується `npx agent-orchestrator-kit update`
- **THEN** обидва скрипти скопійовані
- **AND** `.cursor/hooks.json` містить entries для `stop`, `subagentStop`, `afterAgentResponse` і `sessionEnd`

#### Scenario: Merge не чіпає чужі hooks

- **GIVEN** `.cursor/hooks.json` з користувацьким hook на `afterFileEdit`
- **WHEN** виконується ensure у `update`
- **THEN** користувацький hook лишається

#### Scenario: metrics --collect працює як раніше

- **GIVEN** `metrics.json` з однією сесією і порожніми `sources`
- **AND** `cursor-usage.jsonl` має запис після `sessions[0].startedAt`
- **WHEN** виконується `metrics <name> --collect`
- **THEN** `sessions.length` лишається `1`
- **AND** `sessions[0].sources` містить цей запис

#### Scenario: sessionEnd leftover після archive пише в archive metrics.json

- **GIVEN** немає `openspec/changes/<name>/`
- **AND** існує `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json` з останньою сесією
- **AND** hook-рядок у leftover-вікні цієї сесії
- **WHEN** виконується `node scripts/cursor-spend-collect.cjs`
- **THEN** рядок додано до останньої сесії архівного файла
- **AND** totals цієї сесії перераховані з усіх sources, якщо не було числового override

#### Scenario: sessionEnd leftover після порожнього archive collect (live order)

- **GIVEN** archive уже записав Archiver з `sources: []`
- **AND** jsonl був порожній під час finalize
- **AND** hook-рядок з `id: archive-late-35s` з’явився +35s після `Archiver.endedAt` і входить у `endedAt+120s`
- **WHEN** виконується leftover-collect
- **THEN** `archive-late-35s` є в `Archiver.sources`
- **AND** `spendSource` дорівнює `adapter`

### Requirement: Cursor collect фільтрує за conversationId

Адаптер cursor SHALL читати `conversationId` з рядка hook. Коли filter id присутній — непорожній `CURSOR_CONVERSATION_ID` у env collect **або** `pending.threadId` / опція collect для Cursor **або** `last.threadId` останньої сесії на leftover (`sessionEnd` / hook post-append / persist leftover) — рядок MUST входити лише якщо `row.conversationId` точно збігається з filter id. Рядок з іншим або порожнім `conversationId` MUST пропускатись. Коли filter id відсутній (`last.threadId` / pending / env є `null` або порожні), адаптер і leftover MUST NOT відкидати рядки лише через відсутній `conversationId` (time-only collect як раніше).

`handoff --restore` на клієнті cursor SHALL записати непорожній `CURSOR_CONVERSATION_ID` у `pending.threadId`. Persist SHALL передати цей id (або поточний env) у collect Cursor. Persist leftover SHALL і далі передавати `cursorConversationId: last.threadId` для cursor і MUST NOT втратити цей фільтр.

Same-cwd observer-чат і hotfix-чат з іншим `conversationId` MUST NOT потрапляти в `sources` сесії, що має filter id — включно з leftover після archive.

`scripts/cursor-spend-collect.cjs` `incomingCursorSources` SHALL застосовувати той самий filter, коли `last.threadId` непорожній.

#### Scenario: Чужий conversationId пропускається

- **GIVEN** `pending.threadId` або `CURSOR_CONVERSATION_ID` дорівнює `Y`
- **AND** hook-рядок має `conversationId: X`, `id: g-foreign`, timestamp у вікні persist
- **WHEN** виконується collect cursor
- **THEN** `g-foreign` відсутній у `sources`

#### Scenario: Збіг conversationId входить

- **GIVEN** `CURSOR_CONVERSATION_ID` дорівнює `Y`
- **AND** hook-рядок має `conversationId: Y`, `id: g-mine`, timestamp у вікні
- **WHEN** виконується collect cursor
- **THEN** `g-mine` є в `sources`

#### Scenario: Без filter id рядки не ріжуться по conversationId

- **GIVEN** немає `CURSOR_CONVERSATION_ID` і `pending.threadId` є `null`
- **AND** hook-рядок має `conversationId: X` і timestamp у вікні
- **WHEN** виконується collect cursor
- **THEN** рядок входить за правилами вікна й dedup (не відкидається лише через conversationId)

#### Scenario: Restore пише Cursor conversation id у pending

- **GIVEN** `CURSOR_CONVERSATION_ID=Y` і клієнт резолвиться як `cursor`
- **WHEN** виконується `handoff <name> --restore`
- **THEN** `pending.platform` дорівнює `cursor`
- **AND** `pending.threadId` дорівнює `Y`

#### Scenario: sessionEnd leftover не бере hotfix-чат

- **GIVEN** остання сесія Archiver має `threadId: A`
- **AND** у leftover-вікні є рядок `id: hotfix-b` з `conversationId: B`
- **AND** у тому ж вікні є рядок `id: archiver-a` з `conversationId: A`
- **WHEN** виконується `node scripts/cursor-spend-collect.cjs`
- **THEN** `hotfix-b` відсутній у `Archiver.sources`
- **AND** `archiver-a` є в `Archiver.sources`

#### Scenario: leftover з threadId null лишає time-only

- **GIVEN** остання сесія має `threadId: null`
- **AND** у leftover-вікні є рядок з `conversationId: X`
- **WHEN** виконується leftover-collect
- **THEN** рядок входить за правилами вікна й dedup (не відкидається лише через conversationId)
