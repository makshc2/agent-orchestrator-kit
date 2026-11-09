## Purpose

Визначає протокол передавання контексту між рольовими сесіями OpenSpec: відновлення контексту на старті, персистенцію Memory і handoff-файлу на виході, мову промпта наступної сесії, шаблон handoff-файлу, схему Memory-ентитетів, прапці в orchestrator.yaml та поведінку quick-режиму.

## Requirements

### Requirement: Restore context at session start

На початку кожної рольової сесії агент MUST відновити контекст **до** будь-якої роботи, у такому порядку: (1) виконати `/opsx:<phase>` з pasted промпта, якщо він є, (2) виконати `npx agent-orchestrator-kit handoff --restore` — CLI друкує briefing із memory.json/handoff.md, (3) якщо CLI недоступний або впав — прочитати `openspec/changes/<active>/handoff.md`, (4) заспавнити `session-handoff` у режимі restore ЛИШЕ якщо і CLI, і handoff.md недоступні. Окремий крок читання Memory MCP entities НЕ вимагається — CLI-briefing є канонічним. Відсутність Memory MCP MUST NOT блокувати сесію.

#### Scenario: CLI briefing достатній без субагента

- **WHEN** `npx agent-orchestrator-kit handoff --restore` завершився exit 0 і надрукував briefing
- **THEN** сесія продовжується без спавну `session-handoff` і без читання Memory MCP entities

#### Scenario: Free-form continue uses handoff file

- **WHEN** є рівно одна активна зміна з `handoff.md`, де `next_command` = `/opsx:apply <name>`
- **AND** користувач у новому чаті пише «продовжуй» або «далі» без paste
- **THEN** інструкції start-протоколу вимагають виконати `/opsx:apply <name>`, а не питати «яка фаза?»

### Requirement: Persist Memory and handoff on session exit

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку в батьківській сесії**: (1) записати `openspec/changes/<name>/handoff.md`, (2) виконати `npx agent-orchestrator-kit handoff <name>` з exit 0 (CLI upsert memory.json абсолютним шляхом, записує сесію в `metrics.json` і друкує розширений промпт у stdout), (3) вставити stdout CLI у чат як один fenced промпт. Спавн `session-handoff` у режимі persist дозволений ЛИШЕ як fallback, коли крок (2) повернув помилку. Оновлення Memory MCP entities — опційне дзеркало (одним викликом, якщо tools доступні); його відсутність MUST NOT блокувати закриття. Вимоги до змісту промпта не змінюються: перший рядок `/opsx:<command>`, самодостатній, без службового ярлика; єдиний виняток — зелений apply, коли замість промпту CLI друкує один рядок `npx agent-orchestrator-kit archive <name> --sync` (вимога «Зелений apply друкує команду archive замість промпту»).

#### Scenario: Exit без субагента

- **WHEN** фаза завершена і `npx agent-orchestrator-kit handoff <name>` повернув exit 0
- **THEN** батьківська сесія вставляє stdout-промпт і закривається без спавну `session-handoff`

#### Scenario: Session Exit has no metrics step

- **WHEN** the parent prepares Session Exit
- **THEN** the protocol has no step that asks to fill a `## Metrics` section
- **AND** session metrics reach `metrics.json` through the persist call (`--model`, optional `--platform` and spend flags, adapters)

#### Scenario: Archive закриває пайплайн без next-prompt

- **WHEN** `npx agent-orchestrator-kit archive <name>` завершився exit 0
- **THEN** фінальний `handoff.md` записаний в архівній папці з `next_command: none`
- **AND** fenced next-prompt не вимагається
- **AND** stdout містить зводку по всьому change

### Requirement: Next-session prompt follows agent_language

Тіло промпта наступної сесії MUST бути мовою `project.agent_language` з `.agents/orchestrator.yaml`. Команди-ідентифікатори (`/opsx:review`, ключі Memory `Change:`, `Handoff:`, `Decision:`, шляхи файлів) SHALL лишатися як у протоколі (латиниця). Англійська мова тіла промпта не є вимогою якості і MUST NOT використовуватись, коли `agent_language` не `en`.

