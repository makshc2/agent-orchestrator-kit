## Purpose

Визначає протокол передавання контексту між рольовими сесіями OpenSpec: відновлення контексту на старті, персистенцію Memory і handoff-файлу на виході, мову промпта наступної сесії, шаблон handoff-файлу, схему Memory-ентитетів, прапці в orchestrator.yaml та поведінку quick-режиму.

## Requirements

### Requirement: Restore context at session start

На початку кожної рольової сесії агент MUST відновити контекст **до** будь-якої роботи, у такому порядку: (1) виконати `/opsx:<phase>` з pasted промпта, якщо він є, (2) виконати `npx agent-orchestrator-kit handoff --restore` — CLI друкує briefing із memory.json/handoff.md, (3) якщо CLI недоступний або впав — прочитати `openspec/changes/<active>/handoff.md`, (4) заспавнити `session-handoff` у режимі restore ЛИШЕ якщо і CLI, і handoff.md недоступні. Окремий крок читання Memory MCP entities НЕ вимагається — CLI-briefing є канонічним. Відсутність Memory MCP MUST NOT блокувати сесію.

#### Scenario: CLI briefing достатній без субагента

- **WHEN** `npx agent-orchestrator-kit handoff --restore` завершився exit 0 і надрукував briefing
- **THEN** сесія продовжується без спавну `session-handoff` і без читання Memory MCP entities

#### Scenario: Free-form continue uses handoff file

- **WHEN** є рівно одна активна зміна з `handoff.md`, де `next_command` = `/opsx:apply <name>`
- **AND** користувач у новому чаті пише «продовжуй» або «далі» без paste
- **THEN** інструкції start-протоколу вимагають виконати `/opsx:apply <name>`, а не питати «яка фаза?»

### Requirement: Persist Memory and handoff on session exit

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку в батьківській сесії**: (1) записати `openspec/changes/<name>/handoff.md`, включно із заповненою секцією `## Metrics`, (2) виконати `npx agent-orchestrator-kit handoff <name>` з exit 0 (CLI upsert memory.json абсолютним шляхом, записує сесію в `metrics.json` і друкує розширений промпт у stdout), (3) вставити stdout CLI у чат як один fenced промпт. Спавн `session-handoff` у режимі persist дозволений ЛИШЕ як fallback, коли крок (2) повернув помилку. Оновлення Memory MCP entities — опційне дзеркало (одним викликом, якщо tools доступні); його відсутність MUST NOT блокувати закриття. Вимоги до змісту промпта не змінюються: перший рядок `/opsx:<command>`, самодостатній, без службового ярлика.

#### Scenario: Exit без субагента

- **WHEN** фаза завершена і `npx agent-orchestrator-kit handoff <name>` повернув exit 0
- **THEN** батьківська сесія вставляє stdout-промпт і закривається без спавну `session-handoff`

#### Scenario: Метрики заповнені до запуску CLI

- **WHEN** батьківська сесія готує Session Exit
- **THEN** протокол вимагає заповнити `## Metrics` у `handoff.md` до кроку (2)
- **AND** CLI не використовується як спосіб «додати метрики пізніше»

#### Scenario: Archive закриває пайплайн без next-prompt

- **WHEN** `npx agent-orchestrator-kit archive <name>` завершився exit 0
- **THEN** фінальний `handoff.md` записаний в архівній папці з `next_command: none`
- **AND** fenced next-prompt не вимагається
- **AND** stdout містить зводку по всьому change

### Requirement: Next-session prompt follows agent_language

Тіло промпта наступної сесії MUST бути мовою `project.agent_language` з `.agents/orchestrator.yaml`. Команди-ідентифікатори (`/opsx:review`, ключі Memory `Change:`, `Handoff:`, `Decision:`, шляхи файлів) SHALL лишатися як у протоколі (латиниця). Англійська мова тіла промпта не є вимогою якості і MUST NOT використовуватись, коли `agent_language` не `en`.

