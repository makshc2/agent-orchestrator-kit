## Purpose

agentic-factory-roadmap — requirements merged from change agentic-factory-roadmap.

## Requirements

### Requirement: Роадмап фабрики зафіксований у репозиторії

Kit SHALL тримати роадмап розвитку до Agentic Factory як OpenSpec capability `agentic-factory-roadmap` у `openspec/specs/`, а не як зовнішній документ, issue-трекер чи стан у gitignored файлі. Роадмап MUST перелічувати фази з їх межами і назвами відповідних changes.

#### Scenario: Роадмап доступний архітектору наступної фази

- **WHEN** розробник відкриває сесію `/opsx:propose` для будь-якої фази фабрики
- **THEN** межі фази і її non-goals читаються з `openspec/specs/agentic-factory-roadmap/spec.md`
- **AND** повторне узгодження скоупу в чаті не потрібне

#### Scenario: Роадмап не живе поза git

- **WHEN** роадмап або рішення по фазах існують лише в `.cursor/memory.json`, у чаті або на cloud-VM
- **THEN** це вважається порушенням вимоги
- **AND** стан MUST бути перенесений у change-артефакти або спеку в git

### Requirement: Одна фаза — один change

Кожна фаза роадмапу MUST реалізовуватись окремим OpenSpec change. Планувальний change `agentic-factory-roadmap` MUST NOT містити коду. Фаза MUST NOT стартувати, поки change попередньої фази не заархівований.

#### Scenario: Планувальний change не містить коду

- **WHEN** виконується `git status --porcelain` під час роботи над `agentic-factory-roadmap`
- **THEN** змінені шляхи належать лише `openspec/changes/agentic-factory-roadmap/`
- **AND** `bin/`, `templates/`, `profiles/`, `scripts/` не змінені

#### Scenario: Наступна фаза стартує лише після archive

- **GIVEN** change поточної фази ще не заархівований
- **WHEN** розробник намагається почати `/opsx:propose` наступної фази
- **THEN** правило вимагає спершу завершити archive поточної фази
- **AND** `npx agent-orchestrator-kit status` MUST не показувати активних змін перед стартом

#### Scenario: Порядок фаз зафіксований

- **WHEN** визначається наступний change фабрики
- **THEN** порядок SHALL бути: `agentic-factory-roadmap` → `add-factory-gates-and-mcp` → `add-factory-memory-and-skills` → `add-cloud-agent-handoff`
- **AND** будь-яка зміна порядку MUST оформлюватись як зміна цієї спеки

### Requirement: Межі фаз 1–3

Роадмап SHALL фіксувати скоуп кожної фази: Phase 1 (`add-factory-gates-and-mcp`) — локальний review-гейт на commit і встановлення `mcp.optional` інструментів патерном Figma-launcher-а з MCP-health у `status`, включно з VCS MCP для GitHub (особисті репо) і GitLab (робочі репо); Phase 2 (`add-factory-memory-and-skills`) — рішення в git як канон із Memory MCP як дзеркалом плюс машинний інвентар skills; Phase 3 (`add-cloud-agent-handoff`) — вимога, що артефакти сесії існують лише в git-tracked шляхах, з полем runtime у handoff.

#### Scenario: Phase 1 закриває governance-розрив на commit

- **GIVEN** проєкт із `pipeline.require_spec_review: true` після Phase 1
- **WHEN** розробник комітить зміни у `src/` без `review.md` з `Verdict: APPROVE`
- **THEN** commit MUST бути відхилений детермінованим гейтом
- **AND** при `require_spec_review: false` гейт MUST бути no-op

#### Scenario: Phase 1 не вводить новий патерн для MCP-секретів

- **WHEN** Phase 1 додає підтримку `github`, `gitlab` або `browser` з `mcp.optional`
- **THEN** використовується наявний патерн: gitignored local env + committed example + launcher-скрипт + setup/status команди, які не друкують токен
- **AND** committed MCP-конфіг MUST NOT містити реального токена

#### Scenario: Phase 1 VCS MCP відповідає git remote origin

- **GIVEN** особисті репозиторії власника живуть на GitHub, робочі — на GitLab включно з self-hosted
- **WHEN** Phase 1 встановлює VCS MCP
- **THEN** `mcp.optional` MUST містити і `github`, і `gitlab`
- **AND** хост MUST визначатись з `git remote get-url origin`, а не з прапорця `--ci`
- **AND** origin на `github.com` ставить GitHub MCP і не вимагає GitLab-токена
- **AND** origin на GitLab (gitlab.com або self-hosted hostname) ставить GitLab MCP з base URL, взятим з remote, і не вимагає GitHub-токена
- **AND** `--ci` MUST NOT перевизначати детекцію remote

