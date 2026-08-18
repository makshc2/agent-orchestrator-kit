# task-contract

## ADDED Requirements

### Requirement: Машинно-перевірний формат тасків

Кожен таск у `tasks.md` change-у MUST містити індентовані поля `Files:`, `Do:`, `Done-when:`. Поле `Do:` MUST NOT містити неконкретних формулювань (наприклад «as needed», «if necessary», «update X» без деталей).

#### Scenario: Валідний таск проходить лінт

- **GIVEN** таск із заповненими `Files:`, `Do:` (конкретна зміна), `Done-when:` (перевірна умова)
- **WHEN** виконується `npx agent-orchestrator-kit gate-check --tasks <name>`
- **THEN** таск не породжує помилок у звіті

#### Scenario: Таск без контракту падає в strict-режимі

- **GIVEN** `pipeline.task_contract: strict` в `.agents/orchestrator.yaml` і таск без `Done-when:` або з «as needed» у `Do:`
- **WHEN** виконується `gate-check --tasks <name>`
- **THEN** exit code ≠ 0, звіт називає таск і відсутнє поле/заборонений патерн

#### Scenario: Warning-режим не блокує старі changes

- **GIVEN** `pipeline.task_contract: warn` (default) і таск без контрактних полів
- **WHEN** виконується `gate-check --tasks <name>`
- **THEN** exit code 0, звіт містить попередження щодо таска

#### Scenario: Неіснуючий Files-шлях падає в strict-режимі

- **GIVEN** `pipeline.task_contract: strict` і таск, у якого `Files:` містить неіснуючий шлях без префікса `new file:`
- **WHEN** виконується `gate-check --tasks <name>`
- **THEN** exit code ≠ 0, звіт називає таск і відсутній шлях

#### Scenario: Префікс new file дозволяє новий Files-шлях

- **GIVEN** `pipeline.task_contract: strict` і таск, у якого `Files:` містить `new file: <path>` для неіснуючого шляху
- **WHEN** виконується `gate-check --tasks <name>`
- **THEN** цей шлях не породжує помилки у звіті

### Requirement: Propose генерує контрактні таски

Шаблони propose (команда, skill, `openspec/config.yaml` rules) SHALL інструктувати архітектора писати кожен таск у контрактному форматі, самодостатнім для виконавця без читання design.md.

#### Scenario: Правила контракту в config template

- **GIVEN** проєкт після `init`
- **WHEN** читається `openspec/config.yaml` (або template kit-а)
- **THEN** rules.tasks містить вимоги Files/Do/Done-when і заборону неконкретних формулювань
