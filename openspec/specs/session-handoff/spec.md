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

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку в батьківській сесії**: (1) записати `openspec/changes/<name>/handoff.md`, включно із заповненою секцією `## Metrics`, (2) виконати `npx agent-orchestrator-kit handoff <name>` з exit 0 (CLI upsert memory.json абсолютним шляхом, записує сесію в `metrics.json` і друкує розширений промпт у stdout), (3) вставити stdout CLI у чат як один fenced промпт. Спавн `session-handoff` у режимі persist дозволений ЛИШЕ як fallback, коли крок (2) повернув помилку. Оновлення Memory MCP entities — опційне дзеркало (одним викликом, якщо tools доступні); його відсутність MUST NOT блокувати закриття. Вимоги до змісту промпта не змінюються: перший рядок `/opsx:<command>`, самодостатній, без службового ярлика; єдиний виняток — зелений apply, коли замість промпту CLI друкує один рядок `npx agent-orchestrator-kit archive <name> --sync` (вимога «Зелений apply друкує команду archive замість промпту»).

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

Ім'я субагента фази у промпті (`Наступна роль / субагент фази`, `subagent-<name>`, `.cursor/agents/<name>.md`) SHALL братися лише з backtick-токена у `## Subagents to spawn` / `## Next role` або з карти канонічна роль → субагент (`Explorer`→`explorer`, `Architect`→`spec-architect`, `Spec Reviewer`→`spec-reviewer`, `Implementer`→порожньо, `Archiver`→порожньо); вільний текст Next role MUST NOT парситись на слова. Коли ім'я невідоме, промпт SHALL друкувати плейсхолдер `<phase-specialist>`.

#### Scenario: Ukrainian project gets Ukrainian prompt body

- **WHEN** `.agents/orchestrator.yaml` має `project.agent_language: uk`
- **AND** агент виводить промпт наступної сесії
- **THEN** інструктивне тіло (починаю сесію, запусти restore, conductor, HARD STOP) написане українською
- **AND** перший рядок лишається `/opsx:<command> <name>`

#### Scenario: English project keeps English body

- **WHEN** `project.agent_language` є `en` або відсутній
- **THEN** тіло промпта MAY бути англійською; команда `/opsx:` не змінюється

#### Scenario: Apply exit does not start archive in the same chat

- **GIVEN** усі таски `[x]`, канонічна Closed role `Implementer` і порожня секція `## Blocked`
- **WHEN** apply-сесія закривається через `handoff <name>`
- **THEN** CLI друкує замість next-role промпта один рядок `npx agent-orchestrator-kit archive <name> --sync` (його запускають у терміналі після merge)
- **AND** інструкція забороняє запускати archive (CLI чи `/opsx:archive`) у цьому ж apply-чаті

#### Scenario: Вільний текст Next role не стає ім'ям субагента

- **WHEN** `## Next role` містить `Implementer — відновити verification після усунення baseline lint` без backtick
- **THEN** промпт не містить `subagent-baseline` і `.cursor/agents/baseline.md`
- **AND** рядок субагента фази містить `<phase-specialist>` або порожнє ім'я

#### Scenario: Backtick-ім'я і карта ролей працюють

- **WHEN** `## Next role` містить `Architect (spawn \`spec-architect\`)`
- **THEN** промпт містить `subagent-spec-architect`
- **WHEN** `## Next role` містить лише `Spec Reviewer`
- **THEN** промпт містить `subagent-spec-reviewer`

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

Правило Memory MCP SHALL фіксувати схему: `Change:<name>` (status, tasks n/m, last_role, review), `Handoff:<name>` (next_role, next_command, session_count, summary, blocked), `Decision:<topic>` (chosen + reason). Старт сесії НЕ вимагає читання цих ключів: канонічним є CLI-брифінг `npx agent-orchestrator-kit handoff <name> --restore`, а Memory MCP — опційне дзеркало файлів (`decisions.md` → `Decision:*`, `handoff.md` → `Handoff:<name>` / `Change:<name>`), яке CLI persist і далі upsert-ить у Memory JSON. Жоден шаблон (rule, skill, субагент) і CLI-промпт MUST NOT інструктувати агента читати ці ключі як окремий крок Session Start.

#### Scenario: Memory rule lists Handoff fields

- **WHEN** проєкт має `.agents/rules/memory-mcp-autosetup.mdc` після init/update
- **THEN** правило перелічує поля `next_role`, `next_command`, `session_count` для `Handoff:<name>`

#### Scenario: Шаблони не вимагають Memory-read на старті

- **WHEN** після init читаються `.agents/rules/session-handoff.mdc`, `.agents/skills/agent-orchestration/SKILL.md` і `.agents/subagents/session-handoff.md`
- **THEN** жоден не містить кроку «Read Memory entities `Change:<name>`, `Handoff:<name>`, and `Decision:*`» у Session Start / Restore mode
- **AND** rule і skill містять «no separate Memory MCP read step» (без урахування регістру)

