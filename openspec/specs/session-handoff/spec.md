## Purpose

Визначає протокол передавання контексту між рольовими сесіями OpenSpec: відновлення контексту на старті, персистенцію Memory і handoff-файлу на виході, мову промпта наступної сесії, шаблон handoff-файлу, схему Memory-ентитетів, прапці в orchestrator.yaml та поведінку quick-режиму.

## Requirements

### Requirement: Restore context at session start

На початку кожної рольової сесії (`/opsx:explore`, `design`, `propose`, `review`, `apply`, `archive`, `quick`) агент MUST відновити контекст **до** будь-якої роботи спеціаліста, у такому порядку: (1) виконати `/opsx:<phase>` з pasted промпта, якщо він є, (2) **прочитати Memory** entities `Change:<name>`, `Handoff:<name>`, `Decision:*`, (3) якщо Memory MCP недоступний або entities порожні — прочитати `openspec/changes/<active>/handoff.md`. Відсутність Memory MCP MUST NOT блокувати сесію, якщо є `handoff.md`.

#### Scenario: Free-form continue uses handoff file

- **WHEN** є рівно одна активна зміна з `handoff.md`, де `next_command` = `/opsx:apply <name>`
- **AND** користувач у новому чаті пише «продовжуй» або «далі» без paste
- **THEN** інструкції start-протоколу вимагають виконати `/opsx:apply <name>`, а не питати «яка фаза?»

#### Scenario: Memory down still starts from file

- **WHEN** Memory MCP недоступний
- **AND** `openspec/changes/<name>/handoff.md` існує
- **THEN** сесія продовжується з файлу і не зупиняється через Memory

### Requirement: Persist Memory and handoff on session exit

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку**: (1) оновити Memory entities `Change:<name>`, `Handoff:<name>` і всі нові `Decision:<topic>`; (2) записати дзеркало в `openspec/changes/<name>/handoff.md`; (3) вивести в чат fenced промпт наступної сесії. Промпт MUST починатися з `/opsx:<command>`, MUST NOT містити ярлик `NEXT_SESSION_PROMPT`, і MUST містити задачу прочитати щойно записані Memory entities (ключі `Change:<name>`, `Handoff:<name>`, `Decision:*`). Промпт MUST NOT дублювати повне саммарі сесії — стан живе в Memory. Якщо Memory MCP недоступний на кроці (1), кроки (2) і (3) все одно MUST виконатись; промпт тоді наказує читати `handoff.md`.

#### Scenario: Propose exit writes handoff and prompt

- **WHEN** `/opsx:propose <name>` завершив артефакти і `openspec validate --strict` пройшов
- **THEN** існує `openspec/changes/<name>/handoff.md` з `next_command` на `/opsx:review <name>`
- **AND** фінальне повідомлення агента містить fenced блок, перший рядок якого — `/opsx:review <name>`, без рядка `NEXT_SESSION_PROMPT`
- **AND** цей блок наказує прочитати Memory `Change:<name>`, `Handoff:<name>`, `Decision:*`

#### Scenario: Prompt is emitted only after Memory write is attempted

- **WHEN** сесія закриває фазу
- **THEN** інструкція вимагає оновити Memory entities до виводу промпта в чат

#### Scenario: New-session prompt asks to read Memory not to paste the summary

- **WHEN** агент виводить промпт наступної сесії
- **THEN** текст містить задачу прочитати Memory entities активної зміни
- **AND** не містить секції «Last session» з повним саммарі (саммарі вже в Memory / `handoff.md`)

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

Kit SHALL постачати шаблон `handoff.md` (у skill/команді) з секціями: Closed role, Done, Decisions, Blocked, Next command, Attach, Subagents to spawn, і готовий текст промпта наступної сесії (без ярлика `NEXT_SESSION_PROMPT`). Файл SHALL жити в `openspec/changes/<name>/handoff.md` (не в gitignored cache). Він не є артефактом схеми OpenSpec.

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

Шаблон `templates/orchestrator.yaml` і всі профілі SHALL містити `handoff.restore_on_start`, `handoff.persist_on_exit`, `handoff.emit_next_session_prompt` зі значенням `true`.

#### Scenario: Flags present after init

- **WHEN** виконується init з профілем `generic`, `vue3`, `node` або `mvp`
- **THEN** `.agents/orchestrator.yaml` містить `restore_on_start: true`, `persist_on_exit: true`, `emit_next_session_prompt: true`

### Requirement: Quick mode emits a single exit prompt

У профілі mvp (`/opsx:quick`) агент MUST NOT емітити mid-session промпт наступної сесії між propose і apply. На виході quick-сесії він MUST записати `handoff.md` і вивести один промпт на verify/archive.

#### Scenario: Quick does not ask to paste between propose and apply

- **WHEN** виконується `/opsx:quick <name>`
- **THEN** інструкція quick забороняє mid-session prompt між створенням артефактів і імплементацією
- **AND** вимагає один промпт наступної сесії наприкінці сесії (без ярлика `NEXT_SESSION_PROMPT`)
