## Purpose

Optional design-intake phase: capture UI design into a durable brief so apply sessions do not depend on live Figma MCP.

## Requirements

### Requirement: Команда design-intake у шаблонах

Kit SHALL постачати команду-шаблон `templates/.agents/commands/opsx-design.md`, яка визначає роль Design Intake: одноразовий захват дизайну з будь-якого джерела у durable-артефакт зміни.

#### Scenario: Init встановлює команду

- **WHEN** виконується `agent-orchestrator-kit init` з будь-яким профілем
- **THEN** у проєкті створюється `.agents/commands/opsx-design.md`

#### Scenario: Дозволені шляхи запису

- **WHEN** агент виконує сесію `/opsx:design <name>`
- **THEN** команда дозволяє запис лише в `openspec/changes/<name>/design-brief.md` та `openspec/changes/<name>/assets/`
- **AND** команда забороняє редагування `src/` і будь-яких інших файлів

#### Scenario: Fallback ladder джерел

- **WHEN** агент читає команду `opsx-design.md`
- **THEN** команда документує порядок джерел: Figma MCP (одним проходом) → експортовані зображення → скріншоти → фото
- **AND** інструктує зберігати захоплений контекст у brief негайно, без повторних запитів до Figma під час apply

### Requirement: Структура design brief

Команда design-intake SHALL визначати структуру `design-brief.md` з секціями: Source (метадані джерела: file key, node ids, дата захвату), Structure (ієрархія layout), Tokens (кольори, типографіка, spacing), Reference images (перелік файлів у `assets/`), Constraints, Confidence notes.

#### Scenario: Шаблон brief у команді

- **WHEN** агент створює `design-brief.md` за командою
- **THEN** файл містить щонайменше секції Source, Structure, Tokens, Reference images, Constraints

#### Scenario: Позначки впевненості для растрових джерел

- **WHEN** джерелом є скріншот або фото
- **THEN** виведені (не виміряні) значення у brief позначаються маркером впевненості

### Requirement: Роль design_intake у конфігурації

Шаблон `templates/orchestrator.yaml` та всі профілі (`generic`, `vue3`, `node`, `mvp`) SHALL містити роль `design_intake` з командою `/opsx:design`, режимом `brief-only` і `model_hint: strong`, а секція `pipeline` SHALL містити прапорець `require_design_brief` зі значенням за замовчуванням `false`.

#### Scenario: Роль у всіх профілях

- **WHEN** виконується init з профілем `generic`, `vue3`, `node` або `mvp`
- **THEN** `.agents/orchestrator.yaml` містить роль `design_intake` і `pipeline.require_design_brief: false`

#### Scenario: Зворотна сумісність consumer-проєктів

- **WHEN** consumer-проєкт з попередньою версією конфіга (без прапорця) запускає `gate-check`
- **THEN** відсутній `require_design_brief` трактується як `false`
- **AND** поведінка gate-check не змінюється

### Requirement: Brief-гейт у gate-check

Команда CLI `gate-check` SHALL, коли `pipeline.require_design_brief: true` і git diff торкається `src/`, вимагати наявності `design-brief.md` в активній зміні, з opt-out через рядок `Design: none` у `proposal.md` зміни.

#### Scenario: Brief відсутній — гейт падає

- **WHEN** `require_design_brief: true`, diff торкається `src/`, активна зміна не має `design-brief.md` і proposal не містить `Design: none`
- **THEN** `gate-check` завершується з non-zero exit code
- **AND** виводить підказку запустити `/opsx:design <name>`

#### Scenario: Brief присутній — гейт проходить

- **WHEN** `require_design_brief: true`, diff торкається `src/`, у зміні існує `design-brief.md`
- **THEN** brief-гейт проходить

#### Scenario: Не-UI зміна з opt-out

- **WHEN** `require_design_brief: true`, diff торкається `src/`, `design-brief.md` відсутній, але `proposal.md` містить рядок `Design: none`
- **THEN** brief-гейт проходить

#### Scenario: Прапорець вимкнено

- **WHEN** `require_design_brief: false` або відсутній
- **THEN** gate-check не перевіряє наявність brief

### Requirement: Видимість brief у status

Команда CLI `status` SHALL показувати для кожної активної зміни наявність design brief.

#### Scenario: Рядок brief у виводі

- **WHEN** виконується `agent-orchestrator-kit status` за наявності активних змін
- **THEN** для кожної зміни виводиться рядок `brief: yes` або `brief: no` поряд з tasks і review

### Requirement: Документація фази design-intake

Шаблони документації (`templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/.agents/rules/agent-orchestration.mdc`, `templates/.agents/rules/openspec-workflow.mdc`, скіл `agent-orchestration`) та `README.md` kit SHALL описувати опційну фазу design, роль, гейт і формат маркера `Design: none`.

#### Scenario: Pipeline-діаграма з опційною фазою

- **WHEN** рендериться `templates/AGENTS.md`
- **THEN** pipeline показує опційну фазу design між explore і propose
- **AND** таблиця ролей містить рядок Design Intake з командою `/opsx:design`

#### Scenario: Правила згадують команду

- **WHEN** init встановлює `.agents/rules/`
- **THEN** `agent-orchestration.mdc` містить `/opsx:design` у списку Role Commands
- **AND** `openspec-workflow.mdc` містить мапінг `/opsx:design` → команда `opsx-design`