### Requirement: Orchestrator yaml handoff flags

Шаблон `templates/orchestrator.yaml` і всі профілі SHALL містити `handoff.restore_on_start`, `handoff.persist_on_exit`, `handoff.emit_next_session_prompt`, `handoff.prompt_self_contained` зі значенням `true` і `handoff.spawn_handoff_subagent` зі значенням `false` — документований дефолт parent-driven протоколу, де `session-handoff` є лише fallback-ом. CLI SHALL читати `handoff.spawn_handoff_subagent` у `readOrchestratorMeta` (regex, без yaml-залежності; відсутній ключ або відсутній файл = `false`) і друкувати в промпті наступної сесії рядки fallback-спавну `session-handoff` (restore — лише коли недоступні і CLI, і handoff.md; persist — лише коли CLI persist впав; Amp: isolated `subagent-session-handoff`) тільки коли значення `true`. При `false` промпт MUST NOT згадувати spawn `session-handoff`.

#### Scenario: Flags present after init

- **WHEN** виконується init з профілем `generic`, `vue3`, `node` або `mvp`
- **THEN** `.agents/orchestrator.yaml` містить `restore_on_start: true`, `persist_on_exit: true`, `emit_next_session_prompt: true`, `prompt_self_contained: true`, `spawn_handoff_subagent: false`

#### Scenario: Прапорець true вмикає fallback-рядки у промпті

- **GIVEN** `.agents/orchestrator.yaml` має `spawn_handoff_subagent: true`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** stdout містить `subagent-session-handoff` і рядок «If the CLI failed, spawn `session-handoff` in persist mode»
- **AND** stdout не містить «never skip»

#### Scenario: Дефолт false або відсутній ключ

- **GIVEN** `.agents/orchestrator.yaml` має `spawn_handoff_subagent: false` або не має цього ключа, або файл відсутній
- **WHEN** викликається `readOrchestratorMeta(projectDir)`
- **THEN** результат містить `spawnHandoffSubagent: false`
- **AND** побудований промпт не містить `` `session-handoff` `` і `subagent-session-handoff`

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

Той самий протокол MUST фіксувати: `platform` і `model` є обов'язковими значеннями, не `unknown` (агент завжди знає свій клієнт і модель чату); перегенерація next-thread промпта після правки `handoff.md` виконується лише `npx agent-orchestrator-kit handoff <name> --no-metrics`, повторний повний persist у тій самій сесії MUST NOT запускатись (кожен повний persist = нова сесія в `metrics.json`); `decisions.md` MUST NOT редагуватись агентом напряму — лише через `## Decisions` і persist; після persist сесія зупиняється, будь-яка інша робота (хотфікс поза OpenSpec, наступна фаза, archive) — новий чат.

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

- **WHEN** після `init`/`update` читається субагент `spec-archiver` (fallback без CLI)
- **THEN** текст вимагає заповнити `## Metrics` перед `npx agent-orchestrator-kit archive <name>`
- **AND** описує фінальну зводку archive як завершення пайплайна
- **WHEN** читається команда `/opsx:archive` (fallback над CLI)
- **THEN** вона не містить кроку самозвіту `## Metrics` і блоку Session Start / Exit: лише викликає CLI, показує stdout, а на exit ≠ 0 друкує відмову і зупиняється

#### Scenario: Правило забороняє повторний persist і ручний decisions.md

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** текст містить `--no-metrics` як єдиний спосіб перегенерувати промпт
- **AND** містить заборону повторного повного persist у тій самій сесії
- **AND** містить заборону ручного редагування `decisions.md`
- **AND** вимагає новий чат для хотфіксу поза OpenSpec після persist
- **AND** позначає `platform` і `model` як обов'язкові (не `unknown`)

### Requirement: Зелений apply друкує команду archive замість промпту

