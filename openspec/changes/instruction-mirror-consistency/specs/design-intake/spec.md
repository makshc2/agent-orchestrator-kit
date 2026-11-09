## MODIFIED Requirements

### Requirement: Команда design-intake у шаблонах

Kit SHALL постачати команду-шаблон `templates/.agents/commands/opsx-design.md`, яка визначає роль Design Intake: одноразовий захват дизайну з будь-якого джерела у durable-артефакт зміни. Порядок джерел і правила захоплення лежать у спеціалісті `templates/.agents/subagents/design-intake.md`, який команда лише викликає і не повторює.

#### Scenario: Init встановлює команду

- **WHEN** виконується `agent-orchestrator-kit init` з будь-яким профілем
- **THEN** у проєкті створюється `.agents/commands/opsx-design.md`

#### Scenario: Дозволені шляхи запису

- **WHEN** агент виконує сесію `/opsx:design <name>`
- **THEN** команда дозволяє запис лише в `openspec/changes/<name>/design-brief.md` та `openspec/changes/<name>/assets/`
- **AND** команда забороняє редагування `src/` і будь-яких інших файлів

#### Scenario: Fallback ladder джерел

- **WHEN** агент читає спеціаліста `design-intake.md`
- **THEN** він документує порядок джерел: Figma MCP (одним проходом) → експортовані зображення → скріншоти → фото
- **AND** інструктує зберігати захоплений контекст у brief негайно, без повторних запитів до Figma під час apply
- **AND** команда `opsx-design.md` не містить цього порядку, а лише спавнить спеціаліста

### Requirement: Структура design brief

Спеціаліст design-intake (`templates/.agents/subagents/design-intake.md`) SHALL визначати структуру `design-brief.md` з секціями: Source (метадані джерела: file key, node ids, дата захвату), Structure (ієрархія layout), Tokens (кольори, типографіка, spacing), Reference images (перелік файлів у `assets/`), Constraints, Confidence notes. Команда `opsx-design.md` MUST NOT повторювати цей шаблон.

#### Scenario: Шаблон brief у спеціалісті

- **WHEN** агент створює `design-brief.md` за `design-intake.md`
- **THEN** файл містить щонайменше секції Source, Structure, Tokens, Reference images, Constraints

#### Scenario: Позначки впевненості для растрових джерел

- **WHEN** джерелом є скріншот або фото
- **THEN** виведені (не виміряні) значення у brief позначаються маркером впевненості
- **AND** правило маркерів лежить у `design-intake.md`, а не в команді
