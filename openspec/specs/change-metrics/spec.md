## Purpose

change-metrics — requirements merged from change fix-metrics-model-and-spend.

## Requirements

### Requirement: Файл metrics.json є git-tracked журналом change-у

Kit SHALL писати `openspec/changes/<name>/metrics.json` (після archive — у `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json`) зі схемою версії `1`: `version`, `change`, `createdAt`, `updatedAt`, `archivedAt` (`null` до фіналізації), `spend` (`inputTokens`, `outputTokens`, `totalTokens`, `costUsd`), `spendByPlatform` (ключі `cursor`, `claude`, `amp` → `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `ampCredits`, `source`), `spendByModel` (масив `{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, ampCredits }`), `totals` (`sessions`, `durationMs`, `leadTimeMs`, `cloudSessions`), `phases` (ключ фази → `sessions`, `durationMs`, spend-поля, `agents`, `models`), `sessions` (масив записів), `pending` (`{ startedAt, role }` або `null`). Запис сесії SHALL містити `sources` (масив `{ id, platform, model, inputTokens, outputTokens, totalTokens, costUsd, ampCredits, at }`) і опційно `models` (масив id), коли моделей більше однієї. Файл MUST бути git-tracked (не в gitignored cache). Пошкоджений або відсутній JSON SHALL замінюватись default-об'єктом з тими самими ключами, без падіння CLI. Відсутні нові поля в legacy-файлі SHALL мержитись з default (`spendByPlatform` з трьома ключами і `null`-полями, `spendByModel: []`, `sources: []`).

#### Scenario: Restore створює валідний скелет

- **GIVEN** активна зміна без `metrics.json`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --restore` без `--no-metrics`
- **THEN** файл `openspec/changes/<name>/metrics.json` існує
- **AND** містить `version: 1`, `change: <name>`, `sessions: []`, `pending` з `startedAt`, `archivedAt: null`
- **AND** містить ключі `spendByPlatform` і `spendByModel`

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

### Requirement: Restore записує старт сесії, persist — її закриття

`handoff --restore` SHALL записувати `pending` (`startedAt` = зараз, `role` з next role handoff-файлу, якщо він є). `handoff <name>` SHALL додавати елемент у `sessions` з: `startedAt` з `--started-at` або `pending.startedAt` або `null`; `endedAt` = зараз; `durationMs` = різниця або `null`; `role` = Closed role; `phase` = результат `phaseForRole` (`Explorer`→`explore`, `Architect`→`spec`, `Implementer`/`apply`→`apply`, review→`review`, design→`design`, Archiver→`archive`, інакше `other`); `runtime` і `agentId` з runtime-ланцюжка; `tasks` зі знімка progress; `model` з D10/D2; spend з D3′; `platform` з D5; `sources` з collect (або `[]` при `--no-collect` / порожньому collect). Після запису `pending` MUST стати `null`. Агрегати (`phases`, `totals`, `spend`, `spendByPlatform`, `spendByModel`) SHALL перераховуватись на кожному записі. Якщо metrics увімкнено і немає `--no-collect`, persist MUST викликати collect (D9/D11) до запису сесії.

#### Scenario: Restore + persist закриває одну сесію

- **GIVEN** `handoff.md` з Closed role `Architect` і next role `spec-reviewer`
- **AND** адаптери не знаходять usage (tmp без фікстур)
- **WHEN** виконується `handoff <name> --restore`, потім `handoff <name> --model claude-opus-5 --input-tokens 12000 --output-tokens 3000 --cost-usd 0.42`
- **THEN** `pending` є `null`
- **AND** `sessions` має один запис з `role: Architect`, `phase: spec`, `model: claude-opus-5`, `totalTokens: 15000`, `costUsd: 0.42`
- **AND** `phases.spec.agents` містить `Architect`
- **AND** `phases.spec.models` містить `claude-opus-5`

#### Scenario: Persist без restore лишає duration null

- **GIVEN** немає `pending` і немає `--started-at`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].durationMs` є `null`
- **AND** команда завершується з exit 0

### Requirement: Модель сесії — LLM product id з sources, flag або env, інакше null

`session.model` і `phases.*.models` MUST зберігати ідентифікатор LLM-продукту, не Closed role і не ім'я субагента. Якщо сесія має непорожній `sources`, `session.model` SHALL бути primary: модель з найбільшим `totalTokens` серед sources цієї сесії (при рівності — стабільний порядок platform, потім id); `session.models` SHALL містити унікальні id, коли моделей більше однієї. Якщо `sources` порожній, резолв SHALL: непорожній `--model` → непорожній env `AOK_MODEL` → `null`. Рядок зберігається як передано або як у usage-записі (без вигаданої таксономії). Порожній `--model` трактується як відсутнє значення. Відсутня модель MUST NOT робити persist або archive non-zero. Якщо сесія записується з `model: null`, CLI SHALL попередити в stderr (підказка `--model` / `AOK_MODEL`). CLI MUST NOT викликати Cursor SDK, Claude `/cost` чи Amp billing API, щоб дізнатись модель.

#### Scenario: Прапорець --model перемагає env коли sources порожні

- **GIVEN** `AOK_MODEL=claude-fable-5` і collect не дав sources
- **WHEN** виконується persist з `--model cursor-grok-4.6`
- **THEN** `session.model` дорівнює `cursor-grok-4.6`

#### Scenario: Env AOK_MODEL без прапорця

- **GIVEN** `AOK_MODEL=gpt-5.6-sol` і немає `--model` і немає sources
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` дорівнює `gpt-5.6-sol`

