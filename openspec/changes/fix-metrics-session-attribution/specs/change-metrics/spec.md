## ADDED Requirements

### Requirement: Канонічна Closed role у metrics.json

`session.role` і `phases.*.agents` MUST зберігати канонічний токен ролі, не повний рядок Closed role з `handoff.md`. Канонічні токени: `Explorer`, `Architect`, `Spec Reviewer`, `Implementer`, `Archiver`, `Design Intake`. CLI SHALL брати перший відомий токен з Closed role (регістр ігнорується; `Spec Reviewer` — два слова) або перший сегмент до `—` / коми, якщо він збігається з токеном. Текст після `—` MUST NOT записуватись у `session.role` і MUST NOT потрапляти в `phases.*.agents`. `handoff.md` MAY лишати повне речення Closed role.

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

### Requirement: Cursor collect фільтрує за conversationId

Адаптер cursor SHALL читати `conversationId` з рядка hook. Коли filter id присутній — непорожній `CURSOR_CONVERSATION_ID` у env collect **або** `pending.threadId` / опція collect для Cursor — рядок MUST входити лише якщо `row.conversationId` точно збігається з filter id. Рядок з іншим або порожнім `conversationId` MUST пропускатись. Коли filter id відсутній, адаптер MUST NOT відкидати рядки лише через відсутній `conversationId` (time-only collect як раніше).

`handoff --restore` на клієнті cursor SHALL записати непорожній `CURSOR_CONVERSATION_ID` у `pending.threadId`. Persist SHALL передати цей id (або поточний env) у collect Cursor.

Same-cwd observer-чат з іншим `conversationId` MUST NOT потрапляти в `sources` сесії, що має filter id.

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

## MODIFIED Requirements

### Requirement: Файл metrics.json є git-tracked журналом change-у

Kit SHALL писати `openspec/changes/<name>/metrics.json` (після archive — у `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json`) зі схемою версії `1`: `version`, `change`, `createdAt`, `updatedAt`, `archivedAt` (`null` до фіналізації), `spend` (`inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`), `spendByPlatform` (ключі `cursor`, `claude`, `amp` → `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`, `ampCredits`, `source`), `spendByModel` (масив `{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, ampCredits }`), `totals` (`sessions`, `durationMs`, `leadTimeMs`, `cloudSessions`), `phases` (ключ фази → `sessions`, `durationMs`, spend-поля включно з `costUsd` і `costUsdEstimated`, `agents`, `models`), `sessions` (масив записів), `pending` (`{ startedAt, role, platform, threadId, clientSource }` або `null`). Запис сесії SHALL містити `spendSource` (непорожній рядок), `ampCredits` (число або `null`), `costUsdEstimated` (число або `null`), `threadId` (Amp thread id, Cursor `conversationId`, або `null`), `sources` (масив `{ id, platform, model, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, costSource, ampCredits, at }`; порожній, коли клієнт невідомий і немає `--collect`) і опційно `models` (масив id), коли моделей більше однієї. `costUsd` SHALL містити лише billed / self-report / Amp usage `Cost: $N`. `costUsdEstimated` SHALL містити лише оцінений USD і MUST NOT дублювати billed `costUsd`. `costSource` на source SHALL бути `"api-estimate"`, `"api-estimate-fallback"` або `"amp-usage"`, коли джерело відоме; інакше поле може бути відсутнім. Файл MUST бути git-tracked (не в gitignored cache). Пошкоджений або відсутній JSON SHALL замінюватись default-об'єктом з тими самими ключами, без падіння CLI. Відсутні нові поля в legacy-файлі SHALL мержитись з default (`spendByPlatform` з трьома ключами і `null`-полями включно з `costUsdEstimated`, `spendByModel: []`, `sources: []`, `spendSource: "unreported"`, `ampCredits: null`, `costUsdEstimated: null` на `spend` і сесіях).

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

### Requirement: Restore записує старт сесії, persist — її закриття

