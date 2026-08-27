## ADDED Requirements

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

## MODIFIED Requirements

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
