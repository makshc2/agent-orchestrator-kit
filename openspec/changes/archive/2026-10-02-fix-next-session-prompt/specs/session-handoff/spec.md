## ADDED Requirements

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

## MODIFIED Requirements

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
