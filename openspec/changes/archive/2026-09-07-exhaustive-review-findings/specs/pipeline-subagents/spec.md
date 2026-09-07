## ADDED Requirements

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
