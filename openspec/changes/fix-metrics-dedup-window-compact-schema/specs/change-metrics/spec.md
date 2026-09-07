## MODIFIED Requirements

### Requirement: Файл metrics.json є git-tracked журналом change-у

Kit SHALL писати `openspec/changes/<name>/metrics.json` (після archive — у `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json`) зі схемою версії `2`: `version`, `change`, `createdAt`, `updatedAt`, `archivedAt` (`null` до фіналізації), `spend` (`inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`), `spendByPlatform` (ключі `cursor`, `claude`, `amp` → `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `costUsdEstimated`, `ampCredits`, `source`), `spendByModel` (масив `{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, ampCredits }`), `totals` (`sessions`, `durationMs`, `leadTimeMs`, `cloudSessions`), `phases` (ключ фази → `sessions`, `durationMs`, `startedAt`, `endedAt`, `leadTimeMs`, spend-поля включно з `costUsd` і `costUsdEstimated`, `agents`, `models`), `sessions` (масив записів), `pending` (`{ startedAt, role, platform, threadId, clientSource }` або `null`). Запис сесії SHALL містити `spendSource` (непорожній рядок), `ampCredits` (число або `null`), `costUsdEstimated` (число або `null`), `threadId` (Amp thread id, Cursor `conversationId`, або `null`), `sourceIds` (масив рядків id зібраних подій: Cursor `id`, Claude `message.id`, Amp `<thread>:<n>`; порожній, коли клієнт невідомий і немає `--collect`), `sourceTotals` (об'єкт `{ [id]: totalTokens }` для upgrade кумулятивних Cursor-рядків того самого id), `byModel` (масив `{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, costSource? }` — per-model агрегат цієї сесії) і опційно `models` (масив id), коли моделей більше однієї. Optional `byModel[].costSource`, when present, MUST be one of `api-estimate`, `api-estimate-fallback`, or `amp-usage`; absence means no applicable provenance. `costUsd` SHALL містити лише billed / self-report / Amp usage `Cost: $N`. `costUsdEstimated` SHALL містити лише оцінений USD і MUST NOT дублювати billed `costUsd`. Запис сесії MUST NOT містити масив per-message `sources`; per-message об'єкти живуть лише в пам'яті адаптера під час collect. Файл change-у з 8 сесій SHALL лишатись близько 1k рядків незалежно від кількості повідомлень. Файл MUST бути git-tracked (не в gitignored cache). Пошкоджений або відсутній JSON SHALL замінюватись default-об'єктом з тими самими ключами, без падіння CLI. Відсутні нові поля в legacy-файлі SHALL мержитись з default (`spendByPlatform` з трьома ключами і `null`-полями включно з `costUsdEstimated`, `spendByModel: []`, `sourceIds: []`, `sourceTotals: {}`, `byModel: []`, `spendSource: "unreported"`, `ampCredits: null`, `costUsdEstimated: null` на `spend` і сесіях). Legacy v1-файл із `sessions[].sources` SHALL нормалізуватись при читанні шляхом representation-only conversion: `sourceIds` = унікальні `sources[].id`, `sourceTotals` = `id → totalTokens`, `byModel` = агрегат `sources` за `platform` + `model`; після нормалізації ключ `sources` MUST бути відсутній. Schema-only migration MUST preserve every existing session numeric field and every existing top-level aggregate, including `spend`, `totals`, `spendByPlatform`, `spendByModel`, and `phases`; it MUST NOT recompute or invent consumer numbers. Derived fields without a legacy value SHALL remain null-honest. `metrics <name>` і `metrics <name> --json` SHALL читати v1 і v2 без запису на диск; `metrics <name> --migrate` SHALL переписати файл (включно з архівним) у v2 з цією exact numeric invariance і MUST NOT запускати recompute. Наступний звичайний persist/archive write після conversion SHALL додати свою сесію або contributions і перерахувати агрегати за звичайними правилами запису.

#### Scenario: Restore створює валідний скелет

- **GIVEN** активна зміна без `metrics.json`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --restore` без `--no-metrics`
- **THEN** файл `openspec/changes/<name>/metrics.json` існує
- **AND** містить `version: 2`, `change: <name>`, `sessions: []`, `pending` з `startedAt`, `archivedAt: null`
- **AND** містить ключі `spendByPlatform` і `spendByModel`
- **AND** `spend` містить ключ `costUsdEstimated` зі значенням `null`

#### Scenario: Пошкоджений JSON не валить persist

- **GIVEN** `metrics.json` містить невалідний JSON
- **WHEN** виконується persist без `--no-metrics`
- **THEN** команда завершується з exit 0
- **AND** файл перезаписаний валідним об'єктом схеми версії `2` із новою сесією

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

#### Scenario: v1 файл мігрує на першому записі

- **GIVEN** `metrics.json` `version: 1` з `sessions[0].sources` із 4 записів з чотирма різними id і двома моделями
- **AND** новий persist не має додаткових numeric contributions
- **WHEN** виконується persist без `--no-metrics`
- **THEN** файл має `version: 2`
- **AND** `sessions[0].sourceIds.length` дорівнює `4`
- **AND** `sessions[0].byModel.length` дорівнює `2`, а обидва рядки разом містять суму токенів цих 4 записів
- **AND** `sessions[0]` не має ключа `sources`
- **AND** `spend.totalTokens` не змінився

#### Scenario: metrics --migrate переписує архівний файл

- **GIVEN** `openspec/changes/archive/2026-09-07-x/metrics.json` `version: 1`
- **WHEN** виконується `metrics x --json`
- **THEN** stdout містить `version: 2` і `sourceIds`
- **AND** файл на диску не змінився
- **WHEN** виконується `metrics x --migrate`
- **THEN** файл на диску має `version: 2` і ті самі session numeric fields, `spend`, `totals`, `spendByPlatform`, `spendByModel` і `phases`
- **AND** schema-only `--migrate` не запускає recompute

### Requirement: Restore записує старт сесії, persist — її закриття

`handoff --restore` SHALL записувати `pending` (`startedAt` = зараз, `role` з next role handoff-файлу, якщо він є, `platform`, `threadId`, `clientSource` з детекту клієнта). `handoff <name>` SHALL додавати елемент у `sessions` з: `startedAt` з `--started-at` або `pending.startedAt` або `endedAt` останньої закритої сесії або `createdAt` файла (MUST NOT бути раніше за `createdAt`; earliest event MUST NOT ставати `startedAt`); `endedAt` = зараз; `durationMs` = різниця, коли обидва кінці відомі, інакше `null`; `role` = канонічний токен Closed role (див. «Канонічна Closed role у metrics.json»); `phase` = `phaseForRole` канонічного токена; `runtime` і `agentId` з runtime-ланцюжка; `tasks` зі знімка progress; `model` за вимогою «Модель сесії»; `platform`, токени, `costUsd`, `ampCredits` і `spendSource` з ланцюжка прапорець → числовий `## Metrics` → transient sources → `null`; `sourceIds` / `sourceTotals` / `byModel` з collect клієнта, зафіксованого на restore (або всі адаптери при `--collect`; порожні коли клієнт невідомий і немає `--collect`). Перед collect поточної сесії persist SHALL виконати leftover-backfill останньої вже закритої сесії (див. «Вікно collect»). Після запису `pending` MUST стати `null`. Агрегати (`phases`, `totals`, `spend`, `spendByPlatform`, `spendByModel`) SHALL перераховуватись на кожному записі.

Порядок persist MUST бути: прочитати `## Metrics` → leftover попередньої сесії → collect і записати сесію в `metrics.json` → надрукувати попередження в stderr → надрукувати next-thread prompt у stdout. Prompt MUST лишатись єдиним вмістом stdout. Два послідовні persist MUST лишатись двома записами сесій і MUST NOT зливатись в один.


Persist без `pending` і без `--started-at` SHALL надрукувати в stderr попередження `metrics: persist without restore — window starts at <last.endedAt>` і MUST NOT відкривати нижню межу collect.

#### Scenario: Restore + persist закриває одну сесію

- **GIVEN** `handoff.md` з Closed role `Architect`, next role `spec-reviewer` і `## Metrics` з `model: claude-opus-5`, `input_tokens: 12000`, `output_tokens: 3000`, `cost_usd: 0.42`
- **AND** collect не повернув transient source records з model
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

#### Scenario: Persist без restore починається з last.endedAt

- **GIVEN** `metrics.json` має 6 сесій, остання `endedAt` T, `pending: null`, немає `--started-at`
- **AND** `## Metrics` містить `platform: amp`
- **AND** у `AMP_DATA_DIR/threads` є 74 треди цього cwd з usage за три місяці до T
- **WHEN** виконується persist
- **THEN** `sessions[6].startedAt` дорівнює T
- **AND** `sessions[6].sourceIds` не містить id з `at` < T
- **AND** stderr містить `persist without restore`
- **AND** exit code 0

### Requirement: Restore фіксує клієнта сесії, persist йде його флоу

`handoff --restore` SHALL визначити клієнта сесії і записати його в `pending`: `platform` (`cursor` | `claude` | `amp` | `null`), `threadId` (Amp thread id, або Cursor `conversationId`, або `null`), `clientSource` (непорожній рядок джерела). Резолв клієнта: `--platform` / `AOK_PLATFORM` → `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` → `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID` → Claude Code env → батьківський процес `amp` і/або свіжий `~/.local/share/amp/session.json` `lastThreadByTerminal[tty]` (вікно свіжості ≤ 2h; `/dev/null` і pipe MUST NOT рахуватись як tty) → якщо env і Amp parent не перемогли, свіжий `session.json` `lastThreadId` (те саме вікно ≤ 2h; свіжість з кореневого `updatedAt`, інакше mtime файла) з `clientSource: amp-session-last` → якщо `lastThreadId` порожній, але `session.json` існує і свіжий — перший id `amp threads list` з `clientSource: amp-session-list` → `null`. Якщо батько є `amp` і tty немає, `pending.threadId` SHALL братися з першого id `amp threads list` (`clientSource: amp-threads-list`), MUST NOT з `session.json` `lastThreadId`. Для cursor непорожній `CURSOR_CONVERSATION_ID` SHALL стати `pending.threadId`; на persist без `pending` той самий env SHALL стати `session.threadId` (id, використаний як фільтр collect, MUST бути записаний у сесію). Amp env MUST перемагати Cursor env. `agentMode` (`low`/`medium`/`high`/`ultra`) MUST NOT ставати `session.model`.

`handoff <name>` SHALL резолвити `session.platform` так: `--platform` → `## Metrics` → `AOK_PLATFORM` → `pending.platform` → host env → transient sources. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, persist SHALL зібрати spend лише цього клієнта навіть без `--collect`. Amp-флоу: `amp threads export <pending.threadId>` (бінар `AOK_AMP_BIN` або `amp`; fail-open) плюс локальні `threads/*.json` **лише цього thread id**. Persist і archive MUST NOT викликати `listRecentAmpThreadIds`; без thread id (`pending.threadId`, `--amp-thread`, `AMP_CURRENT_THREAD` / `AMP_THREAD_ID`) Amp-флоу MUST пропустити локальні `threads/*.json` з note у stderr. Cost треда, чий id уже є `threadId` попередньої сесії, MUST NOT додаватись до нової сесії. Cursor-флоу: hook-файл з фільтром conversationId. Claude-флоу: `~/.claude/projects`. `--collect` SHALL як і раніше запускати всі три адаптери. Відсутній Amp CLI MUST NOT валити persist.

#### Scenario: Amp restore + persist без Amp env збирає thread

- **GIVEN** `handoff --restore` з `AMP_CURRENT_THREAD=T-lock` записав `pending.platform: amp` і `pending.threadId: T-lock`
- **AND** після restore з’явився matching Amp usage у вікні
- **WHEN** виконується persist без `AMP_*` і без `--collect`
- **THEN** `sessions[0].platform` дорівнює `amp`
- **AND** `sessions[0].sourceIds` містить id usage цього thread, а `byModel` містить його модель і токени

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
- **AND** `sessions[0].sourceIds` містить id usage `T-lock`, а `sourceTotals` і `byModel` містять його compact data

#### Scenario: Cursor restore не підхоплює Amp disk threads

- **GIVEN** `handoff --restore` з `CURSOR_AGENT=1` записав `pending.platform: cursor`
- **AND** у `AMP_DATA_DIR/threads` є matching usage цього cwd
- **WHEN** виконується persist без `--collect`
- **THEN** `sessions[0].platform` дорівнює `cursor`
- **AND** `sessions[0].sourceIds` не містить id Amp usage і `sessions[0].byModel` не має внеску Amp

#### Scenario: Persist без restore на порожньому файлі починається з createdAt

- **GIVEN** немає `pending` і немає `--started-at`
- **AND** файл має `createdAt` C і collect не повернув transient source records
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].startedAt` дорівнює C
- **AND** `sessions[0].durationMs` є різницею між `endedAt` і C
- **AND** команда завершується з exit 0

#### Scenario: Persist без restore не ставить startedAt з earliest source.at

- **GIVEN** немає `pending` і немає `--started-at`
- **AND** остання закрита сесія має `endedAt: 2026-08-31T16:15:00.000Z`
- **AND** collect повернув transient source records з `at: 2026-08-31T16:10:00.000Z` і `at: 2026-08-31T16:16:00.000Z`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** нова сесія має `startedAt: 2026-08-31T16:15:00.000Z`
- **AND** earliest source `at` не використано як старт

#### Scenario: Сесія записана до друку промпта

- **GIVEN** persist завершився exit 0
- **WHEN** порівнюються stdout і `metrics.json`
- **THEN** `metrics.json` містить нову сесію
- **AND** stdout містить лише next-thread prompt без метрик

#### Scenario: Cursor persist без pending записує threadId з env

- **GIVEN** `pending: null` і `CURSOR_CONVERSATION_ID=c39e1057`
- **AND** hook-файл має рядки `conversationId c39e1057` і `conversationId 0d5285a1` у вікні
- **WHEN** виконується persist без `--collect`
- **THEN** `sessions[0].threadId` дорівнює `c39e1057`
- **AND** `sourceIds` містить лише рядки `c39e1057`

#### Scenario: Persist Amp без thread id не сканує локальні threads

- **GIVEN** `pending: null`, немає `AMP_*` env і `--amp-thread`, `## Metrics platform: amp`
- **AND** `AMP_DATA_DIR/threads` має matching треди цього cwd
- **WHEN** виконується persist
- **THEN** `sessions[n].sourceIds` порожній
- **AND** `listRecentAmpThreadIds` не викликається
- **AND** stderr містить note про пропущений Amp collect без thread id

