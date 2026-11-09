## MODIFIED Requirements

### Requirement: Restore записує старт сесії, persist — її закриття

`handoff --restore` SHALL записувати `pending` (`startedAt` = зараз, `role` з next role handoff-файлу, якщо він є, `platform`, `threadId`, `clientSource` з детекту клієнта). `handoff <name>` SHALL додавати елемент у `sessions` з: `startedAt` з `--started-at` або `pending.startedAt` або `endedAt` останньої закритої сесії або `createdAt` файла (MUST NOT бути раніше за `createdAt`; earliest event MUST NOT ставати `startedAt`); `endedAt` = зараз; `durationMs` = різниця, коли обидва кінці відомі, інакше `null`; `role` = канонічний токен Closed role (див. «Канонічна Closed role у metrics.json»); `phase` = `phaseForRole` канонічного токена; `runtime` і `agentId` з runtime-ланцюжка; `tasks` зі знімка progress; `model` за вимогою «Модель сесії»; `platform`, токени, `costUsd`, `ampCredits` і `spendSource` з ланцюжка прапорець → transient sources → `null`; `sourceIds` / `sourceTotals` / `byModel` з collect клієнта, зафіксованого на restore (або всі адаптери при `--collect`; порожні коли клієнт невідомий і немає `--collect`). Перед collect поточної сесії persist SHALL виконати leftover-backfill останньої вже закритої сесії (див. «Вікно collect»). Після запису `pending` MUST стати `null`. Агрегати (`phases`, `totals`, `spend`, `spendByPlatform`, `spendByModel`) SHALL перераховуватись на кожному записі.

Порядок persist MUST бути: leftover попередньої сесії → collect і записати сесію в `metrics.json` → надрукувати попередження в stderr → надрукувати next-thread prompt у stdout. Prompt MUST лишатись єдиним вмістом stdout. Два послідовні persist MUST лишатись двома записами сесій і MUST NOT зливатись в один.


Persist без `pending` і без `--started-at` SHALL надрукувати в stderr попередження `metrics: persist without restore — window starts at <last.endedAt>` і MUST NOT відкривати нижню межу collect.

#### Scenario: Restore + persist закриває одну сесію

- **GIVEN** `handoff.md` with Closed role `Architect` and next role `spec-reviewer`
- **AND** collect returned no transient source records with a model
- **WHEN** `handoff <name> --restore` runs, then `handoff <name> --model claude-opus-5 --input-tokens 12000 --output-tokens 3000 --cost-usd 0.42`
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
- **AND** persist runs with `--platform amp`
- **AND** у `AMP_DATA_DIR/threads` є 74 треди цього cwd з usage за три місяці до T
- **WHEN** виконується persist
- **THEN** `sessions[6].startedAt` дорівнює T
- **AND** `sessions[6].sourceIds` не містить id з `at` < T
- **AND** stderr містить `persist without restore`
- **AND** exit code 0

### Requirement: Restore фіксує клієнта сесії, persist йде його флоу

`handoff --restore` SHALL визначити клієнта сесії і записати його в `pending`: `platform` (`cursor` | `claude` | `amp` | `null`), `threadId` (Amp thread id, або Cursor `conversationId`, або `null`), `clientSource` (непорожній рядок джерела). Резолв клієнта: `--platform` / `AOK_PLATFORM` → `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` → `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID` → Claude Code env → батьківський процес `amp` і/або свіжий `~/.local/share/amp/session.json` `lastThreadByTerminal[tty]` (вікно свіжості ≤ 2h; `/dev/null` і pipe MUST NOT рахуватись як tty) → якщо env і Amp parent не перемогли, свіжий `session.json` `lastThreadId` (те саме вікно ≤ 2h; свіжість з кореневого `updatedAt`, інакше mtime файла) з `clientSource: amp-session-last` → якщо `lastThreadId` порожній, але `session.json` існує і свіжий — перший id `amp threads list` з `clientSource: amp-session-list` → `null`. Якщо батько є `amp` і tty немає, `pending.threadId` SHALL братися з першого id `amp threads list` (`clientSource: amp-threads-list`), MUST NOT з `session.json` `lastThreadId`. Для cursor непорожній `CURSOR_CONVERSATION_ID` SHALL стати `pending.threadId`; на persist без `pending` той самий env SHALL стати `session.threadId` (id, використаний як фільтр collect, MUST бути записаний у сесію). Amp env MUST перемагати Cursor env. `agentMode` (`low`/`medium`/`high`/`ultra`) MUST NOT ставати `session.model`.

