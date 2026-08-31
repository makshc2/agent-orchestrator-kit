## Purpose

change-metrics — requirements merged from change fix-metrics-model-and-spend.

## Requirements

### Requirement: Файл metrics.json є git-tracked журналом change-у

Kit SHALL писати `openspec/changes/<name>/metrics.json` (після archive — у `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json`) зі схемою версії `1`: `version`, `change`, `createdAt`, `updatedAt`, `archivedAt` (`null` до фіналізації), `spend` (`inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`), `spendByPlatform` (ключі `cursor`, `claude`, `amp` → `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`, `ampCredits`, `source`), `spendByModel` (масив `{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, ampCredits }`), `totals` (`sessions`, `durationMs`, `leadTimeMs`, `cloudSessions`), `phases` (ключ фази → `sessions`, `durationMs`, spend-поля включно з `costUsd` і `costUsdEstimated`, `agents`, `models`), `sessions` (масив записів), `pending` (`{ startedAt, role, platform, threadId, clientSource }` або `null`). Запис сесії SHALL містити `spendSource` (непорожній рядок), `ampCredits` (число або `null`), `costUsdEstimated` (число або `null`), `threadId` (Amp id або `null`), `sources` (масив `{ id, platform, model, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, costSource, ampCredits, at }`; порожній, коли клієнт невідомий і немає `--collect`) і опційно `models` (масив id), коли моделей більше однієї. `costUsd` SHALL містити лише billed / self-report / Amp usage `Cost: $N`. `costUsdEstimated` SHALL містити лише оцінений USD і MUST NOT дублювати billed `costUsd`. `costSource` на source SHALL бути `"api-estimate"`, `"api-estimate-fallback"` або `"amp-usage"`, коли джерело відоме; інакше поле може бути відсутнім. Файл MUST бути git-tracked (не в gitignored cache). Пошкоджений або відсутній JSON SHALL замінюватись default-об'єктом з тими самими ключами, без падіння CLI. Відсутні нові поля в legacy-файлі SHALL мержитись з default (`spendByPlatform` з трьома ключами і `null`-полями включно з `costUsdEstimated`, `spendByModel: []`, `sources: []`, `spendSource: "unreported"`, `ampCredits: null`, `costUsdEstimated: null` на `spend` і сесіях).

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

`handoff --restore` SHALL записувати `pending` (`startedAt` = зараз, `role` з next role handoff-файлу, якщо він є, `platform`, `threadId`, `clientSource` з детекту клієнта). `handoff <name>` SHALL додавати елемент у `sessions` з: `startedAt` з `--started-at` або `pending.startedAt` або `null`; `endedAt` = зараз; `durationMs` = різниця або `null`; `role` = Closed role; `phase` = результат `phaseForRole` (`Explorer`→`explore`, `Architect`→`spec`, `Implementer`/`apply`→`apply`, review→`review`, design→`design`, Archiver→`archive`, інакше `other`); `runtime` і `agentId` з runtime-ланцюжка; `tasks` зі знімка progress; `model`, `platform`, токени, `costUsd`, `ampCredits` і `spendSource` з ланцюжка прапорець → `## Metrics` → (`--collect` sources) → `null`; `sources` з collect клієнта, зафіксованого на restore (або всі адаптери при `--collect`; `[]` коли клієнт невідомий і немає `--collect`). Після запису `pending` MUST стати `null`. Агрегати (`phases`, `totals`, `spend`, `spendByPlatform`, `spendByModel`) SHALL перераховуватись на кожному записі.

Порядок persist MUST бути: прочитати `## Metrics` → записати сесію в `metrics.json` → надрукувати попередження в stderr → надрукувати next-thread prompt у stdout. Prompt MUST лишатись єдиним вмістом stdout.

#### Scenario: Restore + persist закриває одну сесію

- **GIVEN** `handoff.md` з Closed role `Architect`, next role `spec-reviewer` і `## Metrics` з `model: claude-opus-5`, `input_tokens: 12000`, `output_tokens: 3000`, `cost_usd: 0.42`
- **WHEN** виконується `handoff <name> --restore`, потім `handoff <name>`
- **THEN** `pending` є `null`
- **AND** `sessions` має один запис з `role: Architect`, `phase: spec`, `model: claude-opus-5`, `totalTokens: 15000`, `costUsd: 0.42`
- **AND** `phases.spec.agents` містить `Architect`
- **AND** `phases.spec.models` містить `claude-opus-5`

### Requirement: Restore фіксує клієнта сесії, persist йде його флоу

`handoff --restore` SHALL визначити клієнта сесії і записати його в `pending`: `platform` (`cursor` | `claude` | `amp` | `null`), `threadId` (Amp thread id або `null`), `clientSource` (непорожній рядок джерела). Резолв клієнта: `--platform` / `AOK_PLATFORM` → `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` → `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID` → Claude Code env → батьківський процес `amp` і/або свіжий `~/.local/share/amp/session.json` `lastThreadByTerminal[tty]` (вікно свіжості ≤ 2h; `/dev/null` і pipe MUST NOT рахуватись як tty) → `null`. Якщо батько є `amp` і tty немає, `pending.threadId` SHALL братися з першого id `amp threads list` (`clientSource: amp-threads-list`), MUST NOT з `session.json` `lastThreadId`. Amp env MUST перемагати Cursor env. `agentMode` (`low`/`medium`/`high`/`ultra`) MUST NOT ставати `session.model`.

`handoff <name>` SHALL резолвити `session.platform` так: `--platform` → `## Metrics` → `AOK_PLATFORM` → `pending.platform` → host env → sources. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, persist SHALL зібрати spend лише цього клієнта навіть без `--collect`. Amp-флоу: `amp threads export <pending.threadId>` (бінар `AOK_AMP_BIN` або `amp`; fail-open) плюс локальні `threads/*.json`. Cursor-флоу: hook-файл. Claude-флоу: `~/.claude/projects`. `--collect` SHALL як і раніше запускати всі три адаптери. Відсутній Amp CLI MUST NOT валити persist.

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

#### Scenario: Persist без restore лишає duration null

- **GIVEN** немає `pending` і немає `--started-at`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].durationMs` є `null`
- **AND** команда завершується з exit 0

#### Scenario: Сесія записана до друку промпта

- **GIVEN** persist завершився exit 0
- **WHEN** порівнюються stdout і `metrics.json`
- **THEN** `metrics.json` містить нову сесію
- **AND** stdout містить лише next-thread prompt без метрик

### Requirement: Модель сесії — LLM product id з sources, flag або env, інакше null

`session.model` і `phases.*.models` MUST зберігати ідентифікатор LLM-продукту, не Closed role і не ім'я субагента. Резолв SHALL бути: непорожній `--model` → непорожній `model` з `## Metrics` → непорожній env `AOK_MODEL` → primary модель з `sources`, коли передано `--collect` (модель з найбільшим `totalTokens`; при рівності — стабільний порядок platform, потім id) → `null`. `session.models` SHALL містити унікальні id, коли моделей більше однієї (з `sources` при `--collect`). Рядок зберігається як передано або як у usage-записі (без вигаданої таксономії). Порожнє значення і `unknown` трактуються як відсутнє. Відсутня модель MUST NOT робити persist або archive non-zero. Якщо сесія записується з `model: null`, CLI SHALL попередити в stderr (підказка: рядок `model` у `## Metrics` або `--model` / `AOK_MODEL`). CLI MUST NOT викликати Cursor SDK, Claude `/cost` чи Amp billing API, щоб дізнатись модель.

