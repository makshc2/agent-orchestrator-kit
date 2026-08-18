# pipeline-subagents

## MODIFIED Requirements

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