`handoff --restore` SHALL записувати `pending` (`startedAt` = зараз, `role` з next role handoff-файлу, якщо він є, `platform`, `threadId`, `clientSource` з детекту клієнта). `handoff <name>` SHALL додавати елемент у `sessions` з: `startedAt` з `--started-at` або `pending.startedAt` або earliest `source.at` зібраних sources цієї сесії або `null`; `endedAt` = зараз; `durationMs` = різниця, коли обидва кінці відомі, інакше `null`; `role` = канонічний токен Closed role (див. «Канонічна Closed role у metrics.json»); `phase` = `phaseForRole` канонічного токена; `runtime` і `agentId` з runtime-ланцюжка; `tasks` зі знімка progress; `model` за вимогою «Модель сесії»; `platform`, токени, `costUsd`, `ampCredits` і `spendSource` з ланцюжка прапорець → числовий `## Metrics` → sources → `null`; `sources` з collect клієнта, зафіксованого на restore (або всі адаптери при `--collect`; `[]` коли клієнт невідомий і немає `--collect`). Перед collect поточної сесії persist SHALL виконати leftover-backfill останньої вже закритої сесії (див. «Вікно collect»). Після запису `pending` MUST стати `null`. Агрегати (`phases`, `totals`, `spend`, `spendByPlatform`, `spendByModel`) SHALL перераховуватись на кожному записі.

Порядок persist MUST бути: прочитати `## Metrics` → leftover попередньої сесії → collect і записати сесію в `metrics.json` → надрукувати попередження в stderr → надрукувати next-thread prompt у stdout. Prompt MUST лишатись єдиним вмістом stdout. Два послідовні persist MUST лишатись двома записами сесій і MUST NOT зливатись в один.

#### Scenario: Restore + persist закриває одну сесію

- **GIVEN** `handoff.md` з Closed role `Architect`, next role `spec-reviewer` і `## Metrics` з `model: claude-opus-5`, `input_tokens: 12000`, `output_tokens: 3000`, `cost_usd: 0.42`
- **AND** collect не повернув sources з model
- **WHEN** виконується `handoff <name> --restore`, потім `handoff <name>`
- **THEN** `pending` є `null`
- **AND** `sessions` має один запис з `role: Architect`, `phase: spec`, `model: claude-opus-5`, `totalTokens: 15000`, `costUsd: 0.42`
- **AND** `phases.spec.agents` містить `Architect`
- **AND** `phases.spec.models` містить `claude-opus-5`

#### Scenario: Два persist без restore лишаються двома сесіями

- **GIVEN** немає `pending`
- **WHEN** виконуються два persist підряд без `--restore`
- **THEN** `sessions.length` дорівнює `2`
- **AND** записи не злиті в один

### Requirement: Restore фіксує клієнта сесії, persist йде його флоу

`handoff --restore` SHALL визначити клієнта сесії і записати його в `pending`: `platform` (`cursor` | `claude` | `amp` | `null`), `threadId` (Amp thread id, або Cursor `conversationId`, або `null`), `clientSource` (непорожній рядок джерела). Резолв клієнта: `--platform` / `AOK_PLATFORM` → `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` → `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID` → Claude Code env → батьківський процес `amp` і/або свіжий `~/.local/share/amp/session.json` `lastThreadByTerminal[tty]` (вікно свіжості ≤ 2h; `/dev/null` і pipe MUST NOT рахуватись як tty) → `null`. Якщо батько є `amp` і tty немає, `pending.threadId` SHALL братися з першого id `amp threads list` (`clientSource: amp-threads-list`), MUST NOT з `session.json` `lastThreadId`. Для cursor непорожній `CURSOR_CONVERSATION_ID` SHALL стати `pending.threadId`. Amp env MUST перемагати Cursor env. `agentMode` (`low`/`medium`/`high`/`ultra`) MUST NOT ставати `session.model`.

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

### Requirement: Модель сесії — LLM product id з sources, flag або env, інакше null