Ім'я субагента фази у промпті (`Наступна роль / субагент фази`, `subagent-<name>`, `.cursor/agents/<name>.md`) SHALL братися лише з backtick-токена у `## Subagents to spawn` / `## Next role` або з карти канонічна роль → субагент (`Explorer`→`explorer`, `Architect`→`spec-architect`, `Spec Reviewer`→`spec-reviewer`, `Implementer`→порожньо, `Archiver`→порожньо); вільний текст Next role MUST NOT парситись на слова. Коли ім'я невідоме, промпт SHALL друкувати плейсхолдер `<phase-specialist>`.

#### Scenario: Ukrainian project gets Ukrainian prompt body

- **WHEN** `.agents/orchestrator.yaml` має `project.agent_language: uk`
- **AND** агент виводить промпт наступної сесії
- **THEN** інструктивне тіло (починаю сесію, запусти restore, conductor, HARD STOP) написане українською
- **AND** перший рядок лишається `/opsx:<command> <name>`

#### Scenario: English project keeps English body

- **WHEN** `project.agent_language` є `en` або відсутній
- **THEN** тіло промпта MAY бути англійською; команда `/opsx:` не змінюється

#### Scenario: Apply exit does not start archive in the same chat

- **GIVEN** усі таски `[x]`, канонічна Closed role `Implementer` і порожня секція `## Blocked`
- **WHEN** apply-сесія закривається через `handoff <name>`
- **THEN** CLI друкує замість next-role промпта один рядок `npx agent-orchestrator-kit archive <name> --sync` (його запускають у терміналі після merge)
- **AND** інструкція забороняє запускати archive (CLI чи `/opsx:archive`) у цьому ж apply-чаті

#### Scenario: Вільний текст Next role не стає ім'ям субагента

- **WHEN** `## Next role` містить `Implementer — відновити verification після усунення baseline lint` без backtick
- **THEN** промпт не містить `subagent-baseline` і `.cursor/agents/baseline.md`
- **AND** рядок субагента фази містить `<phase-specialist>` або порожнє ім'я

#### Scenario: Backtick-ім'я і карта ролей працюють

- **WHEN** `## Next role` містить `Architect (spawn \`spec-architect\`)`
- **THEN** промпт містить `subagent-spec-architect`
- **WHEN** `## Next role` містить лише `Spec Reviewer`
- **THEN** промпт містить `subagent-spec-reviewer`

### Requirement: Handoff file template

Kit SHALL постачати шаблон `handoff.md` (у skill/команді) з секціями: Closed role, Change, Done, Decisions, Blocked, Next command, Next role, Attach, Subagents to spawn, Constraints, Runtime, і готовий текст промпта наступної сесії (без ярлика `NEXT_SESSION_PROMPT`). Секція Runtime SHALL містити поля `runtime` (`local` або `cloud`) і `agent_id`. Шаблон MUST NOT містити секцію `## Metrics`: метрики сесії приходять з прапорців і адаптерів persist-виклику.

Правила, які шаблон і канонічний протокол MUST фіксувати: `--model` SHALL бути LLM product id (наприклад `cursor-grok-4.6-xhigh-fast`, `claude-opus-5`), не Closed role і не ім'я субагента; family-ярлик (`cursor-grok-4.6`) MAY бути fallback, коли product id невідомий, але CLI все одно візьме product id з adapter sources, коли вони є. Closed role у `handoff.md` MAY містити речення після `—`; metrics зберігає лише канонічний токен (`Explorer|Architect|Spec Reviewer|Implementer|Archiver|Design Intake`).

Наявні файли без секції Runtime лишаються валідними — секція дописується наступним persist-ом без помилки; наявна секція `## Metrics` ігнорується і відкидається при наступному перезаписі файла (вимога «Legacy `## Metrics` section in handoff.md is ignored» у change-metrics). Файл SHALL жити в `openspec/changes/<name>/handoff.md` (не в gitignored cache). Він не є артефактом схеми OpenSpec. CLI `npx agent-orchestrator-kit handoff <name>` SHALL перезаписувати секцію Prompt розширеним самодостатнім текстом мовою `project.agent_language`.

#### Scenario: Init documents the template

- **WHEN** виконується init
- **THEN** `.agents/skills/agent-orchestration/SKILL.md` або always-apply rule містить секції шаблону `handoff.md` (включно з Runtime, без Metrics) і приклад промпта, що починається з `/opsx:`

#### Scenario: Handoff file is inside the change