### Requirement: Модель сесії — LLM product id з sources, flag або env, інакше null

`session.model` і `phases.*.models` MUST зберігати ідентифікатор LLM-продукту, не Closed role, не ім'я субагента і не family-ярлик, коли адаптер уже дав product id. Sources у цій вимозі — transient chat records, не persisted session key. Резолв SHALL відбуватись до compaction: primary модель з transient зібраних chat-подій (модель з найбільшим `totalTokens` серед подій з непорожнім `model`; при рівності — стабільний порядок platform, потім id; для Amp — лише `usage.model` export-повідомлень, не display-імена helper-моделей з usage-таблиці) → якщо жоден transient source не має `model`: непорожній `--model` → непорожній `model` з `## Metrics` → непорожній env `AOK_MODEL` → `null`. `--model` / `## Metrics` / `AOK_MODEL` MUST NOT перемагати непорожній transient `source.model`. Family на кшталт `cursor-grok-4.6` MUST NOT з’являтись у `session.model`, `phases.*.models` чи `spendByModel`, коли transient sources мають product id (`cursor-grok-4.6-xhigh-fast`, `cursor-grok-4.6-low`). Amp Models rows у persisted `byModel` MAY містити display/helper models, але MUST NOT override chat product id, уже визначений з export. `session.models` SHALL містити унікальні `model` з `session.byModel`, коли рядків більше одного. Рядок зберігається як у usage-записі (без вигаданої таксономії). Порожнє значення і `unknown` трактуються як відсутнє. Відсутня модель MUST NOT робити persist або archive non-zero. Якщо сесія записується з `model: null`, CLI SHALL попередити в stderr. CLI MUST NOT викликати Cursor SDK, Claude `/cost` чи Amp billing API, щоб дізнатись модель.

#### Scenario: Product id з transient sources перемагає --model family

- **GIVEN** `--model cursor-grok-4.6`
- **AND** transient sources містять `model: cursor-grok-4.6-low` з `totalTokens: 1000`
- **WHEN** виконується persist
- **THEN** `session.model` дорівнює `cursor-grok-4.6-low`
- **AND** `phases` цієї сесії містить `cursor-grok-4.6-low`
- **AND** `spendByModel` не містить окремого рядка `cursor-grok-4.6`

#### Scenario: Прапорець --model перемагає самозвіт коли transient sources без model

- **GIVEN** `## Metrics` містить `model: claude-fable-5`
- **AND** transient sources порожні або без поля `model`
- **WHEN** виконується persist з `--model cursor-grok-4.6`
- **THEN** `session.model` дорівнює `cursor-grok-4.6`

#### Scenario: Самозвіт перемагає env коли transient sources без model

- **GIVEN** `AOK_MODEL=gpt-5.6-sol` і `## Metrics` містить `model: claude-opus-5`
- **AND** transient sources без model
- **WHEN** виконується persist без `--model`
- **THEN** `session.model` дорівнює `claude-opus-5`

#### Scenario: Env AOK_MODEL без прапорця і без самозвіту коли transient sources без model