`handoff <name>` SHALL резолвити `session.platform` так: `--platform` → `AOK_PLATFORM` → `pending.platform` → host env → transient sources. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, persist SHALL зібрати spend лише цього клієнта навіть без `--collect`. Amp-флоу: `amp threads export <pending.threadId>` (бінар `AOK_AMP_BIN` або `amp`; fail-open) плюс локальні `threads/*.json` **лише цього thread id**. Persist і archive MUST NOT викликати `listRecentAmpThreadIds`; без thread id (`pending.threadId`, `--amp-thread`, `AMP_CURRENT_THREAD` / `AMP_THREAD_ID`) Amp-флоу MUST пропустити локальні `threads/*.json` з note у stderr. Cost треда, чий id уже є `threadId` попередньої сесії, MUST NOT додаватись до нової сесії. Cursor-флоу: hook-файл з фільтром conversationId. Claude-флоу: `~/.claude/projects`. `--collect` SHALL як і раніше запускати всі три адаптери. Відсутній Amp CLI MUST NOT валити persist.

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

- **GIVEN** `pending: null`, немає `AMP_*` env і `--amp-thread`, persist запускається з `--platform amp`
- **AND** `AMP_DATA_DIR/threads` має matching треди цього cwd
- **WHEN** виконується persist
- **THEN** `sessions[n].sourceIds` порожній
- **AND** `listRecentAmpThreadIds` не викликається
- **AND** stderr містить note про пропущений Amp collect без thread id

### Requirement: Модель сесії — LLM product id з sources, flag або env, інакше null

`session.model` і `phases.*.models` MUST зберігати ідентифікатор LLM-продукту, не Closed role, не ім'я субагента і не family-ярлик, коли адаптер уже дав product id. Sources у цій вимозі — transient chat records, не persisted session key. Резолв SHALL відбуватись до compaction: primary модель з transient зібраних chat-подій (модель з найбільшим `totalTokens` серед подій з непорожнім `model`; при рівності — стабільний порядок platform, потім id; для Amp — лише `usage.model` export-повідомлень, не display-імена helper-моделей з usage-таблиці) → якщо жоден transient source не має `model`: непорожній `--model` → непорожній env `AOK_MODEL` → `null`. `--model` / `AOK_MODEL` MUST NOT перемагати непорожній transient `source.model`. Family на кшталт `cursor-grok-4.6` MUST NOT з’являтись у `session.model`, `phases.*.models` чи `spendByModel`, коли transient sources мають product id (`cursor-grok-4.6-xhigh-fast`, `cursor-grok-4.6-low`). Amp Models rows у persisted `byModel` MAY містити display/helper models, але MUST NOT override chat product id, уже визначений з export. `session.models` SHALL містити унікальні `model` з `session.byModel`, коли рядків більше одного. Рядок зберігається як у usage-записі (без вигаданої таксономії). Порожнє значення і `unknown` трактуються як відсутнє. Відсутня модель MUST NOT робити persist або archive non-zero. Якщо сесія записується з `model: null`, CLI SHALL попередити в stderr. CLI MUST NOT викликати Cursor SDK, Claude `/cost` чи Amp billing API, щоб дізнатись модель.

#### Scenario: Product id з transient sources перемагає --model family

- **GIVEN** `--model cursor-grok-4.6`
- **AND** transient sources містять `model: cursor-grok-4.6-low` з `totalTokens: 1000`
- **WHEN** виконується persist
- **THEN** `session.model` дорівнює `cursor-grok-4.6-low`
- **AND** `phases` цієї сесії містить `cursor-grok-4.6-low`
- **AND** `spendByModel` не містить окремого рядка `cursor-grok-4.6`

#### Scenario: Flag --model beats AOK_MODEL when transient sources have no model

- **GIVEN** `AOK_MODEL=gpt-5.6-sol`
- **AND** transient sources are empty or have no `model` field
- **WHEN** persist runs with `--model cursor-grok-4.6`
- **THEN** `session.model` equals `cursor-grok-4.6`

#### Scenario: Legacy ## Metrics model is ignored

- **GIVEN** `AOK_MODEL=gpt-5.6-sol` and a legacy `## Metrics` section with `model: claude-opus-5` in `handoff.md`
- **AND** transient sources have no model
- **WHEN** persist runs without `--model`
- **THEN** `session.model` equals `gpt-5.6-sol`

#### Scenario: Env AOK_MODEL без прапорця коли transient sources без model