- **WHEN** сесія закриває фазу для зміни `<name>`
- **THEN** інструкція вимагає шлях `openspec/changes/<name>/handoff.md`, а не `.agents/cache/handoffs/`

#### Scenario: Persist записує секцію Runtime

- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** `handoff.md` містить секцію `## Runtime` з полями `runtime` і `agent_id`

#### Scenario: Файл без Runtime не блокує persist

- **GIVEN** наявний `handoff.md` містить усі обов'язкові секції, але не має `## Runtime`
- **WHEN** виконується persist
- **THEN** команда завершується з exit 0
- **AND** секція Runtime присутня у файлі після запису

#### Scenario: A legacy Metrics section does not block persist

- **GIVEN** an existing `handoff.md` has all required sections and a legacy `## Metrics` section
- **WHEN** persist runs
- **THEN** the command exits 0
- **AND** the file after the write has no `## Metrics` section

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

### Requirement: Quick mode emits a single exit prompt

У `/opsx:quick` агент MUST NOT емітити mid-session промпт наступної сесії між propose, легким рев'ю і apply. На виході quick-сесії він MUST записати `handoff.md` з `## Closed role`, що починається з канонічного токена `Implementer`, і вивести один fenced block. Після зеленого quick (усі таски `[x]`, build/lint зелені, немає блокерів) цей блок містить рядок `npx agent-orchestrator-kit archive <name> --sync`. Інакше блок містить промпт `/opsx:propose <name>` або `/opsx:apply <name>`.

#### Scenario: Quick does not ask to paste between propose and apply

- **WHEN** виконується `/opsx:quick <name>`
- **THEN** інструкція quick забороняє mid-session prompt між створенням артефактів і імплементацією
- **AND** вимагає один промпт наступної сесії наприкінці сесії (без ярлика `NEXT_SESSION_PROMPT`)
- **AND** вимагає Closed role `Implementer — quick` і рядок `npx agent-orchestrator-kit archive <name> --sync` для зеленого quick

### Requirement: Спільні Session Start/Exit блоки живуть в одному rule

Канонічний текст протоколів Session Start і Session Exit SHALL існувати лише в `templates/.agents/rules/session-handoff.mdc` (`alwaysApply: true`). Команди `templates/.agents/commands/opsx-*.md` MUST посилатися на протокол одним-двома рядками і MUST NOT дублювати його текст. Skill `agent-orchestration` MAY нести лише згенеровані байт-ідентичні блоки-дзеркала цих секцій (`instruction-mirrors`), без рукописної копії; речення поза секціями (git-tracked шляхи, Closed role) лишає окремим абзацом.

#### Scenario: Команди без дубльованих блоків

- **WHEN** після `init`/`update` читаються файли `.agents/commands/opsx-*.md`
- **THEN** жоден не містить повного тексту start/exit протоколу, лише посилання на `.agents/rules/session-handoff.mdc`

#### Scenario: Skill без рукописної копії кроків

- **WHEN** читається `.agents/skills/agent-orchestration/SKILL.md` після `init`/`update`
- **THEN** кроки Session Start і Session Exit стоять лише між маркерами `aok:mirror`
- **AND** поза блоками лишаються речення «Write session artifacts only to git-tracked paths» і правило Closed role (речення після `—` дозволене, metrics зберігає канонічний токен)

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

### Requirement: Зелений apply друкує команду archive замість промпту