#### Scenario: Phase 2 робить рішення видимими в PR/MR

- **WHEN** у сесії фіксується рішення по change
- **THEN** канонічним місцем SHALL бути git-tracked артефакт change-у
- **AND** запис у Memory MCP SHALL бути дзеркалом файлу, а не джерелом істини

#### Scenario: Phase 3 не дозволяє артефакти поза git

- **GIVEN** сесія виконується як cloud-run
- **WHEN** фаза закривається з незакомміченими OpenSpec-артефактами
- **THEN** handoff вважається неповним
- **AND** `handoff.md` MUST фіксувати runtime сесії (`local` або `cloud`)

### Requirement: Платформенний скоуп відкладений у Phase 4

Роадмап MUST відносити зовнішній orchestration runtime (LangGraph, CrewAI, Temporal), Control Plane API, dashboard run-ів, multi-tenant/RBAC, token accounting і Docker sandbox до Phase 4. Ці пункти MUST NOT входити у фази 1–3. Старт Phase 4 MUST вимагати окремого рішення після підтвердженої роботи фаз 1–3 у кількох проєктах.

#### Scenario: Платформенний пункт відхиляється у ранній фазі

- **WHEN** у скоуп change-у фази 1–3 пропонується sandbox, dashboard, audit-сервіс або зовнішній runtime
- **THEN** пункт MUST бути відхилений як Phase 4
- **AND** він MUST лишитись у non-goals цього change

#### Scenario: Phase 4 не стартує без підтвердженого досвіду

- **GIVEN** фази 1–3 заархівовані
- **WHEN** розглядається старт Phase 4
- **THEN** вимагається підтверджена робота фаз 1–3 щонайменше у 2–3 проєктах
- **AND** рішення MUST оформлюватись окремою explore-сесією і власним change

### Requirement: Паритет Cursor, Claude Code і Amp Code

Фази роадмапу MUST працювати повноцінно в Cursor, Claude Code і Amp Code. Нові MCP, skills і субагенти MUST ставитись через спільний `.agents/` + launcher/sync, уже прийнятий kit-ом. Можливість, доступна лише як Cursor-native tool (зокрема IDE browser), MUST NOT вважатись виконаною вимогою.

#### Scenario: VCS і Browser MCP є в усіх трьох IDE

- **WHEN** Phase 1 встановлює `github`, `gitlab` або `browser` MCP
- **THEN** запис з’являється в committed Cursor/Claude MCP example (`.mcp.json` / `.agents/mcp.json.example`) і в Amp MCP settings example
- **AND** усі три IDE запускають той самий `scripts/<tool>-mcp-launcher.cjs`
- **AND** Amp-конфіг використовує абсолютний шлях launcher-а за тим самим правилом, що Memory MCP

#### Scenario: Cursor IDE browser не замінює Browser MCP

- **GIVEN** у Cursor Desktop доступний native browser MCP
- **WHEN** оцінюється готовність Phase 1
- **THEN** вимога Browser MCP вважається виконаною лише за наявності portable stdio-сервера, який стартує в Claude Code і Amp Code
- **AND** відсутність native browser в Claude/Amp MUST NOT лишати Perceive-розрив

#### Scenario: Нові skills синхронізуються як існуючі субагенти

- **WHEN** фаза додає skill або субагент
- **THEN** `sync` копіює його в `.cursor/` і `.claude/`
- **AND** для Amp генерується ізольований `subagent-*` wrapper; виконання тіла в головному треді Amp заборонене

### Requirement: Пайплайн лишається незмінним

Розвиток до Agentic Factory MUST відбуватися в межах наявного пайплайна `explore → [design] → propose → review → apply → verify → archive`. Роадмап MUST NOT вводити паралельний набір ролей, другий оркестратор або альтернативний цикл фаз.

#### Scenario: Нова можливість вбудовується у наявні фази

- **WHEN** фаза роадмапу додає гейт, інструмент або артефакт
- **THEN** він MUST підключатися до наявної фази пайплайна або наявної CLI-команди
- **AND** нові ролі пайплайна MUST NOT створюватись