- **GIVEN** `AOK_MODEL=gpt-5.6-sol`, немає `--model` і `## Metrics` без ключа `model`
- **AND** transient sources без model
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` дорівнює `gpt-5.6-sol`

#### Scenario: Відсутня модель — null, warning, exit 0

- **GIVEN** немає `--model`, немає `AOK_MODEL`, немає `## Metrics` і немає transient sources з model
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` є `null`
- **AND** stderr містить попередження про відсутню модель
- **AND** exit code 0

#### Scenario: Primary model з transient sources за totalTokens

- **GIVEN** collect повернув два transient sources: `claude-opus-4-7` з `totalTokens: 9000` і `gpt-5.6-sol` з `totalTokens: 1000`
- **AND** `--model cursor-grok-4.6`
- **WHEN** виконується persist
- **THEN** `session.model` дорівнює `claude-opus-4-7`
- **AND** `session.models` містить обидва id

#### Scenario: Amp модель чату перемагає helper-модель з usage

- **GIVEN** export має 26 повідомлень `usage.model: gpt-6-astra`
- **AND** usage-таблиця Models має `GPT-5.6 Sol` з більшою сумою токенів, ніж `GPT-6 Astra`
- **WHEN** виконується persist
- **THEN** `session.model` дорівнює `gpt-6-astra`
- **AND** `session.byModel` містить рядок `GPT-5.6 Sol`
- **AND** `session.models` містить обидва

### Requirement: Три read-only адаптери без мережі і без нових npm-залежностей

Collect усіх трьох адаптерів в одному проході запускається за явним `--collect` (на `handoff <name>`, `archive`) або командою `metrics --collect`. Persist і archive без `--collect` SHALL збирати лише locked/resolved клієнта (див. «Restore фіксує клієнта сесії» та «Archive завжди фіналізує metrics.json»). Модуль SHALL жити в `bin/spend-collect.js` і бути імпортованим з `bin/agent-orchestrator.js`. Адаптери MUST бути read-only і offline: без API-ключів, без HTTP, без Cursor SDK, без Amp billing API, без парсера Claude `/cost` як залежності. Нових npm-залежностей (`better-sqlite3`, `sql.js`, `ccusage`) MUST NOT з'являтись. Тести MUST підміняти `HOME` / `AMP_DATA_DIR` / `XDG_CONFIG_HOME` на tmp і MUST NOT читати реальний `~/.claude` розробника в CI.

Адаптер **claude** SHALL читати `~/.claude/projects/<cwd-encoded>/*.jsonl`, де cwd-encoded будується з аргумента `collectSpend({ cwd })` (якщо `cwd` опущено — `process.cwd()`) заміною кожного `/` і кожного `.` на `-`. Парсити assistant-рядки з `message.usage` і `message.model`, рахувати `cache_*` у `inputTokens`, якщо поля є, брати billed `costUsd` лише з `total_cost_usd` (або аналога) на записі, інакше `null`, фільтрувати вікно за полем рядка `timestamp`, і ставити `source: "claude-jsonl"`. Project matching SHALL accept `row.cwd === cwd` or `row.cwd` starting with `cwd + sep` and reject missing `row.cwd`. Static versioned Anthropic prices SHALL be used only for `costUsdEstimated`; live price lookup MUST NOT be used.

Адаптер **amp** SHALL читати `~/.local/share/amp/threads/*.json` з override `AMP_DATA_DIR` або `$XDG_DATA_HOME/amp`. Проєктний match порівнює `collectSpend` `cwd` (або `process.cwd()`, якщо аргумент опущено) після strip `file://` і нормалізації trailing slash. Якщо `env.initial.trees` непорожній — thread входить лише коли хоча б один `trees[].uri` дорівнює cwd; чужий trees MUST відкидатись навіть якщо JSON згадує cwd. Якщо `trees` відсутній або порожній, thread SHALL все одно входити, коли є інший консервативний сигнал того самого репо: `env.initial.cwd` / `env.cwd` / `thread.cwd` / `meta.cwd` (лише якщо поле реально є), `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` дорівнює `thread.id` або basename файла, або точний cwd / `file://`+cwd є в JSON thread. Thread без trees і без цих сигналів MUST пропускатись. MUST NOT вигадувати `cwd` / `meta.cwd`. `inputTokens` SHALL бути `usage.totalInputTokens`, якщо поле є, інакше `usage.inputTokens` плюс `cacheCreationInputTokens` і `cacheReadInputTokens`, якщо вони є. Також брати `usage.model` / `usage.outputTokens` / `usage.timestamp`. Оскільки `messageId` є thread-локальним лічильником, `source.id` MUST бути `<thread.id || basename файла>:<messageId|toMessageId>` — голий `messageId` колізує між threads. `ledger.jsonl` MAY бути відсутнім; без іменованої форми запису адаптер MUST NOT вимагати реальних `ampCredits` (відсутній ledger → `ampCredits: null`). Зберігати токени і `ampCredits` окремо, ставити `source: "amp-thread"` і MUST NOT конвертувати credits у USD.

Адаптер **cursor** SHALL НЕ брати usage з `agent-transcripts/*.jsonl` і MUST NOT читати `state.vscdb`, cookies чи server CSV (локальні бази Cursor не містять token usage). Він SHALL читати `<cwd>/.agents/spend/cursor-usage.jsonl` — файл, який пише опційний hook `scripts/cursor-spend-hook.cjs` з payload подій `stop` / `subagentStop` / `afterAgentResponse`. Кожен рядок: `{ id, event, conversationId, model, modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, at }`, де `inputTokens` уже включає cache-токени за семантикою Cursor. Фільтр вікна — за полем `at`; dedup — за `id` (`generation_id`); якщо той самий `id` зустрічається кілька разів, адаптер SHALL взяти запис з найбільшим `totalTokens`. Рядки без жодного token-поля MUST пропускатись. Якщо файла немає — порожньо + note. `source: "cursor-hook"`. MUST NOT оцінювати з `text.length`.


Claude-адаптер SHALL читати `<projectDir>/*.jsonl`, `<projectDir>/*/subagents/*.jsonl` і `<projectDir>/agent-*.jsonl` (транскрипти субагентів Claude Code). Рядки з однаковим `message.id` в одному проході MUST зливатись в одну подію (лишити запис із найбільшим `totalTokens`; `at` — найраніший). Cwd-match SHALL бути префіксним: `row.cwd === cwd` або `row.cwd` починається з `cwd + sep`; рядок без `cwd` MUST NOT включатись.

#### Scenario: Claude jsonl фікстура заповнює platform claude

- **GIVEN** tmp `HOME` з `~/.claude/projects/<cwd-encoded>/session.jsonl`, де cwd-encoded замінює `/` і `.` у переданому `cwd` на `-`, а assistant-рядок має `message.id`, `message.model: "claude-opus-4-7"`, `message.usage.input_tokens`, `output_tokens`, поле `cwd` рівне цьому `cwd` і поле `timestamp` у вікні
- **WHEN** виконується persist з `--collect`
- **THEN** `spendByPlatform.claude.source` дорівнює `claude-jsonl`
- **AND** `sessions[0].sourceIds` містить цей `message.id`, а `sessions[0].byModel` має рядок з `platform: "claude"` і його токенами
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
- **THEN** `sessions[0].sourceIds` не містить id usage цього thread і `sessions[0].byModel` не має його внеску

#### Scenario: Amp thread без trees входить за cwd або поточним thread

- **GIVEN** tmp `AMP_DATA_DIR` з thread JSON без `trees`, але з `env.initial.cwd` рівним collect cwd, або `AMP_CURRENT_THREAD` рівним `thread.id`
- **WHEN** виконується collect
- **THEN** transient collect result містить usage цього thread у `sources` з `platform: "amp"`

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
- **AND** `sessions[0].sourceIds` містить `g-1`, `sourceTotals["g-1"]` містить його total, а `byModel` має рядок `platform: "cursor"`
- **AND** повторні записи того самого `id` злиті в один з найбільшим `totalTokens`

#### Scenario: Claude streamed-рядки одного message.id рахуються один раз

- **GIVEN** jsonl з 15 assistant-рядками на 6 унікальних `message.id` з однаковим usage у вікні
- **WHEN** виконується collect claude
- **THEN** `sourceIds.length` дорівнює `6`
- **AND** `inputTokens` дорівнює сумі 6 унікальних (359148), не 906419

#### Scenario: Claude subagent-транскрипт входить у сесію

- **GIVEN** `<projectDir>/<sid>.jsonl` з 10 msg і `<projectDir>/<sid>/subagents/agent-a.jsonl` з 15 msg, усі `cwd` = cwd і у вікні
- **WHEN** виконується collect claude
- **THEN** `sourceIds.length` дорівнює `25`

#### Scenario: Claude cwd у підпапці проєкту входить, чужий проєкт — ні

- **GIVEN** рядок з `cwd = <cwd>/openspec/changes/x` і рядок з `cwd = /other/project`, обидва у вікні
- **WHEN** виконується collect claude
- **THEN** перший входить у `sourceIds`
- **AND** другий відсутній

### Requirement: Вікно collect, cwd-match і dedup

For Claude project matching, a transient collector row SHALL match only when `row.cwd === cwd` or `row.cwd` starts with `cwd + sep`; a missing `row.cwd` MUST be excluded. When both `--started-at` and `pending.startedAt` exist, `--started-at` SHALL win and the 120-second grace SHALL be anchored to that selected start.

Є рівно два вікна. Третього вікна MUST NOT бути.

**Persist цієї сесії.** CLI SHALL select start as `--started-at` → `pending.startedAt` → `last.endedAt` → `metrics.createdAt`. The collect lower bound SHALL be selected start minus 120 seconds when it came from `--started-at` or `pending.startedAt`, otherwise selected start itself. Нижня межа MUST завжди існувати. Подія, вже причеплена leftover-ом попередньої сесії, MUST NOT дублюватись. `startedAt` сесії MUST NOT братись з earliest події.

**Leftover останньої закритої сесії.** Persist (перед collect поточної), archive (перед collect Archiver), Cursor `sessionEnd` і Cursor hook після успішного append `stop` / `afterAgentResponse` SHALL причіплювати до **останньої вже закритої** сесії події, яких ще немає за `source.id`, з `at >= last.endedAt`. `leftoverEnd` SHALL бути `pending.startedAt`, коли наступний `pending` існує і `last.threadId` непорожній (навіть якщо це пізніше за 120s), і ця pending-межа є виключною (`at < leftoverEnd`). Для сесії з `threadId: null` leftoverEnd SHALL бути `min(pending.startedAt, last.endedAt + 120s)`; pending-межа лишається виключною, а grace-cap `last.endedAt + 120s` — інклюзивним. Без наступного pending leftoverEnd SHALL бути `last.endedAt + 120s` інклюзивно. Подія після `last.endedAt`, яка лежить у цьому leftover-вікні до наступного pending/cap, MUST належати останній закритій сесії і MUST NOT входити в persist нової сесії.

Leftover без `--collect` MUST бути scoped до `last.platform` і Amp leftover MUST різатись за thread id. If fresh Amp usage supplies Input/Output totals, session totals SHALL equal those totals and `byModel` SHALL be replaced by the fresh Models table. Otherwise, absent an explicit numeric flag override or numeric non-placeholder self-report, totals and `byModel` SHALL be rebuilt from all transient collected events when available, or from compact stored `sourceTotals` / `byModel`; persisted per-event `sources` MUST NOT be required or restored. Explicit numeric overrides MUST remain honored. Existing billed `session.costUsd` MUST be preserved unless fresh Cost is supplied. A matching late row MUST attach even when initial collect persisted `sourceIds: []`.

Подія MUST входити лише якщо її timestamp у відповідному вікні: Claude — поле рядка `timestamp`; Amp — `usage.timestamp`; Cursor — поле `at` hook-запису. Проєктний match порівнює з аргументом `collectSpend({ cwd })` (якщо опущено — `process.cwd()`). Claude transient row входить лише коли `row.cwd === cwd` або `row.cwd` починається з `cwd + sep`; рядок без `cwd` MUST бути виключений. Amp: thread з непорожнім `trees` входить лише за збігом `trees[].uri`; без `trees` — за cwd-полями, `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` або точною згадкою cwd у JSON; MUST NOT вигадувати `meta.cwd`. Cursor: файл `<root>/.agents/spend/cursor-usage.jsonl` читається для **кожного** резолвленого кореня leftover (див. «Спільний multi-root resolveBaseDir»); додатково діє фільтр conversationId на persist **і** на sessionEnd/hook leftover. Dedup: пропустити id, яке вже є в будь-якому `session.sourceIds` поточного `metrics.json`; виняток — Cursor-рядок того самого id з більшим `totalTokens` за `sourceTotals[id]`, який SHALL оновити `sourceTotals`, session totals і `byModel` без додавання id.

#### Scenario: Подія до last session.endedAt не потрапляє в нову сесію

- **GIVEN** уже є сесія з `endedAt` пізнішим за timestamp usage-події в фікстурі
- **WHEN** виконується наступний persist з `--collect`
- **THEN** id цієї події відсутній у `sourceIds` нової сесії

#### Scenario: Пізня подія після попереднього persist не потрапляє в наступну сесію

- **GIVEN** попередня сесія A уже закрита
- **AND** usage-подія має `id: late-a`, timestamp = `endedAt_A + 20s` і раніше за `pending.startedAt` сесії B
- **WHEN** виконується persist B з `--collect`
- **THEN** `late-a` відсутній у `sessions[B].sourceIds`
- **AND** leftover (той самий persist або `sessionEnd`) додає `late-a` до `sessions[A].sourceIds` і його total до `sourceTotals`
- **AND** `sessions[A].inputTokens` дорівнює сумі compact `byModel` / `sourceTotals` усіх її contributions, не лише першої

#### Scenario: Leftover resync після двох sources

- **GIVEN** сесія A має `spendSource: self-report`, null-числа і compact поля для однієї transient source-події на 954984 токенів
- **AND** leftover transient collect додає другу source-подію на 508064 токени та мержить її id/total/model у compact поля
- **WHEN** leftover завершується
- **THEN** `sessions[A].inputTokens` дорівнює `1463048`
- **AND** `sessions[A].spendSource` дорівнює `adapter`

#### Scenario: Повторний collect не дублює source.id

- **GIVEN** `metrics.json` уже містить `sessions[0].sourceIds` з id `msg-1`
- **WHEN** наступний persist з `--collect` знову бачить ту саму подію
- **THEN** новий запис сесії не містить повторного `msg-1`

#### Scenario: Чужа cwd відкидається

- **GIVEN** claude jsonl рядок з `cwd`, що не дорівнює аргументу `collectSpend({ cwd })`
- **WHEN** виконується persist з `--collect`
- **THEN** id цієї події відсутній у persisted `sourceIds`

#### Scenario: Пізній hook після порожнього archive collect причіплюється leftover

- **GIVEN** archive finalize записав Archiver з `sourceIds: []`, `sourceTotals: {}` і `byModel: []`
- **AND** hook-рядок з’явився +35s після `Archiver.endedAt` і `at <= endedAt + 120s`
- **WHEN** виконується leftover (`sessionEnd` або hook post-append)
- **THEN** id цього рядка є в `Archiver.sourceIds`, а його total/model — у `sourceTotals` / `byModel`

#### Scenario: Leftover сесії без threadId обмежений 120s

- **GIVEN** закрита Claude-сесія `endedAt` E з `threadId: null`
- **AND** наступний `pending.startedAt` = E + 17m
- **AND** jsonl має рядки на E + 30s і E + 6m у cwd
- **WHEN** виконується leftover наступного persist
- **THEN** рядок E + 30s причеплено
- **AND** рядок E + 6m відсутній у сесії

#### Scenario: Pre-restore grace бере status/restore-ходи без дубля

- **GIVEN** `pending.startedAt` P з `platform: cursor`, `threadId: conv-new`, і закрита сесія з `endedAt` P − 3m, `platform: cursor`, `threadId: conv-old`
- **AND** Cursor-подія id `a`, `conversationId: conv-new`, на P − 40s ще не причеплена, а подія id `b`, `conversationId: conv-old`, на P − 100s уже є в `sourceIds` попередньої сесії
- **WHEN** виконується persist
- **THEN** `a` є в `sourceIds` нової сесії
- **AND** `b` є лише в попередній сесії

#### Scenario: Cursor upgrade того самого id через sourceTotals

- **GIVEN** сесія має `sourceIds: ["g-1"]`, `sourceTotals: { "g-1": 1000 }`
- **AND** hook-файл має рядок `g-1` з `totalTokens: 1500` у leftover-вікні
- **WHEN** виконується leftover
- **THEN** `sourceTotals["g-1"]` дорівнює `1500`
- **AND** `sourceIds` містить `g-1` рівно один раз
- **AND** session totals перераховані

### Requirement: Агрегати перераховуються на кожному записі

Кожен виклик, що реально зберігає `metrics.json` (persist, archive finalize, leftover backfill), SHALL перераховувати `phases`, `totals`, `spend`, `spendByPlatform` і `spendByModel` з authoritative session-level полів компактного масиву `sessions` та `session.byModel`; schema-only конвертація першого v1→v2 write і `metrics <name> --migrate` є винятком і MUST точно зберігати наявні числові session-level і top-level поля без recompute або numeric backfill. `totals.durationMs` — сума `session.durationMs` (null-honest). `totals.leadTimeMs` — різниця між найранішим `startedAt` і найпізнішим `endedAt` **по всіх сесіях**, або `null`. `totals.cloudSessions` — кількість сесій з `runtime: cloud`. `phases.<phase>.startedAt` / `endedAt` / `leadTimeMs` — лише сесії цієї фази (див. «Межі фази — з сесій цієї фази, не клон totals»). `phases.<phase>.durationMs` — сума `session.durationMs` фази, не `totals.leadTimeMs` і не phase lead. `phases.<phase>.agents` — унікальні канонічні ролі; `phases.<phase>.models` — унікальні непорожні product id з `session.model` і `session.models` після резолву «Модель сесії». `spend`, `spendByPlatform` і `phases` SHALL брати session-level токени, billed spend, estimate, platform і phase; ці session-level spend-поля є authoritative після flag/self-report або fresh usage resync. `spend.costUsd` SHALL підсумовувати лише billed / self-report / Amp usage USD (не Amp credits і не оцінки). `spend.costUsdEstimated` SHALL підсумовувати оцінки без подвійного рахунку. Обидва поля MUST лишатись окремими, округленими r4 сумами; Amp credits MUST NOT входити в жодне USD-поле.

Коли `session.byModel.length > 0`, token-поля, `costUsd`, `costUsdEstimated` і provenance `spendByModel` SHALL наповнюватись **лише з `byModel`**; `session.model` MUST NOT додаватись другим внеском. `spend`, `spendByPlatform` і `phases` SHALL додавати відповідні session-level поля один раз на сесію через null-honest накопичення, навіть якщо агрегат уже містить попередню сесію. Thread-level Amp `Cost` MUST лишатись тільки в `session.costUsd`: його MUST NOT копіювати в модельні рядки або множити на кількість моделей / source ids. `byModel[].costUsd` MAY містити лише billed model cost, який сама fresh usage Models table віддала для цієї моделі, з optional `costSource: "amp-usage"`. Коли `byModel` порожній, `spendByModel` SHALL використати session-level поля один раз під `session.model`; це єдиний session fallback. Бакет без внеску MUST лишатись null-honest із `source: "none"`. `spendByPlatform.*.ampCredits` SHALL лишатись окремим полем і MUST NOT входити в жодну суму USD.

Кожне записане поле `costUsdEstimated`, яке є сумою (`spend`, `spendByPlatform.*`, `spendByModel[]`, `phases.*`, session-level після суми `byModel`), SHALL зберігатись як `Math.round(x * 10000) / 10000`. `null` лишається `null`.

#### Scenario: Дві сесії однієї фази агрегуються

- **GIVEN** уже є сесія `phase: spec`, `model: claude-fable-5`, `role: Architect`
- **WHEN** persist додає другу сесію `phase: spec`, `model: claude-opus-5`, `role: Architect`
- **THEN** `phases.spec.sessions` дорівнює `2`
- **AND** `phases.spec.agents` дорівнює `["Architect"]`
- **AND** `phases.spec.models` містить обидва id моделей

#### Scenario: spendByPlatform з самозвіту без модельних рядків

- **GIVEN** сесія з `platform: cursor`, `totalTokens: 1200`, `costUsd: 0.30` і `byModel: []`
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

#### Scenario: byModel непорожній — модельна карта без family duplication

- **GIVEN** сесія з `--model` / `session.model: cursor-grok-4.6`, authoritative `session.totalTokens: 1102062` і `byModel` з `cursor-grok-4.6-low` на 49412 та іншою моделлю на 1052650
- **WHEN** агрегати перераховуються
- **THEN** `spendByModel` містить `cursor-grok-4.6-low` і не містить рядка `cursor-grok-4.6`
- **AND** phase spend цієї фази дорівнює authoritative session total `1102062`

#### Scenario: Session totals і byModel не подвоюються

- **GIVEN** сесія з `totalTokens: 1000`, `platform: claude` і `byModel`, сума якого теж `1000`
- **WHEN** агрегати перераховуються
- **THEN** `spendByPlatform.claude.totalTokens` дорівнює `1000`

#### Scenario: Amp Cost один раз у rollup незалежно від model rows

- **GIVEN** сесія `phase: apply`, `platform: amp`, `session.costUsd: 12.69`
- **AND** `sourceIds` має щонайменше три id, а `byModel` не містить скопійованого thread-level Cost
- **WHEN** агрегати перераховуються (persist або leftover rewrite)
- **THEN** `spend.costUsd` дорівнює `12.69`
- **AND** `spendByPlatform.amp.costUsd` дорівнює `12.69`
- **AND** `phases.apply.costUsd` дорівнює `12.69`
- **AND** жодне з цих полів не дорівнює `38.07`

#### Scenario: Три Amp-сесії з Cost складаються у rollup

- **GIVEN** три сесії `platform: amp` з `session.costUsd` `4.42`, `8.81` і `12.69`
- **AND** у кожної `sourceIds` непорожні і thread-level Cost не скопійовано в `byModel`
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

- **GIVEN** три session/byModel внески `costUsdEstimated` `2.3911`, `2.8153` і `1.355`
- **WHEN** агрегати перераховуються
- **THEN** `spend.costUsdEstimated` дорівнює `6.5614`
- **AND** значення не містить хвоста `00000001`

#### Scenario: Фази не клонують totals.leadTimeMs

- **GIVEN** сесії `phase: spec` і `phase: review` з різними `startedAt` / `endedAt` / `durationMs` і розривом між ними
- **WHEN** агрегати перераховуються
- **THEN** `phases.spec.startedAt` і `phases.review.startedAt` різні
- **AND** `phases.spec.durationMs` не дорівнює `totals.leadTimeMs`
- **AND** `totals.leadTimeMs` є earliest→latest по всіх сесіях

#### Scenario: Карти з byModel, Cost один раз

- **GIVEN** сесія amp з `byModel` `[gpt-6-astra 866k / 3.10, GPT-5.6 Sol 466k / 0.87]`, `session.costUsd 3.96`, `inputTokens 1320187`
- **WHEN** агрегати перераховуються
- **THEN** `spendByModel` має два рядки з цими токенами і `costUsd` 3.10 / 0.87
- **AND** `spend.costUsd` і `spendByPlatform.amp.costUsd` дорівнюють `3.96`
- **AND** `spendByPlatform.amp.inputTokens` дорівнює `1320187`

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
- **AND** `sourceIds` цієї сесії є `[]`
- **AND** `sourceTotals` цієї сесії є `{}`
- **AND** `byModel` цієї сесії є `[]`
- **AND** у цій сесії немає ключа `sources`
- **AND** exit code 0

### Requirement: Archive завжди фіналізує metrics.json після успішного move

На **старті** `archive <name>`, якщо `pending` є `null`, команда SHALL записати `pending.startedAt = now` (старт сесії Archiver) у ще активний `metrics.json` і SHALL виконати leftover-backfill останньої не-Archiver сесії з `leftoverEnd = pending.startedAt`. Після успішного переміщення change команда MUST створити `metrics.json` у архівній папці, якщо файлу не було, виставити `archivedAt`, очистити `pending`, перерахувати агрегати і додати сесію `role: Archiver`, `phase: archive`, `startedAt` = записаний pending start, `endedAt` = зараз, `durationMs` = дельта (MUST NOT бути `null`, коли pending start існував). Клієнт Archiver SHALL резолвитись так само, як persist: `--platform` / `AOK_PLATFORM` → `## Metrics` (після відкидання stale-копії попередньої сесії) → `resolveRestoreClient` / host env. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, archive SHALL зібрати spend лише цього клієнта навіть без `--collect`, з вікном Archiver `[pending.startedAt − 120s, now]` (pre-restore grace, dedup за id) — MUST NOT з `[last.endedAt, now]`. `--collect` SHALL запускати всі три адаптери. Значення `model` — за «Модель сесії»; токени — за «Джерело spend». Якщо `## Metrics` повторює `inputTokens`/`outputTokens`/`model`/`platform` останньої не-Archiver сесії, ці поля MUST ігноруватись. Невалідний `--platform` MUST відхилятись до move. Якщо після finalize `spend.costUsd` є `null` — warning у stderr через `console.error`. Exit code MUST NOT змінюватись через відсутній файл, порожній spend, відсутній самозвіт або `null` модель.

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
- **AND** collect Archiver не повернув transient records з model
- **WHEN** виконується `archive <name>` без прапорців моделі й платформи
- **THEN** сесія `Archiver` має `platform: amp`, `model: claude-fable-5`, `inputTokens: 4000`
- **AND** `spendSource` цієї сесії є `self-report`

#### Scenario: Hook між last.endedAt і archive pending йде в leftover попередньої сесії

- **GIVEN** остання не-Archiver сесія має `endedAt` раніше за рядок у `.agents/spend/cursor-usage.jsonl`
- **AND** `at` цього рядка раніше за `pending.startedAt` archive
- **AND** host env має `CURSOR_AGENT=1`
- **WHEN** виконується `archive <name>` без `--collect`
- **THEN** id цього hook-рядка є в `sourceIds` останньої не-Archiver сесії, а його числа враховані в session fields / `byModel`
- **AND** `sourceIds` Archiver цей id не містить

#### Scenario: Hook після archive pending потрапляє в Archiver

- **GIVEN** host env має `CURSOR_AGENT=1`
- **AND** hook-рядок має той самий `conversationId`, що й `pending.threadId`, та `at` у `[archive pending.startedAt − 120s, finalize now]`
- **WHEN** виконується `archive <name>` без `--collect`
- **THEN** сесія `Archiver` має `platform: cursor`
- **AND** `sourceIds` містить id цього hook-рядка, а `session.totalTokens` / `byModel` містять його числовий внесок
- **AND** `phases.archive.totalTokens` не є `null`

#### Scenario: Leftover sessionEnd після move пише в архівний metrics.json

- **GIVEN** `archive <name>` уже перемістив change і записав Archiver
- **AND** hook-рядок з тим самим `conversationId`, що й `Archiver.threadId`, з’явився +5s після `Archiver.endedAt` і входить у 120s leftover-вікно останньої сесії архівного файла
- **WHEN** виконується `scripts/cursor-spend-collect.cjs` (`sessionEnd`)
- **THEN** id цього рядка є в `sourceIds` останньої сесії `openspec/changes/archive/*-<name>/metrics.json`, а його числа враховані в session fields / `byModel`
- **AND** активної `openspec/changes/<name>/` уже немає

#### Scenario: Stale ## Metrics з apply не подвоюється на Archiver

- **GIVEN** остання сесія `Implementer` має `inputTokens: 1000`, `platform: cursor`, `model: cursor-grok-4.6`
- **AND** архівований `handoff.md` `## Metrics` повторює ці самі числа
- **AND** у вікні Archiver `[pending.startedAt − 120s, now]` є новий hook-рядок на 50 токенів
- **WHEN** виконується `archive <name>` з `CURSOR_AGENT=1` без `--collect`
- **THEN** `Archiver.inputTokens` не дорівнює `1000`
- **AND** `sourceIds` Archiver містить id нового hook-рядка і session totals враховують його 50 токенів

#### Scenario: Порожній spend на archive — warning і exit 0

- **GIVEN** фіналізований `spend.costUsd` є `null`
- **WHEN** archive успішно фіналізує metrics
- **THEN** stderr містить попередження
- **AND** exit code 0

#### Scenario: Хід Archiver перед командою входить у сесію Archiver

- **GIVEN** `CLAUDECODE=1`, jsonl має assistant-рядок на `pending.startedAt − 50s` з id, якого немає в попередніх сесіях
- **WHEN** виконується `archive <name>` без `--collect`
- **THEN** `sessions[last].sourceIds` містить цей id
- **AND** `sessions[last].spendSource` дорівнює `adapter`

### Requirement: Amp CLI віддає mode і billed USD

Коли locked client є `amp` (або `--collect`), адаптер `amp-cli` SHALL після `amp threads export <id>` викликати `amp threads usage <id> --details` (бінар `AOK_AMP_BIN` або `amp`, fail-open, без сирого HTTP). З export SHALL братися `usage.model` (модель чату), id повідомлень для `sourceIds` і `agentMode`; коли usage віддав `Input tokens` / `Output tokens`, authoritative session totals SHALL дорівнювати їм (включно з helper-моделями), а `byModel` — fresh Models table. Коли usage total lines відсутні, totals SHALL бути сумою compact accumulated внесків наявного `byModel` і нових transient export records. З usage SHALL братися `Cost: $N` у `session.costUsd` і Models у `session.usageModels` / `byModel`. Після persist і recompute внесок цієї сесії до `spend.costUsd` і `spendByPlatform.amp.costUsd` MUST дорівнювати Cost рівно один раз; whole-change поля MAY також містити попередні сесії. `Cost` є єдиним Amp billed USD і MUST NOT копіюватись у `byModel` або transient message records. `byModel[].costSource: "amp-usage"` MAY позначати лише фактичний model-level cost із Models table. Без `Cost:` billed `session.costUsd` нової сесії SHALL бути `null`, але окремий fallback `costUsdEstimated` SHALL бути дозволений за версійованою таблицею нижче й округлений r4. `ampCredits` MUST лишатись окремим і не конвертуватись у USD. `agentMode` SHALL писатись у `session.agentMode`, не в transient record і не в `session.model`. `amp-default` є відсутньою моделлю, тож primary product id із transient export records перемагає. `usageModels` SHALL відповідати «usageModels лише цього thread без дублікатів».

#### Scenario: Amp usage inject заповнює costUsd і agentMode

- **GIVEN** `exportAmpThread` повертає thread з `agentMode: "low"` і usage GLM
- **AND** `usageAmpThread` повертає `{ costUsd: 1.3 }`
- **WHEN** виконується collect Amp CLI
- **THEN** persisted `session.agentMode` є `"low"`
- **AND** `ampThreads[0].costUsd` є `1.3`

#### Scenario: Persist+recompute пише Cost у spend maps

- **GIVEN** Amp collect повернув transient export records і `ampThreads[0].costUsd: 1.3`
- **WHEN** persist записує сесію і перераховує агрегати
- **THEN** `sessions[0].costUsd` дорівнює `1.3`
- **AND** `spend.costUsd` дорівнює `1.3`
- **AND** `spendByPlatform.amp.costUsd` дорівнює `1.3`
- **AND** thread Cost не скопійовано в жоден `byModel[].costUsd`

#### Scenario: Amp usage без рядка Cost лишає costUsd null

- **GIVEN** текст `amp threads usage --details` містить токени і не містить рядка `Cost: $N`
- **WHEN** викликається `parseAmpUsageDetails`
- **THEN** `costUsd` є `null`
- **AND** токени збережені, якщо вони були в тексті
- **AND** billed `costUsd` не обчислюється з токенів або `ampCredits`, але окремий fallback `costUsdEstimated` дозволений

#### Scenario: Amp session totals з usage, sourceIds з export

- **GIVEN** usage: `Input tokens: 1,320,187`, `Output tokens: 17,353`, `Cost: $3.96`, Models Astra 856,680 / Sol 458,614 / Luna 4,893
- **AND** export має 13 повідомлень з usage `gpt-6-astra` на 355976 input
- **WHEN** виконується persist
- **THEN** `session.inputTokens` дорівнює `1320187`
- **AND** `session.costUsd` дорівнює `3.96`
- **AND** `session.sourceIds.length` дорівнює `13`
- **AND** `session.byModel.length` дорівнює `3`

### Requirement: Leftover після amp-usage перераховує токени і лишає billed Cost

When fresh leftover usage supplies `Input tokens` / `Output tokens`, session totals SHALL use those fresh usage totals and `byModel` SHALL be replaced from the fresh Models table. Only when usage returns no total lines SHALL totals fall back to available existing compact `byModel` contributions plus new transient export deltas; the fallback MUST NOT claim reconstructable per-event input/output from `sourceTotals`, which stores only totals. Export-message sums MUST NOT overwrite available usage truth.

`sessionSpendIsFrozen` SHALL повертати true лише коли `spendSource === "flag"` або коли `spendSource === "self-report"` і є хоч одне числове spend-поле (`inputTokens` / `outputTokens` / `totalTokens` / `costUsd` / `ampCredits`). `amp-usage`, `adapter`, `unreported` і placeholder self-report (усі числа `unknown` / null) MUST NOT заморожувати leftover resync токенів.

Після leftover сесії з `spendSource: amp-usage`, fresh usage Input/Output SHALL set session totals and fresh Models SHALL replace `byModel`; only without usage total lines SHALL totals use available existing `byModel` plus new transient deltas. `session.costUsd` SHALL стати свіжим `Cost: $N`, коли usage його віддав; prior billed Cost SHALL зберігатись, коли fresh usage недоступний або не має Cost. Leftover MUST NOT затирати billed `null`-ом. `spendSource` SHALL лишатись `amp-usage`, якщо `costUsd` прийшов з Amp usage/Cost.

#### Scenario: amp-usage leftover resync токенів без drop Cost

- **GIVEN** сесія має `spendSource: amp-usage`, `inputTokens: 495184`, `costUsd: 12.69` і compact `byModel` на 495184 токенів
- **AND** fresh usage повертає no total lines, а transient leftover deltas доводять доступну суму `inputTokens` до `1176546`
- **WHEN** leftover завершується
- **THEN** `session.inputTokens` дорівнює `1176546`
- **AND** `session.costUsd` дорівнює `12.69`
- **AND** `session.spendSource` дорівнює `amp-usage`

#### Scenario: Leftover оновлює Cost свіжим значенням usage

- **GIVEN** сесія має `costUsd: 1.91`, `spendSource: amp-usage`
- **AND** leftover usage віддає `Cost: $2.51`
- **WHEN** leftover завершується
- **THEN** `session.costUsd` дорівнює `2.51`
- **AND** `spend.costUsd` перераховано з `2.51`

#### Scenario: Leftover keeps fresh usage totals and Models

- **GIVEN** fresh usage reports `1320187` input tokens and a Models table while export messages sum to `355976`
- **WHEN** leftover resync completes
- **THEN** `session.inputTokens` equals `1320187`, not `355976`
- **AND** `session.byModel` reflects the fresh Models table

### Requirement: Cursor collect фільтрує за conversationId

Адаптер cursor SHALL читати `conversationId` з рядка hook. Коли filter id присутній — непорожній `CURSOR_CONVERSATION_ID` у env collect **або** `pending.threadId` / опція collect для Cursor **або** `last.threadId` останньої сесії на leftover (`sessionEnd` / hook post-append / persist leftover) — рядок MUST входити лише якщо `row.conversationId` точно збігається з filter id. Рядок з іншим або порожнім `conversationId` MUST пропускатись. Коли filter id відсутній (`last.threadId` / pending / env є `null` або порожні), адаптер і leftover MUST NOT відкидати рядки лише через відсутній `conversationId` (time-only collect як раніше).

`handoff --restore` на клієнті cursor SHALL записати непорожній `CURSOR_CONVERSATION_ID` у `pending.threadId`. Persist SHALL передати цей id (або поточний env) у collect Cursor. Persist leftover SHALL і далі передавати `cursorConversationId: last.threadId` для cursor і MUST NOT втратити цей фільтр; persist без pending SHALL записати env id у `session.threadId`, щоб leftover мав фільтр.

Same-cwd observer-чат і hotfix-чат з іншим `conversationId` MUST NOT потрапляти в persisted `sourceIds` сесії, що має filter id — включно з leftover після archive.

`scripts/cursor-spend-collect.cjs` `incomingCursorSources` SHALL застосовувати той самий filter, коли `last.threadId` непорожній.

#### Scenario: Чужий conversationId пропускається

- **GIVEN** `pending.threadId` або `CURSOR_CONVERSATION_ID` дорівнює `Y`
- **AND** hook-рядок має `conversationId: X`, `id: g-foreign`, timestamp у вікні persist
- **WHEN** виконується collect cursor
- **THEN** у transient collector result немає record `g-foreign`, а після persist його немає в `sourceIds`

#### Scenario: Збіг conversationId входить

- **GIVEN** `CURSOR_CONVERSATION_ID` дорівнює `Y`
- **AND** hook-рядок має `conversationId: Y`, `id: g-mine`, timestamp у вікні
- **WHEN** виконується collect cursor
- **THEN** transient collector result містить record `g-mine`, а після persist `sourceIds` містить `g-mine`

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
- **THEN** `hotfix-b` відсутній у `Archiver.sourceIds`
- **AND** `archiver-a` є в `Archiver.sourceIds`, а його числовий внесок є в session totals / `byModel`

#### Scenario: leftover з threadId null лишає time-only

- **GIVEN** остання сесія має `threadId: null`
- **AND** у leftover-вікні є рядок з `conversationId: X`
- **WHEN** виконується leftover-collect
- **THEN** рядок входить за правилами вікна й dedup (не відкидається лише через conversationId)

### Requirement: Cursor estimate не змішується з billed USD

Адаптер cursor SHALL оцінювати USD для кожної моделі з токенами, коли є хоча б одне з `inputTokens`, `outputTokens`, `totalTokens`, і SHALL переносити округлений r4 результат transient record до compact `session.byModel[].costUsdEstimated` та authoritative `session.costUsdEstimated`, ніколи в billed `costUsd`. Persisted per-message records MUST NOT існувати. Оцінка MUST NOT видаватись за Cursor invoice. Ставки SHALL жити у версійованому модулі `bin/cursor-cost-estimate.js` без HTTP і без Cursor SDK.

1. Моделі `grok-4.6` / `grok-4.5` (включно з префіксом `cursor-`, записом `grok-4-6` / `grok-4-5` і суфіксом `-fast`) SHALL використовувати чинну xAI API-таблицю, з подвоєнням для `-fast` і long-context cliff при `inputTokens >= 200000`. Відсутній cache-split MUST рахувати весь input як fresh (оцінка зверху). `costSource: "api-estimate"`.
2. Будь-яка інша Cursor-модель (включно з порожнім або невідомим id) з `inputTokens` і/або `outputTokens` SHALL використовувати fallback **$3 / 1M input + $15 / 1M output**, без cache-split, без long-context cliff і без множника `-fast`; відсутня сторона рахується як `0`. `costSource: "api-estimate-fallback"`.
3. Якщо `inputTokens` і `outputTokens` обидва `null`, але є `totalTokens`, SHALL використовуватись fallback **$3.50 / 1M** total з `costSource: "api-estimate-fallback"`.
4. Якщо немає жодного з `inputTokens`, `outputTokens`, `totalTokens` — `costUsdEstimated` SHALL бути `null` і `costSource` MUST NOT ставитись.

`spend.costUsd` MUST містити лише billed / self-report / Amp usage. Human summary SHALL друкувати `$X billed + ~$Y est.` через `formatMetricsCostLine`. Claude-адаптер SHALL рахувати `costUsdEstimated` для transient message records через версійований модуль `bin/claude-cost-estimate.js`, а persist SHALL зберігати лише їхні compact `byModel` і session-level r4 суми (Anthropic list-price за family model id: input / cache read / cache write / output за MTok; реальний cache-split з `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; невідома модель → fallback $3 / $15 без cache-split, `costSource: api-estimate-fallback`). Amp-сесія без рядка `Cost: $N` SHALL отримувати `costUsdEstimated` тією самою функцією за нормалізованим ім'ям моделі або fallback; за наявності Cost estimate для Amp MUST лишатись `null`. Кожна модель з токенами і без billed model cost SHALL отримати estimate за погодженою таблицею. Estimate MUST NOT потрапляти в `costUsd`. Live HTTP, Cursor SDK або інші runtime pricing dependencies MUST NOT використовуватись.

#### Scenario: Cursor hook з grok-4.6-fast пише estimate, не costUsd

- **GIVEN** `cursor-usage.jsonl` з `model: cursor-grok-4.6-high-fast`, `inputTokens: 400`, `outputTokens: 40`
- **WHEN** виконується collect cursor
- **THEN** `session.costUsd` і `session.byModel[0].costUsd` є `null`
- **AND** `session.byModel[0].costUsdEstimated` є числом, округленим r4, і session estimate є його null-honest сумою
- **AND** `session.byModel[0].costSource` є `"api-estimate"`

#### Scenario: Cursor hook з не-grok моделлю пише fallback estimate

- **GIVEN** `cursor-usage.jsonl` з `model: gpt-5.6`, `inputTokens: 1000000`, `outputTokens: 1000000`
- **WHEN** виконується collect cursor
- **THEN** `session.costUsd` і `session.byModel[0].costUsd` є `null`
- **AND** `session.byModel[0].costUsdEstimated` і `session.costUsdEstimated` дорівнюють `18`
- **AND** `session.byModel[0].costSource` є `"api-estimate-fallback"`

#### Scenario: Cursor fallback з лише totalTokens

- **GIVEN** не-grok модель з `totalTokens: 1000000` і без `inputTokens` / `outputTokens`
- **WHEN** рахується оцінка в `bin/cursor-cost-estimate.js`
- **THEN** `costUsdEstimated` дорівнює `3.5`
- **AND** compact model row має `costSource: "api-estimate-fallback"`

#### Scenario: Cursor без токенів не пише estimate

- **GIVEN** модель `gpt-5.6` без `inputTokens`, `outputTokens` і `totalTokens`
- **WHEN** рахується оцінка
- **THEN** `costUsdEstimated` є `null` і compact model row не має `costSource`

#### Scenario: Відсутня сторона токенів рахується як нуль

- **GIVEN** не-grok модель з `inputTokens: 1000000` і `outputTokens: null`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `3`
- **AND** compact model row має `costSource: "api-estimate-fallback"`

#### Scenario: Cursor fallback не подвоює суфікс -fast

- **GIVEN** модель `gpt-5.6-fast` з `inputTokens: 1000000` і `outputTokens: 1000000`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `18`
- **AND** compact model row має `costSource: "api-estimate-fallback"`

#### Scenario: Порожня Cursor-модель з токенами все одно оцінюється

- **GIVEN** порожній model id і `inputTokens: 1000000`
- **WHEN** рахується fallback
- **THEN** `costUsdEstimated` дорівнює `3`
- **AND** compact model row має `costSource: "api-estimate-fallback"`

#### Scenario: Claude estimate з cache-split

- **GIVEN** Claude-сесія `claude-opus-5` з `input_tokens 100000`, `cache_read_input_tokens 900000`, `cache_creation_input_tokens 0`, `output_tokens 10000`
- **WHEN** виконується persist
- **THEN** `session.costUsdEstimated` дорівнює `1.2`
- **AND** `session.costUsd` є `null`
- **AND** `spendByPlatform.claude.costUsdEstimated` дорівнює `1.2`

#### Scenario: Amp без Cost отримує fallback estimate

- **GIVEN** Amp usage без рядка `Cost:` і модель `gpt-6-astra` з `inputTokens 1000000`, `outputTokens 10000`
- **WHEN** виконується persist
- **THEN** `session.costUsdEstimated` дорівнює `3.15`
- **AND** `session.costUsd` є `null`
- **AND** `session.byModel[0].costSource` є `api-estimate-fallback` і жодні persisted per-message records не створені

#### Scenario: Amp з Cost не отримує estimate

- **GIVEN** Amp usage з `Cost: $3.96`
- **WHEN** виконується persist
- **THEN** `session.costUsd` дорівнює `3.96`
- **AND** `session.costUsdEstimated` є `null`

### Requirement: Опційна платформа сесії — flag/env/host/sources/null

`session.platform` SHALL бути `cursor`, `claude`, `amp` або `null`. Резолв: `--platform` → `platform` з `## Metrics` → env `AOK_PLATFORM` → host env (Amp: `AMP_CURRENT_THREAD` / `AMP_THREAD_ID`; Cursor: `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID`; Claude Code: `CLAUDECODE` / `CLAUDE_CODE` / `CLAUDE_CODE_ENTRYPOINT`) → primary platform з transient adapter sources при `--collect` → `null`. Transient adapter sources MAY існувати в пам'яті під час collect, але MUST NOT записуватись як `session.sources`; persisted v2-сесія SHALL зберігати їхні ідентифікатори в `sourceIds`, compact totals у `sourceTotals`, а модельні суми в `byModel`. Невалідний `--platform` (не з трьох значень) MUST завершувати persist/archive з non-zero. Невалідний непорожній `platform` у `## Metrics` або в `AOK_PLATFORM` SHALL давати `null` і warning, не fail (без fallback на host). `--platform` MUST перемагати самозвіт, самозвіт MUST перемагати host env.

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

### Requirement: Джерело spend — прапорці, потім самозвіт, потім опційні адаптери

Session-level spend SHALL резолвитись пополе, перше не-null значення виграє: явний прапорець (`--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`) → відповідний **числовий** ключ `## Metrics` (для archive — після drop stale-копії попередньої сесії) → transient adapter sources (locked client або `--collect`) → `null`. Значення-плейсхолдери `unknown`, `none`, `n/a`, `-`, `—`, `null` і порожній рядок MUST трактуватись як відсутнє число і MUST NOT вважатись самозвітом-override. Дефолтний persist і archive MUST NOT читати адаптери інших платформ, ніж резолвлений клієнт, якщо немає `--collect`.

`session.ampCredits` SHALL зберігатись окремим полем сесії з ключа `amp_credits` і MUST NOT входити в `costUsd` чи в будь-яку суму USD. Відсутнє число MUST лишатись `null`, ніколи штучним `0`. CLI MUST NOT писати оцінений з токенів USD у `costUsd`. CLI MUST NOT конвертувати Amp credits у USD. Cursor-оцінка з токенів SHALL писатись лише в `costUsdEstimated`. Ключ самозвіту `cost_usd` і прапорець `--cost-usd` SHALL потрапляти в `costUsd` як billed/self-report і MUST NOT копіюватись у `costUsdEstimated`. Агент MUST NOT підставляти Cursor-оцінку як billed `cost_usd`.

Коли transient adapter sources зібрані, persisted v2-сесія SHALL зберігати лише їхні `sourceIds`, `sourceTotals` і агреговані `byModel`, без ключа `sources`; session-level totals SHALL бути авторитетними для `spend`, `spendByPlatform` і фаз, а `byModel` SHALL наповнювати `spendByModel`. Опційний `byModel[].costSource` MAY фіксувати джерело billed або estimated cost. Адаптерні compact-дані MUST NOT перекривати totals, що прийшли з прапорців або **числового** самозвіту. Placeholder `## Metrics` (усі числа `unknown`) плюс `spend_source: self-report` MUST NOT блокувати leftover resync: leftover MAY виставити session totals з compact adapter totals і `spendSource: adapter`.

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
- **THEN** `sessions[0].sourceIds` є `[]`
- **AND** `sessions[0].sourceTotals` є `{}`
- **AND** `sessions[0].byModel` є `[]`
- **AND** у `sessions[0]` немає ключа `sources`
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
- **AND** адаптерна фікстура дає transient source з `inputTokens: 5`, `outputTokens: 5`
- **WHEN** виконується persist з `--collect`
- **THEN** `sessions[0].inputTokens` дорівнює `1000`
- **AND** `sessions[0].sourceIds` містить id зібраного запису
- **AND** `sessions[0].byModel` містить токени зібраного запису
- **AND** у `sessions[0]` немає ключа `sources`

#### Scenario: Placeholder self-report не блокує leftover resync

- **GIVEN** `## Metrics` з усіма числовими полями `unknown` і `spend_source: self-report`
- **AND** leftover додає два transient sources з `inputTokens` 100 і 50
- **WHEN** leftover завершується
- **THEN** `session.inputTokens` дорівнює `150`
- **AND** `session.spendSource` дорівнює `adapter`

#### Scenario: Самозвіт cost_usd не стає estimate

- **GIVEN** `## Metrics` містить `cost_usd: 0.42` і немає Cursor hook-записів
- **WHEN** виконується persist
- **THEN** `sessions[0].costUsd` дорівнює `0.42`
- **AND** `sessions[0].costUsdEstimated` є `null`

### Requirement: Поле session.spendSource фіксує походження чисел

Кожен запис сесії SHALL містити `spendSource` — непорожній рядок походження spend-чисел. CLI SHALL резолвити його так: непорожній ключ `spend_source` з `## Metrics`, **лише якщо є хоч одне числове spend-поле** → `flag`, якщо хоч одне число прийшло з прапорця і секція не задала `spend_source` → `self-report`, якщо числа прийшли з секції → `adapter`, якщо числа прийшли лише з transient adapter sources / leftover і були збережені у session totals та compact `sourceIds` / `sourceTotals` / `byModel` → `unreported`, якщо жодного числа немає. Значення `unreported` SHALL використовуватись і тоді, коли секція є, але всі числові поля порожні або `unknown`. Ключ `spend_source: self-report` при всіх `unknown`/null числах MUST трактуватись як відсутній override (плейсхолдер), не як freeze leftover.

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
- **AND** leftover додає два transient sources
- **WHEN** leftover перераховує totals
- **THEN** session totals дорівнюють compact сумі з `sourceTotals` / `byModel`
- **AND** `spendSource` дорівнює `adapter`
- **AND** у session немає ключа `sources`

### Requirement: Прапорець `--collect` вмикає локальні адаптери

`handoff <name>` і `archive` SHALL приймати опційний `--collect`, який вмикає повний прохід `collectSpend` (три адаптери, вікно, dedup) додатково до locked-клієнта. Без `--collect` і без резолвленого клієнта `amp`/`cursor`/`claude` адаптери MUST NOT запускатись; persisted v2-сесія MUST мати `sourceIds: []`, `sourceTotals: {}`, `byModel: []` і MUST NOT мати ключа `sources`. Коли клієнт резолвлений, archive і persist SHALL читати адаптер цього клієнта навіть без `--collect`. Адаптери MAY оперувати transient source records у пам'яті, але запис SHALL містити лише compact v2-поля, а session totals SHALL бути авторитетними.

`--collect` на `archive` SHALL спочатку виконати leftover попередньої сесії з `leftoverEnd = pending.startedAt`, а потім зібрати всі три адаптери у вікні Archiver `[pending.startedAt − 120s, now]` з dedup за id проти `sourceIds` усіх сесій. MUST NOT ставити вікно Archiver `[last session.endedAt, now]`; подія до `pending.startedAt − 120s` MUST NOT входити в сесію Archiver. Подія в `[last.endedAt, pending.startedAt)`, яку вже додав leftover останньої не-Archiver сесії, MUST NOT входити в `sourceIds` Archiver через dedup.

Прапорець `--no-collect` SHALL бути видалений. **BREAKING**: скрипти, що передавали `--no-collect`, MUST перейти на дефолтну поведінку без прапорця.

`--no-metrics` MUST як і раніше не створювати сесію і не запускати collect.

#### Scenario: --collect наповнює sources

- **GIVEN** tmp фікстура Claude JSONL з подією у вікні
- **WHEN** виконується persist з `--collect`
- **THEN** `sessions[0].sourceIds` непорожній
- **AND** `sessions[0].sourceTotals` містить total для цієї події
- **AND** `sessions[0].byModel` непорожній
- **AND** у `sessions[0]` немає ключа `sources`
- **AND** `spendByPlatform.claude.source` дорівнює `claude-jsonl`

#### Scenario: Дефолт лишає sources порожніми

- **GIVEN** та сама фікстура і клієнт сесії не резолвлений
- **WHEN** виконується persist без `--collect`
- **THEN** `sessions[0].sourceIds` є `[]`
- **AND** `sessions[0].sourceTotals` є `{}`
- **AND** `sessions[0].byModel` є `[]`
- **AND** у `sessions[0]` немає ключа `sources`
- **AND** exit code 0

#### Scenario: Дефолтний archive без клієнта не читає чужі адаптери

- **GIVEN** tmp-фікстура Claude JSONL з валідною подією у вікні Archiver
- **AND** клієнт сесії не резолвлений
- **WHEN** виконується `archive <name>` з валідним sync-рішенням і без `--collect`
- **THEN** архівний `metrics.json` містить сесію `Archiver` із `sourceIds: []`, `sourceTotals: {}` і `byModel: []`
- **AND** ця сесія не має ключа `sources`
- **AND** exit code 0

#### Scenario: Archive --collect: подія між last.endedAt і pending іде в leftover

- **GIVEN** остання не-Archiver сесія має `endedAt` раніше за usage-подію в tmp-фікстурі Claude JSONL
- **AND** подія входить у `[last.endedAt, archive pending.startedAt)` і cwd збігається
- **WHEN** виконується `archive <name> --collect` з валідним sync-рішенням
- **THEN** id цієї події відсутній у `sourceIds` Archiver
- **AND** leftover додає його до `sourceIds` останньої не-Archiver сесії
- **AND** exit code 0

#### Scenario: Archive --collect збирає вікно Archiver

- **GIVEN** archive записав `pending.startedAt`
- **AND** usage-подія в tmp-фікстурі Claude JSONL входить у `[pending.startedAt − 120s, now]`, відсутня в `sourceIds` усіх сесій і cwd збігається
- **WHEN** виконується `archive <name> --collect` з валідним sync-рішенням
- **THEN** сесія `Archiver` містить id цієї події в `sourceIds`, її totals у session fields / `sourceTotals` і модельний внесок у `byModel`
- **AND** usage-подія до `pending.startedAt − 120s` не входить у `sourceIds` Archiver
- **AND** у сесії `Archiver` немає ключа `sources`
- **AND** exit code 0

#### Scenario: --no-collect більше не існує

- **WHEN** виконується persist з `--no-collect`
- **THEN** CLI повідомляє про невідомий прапорець
- **AND** документація і шаблони протоколу не згадують `--no-collect`

### Requirement: Cursor spend hook — опційне доповнення, ensure лише в setup-командах

Kit SHALL і надалі постачати `templates/scripts/cursor-spend-hook.cjs` і `templates/scripts/cursor-spend-collect.cjs` з такою поведінкою: hook читає stdin payload подій `stop` / `subagentStop` / `afterAgentResponse` і дописує transient запис у `<project>/.agents/spend/cursor-usage.jsonl`, лише якщо payload містить хоча б одне з `input_tokens` / `output_tokens` (включно з `conversationId`); корінь `<project>` резолвиться за «Спільний multi-root resolveBaseDir». Після успішного append подій `stop` і `afterAgentResponse` hook SHALL викликати leftover-backfill collect-скрипта проти всіх кандидатних коренів (fail-open, без stdout). Collect-скрипт на `sessionEnd` мержить нові рядки в **останню** сесію цільового `metrics.json` без додавання нової сесії і MUST фільтрувати за `last.threadId`, коли він непорожній. Цільові файли **на кожному** кандидатному корені з `openspec/changes`: кожна активна `openspec/changes/<name>/metrics.json` **і** найсвіжіший `openspec/changes/archive/*-<name>/metrics.json` для імен, яких більше немає в active. MUST NOT скіпати каталог `archive/` наосліп. Після attach leftover MUST resync authoritative session totals за «Вікно collect» / «Джерело spend» (`looksOverridden` / `syncAdapterSessionTotals` MUST NOT трактувати placeholder `self-report` як override), а persisted v2-сесія SHALL містити лише `sourceIds`, `sourceTotals` і `byModel`, без `sources`. `scripts/cursor-spend-collect.cjs` і `templates/scripts/cursor-spend-collect.cjs` MUST лишатись поведінково синхронними; те саме для пари hook. Обидва скрипти MUST бути fail-open: будь-яка помилка завершується exit 0 без stdout.

`ensureCursorSpendHook(projectDir)` SHALL викликатись лише в `init`, `update`, `sync` і `mcp-setup`. Виклики з `handoff --restore`, `handoff <name>` persist і `metrics` MUST бути видалені — жодна сесійна команда не переписує `.cursor/hooks.json` і не друкує статус hook. Merge `.cursor/hooks.json` MUST NOT видаляти чужі hooks; битий `hooks.json` MUST NOT перезаписуватись — лише warning. `.agents/spend/` MUST лишатись у GITIGNORE_LINES. `status` SHALL і далі друкувати секцію `Spend capture`, позначаючи hook як опційний.

`npx agent-orchestrator-kit metrics [name] --collect` SHALL лишатись доступним: повний collectSpend, attach до останньої сесії з вікном `[last.startedAt, now]`, dedup за `sourceIds` і upgrade того самого id через `sourceTotals`, без додавання нової сесії. MUST NOT підміняти це вікно leftover-only (`[last.endedAt, leftoverEnd)`). Після attach leftover resync (див. «Вікно collect») SHALL застосовуватись.

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

- **GIVEN** `metrics.json` з однією сесією і порожніми `sourceIds: []`, `sourceTotals: {}`, `byModel: []`
- **AND** `cursor-usage.jsonl` має запис після `sessions[0].startedAt`
- **WHEN** виконується `metrics <name> --collect`
- **THEN** `sessions.length` лишається `1`
- **AND** `sessions[0].sourceIds` містить id цього запису, `sourceTotals` — його total, а `byModel` — його модельний внесок
- **AND** `sessions[0]` не має ключа `sources`

#### Scenario: sessionEnd leftover після archive пише в archive metrics.json

- **GIVEN** немає `openspec/changes/<name>/`
- **AND** існує `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json` з останньою сесією
- **AND** hook-рядок у leftover-вікні цієї сесії
- **WHEN** виконується `node scripts/cursor-spend-collect.cjs`
- **THEN** id рядка додано до `sourceIds` останньої сесії архівного файла
- **AND** authoritative totals цієї сесії перераховані з compact event aggregate, якщо не було числового override

#### Scenario: sessionEnd leftover після порожнього archive collect (live order)

- **GIVEN** archive уже записав Archiver з `sourceIds: []`, `sourceTotals: {}`, `byModel: []`
- **AND** jsonl був порожній під час finalize
- **AND** hook-рядок з `id: archive-late-35s` з’явився +35s після `Archiver.endedAt` і входить у `endedAt+120s`
- **WHEN** виконується leftover-collect
- **THEN** `archive-late-35s` є в `Archiver.sourceIds`, його total є в `sourceTotals`, а модельний внесок — у `byModel`
- **AND** `spendSource` дорівнює `adapter`

### Requirement: Leftover attach після порожнього persist/archive collect

Якщо persist або archive finalize уже записали v2-сесію з `sourceIds: []`, `sourceTotals: {}`, `byModel: []` (jsonl ще не існував або був порожній), Cursor-рядок, який згодом з’явився на диску з `at` у leftover-вікні цієї сесії (`at >= last.endedAt` і `at <= last.endedAt + 120s`, коли pending немає), MUST бути причеплений leftover-backfill (`sessionEnd` або hook post-append) до **цієї** останньої сесії. Dedup SHALL використовувати `sourceIds` / fingerprint; повторний рядок того самого id з більшим кумулятивним total MUST upgrade `sourceTotals[id]`, `byModel` і session totals без дубля id. Після attach leftover MUST перерахувати authoritative session totals з compact event aggregate, якщо немає прапорця або числового самозвіту, і виставити `spendSource: adapter`. `updatedAt` MUST оновитись, коли compact поля змінились. Persisted session MUST NOT мати ключа `sources`.

Рядок у вікні, який існує на диску в момент collect, MUST NOT ігноруватись лише тому, що перший persist/archive collect уже записав порожні compact поля.

#### Scenario: Live-order leftover після порожнього archive

- **GIVEN** `archive <name>` фіналізував Archiver при порожньому `.agents/spend/cursor-usage.jsonl`
- **AND** compact поля Archiver порожні і `spendSource` є `unreported`
- **AND** згодом з’являється hook-рядок `id: 4f85ec6a` з `at = Archiver.endedAt + 35s` і `at <= Archiver.endedAt + 120s`
- **WHEN** виконується leftover-collect (`node scripts/cursor-spend-collect.cjs` як `sessionEnd` або leftover після append hook)
- **THEN** `Archiver.sourceIds` містить `4f85ec6a`, `sourceTotals` містить його total, а `byModel` — модельний внесок
- **AND** `Archiver.spendSource` дорівнює `adapter`
- **AND** session totals Archiver дорівнюють compact event aggregate
- **AND** `updatedAt` пізніший за час finalize

#### Scenario: Порожній persist потім пізній stop

- **GIVEN** persist записав сесію з порожніми compact полями і `endedAt` T
- **AND** hook-рядок з `id: late-stop` має `at = T + 20s` і входить у leftover-вікно
- **WHEN** виконується leftover-collect
- **THEN** `late-stop` є в `sourceIds` цієї сесії і представлений у `sourceTotals` / `byModel`
- **AND** `spendSource` дорівнює `adapter`

### Requirement: Hook leftover після успішного append

Після успішного допису transient рядка в `<project>/.agents/spend/cursor-usage.jsonl` hook подій `stop` і `afterAgentResponse` SHALL виконати той самий leftover-backfill, що й `scripts/cursor-spend-collect.cjs` на `sessionEnd`, проти резолвлених коренів (див. «Спільний multi-root resolveBaseDir»). Виклик MUST бути fail-open: будь-яка помилка leftover MUST NOT змінювати exit hook і MUST NOT друкувати stdout. `sessionEnd` leftover MUST лишатись і MUST бути ідемпотентним: повторний прохід з тим самим id / fingerprint MUST NOT дублювати `sourceIds`; більший total того самого id MUST upgrade `sourceTotals`, `byModel` і authoritative session totals.

`subagentStop` без `input_tokens` / `output_tokens` MUST NOT писати рядок і MUST NOT запускати leftover. Hook MUST реєструвати leftover лише після успішного append (не коли рядок відхилено через відсутні токени). Persisted v2-сесія MUST NOT мати `sources`.

#### Scenario: stop після append причіплює leftover без sessionEnd

- **GIVEN** `metrics.json` з останньою сесією `endedAt` T, `threadId` рівним `conversation_id` payload і порожніми compact полями
- **AND** payload `stop` має токени і `at` у leftover-вікні буде T+N де N ≤ 120s
- **WHEN** виконується `scripts/cursor-spend-hook.cjs` з цим payload (без окремого `sessionEnd`)
- **THEN** рядок з’являється в jsonl
- **AND** той самий id є в `sourceIds`, total — у `sourceTotals`, а модельний внесок — у `byModel` останньої сесії
- **AND** stdout hook порожній
- **AND** exit code 0

#### Scenario: Повторний sessionEnd не дублює id

- **GIVEN** hook уже причепив `id: g-1` leftover-ом
- **WHEN** виконується `node scripts/cursor-spend-collect.cjs` (`sessionEnd`)
- **THEN** `sourceIds` містить `g-1` рівно один раз
- **AND** exit code 0
- **AND** stdout порожній

#### Scenario: afterAgentResponse теж запускає leftover

- **GIVEN** остання сесія з порожніми compact полями і matching `threadId`
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

Collect (`sessionEnd` і leftover після append) SHALL виконати leftover-backfill для **кожного** кандидата, у якого є `openspec/changes`, читаючи **цей** корінь `.agents/spend/cursor-usage.jsonl` і пишучи compact `sourceIds` / `sourceTotals` / `byModel` та authoritative session totals у **його** active / newest-archive `metrics.json`. Помилка одного кореня MUST NOT зупиняти інші (fail-open). Один `sessionEnd` у multi-root вікні MUST оновити archive consumer, не лише kit. Persisted v2-сесія MUST NOT мати `sources`.

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
- **THEN** id рядка є в `sourceIds`, total — у `sourceTotals`, а модельний внесок — у `byModel` останньої сесії архівного `metrics.json` consumer
- **AND** leftover читав jsonl consumer, не kit

#### Scenario: Перший openspec у kit не перемагає consumer з active change

- **GIVEN** kit cwd має `openspec/changes`, consumer у `workspace_roots` має active `openspec/changes/<name>/`
- **AND** немає збігу `conversation_id` з threadId жодного metrics
- **WHEN** резолвиться корінь для запису jsonl
- **THEN** обрано consumer (active change), не kit лише через порядок cwd / `.agents`

### Requirement: Оцінені USD-агрегати округлюються до 4 знаків

Кожен запис `metrics.json`, що перераховує `spend.costUsdEstimated`, `spendByPlatform.*.costUsdEstimated`, `spendByModel[].costUsdEstimated`, `phases.*.costUsdEstimated` або session-level `costUsdEstimated` **із сум session fields або compact `byModel`**, SHALL зберігати число з 4 десятковими знаками: `Math.round(x * 10000) / 10000`. `null` MUST лишатись `null`. Per-event transient оцінки вже округлені так само; агрегат MUST повторно округлювати суму, щоб не зберігати бінарний float на кшталт `6.561400000000001`. `costUsd` і токени MUST NOT змішуватись з цим правилом у `addNullable`.

#### Scenario: Сума трьох estimate стає 6.5614

- **GIVEN** compact `byModel` / session contributions з `costUsdEstimated` `2.3911`, `2.8153` і `1.355`
- **WHEN** агрегати перераховуються і файл записується
- **THEN** `spend.costUsdEstimated` суворо дорівнює `6.5614`
- **AND** значення не є `6.561400000000001`
- **AND** відповідні `spendByPlatform.cursor.costUsdEstimated`, рядок `spendByModel` і `phases.*.costUsdEstimated` цієї фази теж дорівнюють `6.5614`, якщо всі три внески належать одній платформі/моделі/фазі

#### Scenario: null estimate лишається null

- **GIVEN** сесії без жодного ненульового `costUsdEstimated`
- **WHEN** агрегати перераховуються
- **THEN** `spend.costUsdEstimated` є `null`

### Requirement: Amp leftover scoped до last.platform і thread id

Leftover-collect без `--collect` SHALL запускати лише адаптер `last.platform`, коли `last.platform` є `amp`, `cursor` або `claude`. Cursor leftover на сесії з `last.platform === amp` MUST NOT причіплювати hook-рядки. Якщо `last.platform` є `null`, leftover MUST NOT запускати всі три адаптери; Amp leftover тоді дозволений лише коли є `last.threadId` або однозначний thread-префікс, витягнутий з `sourceIds`: текст до першого `:`, якщо id починається з `T-` (`T-apply:8` → `T-apply`). Якщо `sourceIds` мають змішані thread-префікси, identity MUST NOT інферитись.

Amp leftover SHALL передавати `ampThreadId` = `last.threadId`, або — якщо `threadId` є `null` — той однозначний префікс. MUST NOT підставляти `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` з env, якщо це відкриє інший thread. `collectAmpCli` MUST NOT викликати `listRecentAmpThreadIds`, коли leftover thread id уже відомий **або** коли leftover не має ні `threadId`, ні однозначного префікса з `sourceIds`.

Коли leftover-режим має явний `ampThreadId` (переданий `listRecentAmpThreads: false` і непорожній `ampThreadId`), `collectAmpCli` MUST зібрати **лише цей id**. MUST NOT додавати `ampCurrentThreadId(env)` / `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` до списку ids перед export. Чужий env-thread (`T-archive` при leftover `T-apply`) MUST NOT експортуватись і MUST NOT потрапляти в compact collected data.

Incoming Amp leftover id MUST входити лише якщо він починається з `<resolvedThreadId>:`. Id `T-archive:2` MUST NOT потрапляти в сесію, чий thread є `T-apply` (або чиї наявні `sourceIds` однозначно мають префікс `T-apply`). ExclusiveEnd leftover-вікна (`at >= pending.startedAt` наступної сесії) MUST лишатись; thread-фільтр діє зверху. Для непорожнього thread identity нормальною верхньою межею лишається наступний `pending.startedAt`; для `threadId: null` без однозначної identity верхня межа MUST бути `min(next pending.startedAt, last.endedAt + 120s)`, тому події з довгою затримкою приймаються лише за наявності identity або якщо вкладаються в cap.

#### Scenario: Leftover Implementer без threadId не бере archive thread і Cursor hook

- **GIVEN** остання закрита сесія `role: Implementer`, `platform: amp`, `threadId: null`
- **AND** `sourceIds` містять `T-apply:8` і `T-apply:9`
- **AND** Amp CLI може віддати usage `T-archive:2`, а `.agents/spend/cursor-usage.jsonl` має рядок у leftover-вікні
- **WHEN** виконується leftover наступного persist без `--collect`
- **THEN** `T-archive:2` відсутній у `Implementer.sourceIds`
- **AND** Cursor hook ids відсутні в `Implementer.sourceIds`
- **AND** `listRecentAmpThreadIds` не викликається

#### Scenario: Leftover з threadId T-apply теж ріже чужий thread

- **GIVEN** остання сесія має `platform: amp` і `threadId: T-apply`
- **AND** у leftover-вікні є Amp usage `T-apply:10` і `T-archive:2`
- **WHEN** виконується leftover без `--collect`
- **THEN** `T-apply:10` є в `sourceIds`
- **AND** `T-archive:2` відсутній
- **AND** Cursor hook ids відсутні

#### Scenario: Leftover з явним T-apply не експортує env T-archive

- **GIVEN** leftover без `--collect` передає `ampThreadId: T-apply` і `listRecentAmpThreads: false`
- **AND** env має `AMP_CURRENT_THREAD=T-archive` (або `AMP_THREAD_ID=T-archive`)
- **AND** Amp CLI може експортувати обидва threads
- **WHEN** виконується leftover collect / `collectAmpCli`
- **THEN** `exportAmpThread` не викликається з `T-archive`
- **AND** зібрані ids не містять префікс `T-archive:`
- **AND** зібрані Amp ids містять лише `T-apply`

#### Scenario: Amp leftover без thread і без префікса не кличе listRecent

- **GIVEN** остання сесія має `platform: amp`, `threadId: null`, `sourceIds: []`
- **WHEN** виконується leftover без `--collect`
- **THEN** `collectAmpCli` не викликає `listRecentAmpThreadIds`
- **AND** нові Amp ids не з’являються з «останніх» threads

### Requirement: usageModels лише цього thread без дублікатів

`session.usageModels` SHALL містити рядки таблиці Models **лише** з Amp thread цієї сесії (`session.threadId` або однозначний префікс до `:` з `sourceIds`, що починаються з `T-`). Змішані thread-префікси в `sourceIds` MUST NOT інферити identity. CLI MUST NOT мержити `usageModels` інших threads. Рядки SHALL бути унікальні за іменем моделі (після `matchAmpUsageModel`): залишити рядок з більшим `totalTokens` (або `inputTokens + outputTokens`); при рівності — останній. Leftover MUST перезаписати `usageModels` і compact `byModel` свіжою thread-scoped множиною, не конкатенувати попередню таблицю з новою. Fresh Amp usage `Input tokens` / `Output tokens` SHALL override export sums у authoritative session fields; лише коли usage totals відсутні, SHALL використовуватись compact aggregate transient export-подій. Fresh Models SHALL визначати `byModel`. Fresh `Cost: $N` SHALL override cached prior Cost; cached prior Cost лишається тільки коли fresh Cost відсутній, і Cost одного thread MUST NOT дублюватись у новій сесії.

#### Scenario: usageModels після leftover унікальні й цього thread

- **GIVEN** сесія має `threadId: T-apply` і leftover зібрав usage `T-apply` (Luna двічі) плюс usage `T-review` (Fable, Sol)
- **WHEN** leftover записує `usageModels` і `byModel`
- **THEN** кожна модель зустрічається щонайбільше один раз
- **AND** моделей з `T-review` немає
- **AND** Luna є рівно один рядок

## ADDED Requirements

### Requirement: Експорт меж фаз для зовнішніх дашбордів

`metrics <name> --summary-json` SHALL друкувати в stdout лише JSON `{ version, change, createdAt, archivedAt, totals, phases, spend, spendByPlatform, spendByModel }` без `sessions` і без `pending`. `phases.<phase>` у цьому виводі SHALL містити `sessions`, `startedAt`, `endedAt`, `durationMs`, `leadTimeMs`, токени, `costUsd`, `costUsdEstimated`, `agents`, `models` — ті самі значення, що й у файлі. Вивід MUST NOT містити ключ `commits` і MUST NOT бути похідним від git log. README «Change metrics» SHALL мати розділ «Для дашбордів», який каже: межі й тривалість фази беруться лише з `phases.<phase>`, `totals.leadTimeMs` — лише для підсумку по change-у, git log MUST NOT використовуватись для меж фаз.

#### Scenario: summary-json віддає різні межі фаз без сесій

- **GIVEN** файл із сесіями `phase: spec` (15:17:41→15:31:40, durationMs 539356) і `phase: review` (15:26:32→15:39:40, durationMs 459267)
- **WHEN** виконується `metrics <name> --summary-json`
- **THEN** stdout є валідним JSON без ключа `sessions`
- **AND** `phases.spec.startedAt` не дорівнює `phases.review.startedAt`
- **AND** `phases.spec.durationMs` дорівнює `539356`, `phases.review.durationMs` — `459267`
- **AND** жоден об'єкт не містить ключа `commits`

#### Scenario: README описує контракт дашборда

- **WHEN** читається README «Change metrics»
- **THEN** є розділ «Для дашбордів» зі згадкою `phases.<phase>.startedAt` / `endedAt` / `durationMs` і забороною git log для меж фаз