Коли `npx agent-orchestrator-kit handoff <name>` (persist, не `--restore`) закриває сесію, CLI SHALL після перевірки обов'язкових секцій `handoff.md` і підрахунку progress у `tasks.md`, але **до** побудови next-session промпта, визначити «зелений apply»: канонічна Closed role — `Implementer` (`Implementer — …` теж), `tasks.md` має хоча б один таск і всі таски `[x]`, а секція `## Blocked` порожня — рівно `none`, `none.`, `-`, `—`, `n/a` або `немає` (без урахування регістру, з необов'язковим маркером списку); будь-який інший текст не вважається порожнім. У зеленому apply CLI MUST: виставити Next command = `npx agent-orchestrator-kit archive <name> --sync` і Next role = `none` (Next command, вказаний агентом через `--next-command` чи в `handoff.md`, MUST бути замінений, а коли він відрізнявся — stderr-нотатка `green apply — Next command replaced with the archive command (was: …)`); записати `handoff.md` із цими полями та блоком `## Prompt`, що містить той самий рядок; надрукувати в stdout РІВНО цей рядок і `\n` — жодних інших рядків (решта повідомлень persist лишається в stderr, плюс один рядок-підказка: запустити в терміналі після merge, новий чат не потрібен, `/opsx:archive` — fallback). У решті станів (інша роль, незакритий таск, відсутній `tasks.md` або `tasks.md` без тасків, непорожній `## Blocked`) поведінка MUST лишатися незмінною, включно з промптом, чий перший рядок — `/opsx:…`. Тригер MUST NOT залежати від `pipeline.archive_after_merge` і від мови `project.agent_language`; повторний `handoff <name> --no-metrics` MUST давати той самий stdout і той самий `handoff.md`; `handoff <name> --restore` MUST лишатися без змін (без підказки про archive). Це єдиний виняток із вимоги, що перший рядок stdout persist — `/opsx:…`. Шаблон `/opsx:apply` і skill `openspec-apply-change` SHALL вимагати на виході зеленого apply записати `## Blocked` = `none`, `## Next command` = буквальний рядок `npx agent-orchestrator-kit archive <name> --sync` і `## Next role` = `none`, а інакше лишати `/opsx:apply <name>` (є таски) або `/opsx:propose <name>` (escape valve із записом прогалини в `## Blocked`).

#### Scenario: Зелений apply друкує один рядок

- **GIVEN** `tasks.md` з усіма тасками `[x]`, `handoff.md` із Closed role `Implementer — all tasks done` і `## Blocked` = `none`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** stdout дорівнює рівно `npx agent-orchestrator-kit archive <name> --sync` плюс `\n`
- **AND** `handoff.md` має `## Next command` = `` `npx agent-orchestrator-kit archive <name> --sync` ``, `## Next role` = `none` і блок `## Prompt` з тим самим рядком
- **AND** stderr містить підказку запустити рядок у терміналі після merge і не містить «Copy the prompt below»
- **AND** сесія `Implementer` записана в `metrics.json`, як і раніше

#### Scenario: Інші ролі й стани не змінюються

- **WHEN** Closed role — `Architect`, а всі таски `[x]` і `## Next command` = `/opsx:review <name>`
- **THEN** stdout, як і раніше, починається з `/opsx:review <name>` і містить `HARD STOP`
- **WHEN** Closed role — `Implementer`, але є незакритий таск, або `## Blocked` = `waiting for CI on the PR`, або `tasks.md` відсутній чи без тасків
- **THEN** stdout — звичайний промпт, чий перший рядок — Next command із `handoff.md`, і містить `HARD STOP`
- **AND** stderr не містить підказки про запуск archive у терміналі

#### Scenario: Next command агента замінюється з нотаткою

- **GIVEN** зелений apply, де агент записав `## Next command` = `/opsx:archive <name>`
- **WHEN** виконується `handoff <name>`
- **THEN** stdout дорівнює рядку `npx agent-orchestrator-kit archive <name> --sync`
- **AND** stderr містить `green apply — Next command replaced with the archive command (was: /opsx:archive <name>)`, а `handoff.md` має команду archive

#### Scenario: Повторна генерація і мова не міняють результат

- **GIVEN** зелений apply, що вже пройшов persist
- **WHEN** виконується `handoff <name> --no-metrics`
- **THEN** stdout і `handoff.md` байт-у-байт збігаються з попереднім результатом
- **AND** у проєкті з `project.agent_language: uk` або з `pipeline.archive_after_merge: false` stdout той самий один рядок

#### Scenario: Restore не змінюється

- **GIVEN** `handoff.md` після зеленого apply
- **WHEN** виконується `handoff <name> --restore`
- **THEN** брифінг друкує `next_command: npx agent-orchestrator-kit archive <name> --sync` і `next_role: none`
- **AND** жодна підказка про archive не додається

#### Scenario: Шаблони apply вимагають буквальний рядок

- **WHEN** після `init`/`update` читаються `.agents/commands/opsx-apply.md` і `.agents/skills/openspec-apply-change/SKILL.md`
- **THEN** обидва містять буквальний рядок `npx agent-orchestrator-kit archive <name> --sync`
- **AND** `opsx-apply.md` на виході вимагає `## Blocked` = `none`, `## Next role` = `none` і забороняє запускати archive у цьому apply-чаті

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

### Requirement: Restore попереджає про пропущений Session Exit