#### Scenario: Прапорець --model перемагає самозвіт

- **GIVEN** `## Metrics` містить `model: claude-fable-5`
- **WHEN** виконується persist з `--model cursor-grok-4.6`
- **THEN** `session.model` дорівнює `cursor-grok-4.6`

#### Scenario: Самозвіт перемагає env

- **GIVEN** `AOK_MODEL=gpt-5.6-sol` і `## Metrics` містить `model: claude-opus-5`
- **WHEN** виконується persist без `--model`
- **THEN** `session.model` дорівнює `claude-opus-5`

#### Scenario: Env AOK_MODEL без прапорця і без самозвіту

- **GIVEN** `AOK_MODEL=gpt-5.6-sol`, немає `--model` і `## Metrics` без ключа `model`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` дорівнює `gpt-5.6-sol`

#### Scenario: Відсутня модель — null, warning, exit 0

- **GIVEN** немає `--model`, немає `AOK_MODEL`, немає `## Metrics` і немає `--collect`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` є `null`
- **AND** stderr містить попередження про відсутню модель
- **AND** exit code 0

#### Scenario: Primary model з sources лише при --collect

- **GIVEN** collect повернув два sources: `claude-opus-4-7` з `totalTokens: 9000` і `gpt-5.6-sol` з `totalTokens: 1000`
- **AND** немає `--model`, `AOK_MODEL` і ключа `model` у `## Metrics`
- **WHEN** виконується persist з `--collect`
- **THEN** `session.model` дорівнює `claude-opus-4-7`
- **AND** `session.models` містить обидва id

### Requirement: Три read-only адаптери без мережі і без нових npm-залежностей

Collect усіх трьох адаптерів в одному проході запускається за явним `--collect` (на `handoff <name>`, `archive`) або командою `metrics --collect`. Persist і archive без `--collect` SHALL збирати лише locked/resolved клієнта (див. «Restore фіксує клієнта сесії» та «Archive завжди фіналізує metrics.json»). Модуль SHALL жити в `bin/spend-collect.js` і бути імпортованим з `bin/agent-orchestrator.js`. Адаптери MUST бути read-only і offline: без API-ключів, без HTTP, без Cursor SDK, без Amp billing API, без парсера Claude `/cost` як залежності. Нових npm-залежностей (`better-sqlite3`, `sql.js`, `ccusage`) MUST NOT з'являтись. Тести MUST підміняти `HOME` / `AMP_DATA_DIR` / `XDG_CONFIG_HOME` на tmp і MUST NOT читати реальний `~/.claude` розробника в CI.

Адаптер **claude** SHALL читати `~/.claude/projects/<cwd-encoded>/*.jsonl`, де cwd-encoded будується з аргумента `collectSpend({ cwd })` (якщо `cwd` опущено — `process.cwd()`) заміною кожного `/` і кожного `.` на `-`. Парсити assistant-рядки з `message.usage` і `message.model`, рахувати `cache_*` у `inputTokens`, якщо поля є, брати `costUsd` лише з `total_cost_usd` (або аналога) на записі, інакше `null`, фільтрувати вікно за полем рядка `timestamp`, фільтрувати проєкт за полем рядка `cwd` === цей `cwd`, і ставити `source: "claude-jsonl"`. Pricing table MUST NOT постачатись.

Адаптер **amp** SHALL читати `~/.local/share/amp/threads/*.json` з override `AMP_DATA_DIR` або `$XDG_DATA_HOME/amp`. Проєктний match порівнює `collectSpend` `cwd` (або `process.cwd()`, якщо аргумент опущено) після strip `file://` і нормалізації trailing slash. Якщо `env.initial.trees` непорожній — thread входить лише коли хоча б один `trees[].uri` дорівнює cwd; чужий trees MUST відкидатись навіть якщо JSON згадує cwd. Якщо `trees` відсутній або порожній, thread SHALL все одно входити, коли є інший консервативний сигнал того самого репо: `env.initial.cwd` / `env.cwd` / `thread.cwd` / `meta.cwd` (лише якщо поле реально є), `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` дорівнює `thread.id` або basename файла, або точний cwd / `file://`+cwd є в JSON thread. Thread без trees і без цих сигналів MUST пропускатись. MUST NOT вигадувати `cwd` / `meta.cwd`. `inputTokens` SHALL бути `usage.totalInputTokens`, якщо поле є, інакше `usage.inputTokens` плюс `cacheCreationInputTokens` і `cacheReadInputTokens`, якщо вони є. Також брати `usage.model` / `usage.outputTokens` / `usage.timestamp`. Оскільки `messageId` є thread-локальним лічильником, `source.id` MUST бути `<thread.id || basename файла>:<messageId|toMessageId>` — голий `messageId` колізує між threads. `ledger.jsonl` MAY бути відсутнім; без іменованої форми запису адаптер MUST NOT вимагати реальних `ampCredits` (відсутній ledger → `ampCredits: null`). Зберігати токени і `ampCredits` окремо, ставити `source: "amp-thread"` і MUST NOT конвертувати credits у USD.

Адаптер **cursor** SHALL НЕ брати usage з `agent-transcripts/*.jsonl` і MUST NOT читати `state.vscdb`, cookies чи server CSV (локальні бази Cursor не містять token usage). Він SHALL читати `<cwd>/.agents/spend/cursor-usage.jsonl` — файл, який пише опційний hook `scripts/cursor-spend-hook.cjs` з payload подій `stop` / `subagentStop` / `afterAgentResponse`. Кожен рядок: `{ id, event, conversationId, model, modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, at }`, де `inputTokens` уже включає cache-токени за семантикою Cursor. Фільтр вікна — за полем `at`; dedup — за `id` (`generation_id`); якщо той самий `id` зустрічається кілька разів, адаптер SHALL взяти запис з найбільшим `totalTokens`. Рядки без жодного token-поля MUST пропускатись. Якщо файла немає — порожньо + note. `source: "cursor-hook"`. MUST NOT оцінювати з `text.length`.

#### Scenario: Claude jsonl фікстура заповнює platform claude

- **GIVEN** tmp `HOME` з `~/.claude/projects/<cwd-encoded>/session.jsonl`, де cwd-encoded замінює `/` і `.` у переданому `cwd` на `-`, а assistant-рядок має `message.id`, `message.model: "claude-opus-4-7"`, `message.usage.input_tokens`, `output_tokens`, поле `cwd` рівне цьому `cwd` і поле `timestamp` у вікні
- **WHEN** виконується persist з `--collect`
- **THEN** `spendByPlatform.claude.source` дорівнює `claude-jsonl`
- **AND** `sessions[0].sources` містить цей `message.id` з `platform: "claude"`
- **AND** `costUsd` є числом лише якщо запис мав `total_cost_usd`, інакше `null`

