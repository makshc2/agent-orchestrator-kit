## Purpose

Визначає, як батьківська рольова сесія OpenSpec (conductor) делегує роботу спеціалізованим субагентам, яка таблиця маршрутизації постачається в шаблони, яких субагентів kit надає для кожної фази, як субагент звітує, і як Amp skill-wrappers забезпечують ізоляцію.

## Requirements

### Requirement: Conductor must delegate specialist work

Делегування conductor-а SHALL бути диференційованим за фазою. Для `/opsx:propose` і `/opsx:review` батьківська сесія MUST запускати відповідного спеціаліста (`spec-architect`, `spec-reviewer`) і MUST NOT сама писати артефакти чи вердикт. Для `/opsx:apply` батьківська сесія MAY писати код і тести сама, керуючись `tasks.md` і `apply-notes.md`; спавн `code-writer`/`test-writer` дозволений для паралельних незалежних тасків або на явний запит користувача; `design-implementer` лишається обов'язковим для тасків із design-brief/Figma сигналом. Для archive спавн phase-субагентів заборонений — фаза виконується CLI-командою `agent-orchestrator-kit archive`, за замовчуванням людиною з терміналу (або opt-in CI); `/opsx:archive` — fallback, у якому батьківська сесія лише викликає цю CLI-команду, показує stdout, а на exit ≠ 0 друкує відмову зі stderr і зупиняється.

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

- **WHEN** агент виконує `/opsx:archive <name>` (fallback, коли термінал чи CI були недоступні)
- **THEN** він MUST викликати `npx agent-orchestrator-kit archive <name>` і показати stdout
- **AND** на exit ≠ 0 MUST надрукувати відмову зі stderr і зупинитись
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

### Requirement: Conductor не дублює розвідку спеціаліста

У `/opsx:propose` parent-conductor MUST NOT досліджувати репозиторій (grep/cat/sed по `bin/`, `src/`, специфікаціях чи чужих changes) ні до, ні після спавну `spec-architect`: розвідка належить спеціалісту. Conductor SHALL читати лише decision brief (за шляхом), `status` кіта і `handoff --restore`, а на re-propose, коли існує `review.md` з `Verdict: REQUEST CHANGES` (Tier 1 чи Tier 2), ще й цей `review.md`; SHALL заспавнити `spec-architect` щонайбільше за 5 викликів інструментів, включно з цим читанням, і SHALL передати в spawn-prompt шлях до brief (або дослівний опис користувача, якщо brief-файлу немає) і назву change, а на re-propose ще й шлях до `review.md`, його вердикт і список Required Before Apply, а не вставлений зміст чи дайджест власної розвідки. Після звіту conductor SHALL зробити щонайбільше 3 виклики (один shell-виклик: `openspec status`, перелік заявлених шляхів артефактів і `gate-check --review <name>`; потім persist сесії) і за зеленого гейта MUST NOT перечитувати артефакти; червоний гейт додає лише один re-spawn і один повторний `gate-check --review`. Попередження `artifact budget` conductor MUST передати користувачу в підсумку. Ця вимога доповнює «Conductor must delegate specialist work» і «Повторний propose після REQUEST CHANGES бере повний punch list» і не змінює їх: на re-propose conductor і далі MUST перевірити за звітом, що кожен пункт закрито, і MUST NOT сам редагувати proposal/design/specs/tasks.

#### Scenario: Зелений гейт без перечитування

- **GIVEN** `/opsx:propose <name>` і decision brief у git-tracked файлі
- **WHEN** conductor виконує сесію
- **THEN** він читає brief за шляхом, `status` і `handoff --restore` та спавнить `spec-architect` щонайбільше за 5 викликів, передаючи шлях до brief і назву change
- **AND** після звіту робить щонайбільше 3 виклики і за `gate-check --review` exit 0 не читає артефакти

#### Scenario: Червоний гейт дає один re-spawn

- **GIVEN** `gate-check --review <name>` після звіту architect-а завершився з exit ≠ 0
- **WHEN** conductor реагує
- **THEN** він один раз переспавнює `spec-architect` з повним списком помилок і запускає `gate-check --review` повторно
- **AND** не досліджує репозиторій сам

#### Scenario: Попередження бюджету доходить до користувача

- **GIVEN** `gate-check --review <name>` завершився з exit 0 і вивів рядок `artifact budget`
- **WHEN** conductor пише підсумок
- **THEN** підсумок дослівно передає це попередження і радить розбити change на зрізи в бюджет
- **AND** next command лишається `/opsx:review <name>`

