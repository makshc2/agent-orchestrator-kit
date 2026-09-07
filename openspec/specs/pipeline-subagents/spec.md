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

### Requirement: spec-reviewer виконує вичерпний скан і схему review.md

Інструкція `templates/.agents/subagents/spec-reviewer.md` (джерело generated Amp wrapper) MUST вимагати: не зупинятись на першому blocking; завершити повний чекліст Tier 2 і повний скан артефактів до вердикту; на REQUEST CHANGES і на повторному review писати секції Checklist, Findings (Blocker / Major / Minor), Required Before Apply, Previous findings; косметику не класти в Required Before Apply. Заголовок `Previous findings` ALWAYS присутній після будь-якого Tier 2 проходу. Якщо попереднього `review.md` не було — тіло є літеральним рядком `none — first review cycle`. Якщо був — кожен попередній пункт Required Before Apply як `resolved` | `unresolved` плюс однорядкове evidence. Спеціаліст MUST прочитати існуючий `review.md` перед overwrite. Один ✗ SHALL давати REQUEST CHANGES з повним списком blocking цього проходу. Same-class rescan — лише LLM-only класи (інший таск, чий `Do:` не виконується без design.md; інша design-поведінка без вимоги в delta; інший drift proposal↔tasks; інший згаданий заголовок/шлях, якого немає). Класи Tier 1 NEVER входять у same-class rescan Tier 2.

#### Scenario: Шаблон spec-reviewer забороняє зупинку на першому blocking

- **WHEN** після apply читається `templates/.agents/subagents/spec-reviewer.md`
- **THEN** файл містить заборону зупинятись на першому blocking
- **AND** вимагає секції Checklist, Findings, Required Before Apply, Previous findings
- **AND** вимагає прочитати існуючий `review.md` перед overwrite
- **AND** вимагає повний скан proposal, design, tasks, delta specs і згаданих шляхів до запису вердикту

### Requirement: Parent вставляє чекліст Tier 2 у spawn spec-reviewer

Команда `/opsx:review` MUST передати ізольованому `spec-reviewer` повний чекліст Tier 2 у spawn-промпті, не покладатись на те, що субагент сам прочитає тіло `opsx-review.md`. Коли `.agents/orchestrator.yaml` має `project.stack: vue3`, промпт MUST містити пункти Vue 3 з того чекліста (`<script setup>` + Composition API, Pinia setup stores, Axios, конкретні шляхи `src/`, без стороннього UI-рефакторингу). Перед спавном conductor MUST зафіксувати, чи існував `review.md`, і передати цей факт плюс шлях до файла в spawn-промпт. Наявна вимога «спавнити spec-reviewer лише після проходження Tier 1» лишається чинною. Прийнятий виняток з вимоги main spec «parent MUST NOT сама писати вердикт»: коли `gate-check --review` падає, parent сам пише `review.md` з рядком `**Source:** gate-check` і без `## Checklist`, не спавнить `spec-reviewer`.

#### Scenario: Vue 3 пункти потрапляють в ізольований промпт

- **GIVEN** `project.stack: vue3` і Tier 1 пройшов
- **WHEN** conductor спавнить `spec-reviewer`
- **THEN** spawn-промпт містить повний чекліст Tier 2 включно з пунктами Vue 3
- **AND** spawn-промпт містить факт, чи існував `review.md`, і шлях до файла
- **AND** parent MUST NOT рев’ювати артефакти сам замість спеціаліста

#### Scenario: Не-vue3 стек не вимагає Vue пунктів у промпті

- **GIVEN** `project.stack` не є `vue3` і Tier 1 пройшов
- **WHEN** conductor спавнить `spec-reviewer`
- **THEN** spawn-промпт усе одно містить повний не-Vue чекліст Tier 2 (consistency, main specs, scope, task self-sufficiency)
- **AND** пункти Vue 3 MAY бути відсутні

### Requirement: Повторний propose після REQUEST CHANGES бере повний punch list

Інструкції `templates/.agents/commands/opsx-propose.md` і `templates/.agents/skills/openspec-propose/SKILL.md` MUST вимагати: якщо існує `review.md` з `Verdict: REQUEST CHANGES`, conductor MUST передати в spawn-промпт `spec-architect` шлях до `review.md`, вердикт і список Required Before Apply і MUST перевірити, що звіт закриває кожен пункт; parent MUST NOT сам редагувати proposal/design/specs/tasks. Інструкція `templates/.agents/subagents/spec-architect.md` MUST вимагати: architect MUST прочитати `review.md`, виправити кожен пункт Required Before Apply і повторно просканувати той самий клас дефекту в усіх артефактах change; MUST NOT зупинятись після виправлення лише перелічених рядків. Клас для propose-side rescan — ті самі LLM-only приклади, що й для Tier 2: інший таск, чий `Do:` не виконується без design.md; інша design-поведінка без вимоги в delta; інший drift proposal↔tasks; інший згаданий заголовок/шлях, якого немає. Класи Tier 1 NEVER входять у цей rescan. Виняток: якщо `review.md` містить рядок `**Source:** gate-check` і немає `## Checklist` (немає семантичного T2 списку), structure-only propose дозволений і MAY виправляти лише помилки gate-check. Контракт тасків Files/Do/Done-when лишається чинним; спека `task-contract` не змінюється.

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
- немає `review.md` → `/opsx:review <name>`;
- `review.md` містить `Verdict: REQUEST CHANGES` → `/opsx:propose <name>`;
- `review.md` містить `Verdict: APPROVE` і в `tasks.md` є незакриті `- [ ]` → `/opsx:apply <name>`.
Інструкція MUST NOT мапити будь-який non-APPROVE `review.md` знову на `/opsx:review`. У файлі замінити лише поточний рядок 18; рядок 19 лишається єдиною гілкою APPROVE→apply (перефразувати на `Verdict: APPROVE`).

#### Scenario: GUIDE більше не відправляє RC на повторний review

- **GIVEN** активна зміна з `review.md`, що містить `Verdict: REQUEST CHANGES`, і незакриті таски
- **WHEN** викликається `openspec-guide` для next command
- **THEN** точна наступна команда є `/opsx:propose <name>`
- **AND** відповідь MUST NOT рекомендувати `/opsx:review <name>` як next command

#### Scenario: Відсутній review.md лишається review

- **GIVEN** є `proposal.md` і немає `review.md`
- **WHEN** викликається `openspec-guide` для next command
- **THEN** точна наступна команда є `/opsx:review <name>`

#### Scenario: APPROVE з відкритими тасками лишається apply

- **GIVEN** `review.md` містить `Verdict: APPROVE` і `tasks.md` має хоча б один `- [ ]`
- **WHEN** викликається `openspec-guide` для next command
- **THEN** точна наступна команда є `/opsx:apply <name>`