#### Scenario: Amp thread фікстура зберігає credits окремо від USD

- **GIVEN** tmp `AMP_DATA_DIR` з thread JSON, де assistant usage має `model`, `inputTokens`, `outputTokens`, `timestamp` у вікні, і `env.initial.trees` містить `uri` з `file://` + cwd collect
- **AND** `ledger.jsonl` відсутній
- **WHEN** виконується persist з `--collect`
- **THEN** `spendByPlatform.amp.source` дорівнює `amp-thread`
- **AND** `spendByPlatform.amp.ampCredits` є `null` і не записується як `costUsd`
- **AND** `spend.costUsd` не включає Amp credits

#### Scenario: Amp thread без trees і без cwd-сигналу пропускається

- **GIVEN** tmp `AMP_DATA_DIR` з thread JSON без `env.initial.trees` і без cwd / `AMP_CURRENT_THREAD` / згадки шляху репо
- **WHEN** виконується persist з `--collect`
- **THEN** цей thread відсутній у `sessions[0].sources`

#### Scenario: Amp thread без trees входить за cwd або поточним thread

- **GIVEN** tmp `AMP_DATA_DIR` з thread JSON без `trees`, але з `env.initial.cwd` рівним collect cwd, або `AMP_CURRENT_THREAD` рівним `thread.id`
- **WHEN** виконується collect
- **THEN** usage цього thread є в `sources` з `platform: "amp"`

#### Scenario: Cursor без hook-файла повертає порожньо

- **GIVEN** у `<cwd>/.agents/spend/` немає `cursor-usage.jsonl`
- **WHEN** виконується persist з `--collect`
- **THEN** `spendByPlatform.cursor` не отримує внеску від адаптера
- **AND** persist exit 0
- **AND** токени не оцінені з довжини тексту

#### Scenario: Cursor hook-файл заповнює platform cursor

- **GIVEN** `<cwd>/.agents/spend/cursor-usage.jsonl` з записом `{ id: "g-1", model, inputTokens, outputTokens, at }` у вікні
- **WHEN** виконується persist з `--collect`
- **THEN** `spendByPlatform.cursor.source` дорівнює `cursor-hook`
- **AND** `sessions[0].sources` містить `g-1` з `platform: "cursor"`
- **AND** повторні записи того самого `id` злиті в один з найбільшим `totalTokens`

### Requirement: Вікно collect, cwd-match і dedup

Коли collect запущено (`--collect` або `metrics --collect`), вікно SHALL бути `[last session.endedAt || metrics.createdAt, endedAt]`. CLI MUST NOT ставити нижню межу на `pending.startedAt`. Подія MUST входити лише якщо її timestamp у вікні: Claude — поле рядка `timestamp`; Amp — `usage.timestamp`; Cursor — поле `at` hook-запису. Проєктний match порівнює з аргументом `collectSpend({ cwd })` (якщо опущено — `process.cwd()`). Claude: поле рядка `cwd` === цей шлях; без поля `cwd` подію MUST NOT включати. Amp: thread з непорожнім `trees` входить лише за збігом `trees[].uri`; без `trees` — за cwd-полями, `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` або точною згадкою cwd у JSON; MUST NOT вигадувати `meta.cwd`. Cursor: файл `<cwd>/.agents/spend/cursor-usage.jsonl` уже проєктно-локальний — додатковий match не потрібен. Dedup: пропустити `source.id`, яке вже є в будь-якому `session.sources` поточного `metrics.json` (claude `message.id`, amp `<threadKey>:<messageId|toMessageId>`, cursor `generation_id`).

#### Scenario: Подія до last session.endedAt не потрапляє в сесію

- **GIVEN** уже є сесія з `endedAt` пізнішим за timestamp usage-події в фікстурі
- **WHEN** виконується наступний persist з `--collect`
- **THEN** ця подія відсутня в новій сесії `sources`

#### Scenario: Пізня подія після попереднього persist потрапляє в наступну сесію

- **GIVEN** попередня сесія вже закрита
- **AND** usage-подія має timestamp після `last session.endedAt` і раніше за новий `pending.startedAt`
- **WHEN** виконується наступний persist з `--collect`
- **THEN** ця подія є в `sources` нової сесії

#### Scenario: Повторний collect не дублює source.id

- **GIVEN** `metrics.json` уже містить `sessions[0].sources` з id `msg-1`
- **WHEN** наступний persist з `--collect` знову бачить ту саму подію
- **THEN** новий запис сесії не містить повторного `msg-1`

#### Scenario: Чужа cwd відкидається

- **GIVEN** claude jsonl рядок з `cwd`, що не дорівнює аргументу `collectSpend({ cwd })`
- **WHEN** виконується persist з `--collect`
- **THEN** ця подія відсутня в `sources`

### Requirement: Опційна платформа сесії — flag/env/host/sources/null

`session.platform` SHALL бути `cursor`, `claude`, `amp` або `null`. Резолв: `--platform` → `platform` з `## Metrics` → env `AOK_PLATFORM` → host env (Amp: `AMP_CURRENT_THREAD` / `AMP_THREAD_ID`; Cursor: `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID`; Claude Code: `CLAUDECODE` / `CLAUDE_CODE` / `CLAUDE_CODE_ENTRYPOINT`) → primary platform з `sources` при `--collect` → `null`. Невалідний `--platform` (не з трьох значень) MUST завершувати persist/archive з non-zero. Невалідний непорожній `platform` у `## Metrics` або в `AOK_PLATFORM` SHALL давати `null` і warning, не fail (без fallback на host). `--platform` MUST перемагати самозвіт, самозвіт MUST перемагати host env.

#### Scenario: --platform записує cursor

- **WHEN** виконується persist з `--platform cursor`
- **THEN** `sessions[0].platform` дорівнює `cursor`
- **AND** exit code 0

#### Scenario: Невалідний --platform падає

- **WHEN** виконується persist з `--platform foo`
- **THEN** exit code ≠ 0
- **AND** сесія не дописується як успішний persist-запис із `platform: foo`

#### Scenario: Самозвіт перемагає host env

- **GIVEN** `CURSOR_AGENT=1` і `## Metrics` містить `platform: amp`
- **WHEN** виконується persist без `--platform` і без `AOK_PLATFORM`
- **THEN** `sessions[0].platform` дорівнює `amp`

#### Scenario: Host env виставляє платформу коли немає flag і самозвіту