`handoff <name> --restore` SHALL друкувати попередження `UNPERSISTED SESSION`, коли попередня сесія не виконала Session Exit: у `metrics.json` лишився `pending`, `handoff.md` відсутній при наявних артефактах change, або `handoff.md` старший за артефакти більш ніж на 2 секунди. `handoff.md`, `metrics.json`, `decisions.md` і `.openspec.yaml` не рахуються артефактами. Попередження не змінює exit code і не блокує restore. Пояснення в `opsx-explore.md` і `openspec-explore` SHALL називати Session Exit винятком із заборони писати артефакти.

#### Scenario: Відкрита сесія без persist

- **GIVEN** `metrics.json` має непорожній `pending`
- **WHEN** виконується restore
- **THEN** вивід містить `UNPERSISTED SESSION` і роль та час початку відкритої сесії
- **AND** exit code дорівнює 0

#### Scenario: Артефакти без handoff.md

- **GIVEN** у change є `proposal.md`, але немає `handoff.md`
- **WHEN** виконується restore
- **THEN** вивід містить `UNPERSISTED SESSION` і `no handoff.md`

#### Scenario: Чистий стан не попереджає

- **GIVEN** `handoff.md` новіший за всі артефакти і `pending` порожній
- **WHEN** виконується restore
- **THEN** вивід не містить `UNPERSISTED SESSION`

### Requirement: Restore prints a recovery briefing for an unpersisted session

When `handoff <name> --restore` prints at least one `UNPERSISTED SESSION` warning, it SHALL then print a recovery briefing built from `checkpoint.json`, `handoff.md`, `decisions.md`, `tasks.md`, `review.md` and git. The existing lines, their order and the exit code MUST NOT change; without such a warning no briefing is printed. The briefing starts with the line `RECOVERY BRIEFING`.

#### Scenario: Interrupted session with a checkpoint
- **GIVEN** `pending` is open and a valid checkpoint reports progress `finished 2.1` and next step `start 2.2`
- **WHEN** restore runs
- **THEN** the output keeps every pre-existing line, then the `UNPERSISTED SESSION` warning, then `RECOVERY BRIEFING`
- **AND** a FACTS line names `finished 2.1` with the source `[checkpoint.json]` and the exit code is 0

#### Scenario: Stale handoff
- **GIVEN** `handoff.md` is 60 seconds older than `tasks.md` and no checkpoint exists
- **WHEN** restore runs
- **THEN** the briefing has an UNKNOWN line saying `handoff.md` predates the edits and its Done and Next command may be outdated

#### Scenario: Artifacts without handoff.md
- **GIVEN** the change has `proposal.md` and no `handoff.md`
- **WHEN** restore runs
- **THEN** the briefing is printed before the existing error line, and the exit code stays 1

#### Scenario: Clean state
- **GIVEN** `handoff.md` is newest and `pending` is empty
- **WHEN** restore runs
- **THEN** the output contains neither `UNPERSISTED SESSION` nor `RECOVERY BRIEFING`

### Requirement: Recovery briefing separates facts, unknowns, contradictions and gaps

The briefing SHALL contain, in this order, the headings `FACTS`, `UNKNOWN`, `CONTRADICTIONS`, `GAPS` and `QUESTIONS FOR THE USER`, each followed by items or `- none`. Every item except `- none` ends with its sources in brackets; omission rows end with `[DETAILS]`. Per field the authority is: `decisions.md` for recorded decisions, `tasks.md` for boxes, `review.md` for the verdict, git for changes.

#### Scenario: Sources are tagged
- **WHEN** a briefing is printed
- **THEN** every item under every heading, QUESTIONS and omission rows included, ends with a bracketed source such as `[tasks.md]`, `[git]` or `[DETAILS]`, except `- none`

#### Scenario: Contradicting sources
- **GIVEN** `tasks.md` has 2 ticked boxes while a usable checkpoint reported 4
- **WHEN** the briefing is printed
- **THEN** CONTRADICTIONS names both values and both sources, and QUESTIONS asks which is right

#### Scenario: Reported decision not yet recorded
- **GIVEN** a checkpoint reported the decision `cache: use sha256` and `decisions.md` does not contain it
- **WHEN** the briefing is printed
- **THEN** UNKNOWN lists the decision verbatim with `[checkpoint.json, decisions.md]` and says it is recorded when Session Exit persists `## Decisions`
- **AND** `decisions.md` is not changed