- **GIVEN** `AOK_MODEL=gpt-5.6-sol` і немає `--model`
- **AND** transient sources без model
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` дорівнює `gpt-5.6-sol`

#### Scenario: Відсутня модель — null, warning, exit 0

- **GIVEN** немає `--model`, немає `AOK_MODEL` і немає transient sources з model
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

### Requirement: Вікно collect, cwd-match і dedup

For Claude project matching, a transient collector row SHALL match only when `row.cwd === cwd` or `row.cwd` starts with `cwd + sep`; a missing `row.cwd` MUST be excluded. When both `--started-at` and `pending.startedAt` exist, `--started-at` SHALL win and the 120-second grace SHALL be anchored to that selected start.

Є рівно два вікна. Третього вікна MUST NOT бути.

**Persist цієї сесії.** CLI SHALL select start as `--started-at` → `pending.startedAt` → `last.endedAt` → `metrics.createdAt`. The collect lower bound SHALL be selected start minus 120 seconds when it came from `--started-at` or `pending.startedAt`, otherwise selected start itself. Нижня межа MUST завжди існувати. Подія, вже причеплена leftover-ом попередньої сесії, MUST NOT дублюватись. `startedAt` сесії MUST NOT братись з earliest події.

**Leftover останньої закритої сесії.** Persist (перед collect поточної), archive (перед collect Archiver), Cursor `sessionEnd` і Cursor hook після успішного append `stop` / `afterAgentResponse` SHALL причіплювати до **останньої вже закритої** сесії події, яких ще немає за `source.id`, з `at >= last.endedAt`. `leftoverEnd` SHALL бути `pending.startedAt`, коли наступний `pending` існує і `last.threadId` непорожній (навіть якщо це пізніше за 120s), і ця pending-межа є виключною (`at < leftoverEnd`). Для сесії з `threadId: null` leftoverEnd SHALL бути `min(pending.startedAt, last.endedAt + 120s)`; pending-межа лишається виключною, а grace-cap `last.endedAt + 120s` — інклюзивним. Без наступного pending leftoverEnd SHALL бути `last.endedAt + 120s` інклюзивно. Подія після `last.endedAt`, яка лежить у цьому leftover-вікні до наступного pending/cap, MUST належати останній закритій сесії і MUST NOT входити в persist нової сесії.

Leftover без `--collect` MUST бути scoped до `last.platform` і Amp leftover MUST різатись за thread id. If fresh Amp usage supplies Input/Output totals, session totals SHALL equal those totals and `byModel` SHALL be replaced by the fresh Models table. Otherwise, absent an explicit numeric flag override, totals and `byModel` SHALL be rebuilt from all transient collected events when available, or from compact stored `sourceTotals` / `byModel`; persisted per-event `sources` MUST NOT be required or restored. Explicit numeric overrides MUST remain honored; the Cursor hook script `scripts/cursor-spend-collect.cjs` (`sessionEnd` and post-append leftover) additionally keeps the session totals when `spendSource` is `flag`, or when spend numbers exist and `spendSource` is nonempty and neither `adapter` nor `unreported`; its compact `sourceIds`, `sourceTotals` and `byModel` still grow. Existing billed `session.costUsd` MUST be preserved unless fresh Cost is supplied. A matching late row MUST attach even when initial collect persisted `sourceIds: []`.

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

### Requirement: Опційна платформа сесії — flag/env/host/sources/null

`session.platform` SHALL бути `cursor`, `claude`, `amp` або `null`. Резолв: `--platform` → env `AOK_PLATFORM` → host env (Amp: `AMP_CURRENT_THREAD` / `AMP_THREAD_ID`; Cursor: `CURSOR_AGENT` / `CURSOR_CONVERSATION_ID`; Claude Code: `CLAUDECODE` / `CLAUDE_CODE` / `CLAUDE_CODE_ENTRYPOINT`) → primary platform з transient adapter sources при `--collect` → `null`. Transient adapter sources MAY існувати в пам'яті під час collect, але MUST NOT записуватись як `session.sources`; persisted v2-сесія SHALL зберігати їхні ідентифікатори в `sourceIds`, compact totals у `sourceTotals`, а модельні суми в `byModel`. Невалідний `--platform` (не з трьох значень) MUST завершувати persist/archive з non-zero. Невалідний непорожній `AOK_PLATFORM` SHALL давати `null` і warning, не fail (без fallback на host). `--platform` MUST перемагати `AOK_PLATFORM`, а `AOK_PLATFORM` MUST перемагати host env.

#### Scenario: --platform записує cursor

- **WHEN** виконується persist з `--platform cursor`
- **THEN** `sessions[0].platform` дорівнює `cursor`
- **AND** exit code 0

#### Scenario: Невалідний --platform падає

- **WHEN** виконується persist з `--platform foo`
- **THEN** exit code ≠ 0
- **AND** сесія не дописується як успішний persist-запис із `platform: foo`

#### Scenario: AOK_PLATFORM beats host env

- **GIVEN** `CURSOR_AGENT=1` and `AOK_PLATFORM=amp`
- **WHEN** persist runs without `--platform`
- **THEN** `sessions[0].platform` equals `amp`

#### Scenario: Host env виставляє платформу коли немає flag

- **GIVEN** немає `--platform` / `AOK_PLATFORM`
- **AND** `CURSOR_AGENT=1` (або `CLAUDECODE=1`, або `AMP_CURRENT_THREAD` непорожній)
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].platform` є `cursor` (або `claude` / `amp` відповідно)
- **AND** exit code 0