`session.model` і `phases.*.models` MUST зберігати ідентифікатор LLM-продукту, не Closed role, не ім'я субагента і не family-ярлик, коли адаптер уже дав product id. Резолв SHALL бути: primary модель з `sources` (модель з найбільшим `totalTokens` серед sources з непорожнім `model`; при рівності — стабільний порядок platform, потім id) → якщо жоден source не має `model`: непорожній `--model` → непорожній `model` з `## Metrics` → непорожній env `AOK_MODEL` → `null`. `--model` / `## Metrics` / `AOK_MODEL` MUST NOT перемагати непорожній `source.model`. Family на кшталт `cursor-grok-4.6` MUST NOT з’являтись у `session.model`, `phases.*.models` чи `spendByModel`, коли sources мають product id (`cursor-grok-4.6-xhigh-fast`, `cursor-grok-4.6-low`). `session.models` SHALL містити унікальні id з sources, коли моделей більше однієї. Рядок зберігається як у usage-записі (без вигаданої таксономії). Порожнє значення і `unknown` трактуються як відсутнє. Відсутня модель MUST NOT робити persist або archive non-zero. Якщо сесія записується з `model: null`, CLI SHALL попередити в stderr. CLI MUST NOT викликати Cursor SDK, Claude `/cost` чи Amp billing API, щоб дізнатись модель.

#### Scenario: Product id з sources перемагає --model family

- **GIVEN** `--model cursor-grok-4.6`
- **AND** sources містять `model: cursor-grok-4.6-low` з `totalTokens: 1000`
- **WHEN** виконується persist
- **THEN** `session.model` дорівнює `cursor-grok-4.6-low`
- **AND** `phases` цієї сесії містить `cursor-grok-4.6-low`
- **AND** `spendByModel` не містить окремого рядка `cursor-grok-4.6`

#### Scenario: Прапорець --model перемагає самозвіт коли sources без model

- **GIVEN** `## Metrics` містить `model: claude-fable-5`
- **AND** sources порожні або без поля `model`
- **WHEN** виконується persist з `--model cursor-grok-4.6`
- **THEN** `session.model` дорівнює `cursor-grok-4.6`

#### Scenario: Самозвіт перемагає env коли sources без model

- **GIVEN** `AOK_MODEL=gpt-5.6-sol` і `## Metrics` містить `model: claude-opus-5`
- **AND** sources без model
- **WHEN** виконується persist без `--model`
- **THEN** `session.model` дорівнює `claude-opus-5`

#### Scenario: Env AOK_MODEL без прапорця і без самозвіту коли sources без model