#### Scenario: Відсутня модель — null, warning, exit 0

- **GIVEN** немає `--model`, немає `AOK_MODEL` і collect не дав sources
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `session.model` є `null`
- **AND** stderr містить попередження про відсутню модель
- **AND** exit code 0

#### Scenario: Primary model з sources, не з --model

- **GIVEN** collect повернув два sources: `claude-opus-4-7` з `totalTokens: 9000` і `gpt-5.6-sol` з `totalTokens: 1000`
- **AND** persist викликано з `--model cursor-grok-4.6`
- **WHEN** сесія записується
- **THEN** `session.model` дорівнює `claude-opus-4-7`
- **AND** `session.models` містить обидва id з sources

### Requirement: Spend збирається адаптерами; прапорці override лише totals; null-honest

На persist (metrics увімкнено, немає `--no-collect`) і на archive finalize CLI MUST запускати collect з `bin/spend-collect.js`. Поля сесії `inputTokens`, `outputTokens`, `totalTokens`, `costUsd` SHALL братися з зібраних `sources` (сума токенів; `costUsd` — лише рядки з не-null USD; `ampCredits` не входять у `costUsd`). Явні `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` OVERRIDE лише ці session-level totals; вони MUST NOT витирати `session.sources`, `spendByPlatform` і `spendByModel`. Якщо `--total-tokens` немає, а override input або output передано — `totalTokens` сесії SHALL дорівнювати сумі наявних override. Відсутнє число MUST лишатись `null`, ніколи штучним `0`. Агрегати SHALL додавати лише значення, які є (null-honest): якщо всі сесії мають `null` у полі — агрегат цього поля є `null`. Persist і archive MUST NOT завершуватись non-zero через відсутній spend або порожній collect. CLI MUST NOT вигадувати USD з Amp credits і MUST NOT оцінювати токени з `text.length`.

#### Scenario: Без прапорців і без даних адаптера агрегати null

- **WHEN** виконується persist без spend-прапорців, без `--no-metrics` і без фікстур адаптерів
- **THEN** `sessions[0].totalTokens` є `null`
- **AND** `spend.totalTokens` є `null`
- **AND** `spend.costUsd` є `null`
- **AND** exit code 0

#### Scenario: Total override за замовчуванням = input + output

- **WHEN** persist викликано з `--input-tokens 1000 --output-tokens 200` без `--total-tokens`
- **THEN** `sessions[0].totalTokens` дорівнює `1200`

#### Scenario: Прапорці не витирають spendByPlatform

