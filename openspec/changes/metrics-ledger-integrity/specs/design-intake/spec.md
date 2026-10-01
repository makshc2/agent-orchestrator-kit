## MODIFIED Requirements

### Requirement: Роль design_intake у конфігурації

Шаблон `templates/orchestrator.yaml` та всі профілі (`generic`, `vue3`, `node`, `mvp`) SHALL містити роль `design_intake` з командою `/opsx:design` і режимом `brief-only`, а секція `pipeline` SHALL містити прапорець `require_design_brief` зі значенням за замовчуванням `false`. Ключ `roles.*.model_hint` не читає жоден код kit-а, тому шаблон і профілі MUST NOT містити його для жодної ролі.

#### Scenario: Роль у всіх профілях

- **WHEN** виконується init з профілем `generic`, `vue3`, `node` або `mvp`
- **THEN** `.agents/orchestrator.yaml` містить роль `design_intake` і `pipeline.require_design_brief: false`

#### Scenario: Шаблон без model_hint

- **WHEN** читається `templates/orchestrator.yaml` або будь-який `profiles/*/orchestrator.yaml`
- **THEN** файл не містить рядка `model_hint`
- **AND** роль `design_intake` і далі має `command: /opsx:design` і `mode: brief-only`