### Requirement: Archive завжди фіналізує metrics.json після успішного move

На **старті** `archive <name>`, якщо `pending` є `null`, команда SHALL записати `pending.startedAt = now` (старт сесії Archiver) у ще активний `metrics.json` і SHALL виконати leftover-backfill останньої не-Archiver сесії з `leftoverEnd = pending.startedAt`. Після успішного переміщення change команда MUST створити `metrics.json` у архівній папці, якщо файлу не було, виставити `archivedAt`, очистити `pending`, перерахувати агрегати і додати сесію `role: Archiver`, `phase: archive`, `startedAt` = записаний pending start, `endedAt` = зараз, `durationMs` = дельта (MUST NOT бути `null`, коли pending start існував). Клієнт Archiver SHALL резолвитись так само, як persist: `--platform` / `AOK_PLATFORM` → `resolveRestoreClient` / host env. Коли резолвлений клієнт є `amp` / `cursor` / `claude`, archive SHALL зібрати spend лише цього клієнта навіть без `--collect`, з вікном Archiver `[pending.startedAt − 120s, now]` (pre-restore grace, dedup за id) — MUST NOT з `[last.endedAt, now]`. `--collect` SHALL запускати всі три адаптери. Значення `model` — за «Модель сесії»; токени — за «Джерело spend». Секція `## Metrics` в архівованому `handoff.md` MUST ігноруватись повністю (вимога «Legacy `## Metrics` section in handoff.md is ignored»). Невалідний `--platform` MUST відхилятись до move. Якщо після finalize `spend.costUsd` є `null` — warning у stderr через `console.error`. Exit code MUST NOT змінюватись через відсутній файл, порожній spend або `null` модель.

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

#### Scenario: Archiver takes platform, model and spend from flags

- **GIVEN** collect for the Archiver returned no transient records with a model
- **WHEN** `archive <name> --platform amp --model claude-fable-5 --input-tokens 4000` runs
- **THEN** the `Archiver` session has `platform: amp`, `model: claude-fable-5` and `inputTokens: 4000`
- **AND** its `spendSource` is `flag`

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

### Requirement: Persist і archive не падають лише через відсутні model або spend

Відсутні `model`, `platform` (крім невалідного `--platform`), spend-поля і порожній collect MUST NOT бути єдиною причиною ненульового exit persist або archive. `gate-check` і pre-commit hook MUST NOT вимагати наявність або вміст `metrics.json` і MUST NOT вимагати секцію `## Metrics` у `handoff.md`.

#### Scenario: Persist без model і spend успішний

- **WHEN** виконується валідний persist без `--model`, без `AOK_MODEL` і без spend-прапорців
- **THEN** exit code 0
- **AND** сесія записана з `model: null`, null spend і `spendSource: "unreported"`
- **AND** stderr does not mention `## Metrics`

#### Scenario: Відсутність metrics.json не валить gate-check

- **GIVEN** активна зміна без `metrics.json`
- **WHEN** виконується `npx agent-orchestrator-kit gate-check` (або pre-commit hook)
- **THEN** відсутність файлу не є помилкою і не змінює exit code

#### Scenario: Handoff without ## Metrics does not fail gate-check

- **GIVEN** an active change whose `handoff.md` has no `## Metrics` section
- **WHEN** `npx agent-orchestrator-kit gate-check` runs
- **THEN** the exit code does not change because of the missing section

### Requirement: Джерело spend — прапорці, потім опційні адаптери