- **GIVEN** collect заповнив `spendByPlatform.claude.inputTokens` значенням `5000` і `session.sources` з id `msg-1`
- **WHEN** persist викликано з `--input-tokens 1 --output-tokens 1 --cost-usd 9.99`
- **THEN** `sessions[0].inputTokens` дорівнює `1`
- **AND** `sessions[0].costUsd` дорівнює `9.99`
- **AND** `spendByPlatform.claude.inputTokens` лишається `5000`
- **AND** `sessions[0].sources` містить id `msg-1`

#### Scenario: Порожній collect не валить persist

- **WHEN** усі три адаптери повертають порожні sources
- **THEN** persist завершується з exit 0
- **AND** сесія записана з `sources: []`

### Requirement: Три read-only адаптери без мережі і без нових npm-залежностей

Collect MUST викликати всі три адаптери в одному проході. Модуль SHALL жити в `bin/spend-collect.js` і бути імпортованим з `bin/agent-orchestrator.js`. Адаптери MUST бути read-only і offline: без API-ключів, без HTTP, без Cursor SDK, без Amp billing API, без парсера Claude `/cost` як залежності. Нових npm-залежностей (`better-sqlite3`, `sql.js`, `ccusage`) MUST NOT з'являтись. Тести MUST підміняти `HOME` / `AMP_DATA_DIR` / `XDG_CONFIG_HOME` на tmp і MUST NOT читати реальний `~/.claude` розробника в CI.

Адаптер **claude** SHALL читати `~/.claude/projects/<cwd-encoded>/*.jsonl`, де cwd-encoded будується з аргумента `collectSpend({ cwd })` (якщо `cwd` опущено — `process.cwd()`) заміною кожного `/` і кожного `.` на `-`. Парсити assistant-рядки з `message.usage` і `message.model`, рахувати `cache_*` у `inputTokens`, якщо поля є, брати `costUsd` лише з `total_cost_usd` (або аналога) на записі, інакше `null`, фільтрувати вікно за полем рядка `timestamp`, фільтрувати проєкт за полем рядка `cwd` === цей `cwd`, і ставити `source: "claude-jsonl"`. Pricing table MUST NOT постачатись.

Адаптер **amp** SHALL читати `~/.local/share/amp/threads/*.json` з override `AMP_DATA_DIR` або `$XDG_DATA_HOME/amp`. Проєктний match: порівняти `collectSpend` `cwd` (або `process.cwd()`, якщо аргумент опущено) з кожним `env.initial.trees[].uri` після зняття префікса `file://` (`file:///home/...` → `/home/...`); якщо хоча б одне дерево збігається — включити thread; якщо `env.initial.trees` відсутній або порожній — пропустити thread. MUST NOT читати і MUST NOT вигадувати `cwd` / `meta.cwd`. `inputTokens` SHALL бути `usage.totalInputTokens`, якщо поле є, інакше `usage.inputTokens` плюс `cacheCreationInputTokens` і `cacheReadInputTokens`, якщо вони є. Також брати `usage.model` / `usage.outputTokens` / `usage.timestamp`. Оскільки `messageId` є thread-локальним лічильником, `source.id` MUST бути `<thread.id || basename файла>:<messageId|toMessageId>` — голий `messageId` колізує між threads. `ledger.jsonl` MAY бути відсутнім; без іменованої форми запису адаптер MUST NOT вимагати реальних `ampCredits` (відсутній ledger → `ampCredits: null`). Зберігати токени і `ampCredits` окремо, ставити `source: "amp-thread"` і MUST NOT конвертувати credits у USD.

