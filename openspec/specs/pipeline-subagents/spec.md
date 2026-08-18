## Purpose

Визначає, як батьківська рольова сесія OpenSpec (conductor) делегує роботу спеціалізованим субагентам, яка таблиця маршрутизації постачається в шаблони, яких субагентів kit надає для кожної фази, як субагент звітує, і як Amp skill-wrappers забезпечують ізоляцію.

## Requirements

### Requirement: Conductor must delegate specialist work

Делегування conductor-а SHALL бути диференційованим за фазою. Для `/opsx:propose` і `/opsx:review` батьківська сесія MUST запускати відповідного спеціаліста (`spec-architect`, `spec-reviewer`) і MUST NOT сама писати артефакти чи вердикт. Для `/opsx:apply` батьківська сесія MAY писати код і тести сама, керуючись `tasks.md` і `apply-notes.md`; спавн `code-writer`/`test-writer` дозволений для паралельних незалежних тасків або на явний запит користувача; `design-implementer` лишається обов'язковим для тасків із design-brief/Figma сигналом. Для `/opsx:archive` спавн phase-субагентів заборонений — фаза виконується CLI-командою `agent-orchestrator-kit archive`.

#### Scenario: Apply пише код у батькові по готовому плану

- **WHEN** агент виконує `/opsx:apply <name>` після APPROVE і береться за таск із заповненим контрактом (Files/Do/Done-when)
- **THEN** він MAY реалізувати таск безпосередньо в батьківській сесії
- **AND** MUST зупинитись (STOP, gap у handoff.md, next `/opsx:propose <name>`) якщо таск вимагає інформації поза контрактом, apply-notes і згаданими артефактами — імпровізація заборонена

#### Scenario: Propose не пише артефакти в батькові

- **WHEN** агент виконує `/opsx:propose <name>`
- **THEN** він MUST заспавнити `spec-architect` для створення `proposal.md`, `design.md`, `tasks.md` і delta specs
- **AND** після звіту conductor MAY лише прогнати `npx openspec validate <name> --strict --type change`

#### Scenario: Archive без субагентів

- **WHEN** агент виконує `/opsx:archive <name>`
- **THEN** він MUST викликати `npx agent-orchestrator-kit archive <name>` і показати stdout
- **AND** MUST NOT спавнити `spec-archiver` чи виконувати merge/move вручну

### Requirement: Exclusive routing table in always-apply and commands

Kit SHALL постачати таблицю маршрутизації «фаза × сигнал → субагент» в `templates/.agents/rules/agent-orchestration.mdc` (`alwaysApply: true`), у skill `agent-orchestration` і в кожній команді `templates/.agents/commands/opsx-*.md`. Кожен субагент MUST мати в `description` позитивний тригер (`ALWAYS use for` / `Use proactively`) і негативний (`Do NOT use for`).

#### Scenario: Init installs routing in always-apply rule

- **WHEN** виконується `agent-orchestrator-kit init`
- **THEN** `.agents/rules/agent-orchestration.mdc` містить таблицю з рядками для `session-handoff`, `codebase-explorer`, `spec-architect`, `spec-reviewer`, `code-writer`, `spec-archiver`

#### Scenario: Spec review is not code review

- **WHEN** фаза `/opsx:review`
- **THEN** таблиця призначає `spec-reviewer`, а не `code-reviewer`
- **AND** `description` у `code-reviewer` забороняє використовувати його як гейт proposal до apply

### Requirement: Stage subagents for every OpenSpec phase

Kit SHALL постачати в `templates/.agents/subagents/` агентів: `openspec-guide`, `setup-doctor`, `session-handoff`, `codebase-explorer`, `design-intake`, `spec-architect`, `spec-reviewer`, `design-implementer`, `code-writer`, `test-writer`, `code-reviewer`, `spec-archiver`. Нові агенти MUST синхронізуватись у `.cursor/agents/` і `.claude/agents/` так само, як існуючі.

#### Scenario: Init installs new stage subagents

- **WHEN** виконується `agent-orchestrator-kit init`
- **THEN** у проєкті існують `.agents/subagents/session-handoff.md`, `codebase-explorer.md`, `design-intake.md`, `spec-architect.md`, `spec-reviewer.md`, `spec-archiver.md`

#### Scenario: Sync copies them to Cursor and Claude

- **WHEN** виконується `agent-orchestrator-kit sync --target all`
- **THEN** ті самі файли існують у `.cursor/agents/` і `.claude/agents/`

### Requirement: Specialist report contract and checkbox ownership

Субагент імплементації (`code-writer`, `design-implementer`, `test-writer`) MUST повертати структурований звіт зі статусом `done` або `blocked` і списком файлів. Він MUST NOT позначати чекбокси в `tasks.md`. Conductor MUST ставити `[x]` лише після звіту `done` і перевірки, що файли існують.

#### Scenario: Code-writer does not check tasks.md

- **WHEN** `code-writer` завершує таску
- **THEN** його інструкція забороняє змінювати чекбокси `tasks.md`
- **AND** інструкція `/opsx:apply` вимагає, щоб checkbox ставив conductor

### Requirement: Amp wrappers spawn in isolation

Генератор Amp skill-wrapper (`subagent-<name>`) SHALL додавати преамбулу: батьківський Amp MUST виконувати цей skill як ізольований субагент зі свіжим контекстом і MUST NOT виконувати тіло в головному треді.

#### Scenario: Generated wrapper contains spawn preamble

- **WHEN** `init` або `sync` генерує `.agents/skills/subagent-spec-architect/SKILL.md`
- **THEN** файл містить інструкцію spawn isolated subagent / not in the main thread