### Requirement: A superseded checkpoint is used for reported decisions only

A valid checkpoint is usable only while its recorded SHA-256 of `handoff.md` equals the current one (both absent counts as equal). A checkpoint superseded by a later `handoff.md` SHALL be used only to list its reported decisions that `decisions.md` lacks, labelled as superseded; its tasks count, role, blocker, next step and git HEAD MUST NOT feed any FACT, contradiction, question or git reference.

#### Scenario: Handoff newer than checkpoint
- **GIVEN** a valid checkpoint whose recorded handoff digest equals the current `handoff.md`
- **WHEN** blocker and next step are shown
- **THEN** the checkpoint values are shown as reported and newer than `handoff.md`, and `handoff.md` is not listed as contradicting

#### Scenario: Handoff rewritten after the checkpoint
- **GIVEN** `handoff.md` was rewritten after the checkpoint and the checkpoint reported 4 ticked boxes while `tasks.md` has 6
- **WHEN** the briefing is printed
- **THEN** GAPS says the checkpoint is superseded, the handoff values are used, and no contradiction or question is built from the checkpoint count

### Requirement: Review currency compares content hashes with the review commit

For a verdict starting with `APPROVE` the briefing SHALL compare SHA-256 digests of the planning artifacts (`proposal.md`, `design.md`, `design-brief.md`, `tasks.md` with checkbox marks normalized, `specs/**/*.md`) in the working tree with the last commit that touched `review.md`, over the union of both path sets. Any difference, addition or deletion makes the review stale. Without a clean committed `review.md` or git the state is unknown; checkpoint time and mtime MUST NOT prove currency.

#### Scenario: Edit after review is stale
- **GIVEN** a committed `review.md` with APPROVE and a later edit to `design.md`
- **WHEN** the briefing is printed
- **THEN** CONTRADICTIONS says the verdict does not cover the current artifacts, names `design.md` and `[review.md, git]`

#### Scenario: Checkpoint after the edit does not bless the review
- **GIVEN** APPROVE committed, then `design.md` edited, then a checkpoint taken
- **WHEN** the briefing is printed
- **THEN** the review is still reported stale

#### Scenario: Re-review with the same verdict
- **GIVEN** `design.md` edited after an APPROVE and `review.md` rewritten with APPROVE and committed afterwards
- **WHEN** the briefing is printed
- **THEN** the review is reported current

#### Scenario: Deleted artifact and substantive task edit
- **GIVEN** an APPROVE commit, then `design-brief.md` deleted, or a `Do:` line of `tasks.md` edited
- **WHEN** the briefing is printed
- **THEN** the review is reported stale and names the deleted file or `tasks.md`

#### Scenario: Ticking boxes does not stale a review
- **GIVEN** an APPROVE commit and only `tasks.md` checkbox marks changed since
- **WHEN** the briefing is printed
- **THEN** the review is reported current

#### Scenario: No evidence
- **GIVEN** `review.md` is untracked or modified, or the project is not a git repository
- **WHEN** the briefing is printed
- **THEN** UNKNOWN says the review currency is unknown and no line calls the verdict current

### Requirement: Recovery briefing never infers completion, test results or motives

The briefing MUST NOT treat a modified file as a finished task or a ticked box as a passed test, and MUST NOT state or invent a reason for any decision. It MUST NOT write or overwrite any canonical file. A path is modified when the NUL-delimited output of `git status --porcelain=v1 -z --untracked-files=all` lists it (both paths of a rename), matched exactly against the task `Files:` entries, an entry ending in `/` matching by prefix.

#### Scenario: Changed file is not a finished task
- **GIVEN** task 2.2 is unticked and lists `src/a.js` in `Files:`, and git shows `src/a.js` modified
- **WHEN** the briefing is printed
- **THEN** UNKNOWN says task 2.2 lists a modified path and its completion is not confirmed

#### Scenario: Untracked directory and unusual names
- **GIVEN** unticked tasks list `src/new/a.js`, `src/файл.js` and a path with a tab, a backslash and a quote, all untracked inside new directories
- **WHEN** the briefing is printed
- **THEN** each task gets its UNKNOWN item and no spurious question about an uncovered path is asked