Коли `npx agent-orchestrator-kit handoff <name>` (persist, не `--restore`) закриває сесію, CLI SHALL після перевірки обов'язкових секцій `handoff.md` і підрахунку progress у `tasks.md`, але **до** побудови next-session промпта, визначити «зелений apply»: канонічна Closed role — `Implementer` (`Implementer — …` теж), `tasks.md` має хоча б один таск і всі таски `[x]`, а секція `## Blocked` порожня — рівно `none`, `none.`, `-`, `—`, `n/a` або `немає` (без урахування регістру, з необов'язковим маркером списку); будь-який інший текст не вважається порожнім. У зеленому apply CLI MUST: виставити Next command = `npx agent-orchestrator-kit archive <name> --sync` і Next role = `none` (Next command, вказаний агентом через `--next-command` чи в `handoff.md`, MUST бути замінений, а коли він відрізнявся — stderr-нотатка `green apply — Next command replaced with the archive command (was: …)`); записати `handoff.md` із цими полями та блоком `## Prompt`, що містить той самий рядок; надрукувати в stdout РІВНО цей рядок і `\n` — жодних інших рядків (решта повідомлень persist лишається в stderr, плюс один рядок-підказка: запустити в терміналі після merge, новий чат не потрібен, `/opsx:archive` — fallback). У решті станів (інша роль, незакритий таск, відсутній `tasks.md` або `tasks.md` без тасків, непорожній `## Blocked`) поведінка MUST лишатися незмінною, включно з промптом, чий перший рядок — `/opsx:…`. Тригер MUST NOT залежати від `pipeline.archive_after_merge` і від мови `project.agent_language`; повторний `handoff <name> --no-metrics` MUST давати той самий stdout і той самий `handoff.md`; `handoff <name> --restore` MUST лишатися без змін (без підказки про archive). Це єдиний виняток із вимоги, що перший рядок stdout persist — `/opsx:…`. Шаблон `/opsx:apply` і skill `openspec-apply-change` SHALL вимагати на виході зеленого apply записати `## Blocked` = `none`, `## Next command` = буквальний рядок `npx agent-orchestrator-kit archive <name> --sync` і `## Next role` = `none`, а інакше лишати `/opsx:apply <name>` (є таски) або `/opsx:propose <name>` (escape valve із записом прогалини в `## Blocked`).

#### Scenario: Зелений apply друкує один рядок

- **GIVEN** `tasks.md` з усіма тасками `[x]`, `handoff.md` із Closed role `Implementer — all tasks done` і `## Blocked` = `none`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** stdout дорівнює рівно `npx agent-orchestrator-kit archive <name> --sync` плюс `\n`
- **AND** `handoff.md` має `## Next command` = `` `npx agent-orchestrator-kit archive <name> --sync` ``, `## Next role` = `none` і блок `## Prompt` з тим самим рядком
- **AND** stderr містить підказку запустити рядок у терміналі після merge і не містить «Copy the prompt below»
- **AND** сесія `Implementer` записана в `metrics.json`, як і раніше

#### Scenario: Інші ролі й стани не змінюються

- **WHEN** Closed role — `Architect`, а всі таски `[x]` і `## Next command` = `/opsx:review <name>`
- **THEN** stdout, як і раніше, починається з `/opsx:review <name>` і містить `HARD STOP`
- **WHEN** Closed role — `Implementer`, але є незакритий таск, або `## Blocked` = `waiting for CI on the PR`, або `tasks.md` відсутній чи без тасків
- **THEN** stdout — звичайний промпт, чий перший рядок — Next command із `handoff.md`, і містить `HARD STOP`
- **AND** stderr не містить підказки про запуск archive у терміналі

#### Scenario: Next command агента замінюється з нотаткою

- **GIVEN** зелений apply, де агент записав `## Next command` = `/opsx:archive <name>`
- **WHEN** виконується `handoff <name>`
- **THEN** stdout дорівнює рядку `npx agent-orchestrator-kit archive <name> --sync`
- **AND** stderr містить `green apply — Next command replaced with the archive command (was: /opsx:archive <name>)`, а `handoff.md` має команду archive

#### Scenario: Повторна генерація і мова не міняють результат

- **GIVEN** зелений apply, що вже пройшов persist
- **WHEN** виконується `handoff <name> --no-metrics`
- **THEN** stdout і `handoff.md` байт-у-байт збігаються з попереднім результатом
- **AND** у проєкті з `project.agent_language: uk` або з `pipeline.archive_after_merge: false` stdout той самий один рядок

#### Scenario: Restore не змінюється

- **GIVEN** `handoff.md` після зеленого apply
- **WHEN** виконується `handoff <name> --restore`
- **THEN** брифінг друкує `next_command: npx agent-orchestrator-kit archive <name> --sync` і `next_role: none`
- **AND** жодна підказка про archive не додається

#### Scenario: Шаблони apply вимагають буквальний рядок

- **WHEN** після `init`/`update` читаються `.agents/commands/opsx-apply.md` і `.agents/skills/openspec-apply-change/SKILL.md`
- **THEN** обидва містять буквальний рядок `npx agent-orchestrator-kit archive <name> --sync`
- **AND** `opsx-apply.md` на виході вимагає `## Blocked` = `none`, `## Next role` = `none` і забороняє запускати archive у цьому apply-чаті

### Requirement: Next-session prompt follows the parent-driven protocol

