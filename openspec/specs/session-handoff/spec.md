## Purpose

Визначає протокол передавання контексту між рольовими сесіями OpenSpec: відновлення контексту на старті, персистенцію Memory і handoff-файлу на виході, мову промпта наступної сесії, шаблон handoff-файлу, схему Memory-ентитетів, прапці в orchestrator.yaml та поведінку quick-режиму.

## Requirements

### Requirement: Restore context at session start

На початку кожної рольової сесії (`/opsx:explore`, `design`, `propose`, `review`, `apply`, `archive`, `quick`) агент MUST відновити контекст **до** будь-якої роботи спеціаліста, у такому порядку: (1) виконати `/opsx:<phase>` з pasted промпта, якщо він є, (2) виконати `npx agent-orchestrator-kit handoff --restore`, (3) **прочитати Memory** entities `Change:<name>`, `Handoff:<name>`, `Decision:*`, (4) якщо restore CLI і Memory MCP недоступні або entities порожні — прочитати `openspec/changes/<active>/handoff.md`, (5) заспавнити `session-handoff` у режимі restore, якщо контекст неповний. Відсутність Memory MCP MUST NOT блокувати сесію, якщо є `handoff.md`.

#### Scenario: Free-form continue uses handoff file

- **WHEN** є рівно одна активна зміна з `handoff.md`, де `next_command` = `/opsx:apply <name>`
- **AND** користувач у новому чаті пише «продовжуй» або «далі» без paste
- **THEN** інструкції start-протоколу вимагають виконати `/opsx:apply <name>`, а не питати «яка фаза?»

#### Scenario: Memory down still starts from file

- **WHEN** Memory MCP недоступний
- **AND** `openspec/changes/<name>/handoff.md` існує
- **THEN** сесія продовжується з файлу і не зупиняється через Memory

### Requirement: Persist Memory and handoff on session exit

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку**: (1) заспавнити `session-handoff` у режимі persist (Amp: isolated `subagent-session-handoff`; якщо spawn недоступний — persist у батькові), (2) записати `openspec/changes/<name>/handoff.md`, (3) виконати `npx agent-orchestrator-kit handoff <name>` з exit 0 (CLI upsert `.cursor/memory.json` абсолютним шляхом і друкує розширений промпт у stdout), (4) якщо Memory MCP tools доступні — оновити entities `Change:<name>`, `Handoff:<name>` і всі нові `Decision:<topic>`, (5) вставити stdout CLI у чат як один fenced промпт. Промпт MUST починатися з `/opsx:<command>`, MUST NOT містити ярлик `NEXT_SESSION_PROMPT`, MUST бути **самодостатнім**: роль, change name, мова, HARD STOP старту, який субагент спавнити (включно з Amp wrapper `subagent-<name>`), Done, Decisions, Blocked, attach, constraints, HARD STOP виходу. Промпт MUST NOT бути тонким stub «прочитай Memory». Якщо Memory MCP недоступний на кроці (4), кроки (2), (3) і (5) все одно MUST виконатись.

#### Scenario: Propose exit writes handoff and prompt

- **WHEN** `/opsx:propose <name>` завершив артефакти і `openspec validate --strict` пройшов
- **THEN** існує `openspec/changes/<name>/handoff.md` з `next_command` на `/opsx:review <name>`
- **AND** фінальне повідомлення агента містить fenced блок, перший рядок якого — `/opsx:review <name>`, без рядка `NEXT_SESSION_PROMPT`
- **AND** цей блок наказує прочитати Memory `Change:<name>`, `Handoff:<name>`, `Decision:*`
- **AND** цей блок містить Done/Decisions/Blocked і ім'я субагента наступної сесії, щоб тред міг працювати без Memory MCP

#### Scenario: Prompt is emitted only after Memory write is attempted

- **WHEN** сесія закриває фазу
- **THEN** інструкція вимагає оновити Memory entities до виводу промпта в чат

#### Scenario: New-session prompt is self-contained

- **WHEN** агент виводить промпт наступної сесії
- **THEN** текст містить задачу прочитати Memory entities активної зміни
- **AND** містить операційний контекст попередньої сесії (Done, Decisions, Blocked, attach, spawn)
- **AND** містить HARD STOP виходу і ім'я Amp wrapper `subagent-<name>`

#### Scenario: Paste prompt has no banner label

- **WHEN** агент виводить промпт наступної сесії
- **THEN** скопійований текст не містить підрядка `NEXT_SESSION_PROMPT`
- **AND** починається з `/opsx:`

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

Kit SHALL постачати шаблон `handoff.md` (у skill/команді) з секціями: Closed role, Change, Done, Decisions, Blocked, Next command, Next role, Attach, Subagents to spawn, Constraints, і готовий текст промпта наступної сесії (без ярлика `NEXT_SESSION_PROMPT`). Файл SHALL жити в `openspec/changes/<name>/handoff.md` (не в gitignored cache). Він не є артефактом схеми OpenSpec. CLI `npx agent-orchestrator-kit handoff <name>` SHALL перезаписувати секцію Prompt розширеним самодостатнім текстом мовою `project.agent_language`.

#### Scenario: Init documents the template

- **WHEN** виконується init
- **THEN** `.agents/skills/agent-orchestration/SKILL.md` або always-apply rule містить секції шаблону `handoff.md` і приклад промпта, що починається з `/opsx:`

#### Scenario: Handoff file is inside the change

- **WHEN** сесія закриває фазу для зміни `<name>`
- **THEN** інструкція вимагає шлях `openspec/changes/<name>/handoff.md`, а не `.agents/cache/handoffs/`

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

Kit SHALL постачати команду `npx agent-orchestrator-kit handoff <name>`, яка валідує `handoff.md`, upsert-ить entities у `.cursor/memory.json` за **абсолютним** шляхом і друкує розширений next-thread prompt у stdout мовою `project.agent_language`. Команда `handoff --restore` SHALL друкувати брифінг зі файлу та Memory JSON. Команда `memory-setup` SHALL ставити Memory MCP на `scripts/memory-mcp-launcher.cjs`.

#### Scenario: Persist writes absolute Memory JSON and prompt

- **WHEN** існує `openspec/changes/<name>/handoff.md` з секціями Closed role, Done, Next command
- **AND** виконується `npx agent-orchestrator-kit handoff <name>`
- **THEN** `.cursor/memory.json` містить entity `Handoff:<name>`
- **AND** stdout починається з `/opsx:`
- **AND** stdout містить ім'я субагента або `subagent-`

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