#### Scenario: Ticked box is not a test result
- **GIVEN** 5 of 9 boxes are ticked
- **WHEN** the briefing is printed
- **THEN** UNKNOWN says a ticked box does not confirm that tests passed and no line claims tests passed

#### Scenario: No motive invented
- **GIVEN** a decision recorded without a reason
- **WHEN** the briefing is printed
- **THEN** the decision text appears verbatim, no reason is added, and no canonical file changed

### Requirement: Recovery briefing recovers the available part and reports gaps

When a source is missing, unreadable or corrupt, restore SHALL continue and the briefing SHALL still print everything the other sources support, with one GAPS item per failing source and its reason. A failing source, including a directory in place of `handoff.md` or `decisions.md`, MUST NOT abort restore or change the exit code, which stays 0 except in the existing early return. A briefing without any checkpoint SHALL state `no checkpoint.json` in GAPS.

#### Scenario: Missing checkpoint
- **GIVEN** `pending` is open, no `checkpoint.json` exists, and the change has `tasks.md`, a `decisions.md` entry and a git commit
- **WHEN** restore runs
- **THEN** GAPS says `no checkpoint.json`, and FACTS still report `tasks.md`, `decisions.md` and git state

#### Scenario: Corrupt checkpoint
- **GIVEN** a truncated `checkpoint.json`
- **WHEN** restore runs
- **THEN** GAPS says `checkpoint.json unreadable (invalid JSON): ignored` and no value from it appears

#### Scenario: Interrupted checkpoint write
- **GIVEN** a valid `checkpoint.json` and a leftover `checkpoint.json.tmp`
- **WHEN** restore runs
- **THEN** the valid checkpoint is used and GAPS notes the leftover temporary file

#### Scenario: No git
- **GIVEN** the project directory is not a git repository
- **WHEN** restore runs
- **THEN** GAPS says git is unavailable, the other sources are reported, and the exit code is unchanged

#### Scenario: Unreadable handoff.md or decisions.md
- **GIVEN** `pending` is open and `handoff.md` (or `decisions.md`) is a directory
- **WHEN** restore runs
- **THEN** restore prints a warning naming the file, still prints the remaining lines and the briefing with a GAPS item `<file> unreadable`, and the exit code is 0 (1 only when no handoff.md data and no Memory entity exist)

### Requirement: Recovery briefing asks the user only about material ambiguity

QUESTIONS FOR THE USER SHALL list at most 3 questions, only for these cases: modified paths that no task's `Files:` covers while the handoff next command is not `/opsx:apply`; fewer ticked boxes than a usable checkpoint reported; no usable role value (no non-empty `pending.role`, handoff next role or usable checkpoint role). The CLI MUST NOT prompt interactively; the conductor asks the listed questions and nothing else.

#### Scenario: Ambiguity the sources cannot settle
- **GIVEN** 3 modified paths match no task `Files:` and `handoff.md` next command is `/opsx:review x`
- **WHEN** the briefing is printed
- **THEN** QUESTIONS has one item asking whether those paths belong to this change

#### Scenario: Role missing in a present handoff
- **GIVEN** `handoff.md` exists but has no next role, there is no `pending.role` and no usable checkpoint role
- **WHEN** the briefing is printed
- **THEN** QUESTIONS asks which role was running

#### Scenario: Settled by sources
- **GIVEN** a stale APPROVE and a handoff whose next role is `Reviewer`
- **WHEN** the briefing is printed
- **THEN** QUESTIONS is `- none` and CONTRADICTIONS carries the stale verdict

### Requirement: Recovery briefing is compact and byte-bounded

The briefing SHALL NOT exceed 40 lines or 4096 UTF-8 bytes, every line at most 200 characters, even for multibyte text, long paths and long sources. Shortening MUST cut item text on code points, add `…` and keep the bracketed sources; when content does not fit, FACTS and UNKNOWN items are dropped first into one `(<k> more omitted; see the files below) [DETAILS]` line, and the headings, CONTRADICTIONS, GAPS, QUESTIONS and `DETAILS:` are kept.

#### Scenario: Briefing is capped
- **GIVEN** 60 modified paths, 30 decisions and very long task titles
- **WHEN** restore runs
- **THEN** the briefing has at most 40 lines and 4096 bytes, an omission line, and the `DETAILS:` line