- **GIVEN** `AOK_MODEL=gpt-5.6-sol`, немає `--model` і `## Metrics` без ключа `model`
- **AND** sources без model
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` дорівнює `gpt-5.6-sol`

#### Scenario: Відсутня модель — null, warning, exit 0

- **GIVEN** немає `--model`, немає `AOK_MODEL`, немає `## Metrics` і немає sources з model
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` є `null`
- **AND** stderr містить попередження про відсутню модель
- **AND** exit code 0

#### Scenario: Primary model з sources за totalTokens

- **GIVEN** collect повернув два sources: `claude-opus-4-7` з `totalTokens: 9000` і `gpt-5.6-sol` з `totalTokens: 1000`
- **AND** `--model cursor-grok-4.6`
- **WHEN** виконується persist
- **THEN** `session.model` дорівнює `claude-opus-4-7`
- **AND** `session.models` містить обидва id

### Requirement: Вікно collect, cwd-match і dedup

Є рівно два вікна. Третього вікна MUST NOT бути.

**Persist цієї сесії.** Коли collect запущено (`--collect`, locked client, або `metrics --collect` для нової сесії), вікно SHALL бути `[pending.startedAt || --started-at, endedAt]`. Якщо немає ні pending, ні `--started-at`, нижня межа MAY бути відсутня лише для collect sources цієї сесії; `startedAt` сесії тоді береться з earliest `source.at`. CLI MUST NOT ставити нижню межу persist на `last.endedAt`.

**Leftover останньої закритої сесії.** Persist (перед collect поточної), archive (перед collect Archiver) і Cursor `sessionEnd` SHALL причіплювати до **останньої вже закритої** сесії події, яких ще немає за `source.id`, з `at >= last.endedAt` і `at < leftoverEnd`. `leftoverEnd` SHALL бути `pending.startedAt`, коли наступний `pending` існує (навіть якщо це пізніше за 120s); інакше `last.endedAt + 120s` (інклюзивно). Подія після `last.endedAt` і до `next.pending.startedAt` MUST належати останній закритій сесії і MUST NOT входити в persist нової сесії. Після attach leftover MUST перерахувати session-level токени / `costUsd` / `costUsdEstimated` як суму **всіх** `sources` цієї сесії, якщо немає явного прапорця або числового (не-placeholder) самозвіту; `spendSource` тоді SHALL стати `adapter`, якщо totals узято з sources.

Подія MUST входити лише якщо її timestamp у відповідному вікні: Claude — поле рядка `timestamp`; Amp — `usage.timestamp`; Cursor — поле `at` hook-запису. Проєктний match порівнює з аргументом `collectSpend({ cwd })` (якщо опущено — `process.cwd()`). Claude: поле рядка `cwd` === цей шлях; без поля `cwd` подію MUST NOT включати. Amp: thread з непорожнім `trees` входить лише за збігом `trees[].uri`; без `trees` — за cwd-полями, `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` або точною згадкою cwd у JSON; MUST NOT вигадувати `meta.cwd`. Cursor: файл `<cwd>/.agents/spend/cursor-usage.jsonl` уже проєктно-локальний; додатково діє фільтр conversationId. Dedup: пропустити `source.id`, яке вже є в будь-якому `session.sources` поточного `metrics.json`.

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

### Requirement: Агрегати перераховуються на кожному записі

Кожен виклик, що зберігає `metrics.json` (persist, archive finalize, leftover backfill), SHALL перераховувати `phases`, `totals`, `spend`, `spendByPlatform` і `spendByModel` з масиву `sessions` і їхніх `sources`. `totals.durationMs` — сума `session.durationMs` (null-honest). `totals.leadTimeMs` — різниця між найранішим `startedAt` і найпізнішим `endedAt`, або `null`. `totals.cloudSessions` — кількість сесій з `runtime: cloud`. `phases.<phase>.agents` — унікальні канонічні ролі; `phases.<phase>.models` — унікальні непорожні product id з `session.model` і `session.models` після резолву «Модель сесії». `spend.costUsd` SHALL підсумовувати лише billed / self-report / Amp usage USD (не Amp credits і не оцінки). `spend.costUsdEstimated` SHALL підсумовувати оцінки за тим самим правилом без подвійного рахунку, що й токени. `spend.costUsd` і `spend.costUsdEstimated` MUST лишатись окремими полями і MUST NOT зливатись в одне число. Amp credits MUST NOT входити ні в `costUsd`, ні в `costUsdEstimated`.

Коли `session.sources.length > 0`, `spendByPlatform`, `spendByModel` і `phases.<phase>` spend-поля SHALL наповнюватись **лише** з `sources` (сума всіх sources сесії / фази). Session-level `inputTokens` / `outputTokens` / `totalTokens` / `costUsd` / `costUsdEstimated` / `session.model` MUST NOT додаватись у карти в цьому випадку. `phases.<phase>.spend` MUST дорівнювати сумі всіх sources усіх сесій цієї фази, не замороженим session-полям першого source. Коли `sources` порожні, карти SHALL брати session-level поля (самозвіт / flag без адаптера). Бакет без внеску MUST лишатись null-honest із `source: "none"`. `spendByPlatform.*.ampCredits` SHALL лишатись окремим полем і MUST NOT входити в жодну суму USD.

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

### Requirement: Джерело spend — прапорці, потім самозвіт, потім опційні адаптери

Session-level spend SHALL резолвитись пополе, перше не-null значення виграє: явний прапорець (`--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`) → відповідний **числовий** ключ `## Metrics` (для archive — після drop stale-копії попередньої сесії) → зібрані `sources` (locked client або `--collect`) → `null`. Значення-плейсхолдери `unknown`, `none`, `n/a`, `-`, `—`, `null` і порожній рядок MUST трактуватись як відсутнє число і MUST NOT вважатись самозвітом-override. Дефолтний persist і archive MUST NOT читати адаптери інших платформ, ніж резолвлений клієнт, якщо немає `--collect`.