#### Scenario: Re-propose читає review.md у межах бюджету

- **GIVEN** `/opsx:propose <name>` і `review.md` з `Verdict: REQUEST CHANGES` та списком Required Before Apply
- **WHEN** conductor виконує сесію
- **THEN** він читає `review.md` у межах тих самих 5 викликів до спавну і передає `spec-architect` шлях до `review.md`, вердикт і список Required Before Apply разом зі шляхом до brief і назвою change
- **AND** після звіту перевіряє, що кожен пункт закрито, не редагує proposal/design/specs/tasks сам і за зеленого гейта не перечитує артефакти

#### Scenario: Brief-файлу немає

- **GIVEN** `/opsx:propose` отримав лише опис від користувача
- **WHEN** conductor спавнить `spec-architect`
- **THEN** він передає опис дослівно, а розвідку виконує `spec-architect`

### Requirement: Спеціалісти читають вузько

`spec-architect` SHALL читати main specs за заголовками вимог (`grep -n '^### Requirement:'`) і лише ті вимоги, яких торкається delta або з якими вона може конфліктувати, а не цілий великий spec. `spec-reviewer` SHALL читати повністю main spec кожної capability, якої торкається delta (`openspec/specs/<capability>/spec.md`), а решту main specs відбирати за заголовками вимог і читати кожну вимогу, з якою delta може конфліктувати; у разі сумніву він SHALL прочитати вимогу, бо конфлікт із main spec, пропущений у рев'ю, далі не ловить жоден гейт. Для обох спеціалістів: інші файли репозиторію понад 20 KB SHALL читатись діапазонами (якір ± 40 рядків); файли самого change (`openspec/changes/<name>/`: усі артефакти і наявний `review.md`) SHALL читатись повністю, один раз, бо цього вимагають вичерпний скан Tier 2 і повторний propose; спеціаліст MUST NOT перечитувати файл, уже прочитаний у сесії, і SHALL об'єднувати незалежні читання в один виклик. Виняток для `spec-reviewer`: він MAY перечитати файл, коли його текст уже не в контексті або знахідка залежить від точного формулювання. `spec-architect` MUST NOT приховувати повідомлення `artifact budget`: у режимі `warn` він SHALL перелічити його в `**Risks:**` із пропозицією нарізки на зрізи, у режимі `strict` SHALL повернути `**Status:** blocked` з тією ж пропозицією в `**Risks:**` (єдиний виняток із кроку 6 інструкції architect: виправляти кожну помилку gate-check).

#### Scenario: Architect читає main spec за заголовками

- **GIVEN** delta торкається однієї вимоги великого main spec
- **WHEN** `spec-architect` готує артефакти
- **THEN** він отримує перелік заголовків вимог через grep і читає лише ту вимогу та суміжні, а не весь файл
- **AND** не читає вдруге файл, який уже читав у цій сесії

#### Scenario: Артефакти change не обрізаються діапазонами

- **GIVEN** `tasks.md` change понад 20 KB і наявний `review.md`
- **WHEN** `spec-reviewer` виконує скан перед вердиктом
- **THEN** він читає `tasks.md` і `review.md` повністю, по одному разу, а не діапазонами навколо якоря

#### Scenario: Reviewer читає main spec зачепленої capability повністю

- **GIVEN** delta change лежить у `specs/tiered-review/spec.md`, а `openspec/specs/tiered-review/spec.md` понад 20 KB
- **WHEN** `spec-reviewer` перевіряє конфлікти з main specs
- **THEN** він читає `openspec/specs/tiered-review/spec.md` повністю, а не лише вимоги, відібрані за заголовками
- **AND** решту main specs відбирає за заголовками вимог і читає кожну вимогу, з якою delta може конфліктувати, а в разі сумніву читає її

#### Scenario: Reviewer перечитує файл заради точного формулювання

- **GIVEN** знахідка `spec-reviewer` залежить від точного формулювання вимоги або текст файла вже не в його контексті
- **WHEN** він записує знахідку в `review.md`
- **THEN** він перечитує потрібний файл і цитує його за прочитаним, а не з пам'яті; заборона повторного читання на цей випадок не поширюється

#### Scenario: Бюджет у strict блокує architect

- **GIVEN** `pipeline.artifact_budget: strict` і `gate-check --review` повертає помилку `artifact budget`
- **WHEN** `spec-architect` складає звіт
- **THEN** `**Status:**` є `blocked`, а `**Risks:**` містить пропозицію розбити change на зрізи