#### Scenario: Long and multibyte items
- **GIVEN** 20 gaps and contradictions made of 4-byte characters, and a 400-character path in a decision
- **WHEN** the briefing is printed
- **THEN** it has at most 4096 bytes, every kept item still ends with its bracketed source, and no line splits a character

### Requirement: Recovery briefing is read-only, local and metrics-neutral

Building the briefing SHALL use only local files and read-only git commands with fixed arguments, no network, no LLM and no client detection, so the same files and git state give the same briefing in Cursor, Claude Code and Amp. It MUST NOT write any file or call a metrics function; the session-start record of restore stays exactly as before, once per restore.

#### Scenario: No double metrics accounting
- **GIVEN** an unpersisted change
- **WHEN** restore runs with the briefing and then `handoff <name>` persists
- **THEN** `metrics.json` has `pending` set once by restore, then one new session and `pending` null, as without the briefing

#### Scenario: Read-only
- **WHEN** restore runs with `--no-metrics` on an unpersisted change
- **THEN** no file under the project changes

### Requirement: Session Exit protocol has no metrics self-report step

The canonical Session Exit protocol (`session-handoff.mdc`) and its mirrors (skill `agent-orchestration`, subagents `session-handoff` and `spec-archiver`, templates `AGENTS.md` and `CLAUDE.md`) SHALL NOT ask the parent to write, fill or mention a `## Metrics` handoff section. Session metrics come from the persist call: `--model`, optional `--platform`, spend flags and adapters. The skill's `handoff.md` template SHALL have no Metrics block.

#### Scenario: The rule has no Metrics step

- **WHEN** `.agents/rules/session-handoff.mdc` is read after `init`/`update`
- **THEN** Session Exit lists writing `handoff.md` and then running `npx agent-orchestrator-kit handoff <name>`
- **AND** the text contains no `## Metrics`, `spend_source`, `amp_credits` or `self-report`

#### Scenario: The mirrors agree

- **WHEN** the skill `agent-orchestration`, the subagents `session-handoff` and `spec-archiver`, `AGENTS.md` and `CLAUDE.md` are read
- **THEN** none asks to fill a `## Metrics` section
- **AND** the skill's `handoff.md` template has no `## Metrics` block (its separate `## Metrics (health check per change)` section about the `metrics` command stays)

#### Scenario: The Archiver fallback passes flags, not a section

- **WHEN** the subagent `spec-archiver` is read
- **THEN** it tells the parent to pass `--model` (and `--platform` when detection fails) to `npx agent-orchestrator-kit archive <name>` and has no step that fills `## Metrics`
- **WHEN** the command `/opsx:archive` is read
- **THEN** it has no `## Metrics` step and no Session Start / Exit block

### Requirement: Session Exit keeps the model, persist-once and decisions rules

The protocol SHALL state: pass `--model <llm-product-id>` (never a Closed role, subagent name or Amp mode) and never guess token counts; `--platform` only when client detection is wrong; regenerate the prompt only with `handoff <name> --no-metrics`; no second full persist in a session; only the CLI writes `decisions.md`, from `## Decisions`; stop after persist.

#### Scenario: The protocol prefers a product id over a family

- **WHEN** `.agents/rules/session-handoff.mdc` and the skill `agent-orchestration` are read after `init`/`update`
- **THEN** the `--model` example contains product ids, not only the family `cursor-grok-4.6`
- **AND** the skill says adapter sources win over a family `--model` when a hook gave a more exact id

#### Scenario: The protocol forbids guessed token counts

- **WHEN** `.agents/rules/session-handoff.mdc` is read after `init`/`update`
- **THEN** it says the parent MUST NOT guess tokens
- **AND** it asks for no token numbers in `handoff.md`

#### Scenario: The protocol forbids a repeated persist and a manual decisions.md

- **WHEN** `.agents/rules/session-handoff.mdc` is read after `init`/`update`
- **THEN** it names `--no-metrics` as the only way to regenerate the prompt
- **AND** it forbids a second full persist in the same session and manual edits of `decisions.md`
- **AND** it requires a new chat for an out-of-OpenSpec hotfix after persist

#### Scenario: The same call works in three IDEs

- **WHEN** the rule, the skill `agent-orchestration` and the subagent `session-handoff` are read
- **THEN** all three describe the same `npx agent-orchestrator-kit handoff <name>` call
- **AND** none requires the Cursor SDK, a Claude `/cost` parser or an Amp billing API