`session.ampCredits` SHALL зберігатись окремим полем сесії з ключа `amp_credits` і MUST NOT входити в `costUsd` чи в будь-яку суму USD. Відсутнє число MUST лишатись `null`, ніколи штучним `0`. CLI MUST NOT писати оцінений з токенів USD у `costUsd`. CLI MUST NOT конвертувати Amp credits у USD. Cursor-оцінка з токенів SHALL писатись лише в `costUsdEstimated`. Ключ самозвіту `cost_usd` і прапорець `--cost-usd` SHALL потрапляти в `costUsd` як billed/self-report і MUST NOT копіюватись у `costUsdEstimated`. Агент MUST NOT підставляти Cursor-оцінку як billed `cost_usd`.

Коли зібрані `sources` записуються в `session.sources`, вони SHALL наповнювати `spendByPlatform` / `spendByModel`. Вони MUST NOT перекривати totals, що прийшли з прапорців або **числового** самозвіту. Placeholder `## Metrics` (усі числа `unknown`) плюс `spend_source: self-report` MUST NOT блокувати leftover resync: leftover MAY виставити totals = сума всіх sources і `spendSource: adapter`.

#### Scenario: Прапорець перемагає самозвіт

- **GIVEN** `## Metrics` містить `input_tokens: 100`, `output_tokens: 50`, `cost_usd: 0.10`
- **WHEN** виконується persist з `--input-tokens 7 --cost-usd 9.99`
- **THEN** `sessions[0].inputTokens` дорівнює `7`
- **AND** `sessions[0].outputTokens` дорівнює `50`
- **AND** `sessions[0].costUsd` дорівнює `9.99`

#### Scenario: Дефолтний persist не читає адаптери

- **GIVEN** tmp `HOME` з валідною Claude JSONL фікстурою у вікні сесії
- **AND** `handoff.md` без `## Metrics`
- **AND** клієнт сесії не резолвлений як `claude`
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

#### Scenario: Числовий самозвіт не перекривається зібраними sources

- **GIVEN** `## Metrics` містить `input_tokens: 1000`, `output_tokens: 200`
- **AND** адаптерна фікстура дає source з `inputTokens: 5`, `outputTokens: 5`
- **WHEN** виконується persist з `--collect`
- **THEN** `sessions[0].inputTokens` дорівнює `1000`
- **AND** `sessions[0].sources` містить зібраний запис
- **AND** `spendByPlatform` містить токени зібраного запису (карти з sources)

#### Scenario: Placeholder self-report не блокує leftover resync

- **GIVEN** `## Metrics` з усіма числовими полями `unknown` і `spend_source: self-report`
- **AND** leftover додає два sources з `inputTokens` 100 і 50
- **WHEN** leftover завершується
- **THEN** `session.inputTokens` дорівнює `150`
- **AND** `session.spendSource` дорівнює `adapter`

#### Scenario: Самозвіт cost_usd не стає estimate

- **GIVEN** `## Metrics` містить `cost_usd: 0.42` і немає Cursor hook-записів
- **WHEN** виконується persist
- **THEN** `sessions[0].costUsd` дорівнює `0.42`
- **AND** `sessions[0].costUsdEstimated` є `null`

### Requirement: Поле session.spendSource фіксує походження чисел

Кожен запис сесії SHALL містити `spendSource` — непорожній рядок походження spend-чисел. CLI SHALL резолвити його так: непорожній ключ `spend_source` з `## Metrics`, **лише якщо є хоч одне числове spend-поле** → `flag`, якщо хоч одне число прийшло з прапорця і секція не задала `spend_source` → `self-report`, якщо числа прийшли з секції → `adapter`, якщо числа прийшли лише з адаптера / leftover → `unreported`, якщо жодного числа немає. Значення `unreported` SHALL використовуватись і тоді, коли секція є, але всі числові поля порожні або `unknown`. Ключ `spend_source: self-report` при всіх `unknown`/null числах MUST трактуватись як відсутній override (плейсхолдер), не як freeze leftover.