Session-level spend SHALL резолвитись пополе, перше не-null значення виграє: явний прапорець (`--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`) → transient adapter sources (locked client або `--collect`) → `null`. Дефолтний persist і archive MUST NOT читати адаптери інших платформ, ніж резолвлений клієнт, якщо немає `--collect`.

`session.ampCredits` SHALL зберігатись окремим полем сесії, яке заповнюється лише з transient adapter sources (прапорця для credits немає), і MUST NOT входити в `costUsd` чи в будь-яку суму USD. Відсутнє число MUST лишатись `null`, ніколи штучним `0`. CLI MUST NOT писати оцінений з токенів USD у `costUsd`. CLI MUST NOT конвертувати Amp credits у USD. Cursor-оцінка з токенів SHALL писатись лише в `costUsdEstimated`. Прапорець `--cost-usd` SHALL потрапляти в `costUsd` як billed і MUST NOT копіюватись у `costUsdEstimated`. Агент MUST NOT підставляти Cursor-оцінку як `--cost-usd`.

Коли transient adapter sources зібрані, persisted v2-сесія SHALL зберігати лише їхні `sourceIds`, `sourceTotals` і агреговані `byModel`, без ключа `sources`; session-level totals SHALL бути авторитетними для `spend`, `spendByPlatform` і фаз, а `byModel` SHALL наповнювати `spendByModel`. Опційний `byModel[].costSource` MAY фіксувати джерело billed або estimated cost. Адаптерні compact-дані MUST NOT перекривати totals, що прийшли з прапорців (`spendSource: flag`). Для будь-якої іншої сесії leftover MAY виставити session totals з compact adapter totals і `spendSource: adapter`.

#### Scenario: Flags win per field over adapter sources

- **GIVEN** the adapter fixture gives a transient source with `inputTokens: 100` and `outputTokens: 50`
- **WHEN** persist runs with `--collect --input-tokens 7 --cost-usd 9.99`
- **THEN** `sessions[0].inputTokens` equals `7`
- **AND** `sessions[0].outputTokens` equals `50`
- **AND** `sessions[0].costUsd` equals `9.99`

#### Scenario: Дефолтний persist не читає адаптери

- **GIVEN** tmp `HOME` з валідною Claude JSONL фікстурою у вікні сесії
- **AND** клієнт сесії не резолвлений як `claude`
- **WHEN** виконується persist без `--collect`
- **THEN** `sessions[0].sourceIds` є `[]`
- **AND** `sessions[0].sourceTotals` є `{}`
- **AND** `sessions[0].byModel` є `[]`
- **AND** у `sessions[0]` немає ключа `sources`
- **AND** `sessions[0].totalTokens` є `null`
- **AND** `spendByPlatform.claude.source` дорівнює `none`

#### Scenario: Amp credits stay out of costUsd

- **GIVEN** a `metrics.json` session with `platform: amp`, `ampCredits: 20` and `costUsd: null`
- **WHEN** aggregates are recomputed
- **THEN** `sessions[0].costUsd` is `null` and `spend.costUsd` is `null`
- **AND** `spendByPlatform.amp.ampCredits` equals `20`

#### Scenario: Flag totals are not overwritten by collected sources

- **GIVEN** the adapter fixture gives a transient source with `inputTokens: 5` and `outputTokens: 5`
- **WHEN** persist runs with `--collect --input-tokens 1000 --output-tokens 200`
- **THEN** `sessions[0].inputTokens` equals `1000`
- **AND** `sessions[0].sourceIds` contains the collected record id
- **AND** `sessions[0].byModel` contains the collected record tokens
- **AND** `sessions[0]` has no `sources` key

#### Scenario: Legacy placeholder ## Metrics does not block leftover resync

- **GIVEN** a persisted session without spend flags whose `handoff.md` carried a legacy placeholder `## Metrics` (all numbers `unknown`, `spend_source: self-report`)
- **AND** leftover adds two transient sources with `inputTokens` 100 and 50
- **WHEN** leftover completes
- **THEN** `session.inputTokens` equals `150`
- **AND** `session.spendSource` equals `adapter`

#### Scenario: Flag cost_usd does not become an estimate

- **GIVEN** no Cursor hook records
- **WHEN** persist runs with `--cost-usd 0.42`
- **THEN** `sessions[0].costUsd` equals `0.42`
- **AND** `sessions[0].costUsdEstimated` is `null`

### Requirement: Поле session.spendSource фіксує походження чисел