#### Scenario: Ukrainian project gets Ukrainian prompt body

- **WHEN** `.agents/orchestrator.yaml` має `project.agent_language: uk`
- **AND** агент виводить промпт наступної сесії
- **THEN** інструктивне тіло (починаю сесію, прочитай Memory, conductor) написане українською
- **AND** перший рядок лишається `/opsx:<command> <name>`

#### Scenario: English project keeps English body

- **WHEN** `project.agent_language` є `en` або відсутній
- **THEN** тіло промпта MAY бути англійською; команда `/opsx:` не змінюється

#### Scenario: Apply exit does not start archive in the same chat

- **WHEN** усі таски `[x]` і apply-сесія закривається
- **THEN** агент виводить prompt на наступну роль (verify/archive)
- **AND** інструкція забороняє запускати `/opsx:archive` у цій же сесії

### Requirement: Handoff file template

Kit SHALL постачати шаблон `handoff.md` (у skill/команді) з секціями: Closed role, Change, Done, Decisions, Blocked, Next command, Next role, Attach, Subagents to spawn, Constraints, Runtime, Metrics, і готовий текст промпта наступної сесії (без ярлика `NEXT_SESSION_PROMPT`). Секція Runtime SHALL містити поля `runtime` (`local` або `cloud`) і `agent_id`. Секція Metrics SHALL містити рядки `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits` і опційно `spend_source`; її заповнює агент на виході сесії, а CLI persist зберігає її як самозвіт і лише дописує відсутні рядки зі значенням `unknown`. CLI MUST NOT перезаписувати секцію резолвленими значеннями (прапорці, env, host env, `--collect`) — вони живуть у `metrics.json`.

Правила, які шаблон і канонічний протокол MUST фіксувати: `model` у `## Metrics` і `--model` SHALL бути LLM product id (наприклад `cursor-grok-4.6-xhigh-fast`, `claude-opus-5`), не Closed role і не ім'я субагента; family-ярлик (`cursor-grok-4.6`) MAY бути fallback, коли product id невідомий, але CLI все одно візьме product id з adapter sources, коли вони є. Агент MUST NOT ставити `spend_source: self-report`, коли числові поля `unknown` / порожні — тоді `spend_source` SHALL бути `unknown` або рядок відсутній. Closed role у `handoff.md` MAY містити речення після `—`; metrics зберігає лише канонічний токен (`Explorer|Architect|Spec Reviewer|Implementer|Archiver|Design Intake`).

Наявні файли без секцій Runtime або Metrics лишаються валідними — секція дописується наступним persist-ом без помилки. Файл SHALL жити в `openspec/changes/<name>/handoff.md` (не в gitignored cache). Він не є артефактом схеми OpenSpec. CLI `npx agent-orchestrator-kit handoff <name>` SHALL перезаписувати секцію Prompt розширеним самодостатнім текстом мовою `project.agent_language`.

#### Scenario: Init documents the template

- **WHEN** виконується init
- **THEN** `.agents/skills/agent-orchestration/SKILL.md` або always-apply rule містить секції шаблону `handoff.md` (включно з Runtime і Metrics) і приклад промпта, що починається з `/opsx:`

#### Scenario: Handoff file is inside the change

- **WHEN** сесія закриває фазу для зміни `<name>`
- **THEN** інструкція вимагає шлях `openspec/changes/<name>/handoff.md`, а не `.agents/cache/handoffs/`

#### Scenario: Persist записує секцію Runtime

- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** `handoff.md` містить секцію `## Runtime` з полями `runtime` і `agent_id`

#### Scenario: Файл без Runtime не блокує persist

- **GIVEN** наявний `handoff.md` містить усі обов'язкові секції, але не має `## Runtime`
- **WHEN** виконується persist
- **THEN** команда завершується з exit 0
- **AND** секція Runtime присутня у файлі після запису

#### Scenario: Файл без Metrics не блокує persist

