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
- **AND** після звіту conductor MAY лише перевірити шляхи і звіт, прогнати `npx openspec status --change "<name>"`, `npx openspec validate <name> --strict --type change` і Tier 1 pre-gate `npx agent-orchestrator-kit gate-check --review <name>`, та один раз переспавнити `spec-architect` з повним списком помилок gate-check
- **AND** conductor MUST NOT сам виправляти proposal/design/specs/tasks за помилками gate-check; якщо після одного re-spawn exit усе ще ≠ 0, сесія закривається з `## Blocked` і next command `/opsx:propose <name>`

#### Scenario: Archive без субагентів

- **WHEN** агент виконує `/opsx:archive <name>`
- **THEN** він MUST викликати `npx agent-orchestrator-kit archive <name>` і показати stdout
- **AND** MUST NOT спавнити `spec-archiver` чи виконувати merge/move вручну

### Requirement: Повторний propose після REQUEST CHANGES бере повний punch list

Інструкції `templates/.agents/commands/opsx-propose.md` і `templates/.agents/skills/openspec-propose/SKILL.md` MUST вимагати: якщо існує `review.md` з `Verdict: REQUEST CHANGES`, conductor MUST передати в spawn-промпт `spec-architect` шлях до `review.md`, вердикт і список Required Before Apply і MUST перевірити, що звіт закриває кожен пункт; parent MUST NOT сам редагувати proposal/design/specs/tasks. Інструкція `templates/.agents/subagents/spec-architect.md` MUST вимагати: architect MUST прочитати `review.md`, виправити кожен пункт Required Before Apply і повторно просканувати той самий клас дефекту в усіх артефактах change; MUST NOT зупинятись після виправлення лише перелічених рядків. Клас для propose-side rescan — ті самі LLM-only приклади, що й для Tier 2: інший таск, чий `Do:` не виконується без design.md; інша design-поведінка без вимоги в delta; інший drift proposal↔tasks; інший згаданий заголовок/шлях, якого немає. Класи Tier 1 NEVER входять у цей rescan. Виняток: якщо `review.md` містить рядок `**Source:** gate-check` і немає `## Checklist` (немає семантичного T2 списку), structure-only propose дозволений і MAY виправляти лише помилки gate-check. Контракт тасків Files/Do/Done-when лишається чинним; ця вимога сама не змінює спеку `task-contract` — правила якості Done-when і обов’язкових заголовків proposal задають окремі вимоги `task-contract`.

#### Scenario: T2 punch list не можна закрити частковим фіксом

- **GIVEN** `review.md` з `Verdict: REQUEST CHANGES` після Tier 2 і трьома пунктами Required Before Apply одного LLM-only класу
- **WHEN** виконується `/opsx:propose <name>`
- **THEN** spawn-промпт `spec-architect` містить шлях, вердикт і список Required Before Apply
- **AND** інструкція architect вимагає виправити всі три пункти
- **AND** вимагає rescan того самого LLM-only класу в proposal, design, tasks і delta specs
- **AND** забороняє завершитись після «виправив перелічене, other semantics unchanged» без цього rescan
- **AND** parent MUST NOT сам редагувати proposal/design/specs/tasks

#### Scenario: T1-only RC дозволяє structure-only propose

- **GIVEN** `review.md` з `Verdict: REQUEST CHANGES`, рядком `**Source:** gate-check` і без секції `## Checklist`
- **WHEN** виконується `/opsx:propose <name>`
- **THEN** інструкція дозволяє виправити лише перелічені структурні помилки gate-check
- **AND** MUST NOT вимагати семантичний same-class rescan на цьому проході

### Requirement: openspec-guide маршрутизує REQUEST CHANGES на propose

Субагент `templates/.agents/subagents/openspec-guide.md` MUST визначати next command так:
- є `proposal.md`, немає `review.md` → guide запускає read-only Tier 1 `npx agent-orchestrator-kit gate-check --review <name>`: exit 0 → `/opsx:review <name>`; exit ≠ 0 → `/opsx:propose <name>` з цитатою помилок gate-check (провалений propose pre-gate, зокрема після сесії, закритої з `## Blocked`);
- `review.md` містить `Verdict: REQUEST CHANGES` → `/opsx:propose <name>`;
- `review.md` містить `Verdict: APPROVE` і в `tasks.md` є незакриті `- [ ]` → `/opsx:apply <name>`.
Інструкція MUST NOT мапити будь-який non-APPROVE `review.md` знову на `/opsx:review`. У кроці 4 файла змінюється лише пункт «`proposal.md` exists but no `review.md`»; пункт з `Verdict: APPROVE` і незакритими `- [ ]` у `tasks.md` лишається єдиною гілкою, що веде на `/opsx:apply <name>`.

#### Scenario: GUIDE більше не відправляє RC на повторний review

- **GIVEN** активна зміна з `review.md`, що містить `Verdict: REQUEST CHANGES`, і незакриті таски
- **WHEN** викликається `openspec-guide` для next command
- **THEN** точна наступна команда є `/opsx:propose <name>`
- **AND** відповідь MUST NOT рекомендувати `/opsx:review <name>` як next command

#### Scenario: Відсутній review.md лишається review

- **GIVEN** є `proposal.md` і немає `review.md`
- **AND** `npx agent-orchestrator-kit gate-check --review <name>` дає exit 0
- **WHEN** викликається `openspec-guide` для next command
- **THEN** точна наступна команда є `/opsx:review <name>`

#### Scenario: Провалений propose pre-gate без review.md веде на propose

- **GIVEN** є `proposal.md` і немає `review.md`, бо propose-сесія закрилась з `## Blocked` після одного re-spawn `spec-architect`
- **AND** `npx agent-orchestrator-kit gate-check --review <name>` дає exit ≠ 0
- **WHEN** викликається `openspec-guide` для next command
- **THEN** точна наступна команда є `/opsx:propose <name>`
- **AND** відповідь цитує помилки gate-check
- **AND** MUST NOT рекомендувати `/opsx:review <name>` як next command

#### Scenario: APPROVE з відкритими тасками лишається apply

- **GIVEN** `review.md` містить `Verdict: APPROVE` і `tasks.md` має хоча б один `- [ ]`
- **WHEN** викликається `openspec-guide` для next command
- **THEN** точна наступна команда є `/opsx:apply <name>`