Each session record SHALL carry `spendSource`: `flag` (a number came from a spend flag), `amp-usage` (Amp usage cost, no flag), `adapter` (only transient adapter sources or leftover) or `unreported` (no number). The CLI MUST NOT write `self-report` or any other value.

`spendSource` MUST NOT впливати на exit code. Legacy-записи без поля SHALL читатись як `unreported`; збережені `self-report` чи довільні значення лишаються як є, без міграції.

#### Scenario: A spend flag gives flag

- **WHEN** persist runs with `--total-tokens 500`
- **THEN** `sessions[0].spendSource` equals `flag`

#### Scenario: An empty session gives unreported

- **GIVEN** persist without spend flags and without `--collect`
- **WHEN** the session is recorded
- **THEN** `sessions[0].spendSource` equals `unreported`
- **AND** stderr does not mention `## Metrics`

#### Scenario: Leftover on an unreported session gives adapter

- **GIVEN** a session recorded with `spendSource: unreported`
- **AND** leftover adds two transient sources
- **WHEN** leftover recalculates totals
- **THEN** session totals equal the compact sum of `sourceTotals` / `byModel`
- **AND** `spendSource` equals `adapter`
- **AND** the session has no `sources` key

#### Scenario: A stored self-report value stays readable

- **GIVEN** a `metrics.json` session with `spendSource: self-report`
- **WHEN** `metrics <name>` runs
- **THEN** the session is shown without error
- **AND** the file is not rewritten

### Requirement: Archive друкує людську зводку по всьому change

Після успішного move і finalize `archive <name>` SHALL надрукувати в stdout зводку по всьому change: рядок підсумку (`sessions`, work time, lead time, `tokens`, `cost`), таблицю **by phase** (sessions, duration, tokens, cost, roles, models), таблицю **by platform** (tokens, `costUsd`, `ampCredits`) і таблицю **by model** (platform, tokens, `costUsd`). Зводка SHALL рендеритись тією самою функцією, що й `metrics <name>` без `--json`, щоб два виводи не розходились.

Зводка MUST NOT друкувати єдиний total $, що додає Amp credits до USD. Сесії з `spendSource: "unreported"` SHALL бути видимими в зводці (окремий рядок або лічильник), щоб було зрозуміло, скільки сесій не мають зафіксованого spend. Помилка рендерингу зводки MUST NOT робити archive non-zero — change уже переміщено.

#### Scenario: Archive stdout містить зводку

- **GIVEN** change з трьома записаними сесіями проходить гейти archive
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** stdout містить кількість сесій, work time, lead time, tokens і cost
- **AND** stdout містить таблиці by phase, by platform і by model
- **AND** exit code 0

#### Scenario: Зводка показує unreported сесії

- **GIVEN** дві з трьох сесій мають `spendSource: "unreported"`
- **WHEN** виконується archive
- **THEN** stdout повідомляє, що дві сесії без зафіксованого spend

#### Scenario: Зводка не змішує credits і USD

- **GIVEN** `spendByPlatform.claude.costUsd` є `1.5`, `spendByPlatform.amp.ampCredits` є `20`
- **WHEN** виконується archive
- **THEN** stdout не містить одного total, що дорівнює `21.5`

### Requirement: Leftover attach після порожнього persist/archive collect

Якщо persist або archive finalize уже записали v2-сесію з `sourceIds: []`, `sourceTotals: {}`, `byModel: []` (jsonl ще не існував або був порожній), Cursor-рядок, який згодом з’явився на диску з `at` у leftover-вікні цієї сесії (`at >= last.endedAt` і `at <= last.endedAt + 120s`, коли pending немає), MUST бути причеплений leftover-backfill (`sessionEnd` або hook post-append) до **цієї** останньої сесії. Dedup SHALL використовувати `sourceIds` / fingerprint; повторний рядок того самого id з більшим кумулятивним total MUST upgrade `sourceTotals[id]`, `byModel` і session totals без дубля id. Після attach leftover MUST перерахувати authoritative session totals з compact event aggregate, якщо немає прапорця, і виставити `spendSource: adapter`; the resync eligibility of this hook path is the Cursor hook rule of «Вікно collect, cwd-match і dedup» (a stored session with numbers and a `spendSource` other than `adapter` or `unreported` keeps its totals and only the compact fields grow). `updatedAt` MUST оновитись, коли compact поля змінились. Persisted session MUST NOT мати ключа `sources`.

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

### Requirement: Leftover після amp-usage перераховує токени і лишає billed Cost