CLI-промпт наступної сесії (`buildNextSessionPrompt`, stdout `npx agent-orchestrator-kit handoff <name>`) SHALL повторювати протокол `.agents/rules/session-handoff.mdc`, а не дублювати його: секція Start складається з одного виклику `npx agent-orchestrator-kit handoff <name> --restore` (канонічний брифінг) і читання `openspec/changes/<name>/handoff.md` лише якщо restore впав, після чого спавниться субагент фази; секція Exit HARD STOP складається з двох рядків (записати `handoff.md` → `npx agent-orchestrator-kit handoff <name>` exit 0 → вставити stdout одним fenced-блоком з першим рядком `/opsx:…` → зупинитись; посилання на `.agents/rules/session-handoff.mdc`). Промпт MUST NOT містити окремий крок читання Memory MCP entities, крок дзеркалення Memory MCP, крок `status` і рутинний spawn `session-handoff` («never skip»). Промпт MUST лишатися самодостатнім: перший рядок `/opsx:<command> <name>`, блок ролі (субагент фази, Amp: isolated `subagent-<name>`, Cursor/Claude agents-файл, conductor-only), Closed role, Change, Done, Blocked, Attach, Subagents to spawn, Constraints, HARD STOP. Блок Decisions MUST NOT інлайнитись у промпт — рішення друкує restore з `decisions.md`, а `## Decisions` лишається у handoff.md. Статичний скелет промпта з мінімальними полями SHALL бути ≤ 1536 байт для `en` і ≤ 1600 символів для `uk`.

#### Scenario: Промпт без Memory-read і без рутинного spawn session-handoff

- **GIVEN** `.agents/orchestrator.yaml` після `init` (`spawn_handoff_subagent: false`)
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** stdout починається з `/opsx:<command> <name>`
- **AND** stdout не містить `Read Memory MCP`, `Spawn \`session-handoff\` in persist mode`, `Spawn \`session-handoff\` in restore mode`, `- Decisions:` і `agent-orchestrator-kit status`
- **AND** stdout містить `HARD STOP`, `conductor`, `handoff <name> --restore`, `- Done:`, `- Blocked:`, `- Attach:`, `- Subagents for this session:`

#### Scenario: Український промпт без Memory-read

- **WHEN** `project.agent_language: uk` і виконується persist
- **THEN** stdout містить `Ти — conductor` і `HARD STOP`
- **AND** stdout не містить `Прочитай Memory MCP`, `у режимі persist` і `- Рішення:`

#### Scenario: Start — один виклик, Exit — два рядки

- **WHEN** промпт побудовано для `en` або `uk`
- **THEN** секція Start є одним абзацом з `npx agent-orchestrator-kit handoff <name> --restore`
- **AND** секція Exit HARD STOP має рівно два непорожні рядки: ланцюжок `handoff.md` → `handoff <name>` → fenced stdout → stop і рядок із `.agents/rules/session-handoff.mdc`
- **AND** промпт не містить нумерованих списків кроків

#### Scenario: Бюджет розміру

- **WHEN** промпт побудовано з мінімальними полями (name, next command, next role, spawn)
- **THEN** EN-промпт ≤ 1536 байт, UK-промпт ≤ 1600 символів

### Requirement: Restore briefing prints Attach and the last decisions

Команда `npx agent-orchestrator-kit handoff <name> --restore` SHALL друкувати після Done рядок `attach:` і вміст секції Attach з `handoff.md` без парсингу (file:line-діапазони, записані батьком, друкуються як є), а з `openspec/changes/<name>/decisions.md` — лише останні 10 записів; коли записів більше 10, після них SHALL друкуватися трейлер `(N older entries in openspec/changes/<name>/decisions.md)`, де N — кількість не надрукованих старіших записів. Читання `decisions.md` як джерела рішень не змінюється; рядки `Memory entities: N` / `Memory JSON empty or missing` і `decisions: none` не змінюються. Окрема секція Read set НЕ додається.

#### Scenario: Понад 10 рішень друкуються з трейлером

- **GIVEN** `openspec/changes/<name>/decisions.md` має 13 записів
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --restore --no-metrics`
- **THEN** брифінг містить записи 4–13 і не містить записів 1–3
- **AND** брифінг містить рядок `(3 older entries in openspec/changes/<name>/decisions.md)`

#### Scenario: До 10 рішень друкуються повністю

- **GIVEN** `decisions.md` має 10 записів
- **WHEN** виконується restore
- **THEN** брифінг містить усі 10 записів і не містить `older entries`

#### Scenario: Attach у брифінгу

- **GIVEN** `handoff.md` має `## Attach` з рядком `` - `bin/agent-orchestrator.js:1428-1565` — prompt builder ``
- **WHEN** виконується restore
- **THEN** брифінг містить рядок `attach:` і цей рядок секції без змін
- **AND** рядок `Memory entities: N` надруковано, як і раніше