- **GIVEN** наявний `handoff.md` містить усі обов'язкові секції, але не має `## Metrics`
- **WHEN** виконується persist
- **THEN** команда завершується з exit 0
- **AND** секція Metrics присутня у файлі після запису зі значеннями `unknown`

#### Scenario: Протокол забороняє self-report при unknown токенах

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** правило забороняє писати `spend_source: self-report`, коли `input_tokens` / `output_tokens` є `unknown`
- **AND** каже, що placeholder самозвіт не є spend override для leftover

### Requirement: Memory entity schema for handoff

Правило Memory MCP SHALL фіксувати схему: `Change:<name>` (status, tasks n/m, last_role, review), `Handoff:<name>` (next_role, next_command, session_count, summary, blocked), `Decision:<topic>` (chosen + reason). Старт сесії MUST читати ці ключі для активної зміни, коли MCP доступний.

#### Scenario: Memory rule lists Handoff fields

- **WHEN** проєкт має `.agents/rules/memory-mcp-autosetup.mdc` після init/update
- **THEN** правило перелічує поля `next_role`, `next_command`, `session_count` для `Handoff:<name>`

### Requirement: Orchestrator yaml handoff flags

Шаблон `templates/orchestrator.yaml` і всі профілі SHALL містити `handoff.restore_on_start`, `handoff.persist_on_exit`, `handoff.emit_next_session_prompt`, `handoff.prompt_self_contained`, `handoff.spawn_handoff_subagent` зі значенням `true`.

#### Scenario: Flags present after init

- **WHEN** виконується init з профілем `generic`, `vue3`, `node` або `mvp`
- **THEN** `.agents/orchestrator.yaml` містить `restore_on_start: true`, `persist_on_exit: true`, `emit_next_session_prompt: true`, `prompt_self_contained: true`, `spawn_handoff_subagent: true`

### Requirement: CLI persist is the durable Memory writer

Kit SHALL постачати команду `npx agent-orchestrator-kit handoff <name>`, яка валідує `handoff.md`, дописує рішення з `handoff.md ## Decisions` у append-only `openspec/changes/<name>/decisions.md`, upsert-ить entities у `.cursor/memory.json` за **абсолютним** шляхом і друкує розширений next-thread prompt у stdout мовою `project.agent_language`. Entities `Decision:*` SHALL будуватися з записів decisions.md (у порядку файлу, останній запис topic-а перемагає), а не з handoff.md; напрям синхронізації — лише файл → Memory, зворотний запис з Memory у файл MUST NOT виконуватись. Наявні `Decision:*` entities від інших changes MUST NOT мігруватися чи видалятися. Команда `handoff --restore` SHALL друкувати брифінг зі файлу та Memory JSON, а рішення — з `decisions.md` (за відсутності файлу — `none`), не з Memory. Команда `memory-setup` SHALL ставити Memory MCP на `scripts/memory-mcp-launcher.cjs`.

#### Scenario: Persist writes absolute Memory JSON and prompt

- **WHEN** існує `openspec/changes/<name>/handoff.md` з секціями Closed role, Done, Next command
- **AND** виконується `npx agent-orchestrator-kit handoff <name>`
- **THEN** `.cursor/memory.json` містить entity `Handoff:<name>`
- **AND** stdout починається з `/opsx:`
- **AND** stdout містить ім'я субагента або `subagent-`

#### Scenario: Decision-ентиті — дзеркало git-файлу

- **GIVEN** decisions.md містить записи `foo-topic: варіант A` (старіший) і `foo-topic: варіант B` (новіший)
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>`
- **THEN** `.cursor/memory.json` містить `Decision:foo-topic` з текстом `варіант B`
- **AND** видалення `.cursor/memory.json` не втрачає рішень — вони відновлюються з decisions.md наступним persist

#### Scenario: Restore друкує рішення з git-файлу

- **GIVEN** `openspec/changes/<name>/decisions.md` існує з записами
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --restore`
- **THEN** брифінг містить записи рішень з decisions.md
- **AND** вміст Memory JSON не є джерелом надрукованих рішень