When fresh leftover usage supplies `Input tokens` / `Output tokens`, session totals SHALL use those fresh usage totals and `byModel` SHALL be replaced from the fresh Models table. Only when usage returns no total lines SHALL totals fall back to available existing compact `byModel` contributions plus new transient export deltas; the fallback MUST NOT claim reconstructable per-event input/output from `sourceTotals`, which stores only totals. Export-message sums MUST NOT overwrite available usage truth.

In the CLI leftover (`attachLeftoverSources`, `metrics --collect`), `sessionSpendIsFrozen` SHALL return true only when `spendSource === "flag"`: `amp-usage`, `adapter`, `unreported` and a stored legacy `self-report` MUST NOT freeze leftover token resync, and a frozen session keeps its totals while only its compact `sourceIds`, `sourceTotals` and `byModel` grow. The Cursor hook leftover (`scripts/cursor-spend-collect.cjs`, `sessionEnd` and post-append) keeps its own freeze rule for stored values and is not changed by this requirement.

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

#### Scenario: A flag session keeps its totals

- **GIVEN** a session with `spendSource: flag` and `inputTokens: 7`
- **AND** leftover adds a transient source with `inputTokens` 100
- **WHEN** leftover completes
- **THEN** `session.inputTokens` equals `7` and `session.spendSource` equals `flag`
- **AND** `session.sourceIds` contains the new source id

#### Scenario: A stored self-report session is not frozen in the CLI leftover

- **GIVEN** a session with `spendSource: self-report` and `inputTokens: 5`
- **AND** the CLI leftover (`attachLeftoverSources`) adds a transient source with `inputTokens` 100
- **WHEN** the leftover completes
- **THEN** `session.inputTokens` equals `100`
- **AND** `session.spendSource` equals `adapter`

### Requirement: Канонічна Closed role у metrics.json

`session.role`, `pending.role` і `phases.*.agents` MUST зберігати канонічний токен ролі, не повний рядок Closed role з `handoff.md`. Канонічні токени: `Explorer`, `Architect`, `Spec Reviewer`, `Implementer`, `Archiver`, `Design Intake`; `bin/agent-orchestrator.js` SHALL експортувати їх як `CANONICAL_ROLE_TOKENS` разом із `isCanonicalRole`. CLI SHALL брати перший відомий токен з Closed role або next role (регістр ігнорується; `Spec Reviewer` — два слова) або перший сегмент до `—` / коми, якщо він збігається з токеном. `Spec Architect` (ім'я субагента kit-а `spec-architect`) SHALL канонізуватись у `Architect`, голий `Reviewer` (перший сегмент, без `Code` перед ним) — у `Spec Reviewer`, а `Code Writer` (ім'я субагента kit-а `code-writer`, також через дефіс) — у `Implementer`, зокрема коли перший сегмент до коми містить дужку (`Code Writer (apply, 8/8 tasks)`). `Conductor` і `Code Reviewer` не є Closed role жодного шаблону і MUST NOT додаватись як токени: `canonicalRole` лишає їх сирим рядком, а інваріант «Інваріанти правдоподібності — попередження на запис, не блокування» позначає такий запис як неканонічний (warning + `session.notes`, contract-тест над новими архівами падає). Текст після `—` MUST NOT записуватись у `session.role`, MUST NOT записуватись у `pending.role` і MUST NOT потрапляти в `phases.*.agents`. `handoff.md` MAY лишати повне речення Closed role. `metricsRecordSessionStart` SHALL пропускати роль через ту саму `canonicalRole`, що й persist.

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

#### Scenario: Spec Architect канонізується в Architect

- **GIVEN** Closed role `Spec Architect — propose complete, ready for Spec Reviewer`
- **WHEN** записується сесія
- **THEN** `session.role` дорівнює `Architect`
- **AND** `session.phase` дорівнює `spec`
- **AND** stderr не містить `metrics: warning: role`

#### Scenario: Code Writer канонізується в Implementer

- **GIVEN** Closed role `Code Writer (apply, 8/8 tasks)`
- **WHEN** записується сесія
- **THEN** `session.role` дорівнює `Implementer`
- **AND** `session.phase` дорівнює `apply`
- **AND** stderr не містить `metrics: warning: role`

#### Scenario: Conductor лишається неканонічним і помічається

- **GIVEN** Closed role `Conductor`
- **WHEN** записується сесія
- **THEN** `session.role` дорівнює `Conductor`
- **AND** stderr містить `metrics: warning: role "Conductor" is not a canonical Closed role token`
- **AND** `session.notes` містить цей рядок, exit code дорівнює 0