`spendSource` MUST NOT впливати на exit code. Legacy-записи сесій без поля SHALL читатись як `unreported` без міграції файлу.

#### Scenario: Самозвіт дає self-report

- **GIVEN** `## Metrics` з числами і без ключа `spend_source`
- **WHEN** виконується persist без прапорців
- **THEN** `sessions[0].spendSource` дорівнює `self-report`

#### Scenario: Явний spend_source з секції перемагає дефолт коли є числа

- **GIVEN** `## Metrics` містить `spend_source: cursor-ui` і числа
- **WHEN** виконується persist
- **THEN** `sessions[0].spendSource` дорівнює `cursor-ui`

#### Scenario: Прапорець без секції дає flag

- **GIVEN** `handoff.md` без `## Metrics`
- **WHEN** виконується persist з `--total-tokens 500`
- **THEN** `sessions[0].spendSource` дорівнює `flag`

#### Scenario: Порожня сесія дає unreported

- **GIVEN** `handoff.md` без `## Metrics` і persist без spend-прапорців і без `--collect`
- **WHEN** сесія записується
- **THEN** `sessions[0].spendSource` дорівнює `unreported`

#### Scenario: unknown + spend_source self-report не заморожує leftover

- **GIVEN** сесія записана з `## Metrics` усі `unknown` і `spend_source: self-report`
- **AND** leftover додає два sources
- **WHEN** leftover перераховує totals
- **THEN** session totals дорівнюють сумі sources
- **AND** `spendSource` дорівнює `adapter`

### Requirement: Archive завжди фіналізує metrics.json після успішного move

На **старті** `archive <name>`, якщо `pending` є `null`, команда SHALL записати `pending.startedAt = now` (старт сесії Archiver) у ще активний `metrics.json` і SHALL виконати leftover-backfill останньої не-Archiver сесії з `leftoverEnd = pending.startedAt`. Після успішного переміщення change команда MUST створити `metrics.json` у архівній папці, якщо файлу не було, виставити `archivedAt`, очистити `pending`, перерахувати агрегати і додати сесію `role: Archiver`, `phase: archive`, `startedAt` = записаний pending start, `endedAt` = зараз, `durationMs` = дельта (MUST NOT бути `null`, коли pending start існував). Клієнт Archiver SHALL резолвитись так само, як persist: `--platform` / `AOK_PLATFORM` → `## Metrics` (після відкидання stale-копії попередньої сесії) → `resolveRestoreClient` / host env. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, archive SHALL зібрати spend лише цього клієнта навіть без `--collect`, з вікном Archiver `[pending.startedAt, now]` — MUST NOT з `[last.endedAt, now]`. `--collect` SHALL запускати всі три адаптери. Значення `model` — за «Модель сесії»; токени — за «Джерело spend». Якщо `## Metrics` повторює `inputTokens`/`outputTokens`/`model`/`platform` останньої не-Archiver сесії, ці поля MUST ігноруватись. Невалідний `--platform` MUST відхилятись до move. Якщо після finalize `spend.costUsd` є `null` — warning у stderr через `console.error`. Exit code MUST NOT змінюватись через відсутній файл, порожній spend, відсутній самозвіт або `null` модель.

Після move Cursor `sessionEnd` leftover MUST розглядати найсвіжіший `openspec/changes/archive/*-<name>/metrics.json` і MUST NOT скіпати каталог `archive/` наосліп.

#### Scenario: Archive без файлу створює metrics.json з Archiver

- **GIVEN** change без `metrics.json` проходить гейті archive
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** архівний `metrics.json` існує з непорожнім `archivedAt` і `pending: null`
- **AND** `sessions` містить запис `Archiver` / `archive`

#### Scenario: Archiver має durationMs коли був pending start