#### Scenario: Restore без decisions.md

- **GIVEN** зміна має handoff.md, але не має decisions.md
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --restore`
- **THEN** брифінг позначає рішення як `none` і завершується з exit 0

#### Scenario: Relative Memory path is rewritten

- **WHEN** `.mcp.json` має `MEMORY_FILE_PATH: ".cursor/memory.json"`
- **AND** виконується `npx agent-orchestrator-kit memory-setup`
- **THEN** Memory server запускається через `scripts/memory-mcp-launcher.cjs` без відносного `MEMORY_FILE_PATH`

### Requirement: Quick mode emits a single exit prompt

У профілі mvp (`/opsx:quick`) агент MUST NOT емітити mid-session промпт наступної сесії між propose і apply. На виході quick-сесії він MUST записати `handoff.md` і вивести один промпт на verify/archive.

#### Scenario: Quick does not ask to paste between propose and apply

- **WHEN** виконується `/opsx:quick <name>`
- **THEN** інструкція quick забороняє mid-session prompt між створенням артефактів і імплементацією
- **AND** вимагає один промпт наступної сесії наприкінці сесії (без ярлика `NEXT_SESSION_PROMPT`)

### Requirement: Спільні Session Start/Exit блоки живуть в одному rule

Канонічний текст протоколів Session Start і Session Exit SHALL існувати лише в `templates/.agents/rules/session-handoff.mdc` (`alwaysApply: true`). Команди `templates/.agents/commands/opsx-*.md` MUST посилатися на протокол одним-двома рядками і MUST NOT дублювати його текст.

#### Scenario: Команди без дубльованих блоків

- **WHEN** після `init`/`update` читаються файли `.agents/commands/opsx-*.md`
- **THEN** жоден не містить повного тексту start/exit протоколу, лише посилання на `.agents/rules/session-handoff.mdc`

### Requirement: Рішення change-у накопичуються в git-tracked decisions.md

Канонічним місцем рішень change-у SHALL бути git-tracked файл `openspec/changes/<name>/decisions.md`. CLI `npx agent-orchestrator-kit handoff <name>` SHALL дописувати в нього записи з `handoff.md ## Decisions` у форматі `- <YYYY-MM-DD> <текст рішення>`. Файл MUST бути append-only: наявні записи MUST NOT переписуватися чи видалятися CLI. Запис MUST додаватися лише якщо його нормалізований текст (без date-префікса, з згорнутими пробілами) відсутній серед наявних записів; той самий topic з новим текстом SHALL додаватися новим рядком зі збереженням старого. При `Decisions: none` файл MUST NOT створюватися. `design.md ## Decisions` лишається окремим шаром design-time рішень архітектора і MUST NOT синхронізуватися з decisions.md. `gate-check` і pre-commit hook MUST NOT перевіряти наявність або вміст decisions.md.

#### Scenario: Рішення з handoff.md потрапляє в git-файл

- **WHEN** `handoff.md ## Decisions` містить рішення `foo-topic: chosen X because Y`
- **AND** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** `openspec/changes/<name>/decisions.md` містить датований запис з текстом `foo-topic: chosen X because Y`
- **AND** файл знаходиться у git-tracked шляху change-у, а не в gitignored каталозі

#### Scenario: Повторний persist не дублює записи

- **GIVEN** decisions.md уже містить запис із рішенням поточної сесії
- **WHEN** `npx agent-orchestrator-kit handoff <name>` виконується вдруге з тим самим handoff.md
- **THEN** decisions.md містить рівно один запис цього рішення

#### Scenario: Нова редакція topic-а зберігає історію

- **GIVEN** decisions.md містить запис `foo-topic: варіант A`
- **WHEN** persist виконується з рішенням `foo-topic: варіант B` у handoff.md
- **THEN** decisions.md містить обидва записи — старий не видалений і не змінений