#### Scenario: A bare Reviewer canonicalizes to Spec Reviewer

- **GIVEN** Closed role `Reviewer` (or `Reviewer — APPROVE`)
- **WHEN** the session is recorded
- **THEN** `session.role` equals `Spec Reviewer` and `session.phase` equals `review`
- **AND** `phases.review.agents` contains `Spec Reviewer`
- **AND** stderr does not contain `metrics: warning: role`
- **AND** `Code Reviewer` stays a raw, non-canonical role

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
- **THEN** stdout повідомляє про дві сесії без зафіксованого spend

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

## REMOVED Requirements

### Requirement: Секція `## Metrics` у handoff.md — самозвіт сесії

**Reason**: Agents never filled the section with real numbers (archived handoffs hold only `unknown`, no session has `spendSource: self-report`), and the section duplicated `metrics.json`.
**Migration**: Persist and archive ignore a legacy section (requirement «Legacy `## Metrics` section in handoff.md is ignored»); metrics come from flags and adapters (requirement «Джерело spend — прапорці, потім опційні адаптери»).

### Requirement: Відсутній самозвіт — попередження і unreported, без fail

**Reason**: There is no self-report to miss: the CLI neither warns about the section nor appends a skeleton to `handoff.md`.
**Migration**: A session without spend is recorded as `unreported` with exit 0 (requirement «Поле session.spendSource фіксує походження чисел»); gates never require the section (requirement «Persist і archive не падають лише через відсутні model або spend»).

## RENAMED Requirements

- FROM: `### Requirement: Джерело spend — прапорці, потім самозвіт, потім опційні адаптери`
- TO: `### Requirement: Джерело spend — прапорці, потім опційні адаптери`

## ADDED Requirements

### Requirement: Legacy `## Metrics` section in handoff.md is ignored

Persist and archive SHALL NOT read the `## Metrics` section of `handoff.md` for any session field (`model`, `platform`, tokens, `costUsd`, `ampCredits`, `spendSource`), and the CLI SHALL NOT write it. A `handoff.md` that still has the section (a 13-section file from an older kit) MUST parse as before: persist and archive exit 0, print no warning about it, and drop it when they rewrite the file.

#### Scenario: Legacy values are ignored

- **GIVEN** a `handoff.md` with all required sections and a `## Metrics` section with `platform: cursor`, `model: claude-opus-5`, `input_tokens: 128000`, `output_tokens: 9400`, `cost_usd: 1.25`, `spend_source: self-report`
- **AND** no spend flags, no `--model`, no `AOK_MODEL` and no adapter data
- **WHEN** persist runs
- **THEN** the exit code is 0 and stdout is the next-thread prompt
- **AND** the new session has `model: null`, `platform: null`, null token and cost fields and `spendSource: unreported`
- **AND** stderr does not mention `## Metrics`

#### Scenario: An invalid legacy platform is silent

- **GIVEN** a legacy `## Metrics` section with `platform: chatgpt`
- **WHEN** persist runs
- **THEN** the exit code is 0 and `sessions[0].platform` is `null`
- **AND** stderr does not mention `chatgpt` or `invalid platform`

#### Scenario: The rewritten handoff has no Metrics section

- **GIVEN** a `handoff.md` with a legacy `## Metrics` section
- **WHEN** persist runs
- **THEN** `handoff.md` contains no `## Metrics` heading
- **AND** it keeps its other sections and the `## Prompt` section

#### Scenario: Archive ignores a legacy section

- **GIVEN** the change's `handoff.md` has a legacy `## Metrics` section with `platform: amp`, `model: claude-fable-5` and `input_tokens: 4000`
- **WHEN** `archive <name>` runs without `--model`, `--platform` or spend flags
- **THEN** the `Archiver` session has `model: null` and `inputTokens: null`
- **AND** the archived `handoff.md` contains no `## Metrics` heading

### Requirement: Restore names only --platform when the client is unknown

When `handoff <name> --restore` cannot resolve the session client, the client label it prints SHALL be `unknown — pass --platform` and MUST NOT mention `## Metrics`.

#### Scenario: The restore hint has no Metrics reference

- **GIVEN** no `--platform`, no `AOK_PLATFORM` and no Amp, Cursor or Claude host signal
- **WHEN** `handoff <name> --restore` runs
- **THEN** stdout contains `unknown — pass --platform`
- **AND** stdout does not contain `fill ## Metrics`