- **GIVEN** немає `--platform` / `AOK_PLATFORM` / ключа `platform` у `## Metrics`
- **AND** `CURSOR_AGENT=1` (або `CLAUDECODE=1`, або `AMP_CURRENT_THREAD` непорожній)
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].platform` є `cursor` (або `claude` / `amp` відповідно)
- **AND** exit code 0

### Requirement: Агрегати перераховуються на кожному записі

Кожен виклик, що зберігає `metrics.json` (persist, archive finalize), SHALL перераховувати `phases`, `totals`, `spend`, `spendByPlatform` і `spendByModel` з масиву `sessions` і їхніх `sources`. `totals.durationMs` — сума `session.durationMs` (null-honest). `totals.leadTimeMs` — різниця між найранішим `startedAt` і найпізнішим `endedAt`, або `null`. `totals.cloudSessions` — кількість сесій з `runtime: cloud`. `phases.<phase>.agents` — унікальні Closed role; `phases.<phase>.models` — унікальні непорожні `session.model` і `session.models`. `spend.costUsd` SHALL підсумовувати лише billed / self-report / Amp usage USD (не Amp credits і не оцінки). `spend.costUsdEstimated` SHALL підсумовувати `session.costUsdEstimated` і `source.costUsdEstimated` за тим самим правилом без подвійного рахунку, що й токени. `spend.costUsd` і `spend.costUsdEstimated` MUST лишатись окремими полями і MUST NOT зливатись в одне число. Amp credits MUST NOT входити ні в `costUsd`, ні в `costUsdEstimated`.

`spendByPlatform` SHALL наповнюватись із **двох** джерел: (1) сесії з непорожнім `session.platform` додають свої session-level токени, `costUsd`, `costUsdEstimated` і `ampCredits` у відповідний бакет; (2) `session.sources` (лише коли вони є) додають свої значення в бакет своєї платформи, і лише тоді бакет отримує `source` з іменем адаптера. Одна й та сама сесія MUST NOT рахуватись двічі: коли totals сесії збігаються із сумою її `sources`, у бакет додається один раз. Бакет без внеску MUST лишатись null-honest із `source: "none"`. `spendByModel` SHALL будуватись із пар (`session.model`, `session.platform`) і з `session.sources`, за тим самим правилом без подвійного рахунку, і SHALL містити `costUsdEstimated`. `spendByPlatform.*.ampCredits` SHALL лишатись окремим полем і MUST NOT входити в жодну суму USD.

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

### Requirement: Команда metrics показує ролі, моделі, платформи окремо

CLI SHALL надавати `npx agent-orchestrator-kit metrics [name] [--json]`. Без `--json` людський вивід MUST містити підсумок (`sessions`, work time, lead time, tokens, cost) і таблицю фаз з колонками `roles` (Closed role з `phases.*.agents`) і `models` (LLM id з `phases.*.models`). Колонка `models` MUST NOT друкувати Closed role замість моделей. Вивід MUST містити таблицю **by platform** (cursor / claude / amp з токенами, `costUsd`, `costUsdEstimated`, `ampCredits`, `source`) і таблицю **by model** (`model`, `platform`, токени, `costUsd`, `costUsdEstimated`, `ampCredits`). Вивід MUST показувати кількість сесій зі `spendSource: "unreported"`, а список сесій MUST показувати `spendSource` кожної сесії. MUST NOT друкувати єдиний «total $», що додає Amp credits до Claude/Cursor USD. Рядок підсумку `cost` SHALL рендеритись функцією `formatMetricsCostLine(spend)`: коли є і `costUsd`, і `costUsdEstimated` — `$X billed + ~$Y est.`; лише billed — `$X`; лише estimate — `~$Y est.`; обидва `null` — `—`. Amp `ampCredits` MUST NOT входити в цей рядок і MUST NOT друкуватись як долари. `--json` SHALL друкувати сирий об'єкт файлу в stdout. Команда SHALL знаходити файл активної зміни або найновіший `openspec/changes/archive/*-<name>/metrics.json`. Відсутній файл — non-zero з повідомленням `No metrics.json`.

Рендеринг людського виводу SHALL бути винесений у спільну функцію, яку перевикористовує stdout-зводка `archive`.

#### Scenario: Людська таблиця розрізняє roles і models

- **GIVEN** `metrics.json` із сесією `role: Architect`, `model: claude-opus-5`, `phase: spec`
- **WHEN** виконується `npx agent-orchestrator-kit metrics <name>` без `--json`
- **THEN** stdout містить заголовок колонки `models`
- **AND** рядок фази `spec` містить `claude-opus-5` у колонці моделей
- **AND** `Architect` не надрукований як значення колонки `models`

#### Scenario: Таблиці by platform і by model без unified bill

- **GIVEN** `spendByPlatform.claude.costUsd` є `1.5`, `spendByPlatform.amp.ampCredits` є `20`, `spendByPlatform.cursor.costUsd` є `null`
- **WHEN** виконується `metrics <name>` без `--json`
- **THEN** stdout містить окремі таблиці platform і model
- **AND** stdout не містить одного total $, що є сумою `1.5 + 20`

#### Scenario: Рядок cost показує billed і estimate без credits

- **GIVEN** `spend.costUsd` є `1.30`, `spend.costUsdEstimated` є `8.98`, `spendByPlatform.amp.ampCredits` є `20`
- **WHEN** виконується `metrics <name>` без `--json`
- **THEN** stdout містить `$1.30 billed + ~$8.98 est.`
- **AND** stdout не містить суми credits і USD як одного total

#### Scenario: Вивід показує unreported сесії

- **GIVEN** дві сесії з `spendSource: "unreported"` і одна з `self-report`
- **WHEN** виконується `metrics <name>`
- **THEN** stdout повідомляє про дві сесії без самозвіту

#### Scenario: --json для активної зміни

- **WHEN** виконується `metrics <name> --json` для активної зміни з файлом
- **THEN** stdout є JSON з полем `sessions`
- **AND** exit code 0

#### Scenario: metrics знаходить заархівовану зміну

- **GIVEN** немає активної `openspec/changes/<name>/metrics.json`
- **AND** існує `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json`
- **WHEN** виконується `metrics <name>`
- **THEN** команда читає архівний файл і завершується з exit 0

#### Scenario: Немає файлу — помилка

- **WHEN** виконується `metrics missing-change`
- **THEN** exit code ≠ 0
- **AND** вивід містить `No metrics.json`

### Requirement: --no-metrics пропускає запис сесії і collect

Прапорець `--no-metrics` на `handoff --restore` MUST NOT створювати й MUST NOT оновлювати `pending`. На `handoff <name>` MUST NOT додавати сесію, MUST NOT читати секцію `## Metrics` як джерело сесії і MUST NOT запускати collect. Команда `archive` MUST все одно фіналізувати `metrics.json` після успішного move і SHALL зібрати spend locked/resolved клієнта (або всі адаптери з `--collect`) — незалежно від `--no-metrics`. Прапорця `--no-collect` більше не існує, тому `--no-metrics` MUST NOT посилатись на нього. `--no-metrics` MUST NOT змінювати exit code persist і MUST NOT перетворювати відсутній самозвіт на помилку.

#### Scenario: Persist --no-metrics не створює файл

- **GIVEN** зміна без `metrics.json`
- **WHEN** виконується `handoff <name> --no-metrics`
- **THEN** `metrics.json` не існує
- **AND** persist завершується з exit 0

#### Scenario: Restore --no-metrics не ставить pending

- **GIVEN** зміна без `metrics.json`
- **WHEN** виконується `handoff <name> --restore --no-metrics`
- **THEN** `metrics.json` не створюється

#### Scenario: Persist --no-metrics не читає заповнену секцію

- **GIVEN** `handoff.md` містить `## Metrics` з `input_tokens: 128000` і `model: claude-opus-5`
- **WHEN** виконується `handoff <name> --no-metrics`
- **THEN** `metrics.json` не створюється і сесія не дописується
- **AND** exit code 0

#### Scenario: Archive фіналізує без чужих адаптерів, якщо клієнт невідомий

- **GIVEN** change з валідним sync-рішенням і tmp-фікстурою Claude JSONL у вікні Archiver
- **AND** немає `--platform`, `AOK_PLATFORM` і host env Cursor/Amp/Claude
- **WHEN** виконується `archive <name>` без `--collect`
- **THEN** архівний `metrics.json` існує з сесією `Archiver`
- **AND** `sources` цієї сесії є `[]`
- **AND** exit code 0

### Requirement: Archive завжди фіналізує metrics.json після успішного move

Після успішного переміщення change команда `archive <name>` MUST створити `metrics.json` у архівній папці, якщо файлу не було, виставити `archivedAt`, очистити `pending`, перерахувати агрегати і додати сесію `role: Archiver`, `phase: archive`, `durationMs: null`. Клієнт Archiver SHALL резолвитись так само, як persist: `--platform` / `AOK_PLATFORM` → `## Metrics` (після відкидання stale-копії попередньої сесії) → `resolveRestoreClient` / host env. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, archive SHALL зібрати spend лише цього клієнта навіть без `--collect`, з вікном Archiver (`last session.endedAt || createdAt` → зараз). Amp-флоу: `amp threads export` + `amp threads usage --details` (fail-open) плюс локальні threads. Cursor-флоу: hook-файл. Claude-флоу: `~/.claude/projects`. `--collect` SHALL запускати всі три адаптери. Значення `model`, токенів, `costUsd`, `ampCredits` і `spendSource` SHALL резолвитись: прапорці `archive` → унікальний (не stale) `## Metrics` → зібрані `sources` → `null`. Якщо `## Metrics` повторює `inputTokens`/`outputTokens`/`model`/`platform` останньої не-Archiver сесії, ці поля MUST ігноруватись, щоб не подвоїти apply-spend. Невалідний `--platform` MUST відхилятись до move. Якщо після finalize `spend.costUsd` є `null` — warning у stderr через `console.error`. Exit code MUST NOT змінюватись через відсутній файл, порожній spend, відсутній самозвіт або `null` модель.

#### Scenario: Archive без файлу створює metrics.json з Archiver

- **GIVEN** change без `metrics.json` проходить гейті archive
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** архівний `metrics.json` існує з непорожнім `archivedAt` і `pending: null`
- **AND** `sessions` містить запис `Archiver` / `archive`

#### Scenario: Archiver бере значення з самозвіту

- **GIVEN** `handoff.md` change-у містить `## Metrics` з `platform: amp`, `model: claude-fable-5`, `input_tokens: 4000`
- **AND** жодна попередня сесія не має тих самих `inputTokens`/`model`/`platform`
- **WHEN** виконується `archive <name>` без прапорців моделі й платформи
- **THEN** сесія `Archiver` має `platform: amp`, `model: claude-fable-5`, `inputTokens: 4000`
- **AND** `spendSource` цієї сесії є `self-report`

#### Scenario: Archive з locked Cursor збирає hook у фазу archive

- **GIVEN** остання сесія має `endedAt` раніше за рядок у `.agents/spend/cursor-usage.jsonl`
- **AND** host env має `CURSOR_AGENT=1`
- **WHEN** виконується `archive <name>` без `--collect`
- **THEN** сесія `Archiver` має `platform: cursor`
- **AND** `sources` містить цей hook-рядок
- **AND** `phases.archive.totalTokens` не є `null`

#### Scenario: Stale ## Metrics з apply не подвоюється на Archiver

- **GIVEN** остання сесія `Implementer` має `inputTokens: 1000`, `platform: cursor`, `model: cursor-grok-4.6`
- **AND** архівований `handoff.md` `## Metrics` повторює ці самі числа
- **AND** у вікні Archiver є новий hook-рядок на 50 токенів
- **WHEN** виконується `archive <name>` з `CURSOR_AGENT=1` без `--collect`
- **THEN** `Archiver.inputTokens` не дорівнює `1000`
- **AND** `sources` Archiver містить новий hook-рядок

#### Scenario: Порожній spend на archive — warning і exit 0

- **GIVEN** фіналізований `spend.costUsd` є `null`
- **WHEN** archive успішно фіналізує metrics
- **THEN** stderr містить попередження
- **AND** exit code 0

### Requirement: Persist і archive не падають лише через відсутні model або spend

Відсутні `model`, `platform` (крім невалідного `--platform`), spend-поля, відсутня секція `## Metrics` і порожній collect MUST NOT бути єдиною причиною ненульового exit persist або archive. `gate-check` і pre-commit hook MUST NOT вимагати наявність або вміст `metrics.json` і MUST NOT вимагати заповнений самозвіт.

#### Scenario: Persist без model і spend успішний

- **WHEN** виконується валідний persist без `--model`, без `AOK_MODEL`, без `## Metrics` і без spend-прапорців
- **THEN** exit code 0
- **AND** сесія записана з `model: null`, null spend і `spendSource: "unreported"`

#### Scenario: Відсутність metrics.json не валить gate-check

- **GIVEN** активна зміна без `metrics.json`
- **WHEN** виконується `npx agent-orchestrator-kit gate-check` (або pre-commit hook)
- **THEN** відсутність файлу не є помилкою і не змінює exit code

### Requirement: Секція `## Metrics` у handoff.md — самозвіт сесії

`handoff.md` SHALL мати секцію `## Metrics` — самозвіт агента, який закриває сесію. Секція складається з рядків `- <key>: <value>` і підтримує ключі: `platform` (`cursor` | `claude` | `amp`), `model` (LLM product id), `input_tokens`, `output_tokens`, `total_tokens` (опційно), `cost_usd`, `amp_credits`, `spend_source`. Порядок рядків MUST NOT мати значення; регістр ключа MUST ігноруватись; невідомі ключі MUST ігноруватись без помилки.

Нормалізація значень: `unknown`, `none`, `n/a`, `-`, `—`, `null` і порожній рядок SHALL давати `null`. Числа SHALL прийматись з розділювачами тисяч (`128,000`, `128 000`) і з префіксом `$` для `cost_usd`. Значення, яке не парситься в число, SHALL давати `null` і warning у stderr, а не помилку. Якщо `total_tokens` відсутній, але є `input_tokens` або `output_tokens` — `total_tokens` SHALL дорівнювати сумі наявних. `platform` поза множиною `cursor` / `claude` / `amp` SHALL давати `null` і warning (на відміну від `--platform`, який залишається fail).

CLI SHALL записувати секцію в `handoff.md` при кожному persist: `buildHandoffMarkdown` ставить `## Metrics` після `## Runtime` і перед `## Prompt`. Секція SHALL лишатись **самозвітом як його написав агент**: CLI зберігає прочитані значення і підставляє `unknown` лише для полів, яких у файлі не було або які не спарсились. CLI MUST NOT перезаписувати секцію резолвленими значеннями — прапорці, `AOK_MODEL` / `AOK_PLATFORM`, host env і зібрані при `--collect` `sources` впливають лише на запис у `metrics.json`. Джерелом істини про те, що потрапило в сесію, є `metrics.json`; `## Metrics` лишається записом того, що заявив агент. Наявні `handoff.md` без секції MUST лишатись валідними — секція дописується наступним persist без помилки.

Самозвіт MUST NOT впливати на час: `startedAt`, `endedAt` і `durationMs` ставить лише CLI, ключі часу в секції MUST ігноруватись.

#### Scenario: Persist читає заповнену секцію

- **GIVEN** `handoff.md` містить `## Metrics` з `platform: cursor`, `model: claude-opus-5`, `input_tokens: 128000`, `output_tokens: 9400`, `cost_usd: 0.42`
- **WHEN** виконується `handoff <name>` без spend-прапорців
- **THEN** `sessions[0].platform` дорівнює `cursor`
- **AND** `sessions[0].model` дорівнює `claude-opus-5`
- **AND** `sessions[0].inputTokens` дорівнює `128000`
- **AND** `sessions[0].totalTokens` дорівнює `137400`
- **AND** `sessions[0].costUsd` дорівнює `0.42`
- **AND** exit code 0

#### Scenario: Значення unknown дає null без падіння

- **GIVEN** `## Metrics` містить `model: unknown`, `input_tokens: unknown`, `cost_usd: —`
- **WHEN** виконується persist
- **THEN** `sessions[0].model` є `null`
- **AND** `sessions[0].inputTokens` є `null`
- **AND** `sessions[0].costUsd` є `null`
- **AND** exit code 0

#### Scenario: Числа з розділювачами і знаком долара

- **GIVEN** `## Metrics` містить `input_tokens: 128,000`, `output_tokens: 9 400`, `cost_usd: $1.25`
- **WHEN** виконується persist
- **THEN** `sessions[0].inputTokens` дорівнює `128000`
- **AND** `sessions[0].outputTokens` дорівнює `9400`
- **AND** `sessions[0].costUsd` дорівнює `1.25`

#### Scenario: Невалідна платформа в секції — null і warning

- **GIVEN** `## Metrics` містить `platform: chatgpt`
- **WHEN** виконується persist без `--platform`
- **THEN** `sessions[0].platform` є `null`
- **AND** stderr містить попередження про невалідну платформу самозвіту
- **AND** exit code 0

#### Scenario: Прапорець не перезаписує секцію у файлі

- **GIVEN** `## Metrics` містить `input_tokens: 100`, `output_tokens: 50`, `cost_usd: 0.10`
- **WHEN** виконується persist з `--input-tokens 7 --cost-usd 9.99`
- **THEN** `sessions[0].inputTokens` дорівнює `7`
- **AND** `handoff.md` після запису містить `input_tokens: 100` і `cost_usd: 0.10`
- **AND** exit code 0

#### Scenario: Persist дописує секцію у файл

- **GIVEN** `handoff.md` з усіма обов'язковими секціями і без `## Metrics`
- **WHEN** виконується persist
- **THEN** файл після запису містить `## Metrics`
- **AND** секція стоїть після `## Runtime` і перед `## Prompt`
- **AND** exit code 0

#### Scenario: Ключі часу в секції ігноруються

- **GIVEN** `## Metrics` містить `duration_ms: 999999` і `started_at: 2020-01-01T00:00:00Z`
- **AND** `pending.startedAt` виставлений попереднім restore
- **WHEN** виконується persist
- **THEN** `sessions[0].startedAt` дорівнює `pending.startedAt`
- **AND** `sessions[0].durationMs` розрахований CLI, а не взятий з секції

### Requirement: Джерело spend — прапорці, потім самозвіт, потім опційні адаптери

Session-level spend SHALL резолвитись пополе, перше не-null значення виграє: явний прапорець (`--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`) → відповідний ключ `## Metrics` (для archive — після drop stale-копії попередньої сесії) → зібрані `sources` (locked client або `--collect`) → `null`. Дефолтний persist і archive MUST NOT читати адаптери інших платформ, ніж резолвлений клієнт, якщо немає `--collect`.

`session.ampCredits` SHALL зберігатись окремим полем сесії з ключа `amp_credits` і MUST NOT входити в `costUsd` чи в будь-яку суму USD. Відсутнє число MUST лишатись `null`, ніколи штучним `0`. CLI MUST NOT писати оцінений з токенів USD у `costUsd`. CLI MUST NOT конвертувати Amp credits у USD. Cursor-оцінка з токенів SHALL писатись лише в `costUsdEstimated` (див. «Cursor estimate не змішується з billed USD»). Ключ самозвіту `cost_usd` і прапорець `--cost-usd` SHALL потрапляти в `costUsd` як billed/self-report і MUST NOT копіюватись у `costUsdEstimated`. Агент MUST NOT підставляти Cursor-оцінку як billed `cost_usd`.

Коли `--collect` передано, зібрані `sources` SHALL записуватись у `session.sources` і наповнювати `spendByPlatform` / `spendByModel`, але MUST NOT перекривати totals, що прийшли з прапорців або самозвіту.

#### Scenario: Прапорець перемагає самозвіт

- **GIVEN** `## Metrics` містить `input_tokens: 100`, `output_tokens: 50`, `cost_usd: 0.10`
- **WHEN** виконується persist з `--input-tokens 7 --cost-usd 9.99`
- **THEN** `sessions[0].inputTokens` дорівнює `7`
- **AND** `sessions[0].outputTokens` дорівнює `50`
- **AND** `sessions[0].costUsd` дорівнює `9.99`

#### Scenario: Дефолтний persist не читає адаптери

- **GIVEN** tmp `HOME` з валідною Claude JSONL фікстурою у вікні сесії
- **AND** `handoff.md` без `## Metrics`
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

#### Scenario: Самозвіт не перекривається зібраними sources

- **GIVEN** `## Metrics` містить `input_tokens: 1000`, `output_tokens: 200`
- **AND** адаптерна фікстура дає source з `inputTokens: 5`, `outputTokens: 5`
- **WHEN** виконується persist з `--collect`
- **THEN** `sessions[0].inputTokens` дорівнює `1000`
- **AND** `sessions[0].sources` містить зібраний запис
- **AND** `spendByPlatform` містить токени зібраного запису

#### Scenario: Самозвіт cost_usd не стає estimate

- **GIVEN** `## Metrics` містить `cost_usd: 0.42` і немає Cursor hook-записів
- **WHEN** виконується persist
- **THEN** `sessions[0].costUsd` дорівнює `0.42`
- **AND** `sessions[0].costUsdEstimated` є `null`

### Requirement: Поле session.spendSource фіксує походження чисел

Кожен запис сесії SHALL містити `spendSource` — непорожній рядок походження spend-чисел. CLI SHALL резолвити його так: непорожній ключ `spend_source` з `## Metrics` → `flag`, якщо хоч одне число прийшло з прапорця і секція не задала `spend_source` → `self-report`, якщо числа прийшли з секції → `adapter`, якщо числа прийшли лише з `--collect` → `unreported`, якщо жодного числа немає. Значення `unreported` SHALL використовуватись і тоді, коли секція є, але всі числові поля порожні.

`spendSource` MUST NOT впливати на exit code і MUST NOT змінювати агрегати. Legacy-записи сесій без поля SHALL читатись як `unreported` без міграції файлу.

#### Scenario: Самозвіт дає self-report

- **GIVEN** `## Metrics` з числами і без ключа `spend_source`
- **WHEN** виконується persist без прапорців
- **THEN** `sessions[0].spendSource` дорівнює `self-report`

#### Scenario: Явний spend_source з секції перемагає дефолт

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

### Requirement: Відсутній самозвіт — попередження і unreported, без fail

Persist без секції `## Metrics` (або з секцією, де всі числа порожні) MUST записати сесію, виставити `spendSource: "unreported"`, залишити spend-поля `null` і надрукувати іменоване попередження в stderr із переліком очікуваних ключів. Exit code MUST лишатись `0`. Попередження MUST йти в stderr, щоб stdout лишався лише next-thread prompt.

CLI MUST дописати в `handoff.md` скелет `## Metrics` зі значеннями `unknown` для полів, які лишились порожніми, щоб наступна сесія відкривала готовий до заповнення шаблон.

`gate-check`, pre-commit hook і `archive` MUST NOT вимагати заповнений самозвіт.

#### Scenario: Persist без секції попереджає і продовжує

- **GIVEN** `handoff.md` з усіма обов'язковими секціями і без `## Metrics`
- **WHEN** виконується persist
- **THEN** exit code 0
- **AND** stderr містить попередження про незаповнену секцію `## Metrics`
- **AND** stdout містить лише next-thread prompt

#### Scenario: Скелет секції з'являється у файлі

- **GIVEN** persist завершився без самозвіту
- **WHEN** читається `handoff.md`
- **THEN** файл містить `## Metrics` з рядками `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`
- **AND** порожні поля мають значення `unknown`

#### Scenario: Відсутній самозвіт не валить gate-check

- **GIVEN** активна зміна з `handoff.md` без `## Metrics`
- **WHEN** виконується `npx agent-orchestrator-kit gate-check`
- **THEN** exit code не змінюється через відсутню секцію

### Requirement: Прапорець `--collect` вмикає локальні адаптери

`handoff <name>` і `archive` SHALL приймати опційний `--collect`, який вмикає повний прохід `collectSpend` (три адаптери, вікно, dedup) додатково до locked-клієнта. Без `--collect` і без резолвленого клієнта `amp`/`cursor`/`claude` адаптери MUST NOT запускатись, `session.sources` MUST бути `[]`. Коли клієнт резолвлений, archive і persist SHALL читати адаптер цього клієнта навіть без `--collect`.

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

#### Scenario: Archive --collect збирає вікно Archiver

- **GIVEN** остання сесія має `endedAt` раніше за usage-подію в tmp-фікстурі Claude JSONL
- **AND** подія входить у `[last session.endedAt, now]` і cwd збігається
- **WHEN** виконується `archive <name> --collect` з валідним sync-рішенням
- **THEN** сесія `Archiver` містить цю подію в `sources` або вона врахована в `spendByPlatform.claude`
- **AND** exit code 0

#### Scenario: --no-collect більше не існує

- **WHEN** виконується persist з `--no-collect`
- **THEN** CLI повідомляє про невідомий прапорець
- **AND** документація і шаблони протоколу не згадують `--no-collect`

### Requirement: Archive друкує людську зводку по всьому change

Після успішного move і finalize `archive <name>` SHALL надрукувати в stdout зводку по всьому change: рядок підсумку (`sessions`, work time, lead time, `tokens`, `cost`), таблицю **by phase** (sessions, duration, tokens, cost, roles, models), таблицю **by platform** (tokens, `costUsd`, `ampCredits`) і таблицю **by model** (platform, tokens, `costUsd`). Зводка SHALL рендеритись тією самою функцією, що й `metrics <name>` без `--json`, щоб два виводи не розходились.

Зводка MUST NOT друкувати єдиний total $, що додає Amp credits до USD. Сесії з `spendSource: "unreported"` SHALL бути видимими в зводці (окремий рядок або лічильник), щоб було зрозуміло, скільки сесій не самозвітувались. Помилка рендерингу зводки MUST NOT робити archive non-zero — change уже переміщено.

#### Scenario: Archive stdout містить зводку

- **GIVEN** change з трьома записаними сесіями проходить гейти archive
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** stdout містить кількість сесій, work time, lead time, tokens і cost
- **AND** stdout містить таблиці by phase, by platform і by model
- **AND** exit code 0

#### Scenario: Зводка показує unreported сесії

- **GIVEN** дві з трьох сесій мають `spendSource: "unreported"`
- **WHEN** виконується archive
- **THEN** stdout повідомляє, що дві сесії без самозвіту

#### Scenario: Зводка не змішує credits і USD

- **GIVEN** `spendByPlatform.claude.costUsd` є `1.5`, `spendByPlatform.amp.ampCredits` є `20`
- **WHEN** виконується archive
- **THEN** stdout не містить одного total, що дорівнює `21.5`

### Requirement: Cursor spend hook — опційне доповнення, ensure лише в setup-командах

Kit SHALL і надалі постачати `templates/scripts/cursor-spend-hook.cjs` і `templates/scripts/cursor-spend-collect.cjs` з незмінною поведінкою: hook читає stdin payload подій `stop` / `subagentStop` / `afterAgentResponse` і дописує запис у `<project>/.agents/spend/cursor-usage.jsonl`, лише якщо payload містить хоча б одне з `input_tokens` / `output_tokens`; collect-скрипт на `sessionEnd` мержить нові рядки в **останню** сесію кожного активного `metrics.json` без додавання нової сесії. Обидва MUST бути fail-open: будь-яка помилка завершується exit 0 без stdout.

`ensureCursorSpendHook(projectDir)` SHALL викликатись лише в `init`, `update`, `sync` і `mcp-setup`. Виклики з `handoff --restore`, `handoff <name>` persist і `metrics` MUST бути видалені — жодна сесійна команда не переписує `.cursor/hooks.json` і не друкує статус hook. Merge `.cursor/hooks.json` MUST NOT видаляти чужі hooks; битий `hooks.json` MUST NOT перезаписуватись — лише warning. `.agents/spend/` MUST лишатись у GITIGNORE_LINES. `status` SHALL і далі друкувати секцію `Spend capture`, позначаючи hook як опційний.

`npx agent-orchestrator-kit metrics [name] --collect` SHALL лишатись доступним з незмінною семантикою (повний collectSpend, dedup за `source.id`, без додавання нової сесії).

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

### Requirement: Часові мітки metrics.json — UTC

Усі поля часу в `metrics.json` (`createdAt`, `updatedAt`, `archivedAt`, `pending.startedAt`, `session.startedAt` / `endedAt`, `source.at`) SHALL записуватись як ISO-8601 UTC з суфіксом `Z`, наприклад `2026-08-31T07:08:17.563Z`. Kit MUST NOT писати офсет `Europe/Kyiv` і MUST NOT вимагати кореневий ключ `timezone`. Парсер MUST приймати легасі офсет (`+03:00` / `+02:00`), мікросекунди і зламані Amp-штампи `YYYY-MM-DDTHH:mm:ss.ssssss.000Z`. Команда `metrics` SHALL друкувати дати як `DD.MM.YYYY HH:mm:ss (Київ ±HH:MM)`. Порівняння вікон collect MUST іти через epoch ms, не через рядкове порівняння ISO.

#### Scenario: Зламаний Amp timestamp нормалізується в UTC

- **GIVEN** вхід `2026-08-31T07:08:17.563464.000Z`
- **WHEN** записується `metrics.json`
- **THEN** поле часу дорівнює `2026-08-31T07:08:17.563Z`

### Requirement: Amp CLI віддає mode і billed USD

Коли locked client є `amp` (або `--collect`), адаптер `amp-cli` SHALL після `amp threads export <id>` викликати `amp threads usage <id> --details` (бінар `AOK_AMP_BIN` або `amp`, fail-open, без сирого HTTP). З export SHALL братися `usage.model`, токени і `agentMode` (`low` / `medium` / `high` / `ultra` з `thread.agentMode` або `thread.meta.agentMode`). З usage SHALL братися рядок `Cost: $N` у `session.costUsd` / `spendByPlatform.amp.costUsd` і таблиця Models у `session.usageModels`. Рядок `Cost: $N` є єдиним Amp billed USD: він SHALL писатись зі `costSource: "amp-usage"` на source, коли Cost реально спарсився. Відсутній рядок `Cost:` MUST лишати `costUsd: null` (fail-open), навіть коли usage містить токени або таблицю Models. Kit MUST NOT множити Amp-токени на ставки і MUST NOT ділити чи множити `ampCredits`, щоб отримати USD. `ampCredits` SHALL лишатись окремим полем і MUST NOT записуватись як `costUsd`. `agentMode` SHALL писатись у `session.agentMode` і MUST NOT ставати `session.model`. Плейсхолдер `amp-default` трактується як відсутня модель, тож primary id з sources перемагає. Amp credits MUST NOT конвертуватись у USD.

#### Scenario: Amp usage inject заповнює costUsd і agentMode

- **GIVEN** `exportAmpThread` повертає thread з `agentMode: "low"` і usage GLM
- **AND** `usageAmpThread` повертає `{ costUsd: 1.3 }`
- **WHEN** виконується collect Amp CLI
- **THEN** `sources[0].agentMode` є `"low"`
- **AND** `ampThreads[0].costUsd` є `1.3`

#### Scenario: Amp usage без рядка Cost лишає costUsd null

- **GIVEN** текст `amp threads usage --details` містить токени і не містить рядка `Cost: $N`
- **WHEN** викликається `parseAmpUsageDetails`
- **THEN** `costUsd` є `null`
- **AND** токени збережені, якщо вони були в тексті
- **AND** жодне поле не отримує USD, порахований з токенів або з `ampCredits`

### Requirement: Cursor estimate не змішується з billed USD

Адаптер cursor SHALL оцінювати USD з токенів, коли є хоча б одне з `inputTokens`, `outputTokens`, `totalTokens`, і SHALL писати результат у `costUsdEstimated`, ніколи в `costUsd` (`costUsd` на Cursor-adapter source лишається `null`). Оцінка MUST NOT видаватись за Cursor invoice. Ставки SHALL жити у версійованому модулі `bin/cursor-cost-estimate.js` без HTTP і без Cursor SDK.

1. Моделі `grok-4.6` / `grok-4.5` (включно з префіксом `cursor-`, записом `grok-4-6` / `grok-4-5` і суфіксом `-fast`) SHALL використовувати чинну xAI API-таблицю, з подвоєнням для `-fast` і long-context cliff при `inputTokens >= 200000`. Відсутній cache-split MUST рахувати весь input як fresh (оцінка зверху). `costSource: "api-estimate"`.
2. Будь-яка інша Cursor-модель (включно з порожнім або невідомим id) з `inputTokens` і/або `outputTokens` SHALL використовувати fallback **$3 / 1M input + $15 / 1M output**, без cache-split, без long-context cliff і без множника `-fast`; відсутня сторона рахується як `0`. `costSource: "api-estimate-fallback"`.
3. Якщо `inputTokens` і `outputTokens` обидва `null`, але є `totalTokens`, SHALL використовуватись fallback **$3.50 / 1M** total з `costSource: "api-estimate-fallback"`.
4. Якщо немає жодного з `inputTokens`, `outputTokens`, `totalTokens` — `costUsdEstimated` SHALL бути `null` і `costSource` MUST NOT ставитись.

`spend.costUsd` MUST містити лише billed / self-report / Amp usage. Human summary SHALL друкувати `$X billed + ~$Y est.` через `formatMetricsCostLine`. Claude і Amp MUST NOT отримувати `costUsdEstimated` з токенів у цьому change. Live HTTP для цін MUST NOT використовуватись.

#### Scenario: Cursor hook з grok-4.6-fast пише estimate, не costUsd

- **GIVEN** `cursor-usage.jsonl` з `model: cursor-grok-4.6-high-fast`, `inputTokens: 400`, `outputTokens: 40`
- **WHEN** виконується collect cursor
- **THEN** `sources[0].costUsd` є `null`
- **AND** `sources[0].costUsdEstimated` є числом
- **AND** `sources[0].costSource` є `"api-estimate"`

#### Scenario: Cursor hook з не-grok моделлю пише fallback estimate

- **GIVEN** `cursor-usage.jsonl` з `model: gpt-5.6`, `inputTokens: 1000000`, `outputTokens: 1000000`
- **WHEN** виконується collect cursor
- **THEN** `sources[0].costUsd` є `null`
- **AND** `sources[0].costUsdEstimated` дорівнює `18`
- **AND** `sources[0].costSource` є `"api-estimate-fallback"`

#### Scenario: Cursor fallback з лише totalTokens

- **GIVEN** не-grok модель з `totalTokens: 1000000` і без `inputTokens` / `outputTokens`
- **WHEN** рахується оцінка в `bin/cursor-cost-estimate.js`
- **THEN** `costUsdEstimated` дорівнює `3.5`
- **AND** `costSource` є `"api-estimate-fallback"`

#### Scenario: Cursor без токенів не пише estimate

- **GIVEN** модель `gpt-5.6` без `inputTokens`, `outputTokens` і `totalTokens`
- **WHEN** рахується оцінка
- **THEN** `costUsdEstimated` є `null`

#### Scenario: Відсутня сторона токенів рахується як нуль

- **GIVEN** не-grok модель з `inputTokens: 1000000` і `outputTokens: null`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `3`
- **AND** `costSource` є `"api-estimate-fallback"`

#### Scenario: Cursor fallback не подвоює суфікс -fast

- **GIVEN** модель `gpt-5.6-fast` з `inputTokens: 1000000` і `outputTokens: 1000000`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `18`
- **AND** `costSource` є `"api-estimate-fallback"`

#### Scenario: Порожня Cursor-модель з токенами все одно оцінюється

- **GIVEN** порожній model id і `inputTokens: 1000000`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `3`
- **AND** `costSource` є `"api-estimate-fallback"`