#### Scenario: Archive переносить історію рішень безкоштовно

- **WHEN** виконується `npx agent-orchestrator-kit archive <name>`
- **THEN** decisions.md знаходиться в архівній папці change-у разом з рештою артефактів
- **AND** окремого коду перенесення рішень не потрібно

#### Scenario: Відсутність decisions.md не блокує гейти

- **GIVEN** активна зміна без decisions.md
- **WHEN** виконується `gate-check` або pre-commit hook
- **THEN** відсутність файлу не є помилкою і не впливає на exit code

### Requirement: Session Exit вимагає самозвіт метрик у `## Metrics`

Канонічний протокол Session Exit SHALL вимагати від батьківської сесії заповнити секцію `## Metrics` у `openspec/changes/<name>/handoff.md` **до** запуску `npx agent-orchestrator-kit handoff <name>`. Секція SHALL містити рядки `platform` (`cursor` | `claude` | `amp`), `model` (LLM product id цього чату), `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits` і опційно `spend_source`.

Правила заповнення, які текст протоколу MUST фіксувати: агент бере числа з того, що бачить сам; невідоме поле MUST записуватись як `unknown`, а не як `0` і не як вигадане число; `model` MUST бути LLM product id (`claude-opus-5`, `claude-fable-5`, `gpt-5.6-sol`, `cursor-grok-4.6-xhigh-fast`, `accounts/fireworks/models/glm-5p2`) і MUST NOT бути Closed role чи ім'ям субагента; family `cursor-grok-4.6` без суфікса tier/speed SHALL використовуватись лише коли точніший product id невідомий; `amp_credits` MUST лишатись окремо від `cost_usd`; `spend_source: self-report` MUST ставитись лише коли є хоч одне відоме число; при всіх `unknown` агент MUST NOT маркувати секцію як self-report — CLI тоді бере adapter leftover. Протокол MUST NOT казати, що самозвіт з `unknown` є первинним джерелом spend.

Той самий протокол і той самий виклик CLI SHALL діяти в Cursor, Claude Code і Amp; жоден MUST NOT вимагати Cursor SDK, парсер Claude `/cost` або Amp billing API як обов'язковий крок. Канонічний текст живе в `templates/.agents/rules/session-handoff.mdc` і дзеркалиться в skill `agent-orchestration`, субагенті `session-handoff` і субагенті `spec-archiver`. Відсутність секції MUST NOT блокувати persist — CLI попереджає і пише сесію як `unreported`.

#### Scenario: Правило описує секцію і порядок кроків

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** Session Exit містить крок «заповнити `## Metrics`» перед кроком запуску `handoff <name>`
- **AND** перелічує ключі `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`

#### Scenario: Протокол забороняє вигадані числа і нулі

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** правило вимагає `unknown` для невідомих полів
- **AND** забороняє підставляти `0` або вгадане значення

#### Scenario: Протокол віддає перевагу product id над family

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** приклад `--model` / `model` містить product id, не лише family `cursor-grok-4.6`
- **AND** правило каже, що adapter sources перемагають family, коли hook дав точніший id

#### Scenario: Той самий самозвіт у трьох IDE

- **WHEN** після `init`/`update` читаються `session-handoff.mdc`, skill `agent-orchestration` і субагент `session-handoff`
- **THEN** усі три тексти описують ту саму секцію `## Metrics` і той самий виклик `npx agent-orchestrator-kit handoff <name>`
- **AND** жоден не вимагає Cursor SDK, парсер Claude `/cost` або Amp billing API

#### Scenario: Archiver самозвітує так само

- **WHEN** після `init`/`update` читається субагент `spec-archiver` або команда `/opsx:archive`
- **THEN** текст вимагає заповнити `## Metrics` перед `npx agent-orchestrator-kit archive <name>`
- **AND** описує фінальну зводку archive як завершення пайплайна