Адаптер **cursor** SHALL НЕ брати usage з `agent-transcripts/*.jsonl` і MUST NOT читати `state.vscdb`, cookies чи server CSV (локальні бази Cursor не містять token usage). Він SHALL читати `<cwd>/.agents/spend/cursor-usage.jsonl` — файл, який пише hook `scripts/cursor-spend-hook.cjs` з payload подій `stop` / `subagentStop` (див. Requirement про обов'язковий spend hook). Кожен рядок: `{ id, event, conversationId, model, modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, at }`, де `inputTokens` уже включає cache-токени за семантикою Cursor. Фільтр вікна — за полем `at`; dedup — за `id` (`generation_id`); якщо той самий `id` зустрічається кілька разів (loop follow-ups пишуть кумулятивні числа turn), адаптер SHALL взяти запис з найбільшим `totalTokens`. Рядки без жодного token-поля MUST пропускатись. Якщо файла немає — порожньо + note. `source: "cursor-hook"`. MUST NOT оцінювати з `text.length`.

#### Scenario: Claude jsonl фікстура заповнює platform claude

- **GIVEN** tmp `HOME` з `~/.claude/projects/<cwd-encoded>/session.jsonl`, де cwd-encoded замінює `/` і `.` у переданому `cwd` на `-`, а assistant-рядок має `message.id`, `message.model: "claude-opus-4-7"`, `message.usage.input_tokens`, `output_tokens`, поле `cwd` рівне цьому `cwd` і поле `timestamp` у вікні
- **WHEN** виконується persist без `--no-collect`
- **THEN** `spendByPlatform.claude.source` дорівнює `claude-jsonl`
- **AND** `sessions[0].sources` містить цей `message.id` з `platform: "claude"`
- **AND** `costUsd` є числом лише якщо запис мав `total_cost_usd`, інакше `null`

#### Scenario: Amp thread фікстура зберігає credits окремо від USD

- **GIVEN** tmp `AMP_DATA_DIR` з thread JSON, де assistant usage має `model`, `inputTokens`, `outputTokens`, `timestamp` у вікні, і `env.initial.trees` містить `uri` з `file://` + cwd collect
- **AND** `ledger.jsonl` відсутній
- **WHEN** виконується persist без `--no-collect`
- **THEN** `spendByPlatform.amp.source` дорівнює `amp-thread`
- **AND** `spendByPlatform.amp.ampCredits` є `null` і не записується як `costUsd`
- **AND** `spend.costUsd` не включає Amp credits

#### Scenario: Amp thread без trees пропускається

- **GIVEN** tmp `AMP_DATA_DIR` з thread JSON без `env.initial.trees` (і без вигаданого `meta.cwd`)
- **WHEN** виконується persist без `--no-collect`
- **THEN** цей thread відсутній у `sessions[0].sources`

#### Scenario: Cursor без hook-файла повертає порожньо

- **GIVEN** у `<cwd>/.agents/spend/` немає `cursor-usage.jsonl`
- **WHEN** виконується persist без `--no-collect`
- **THEN** `spendByPlatform.cursor` має null-honest токени/вартість
- **AND** `source` є `none`
- **AND** persist exit 0
- **AND** токени не оцінені з довжини тексту

#### Scenario: Cursor hook-файл заповнює platform cursor

- **GIVEN** `<cwd>/.agents/spend/cursor-usage.jsonl` з записом `{ id: "g-1", model, inputTokens, outputTokens, at }` у вікні
- **WHEN** виконується persist без `--no-collect`
- **THEN** `spendByPlatform.cursor.source` дорівнює `cursor-hook`
- **AND** `sessions[0].sources` містить `g-1` з `platform: "cursor"`
- **AND** повторні записи того самого `id` злиті в один з найбільшим `totalTokens`

### Requirement: Вікно collect, cwd-match і dedup

Вікно SHALL бути `[pending.startedAt || last session.endedAt || metrics.createdAt, endedAt]`. Подія MUST входити лише якщо її timestamp у вікні: Claude — поле рядка `timestamp`; Amp — `usage.timestamp`; Cursor — поле `at` hook-запису. Проєктний match порівнює з аргументом `collectSpend({ cwd })` (якщо опущено — `process.cwd()`). Claude: поле рядка `cwd` === цей шлях; без поля `cwd` подію MUST NOT включати. Amp: thread входить, якщо хоча б один `env.initial.trees[].uri` після strip `file://` дорівнює цьому шляху; немає trees — пропустити thread; MUST NOT вигадувати `meta.cwd`. Cursor: файл `<cwd>/.agents/spend/cursor-usage.jsonl` уже проєктно-локальний — додатковий match не потрібен. Dedup: пропустити `source.id`, яке вже є в будь-якому `session.sources` поточного `metrics.json` (claude `message.id`, amp `<threadKey>:<messageId|toMessageId>`, cursor `generation_id`).

#### Scenario: Подія поза вікном не потрапляє в сесію

- **GIVEN** `pending.startedAt` пізніший за timestamp usage-події в фікстурі
- **WHEN** виконується persist без `--no-collect`
- **THEN** ця подія відсутня в `sessions[0].sources`

#### Scenario: Повторний persist не дублює source.id

- **GIVEN** `metrics.json` уже містить `sessions[0].sources` з id `msg-1`
- **WHEN** наступний persist collect знову бачить ту саму подію
- **THEN** новий запис сесії не містить повторного `msg-1`

#### Scenario: Чужа cwd відкидається

- **GIVEN** claude jsonl рядок з `cwd`, що не дорівнює аргументу `collectSpend({ cwd })`
- **WHEN** виконується persist без `--no-collect`
- **THEN** ця подія відсутня в `sources`

### Requirement: Обов'язковий Cursor spend hook у кожному kit-проєкті

Кожен проєкт з кітом MUST мати робочий Cursor spend capture без ручних дій користувача. Kit SHALL постачати `templates/scripts/cursor-spend-hook.cjs`: hook читає stdin payload подій `stop` / `subagentStop`, і якщо payload містить хоча б одне з `input_tokens` / `output_tokens` — дописує запис у `<project>/.agents/spend/cursor-usage.jsonl`; без token-полів запис MUST NOT створюватись (ніяких нулів). Hook MUST бути fail-open: будь-яка помилка (битий JSON, відсутній каталог) завершується exit 0 без stdout, щоб ніколи не блокувати agent loop.

CLI SHALL мати `ensureCursorSpendHook(projectDir)`: копіює скрипт у `scripts/cursor-spend-hook.cjs` і merge-ить `.cursor/hooks.json` (events `stop` і `subagentStop`, command `node scripts/cursor-spend-hook.cjs`), не видаляючи чужі hooks; битий `hooks.json` MUST NOT перезаписуватись — лише warning. Ensure MUST викликатись у `init`, `update`, `sync`, `mcp-setup` і self-heal у `handoff --restore` та `handoff <name>` persist (persist друкує статус лише в stderr, щоб не зіпсувати prompt у stdout). `.agents/spend/` MUST бути в GITIGNORE_LINES. `status` SHALL друкувати секцію `Spend capture` зі станом cursor hook (скрипт + entry + кількість записів), наявністю локальних даних Claude і Amp.

#### Scenario: Persist self-heal ставить hook

- **GIVEN** проєкт з кітом без `scripts/cursor-spend-hook.cjs` і без entry у `.cursor/hooks.json`
- **WHEN** виконується `handoff <name>` persist
- **THEN** скрипт скопійовано, `.cursor/hooks.json` містить entries для `stop` і `subagentStop`
- **AND** stdout містить лише next-thread prompt (статус hook — у stderr)

#### Scenario: Hook не пише запис без token-полів

- **GIVEN** stop payload без `input_tokens` і `output_tokens`
- **WHEN** hook виконується
- **THEN** `cursor-usage.jsonl` не отримує нового рядка
- **AND** exit code 0

#### Scenario: Merge не чіпає чужі hooks

- **GIVEN** `.cursor/hooks.json` з користувацьким hook на `afterFileEdit`
- **WHEN** виконується ensure
- **THEN** користувацький hook лишається
- **AND** додано лише entries `cursor-spend-hook.cjs`

### Requirement: Прапорець --no-collect пропускає адаптери

`--no-collect` на `handoff <name>` і на `archive` MUST пропускати адаптери, але MUST все одно записати сесію (persist) або фіналізувати файл (archive). Session-level spend тоді лише з прапорців або `null`. `--no-metrics` MUST як і раніше не створювати сесію і MUST NOT запускати collect.

#### Scenario: Persist --no-collect пише сесію без sources з адаптера

- **GIVEN** tmp фікстура Claude JSONL з валідною подією у вікні
- **WHEN** виконується persist з `--no-collect` без spend-прапорців
- **THEN** сесія існує
- **AND** `sessions[0].sources` є `[]`
- **AND** `sessions[0].totalTokens` є `null`
- **AND** exit code 0

### Requirement: Опційна платформа сесії — flag/env/null

`session.platform` SHALL бути `cursor`, `claude`, `amp` або `null`. Резолв: `--platform` → env `AOK_PLATFORM` → `null`. Невалідний `--platform` (не з трьох значень) MUST завершувати persist/archive з non-zero. Невалідний непорожній `AOK_PLATFORM` SHALL давати `null` і warning, не fail. CLI MUST NOT виставляти `platform` з `CURSOR_AGENT` або інших best-effort маркерів середовища.

#### Scenario: --platform записує cursor

- **WHEN** виконується persist з `--platform cursor`
- **THEN** `sessions[0].platform` дорівнює `cursor`
- **AND** exit code 0

#### Scenario: Невалідний --platform падає

- **WHEN** виконується persist з `--platform foo`
- **THEN** exit code ≠ 0
- **AND** сесія не дописується як успішний persist-запис із `platform: foo`

#### Scenario: CURSOR_AGENT не є платформою

- **GIVEN** `CURSOR_AGENT=1` і немає `--platform` / `AOK_PLATFORM`
- **WHEN** виконується persist без `--no-metrics`
- **THEN** `sessions[0].platform` є `null`
- **AND** exit code 0

### Requirement: Агрегати перераховуються на кожному записі

Кожен виклик, що зберігає `metrics.json` (persist, archive finalize), SHALL перераховувати `phases`, `totals`, `spend`, `spendByPlatform` і `spendByModel` з масиву `sessions` і їхніх `sources`. `totals.durationMs` — сума `session.durationMs` (null-honest). `totals.leadTimeMs` — різниця між найранішим `startedAt` і найпізнішим `endedAt`, або `null`. `totals.cloudSessions` — кількість сесій з `runtime: cloud`. `phases.<phase>.agents` — унікальні Closed role; `phases.<phase>.models` — унікальні непорожні `session.model` і `session.models`. `spend.costUsd` SHALL підсумовувати лише USD (не Amp credits): для кожної сесії взяти `session.costUsd`, якщо воно не `null`, інакше суму не-null `source.costUsd` цієї сесії (не додавати source USD поверх уже заповненого session.costUsd). `spendByPlatform` і `spendByModel` SHALL перераховуватись з `session.sources`. `spendByPlatform.*.ampCredits` SHALL лишатись окремим полем.

#### Scenario: Дві сесії однієї фази агрегуються

- **GIVEN** уже є сесія `phase: spec`, `model: claude-fable-5`, `role: Architect`
- **WHEN** persist додає другу сесію `phase: spec`, `model: claude-opus-5`, `role: Architect`
- **THEN** `phases.spec.sessions` дорівнює `2`
- **AND** `phases.spec.agents` дорівнює `["Architect"]`
- **AND** `phases.spec.models` містить обидва id моделей

#### Scenario: Без spend-прапорців totals сесії з sources

- **GIVEN** collect повернув один claude source з `inputTokens: 10`, `outputTokens: 5`, `totalTokens: 15`, `costUsd: null`
- **AND** persist викликано без `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`
- **WHEN** сесія записується
- **THEN** `sessions[0].totalTokens` дорівнює `15`
- **AND** `sessions[0].costUsd` є `null`
- **AND** `spend.costUsd` є `null`

### Requirement: Команда metrics показує ролі, моделі, платформи окремо

CLI SHALL надавати `npx agent-orchestrator-kit metrics [name] [--json]`. Без `--json` людський вивід MUST містити підсумок (`sessions`, work time, lead time, tokens, cost) і таблицю фаз з колонками `roles` (Closed role з `phases.*.agents`) і `models` (LLM id з `phases.*.models`). Колонка `models` MUST NOT друкувати Closed role замість моделей. Вивід MUST містити таблицю **by platform** (cursor / claude / amp з токенами, `costUsd`, `ampCredits`, `source`) і таблицю **by model** (`model`, `platform`, токени, `costUsd`, `ampCredits`). MUST NOT друкувати єдиний «total $», що додає Amp credits до Claude/Cursor USD. Рядок підсумку `cost` SHALL відображати лише `spend.costUsd`. `--json` SHALL друкувати сирий об'єкт файлу в stdout. Команда SHALL знаходити файл активної зміни або найновіший `openspec/changes/archive/*-<name>/metrics.json`. Відсутній файл — non-zero з повідомленням `No metrics.json`.

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

Прапорець `--no-metrics` на `handoff --restore` MUST NOT створювати й MUST NOT оновлювати `pending`. На `handoff <name>` MUST NOT додавати сесію і MUST NOT запускати collect. Команда `archive` MUST все одно фіналізувати `metrics.json` (D4) і запускати collect, якщо немає `--no-collect`. `--no-metrics` MUST NOT змінювати exit code persist.

#### Scenario: Persist --no-metrics не створює файл

- **GIVEN** зміна без `metrics.json`
- **WHEN** виконується `handoff <name> --no-metrics`
- **THEN** `metrics.json` не існує
- **AND** persist завершується з exit 0

#### Scenario: Restore --no-metrics не ставить pending

- **GIVEN** зміна без `metrics.json`
- **WHEN** виконується `handoff <name> --restore --no-metrics`
- **THEN** `metrics.json` не створюється

### Requirement: Archive завжди фіналізує metrics.json після успішного move

Після успішного переміщення change команда `archive <name>` MUST створити `metrics.json` у архівній папці, якщо файлу не було, виставити `archivedAt`, очистити `pending`, перерахувати агрегати, додати сесію `role: Archiver`, `phase: archive`, `durationMs: null`, `model`/`platform` з ланцюжків D2/D5/D10 і запустити collect для вікна Archiver (`last session.endedAt || createdAt` → зараз), якщо немає `--no-collect`. Невалідний `--platform` MUST відхилятись до move. Якщо після finalize `spend.costUsd` є `null` — warning у stderr через `console.error` (Amp credits і заповнені токени не скасовують warning; не перевіряти `sessions.length === 0` і не перевіряти всі `METRICS_SPEND_KEYS`). Exit code MUST NOT змінюватись через відсутній файл, порожній spend, порожній collect або `null` модель.

#### Scenario: Archive без файлу створює metrics.json з Archiver

- **GIVEN** change без `metrics.json` проходить гейті archive
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** архівний `metrics.json` існує з непорожнім `archivedAt` і `pending: null`
- **AND** `sessions` містить запис `Archiver` / `archive`

#### Scenario: Порожній spend на archive — warning і exit 0

- **GIVEN** фіналізований `spend.costUsd` є `null`
- **WHEN** archive успішно фіналізує metrics
- **THEN** stderr містить попередження
- **AND** exit code 0

### Requirement: Persist і archive не падають лише через відсутні model або spend

Відсутні `model`, `platform` (крім невалідного `--platform`), spend-поля і порожній collect MUST NOT бути єдиною причиною ненульового exit persist або archive. `gate-check` і pre-commit hook MUST NOT вимагати наявність або вміст `metrics.json`.

#### Scenario: Persist без model і spend успішний

- **WHEN** виконується валідний persist без `--model`, без `AOK_MODEL` і без spend-прапорців у середовищі без фікстур адаптерів
- **THEN** exit code 0
- **AND** сесія записана з `model: null` і null spend

#### Scenario: Відсутність metrics.json не валить gate-check

- **GIVEN** активна зміна без `metrics.json`
- **WHEN** виконується `npx agent-orchestrator-kit gate-check` (або pre-commit hook)
- **THEN** відсутність файлу не є помилкою і не змінює exit code