- **GIVEN** на старті archive `pending` був `null` і CLI записав `pending.startedAt`
- **WHEN** finalize додає сесію Archiver
- **THEN** `Archiver.startedAt` дорівнює цьому pending start
- **AND** `Archiver.endedAt` є пізнішим або рівним
- **AND** `Archiver.durationMs` є числом `>= 0` і не є `null`

#### Scenario: Archiver бере значення з самозвіту

- **GIVEN** `handoff.md` change-у містить `## Metrics` з `platform: amp`, `model: claude-fable-5`, `input_tokens: 4000`
- **AND** жодна попередня сесія не має тих самих `inputTokens`/`model`/`platform`
- **AND** collect Archiver не повернув sources з model
- **WHEN** виконується `archive <name>` без прапорців моделі й платформи
- **THEN** сесія `Archiver` має `platform: amp`, `model: claude-fable-5`, `inputTokens: 4000`
- **AND** `spendSource` цієї сесії є `self-report`

#### Scenario: Hook між last.endedAt і archive pending йде в leftover попередньої сесії

- **GIVEN** остання не-Archiver сесія має `endedAt` раніше за рядок у `.agents/spend/cursor-usage.jsonl`
- **AND** `at` цього рядка раніше за `pending.startedAt` archive
- **AND** host env має `CURSOR_AGENT=1`
- **WHEN** виконується `archive <name>` без `--collect`
- **THEN** цей hook-рядок є в `sources` останньої не-Archiver сесії
- **AND** `sources` Archiver цей рядок не містить

#### Scenario: Hook після archive pending потрапляє в Archiver

- **GIVEN** host env має `CURSOR_AGENT=1`
- **AND** hook-рядок має `at` у `[archive pending.startedAt, finalize now]`
- **WHEN** виконується `archive <name>` без `--collect`
- **THEN** сесія `Archiver` має `platform: cursor`
- **AND** `sources` містить цей hook-рядок
- **AND** `phases.archive.totalTokens` не є `null`

#### Scenario: Leftover sessionEnd після move пише в архівний metrics.json

- **GIVEN** `archive <name>` уже перемістив change і записав Archiver
- **AND** hook-рядок з’явився +5s після `Archiver.endedAt` і входить у leftover-вікно останньої сесії архівного файла
- **WHEN** виконується `scripts/cursor-spend-collect.cjs` (`sessionEnd`)
- **THEN** цей рядок є в `sources` останньої сесії `openspec/changes/archive/*-<name>/metrics.json`
- **AND** активної `openspec/changes/<name>/` уже немає

#### Scenario: Stale ## Metrics з apply не подвоюється на Archiver

- **GIVEN** остання сесія `Implementer` має `inputTokens: 1000`, `platform: cursor`, `model: cursor-grok-4.6`
- **AND** архівований `handoff.md` `## Metrics` повторює ці самі числа
- **AND** у вікні Archiver `[pending.startedAt, now]` є новий hook-рядок на 50 токенів
- **WHEN** виконується `archive <name>` з `CURSOR_AGENT=1` без `--collect`
- **THEN** `Archiver.inputTokens` не дорівнює `1000`
- **AND** `sources` Archiver містить новий hook-рядок

#### Scenario: Порожній spend на archive — warning і exit 0

- **GIVEN** фіналізований `spend.costUsd` є `null`
- **WHEN** archive успішно фіналізує metrics
- **THEN** stderr містить попередження
- **AND** exit code 0

### Requirement: Прапорець `--collect` вмикає локальні адаптери

`handoff <name>` і `archive` SHALL приймати опційний `--collect`, який вмикає повний прохід `collectSpend` (три адаптери, вікно, dedup) додатково до locked-клієнта. Без `--collect` і без резолвленого клієнта `amp`/`cursor`/`claude` адаптери MUST NOT запускатись, `session.sources` MUST бути `[]`. Коли клієнт резолвлений, archive і persist SHALL читати адаптер цього клієнта навіть без `--collect`.

`--collect` на `archive` SHALL збирати всі три адаптери у вікні Archiver `[pending.startedAt, now]` після leftover попередньої сесії з `leftoverEnd = pending.startedAt`. MUST NOT ставити вікно Archiver `[last session.endedAt, now]`. Подія в `[last.endedAt, pending.startedAt)` MUST йти в leftover останньої не-Archiver сесії і MUST NOT входити в `sources` Archiver.

Прапорець `--no-collect` SHALL бути видалений. **BREAKING**: скрипти, що передавали `--no-collect`, MUST перейти на дефолтну поведінку без прапорця.

`--no-metrics` MUST як і раніше не створювати сесію і не запускати collect.

#### Scenario: --collect наповнює sources

- **GIVEN** tmp фікстура Claude JSONL з подією у вікні
- **WHEN** виконується persist з `--collect`
- **THEN** `sessions[0].sources` непорожній
- **AND** `spendByPlatform.claude.source` дорівнює `claude-jsonl`

#### Scenario: Дефолт лишає sources порожніми

- **GIVEN** та сама фікстура
- **WHEN** виконується persist без `--collect`
- **THEN** `sessions[0].sources` є `[]`
- **AND** exit code 0

#### Scenario: Дефолтний archive без клієнта не читає чужі адаптери

- **GIVEN** tmp-фікстура Claude JSONL з валідною подією у вікні Archiver
- **AND** клієнт сесії не резолвлений
- **WHEN** виконується `archive <name>` з валідним sync-рішенням і без `--collect`
- **THEN** архівний `metrics.json` містить сесію `Archiver` із `sources` рівними `[]`
- **AND** exit code 0

#### Scenario: Archive --collect: подія між last.endedAt і pending іде в leftover

- **GIVEN** остання не-Archiver сесія має `endedAt` раніше за usage-подію в tmp-фікстурі Claude JSONL
- **AND** подія входить у `[last.endedAt, archive pending.startedAt)` і cwd збігається
- **WHEN** виконується `archive <name> --collect` з валідним sync-рішенням
- **THEN** ця подія відсутня в `sources` Archiver
- **AND** leftover додає її до `sources` останньої не-Archiver сесії
- **AND** exit code 0

#### Scenario: Archive --collect збирає вікно Archiver

- **GIVEN** archive записав `pending.startedAt`
- **AND** usage-подія в tmp-фікстурі Claude JSONL входить у `[pending.startedAt, now]` і cwd збігається
- **WHEN** виконується `archive <name> --collect` з валідним sync-рішенням
- **THEN** сесія `Archiver` містить цю подію в `sources` або вона врахована в `spendByPlatform.claude`
- **AND** exit code 0

#### Scenario: --no-collect більше не існує

- **WHEN** виконується persist з `--no-collect`
- **THEN** CLI повідомляє про невідомий прапорець
- **AND** документація і шаблони протоколу не згадують `--no-collect`

### Requirement: Cursor spend hook — опційне доповнення, ensure лише в setup-командах

Kit SHALL і надалі постачати `templates/scripts/cursor-spend-hook.cjs` і `templates/scripts/cursor-spend-collect.cjs` з такою поведінкою: hook читає stdin payload подій `stop` / `subagentStop` / `afterAgentResponse` і дописує запис у `<project>/.agents/spend/cursor-usage.jsonl`, лише якщо payload містить хоча б одне з `input_tokens` / `output_tokens` (включно з `conversationId`); collect-скрипт на `sessionEnd` мержить нові рядки в **останню** сесію цільового `metrics.json` без додавання нової сесії. Цільові файли: кожна активна `openspec/changes/<name>/metrics.json` **і** найсвіжіший `openspec/changes/archive/*-<name>/metrics.json` для імен, яких більше немає в active. MUST NOT скіпати каталог `archive/` наосліп. Після attach leftover MUST resync totals за «Вікно collect» / «Джерело spend» (`looksOverridden` / `syncAdapterSessionTotals` MUST NOT трактувати placeholder `self-report` як override). `scripts/cursor-spend-collect.cjs` і `templates/scripts/cursor-spend-collect.cjs` MUST лишатись поведінково синхронними. Обидва скрипти MUST бути fail-open: будь-яка помилка завершується exit 0 без stdout.

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
