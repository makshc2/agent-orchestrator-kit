# lean-archive

## ADDED Requirements

### Requirement: Детермінований archive через CLI

Команда `npx agent-orchestrator-kit archive <name>` SHALL виконувати повний цикл архівації без LLM-рішень: перевірка гейтів, переміщення change у датований архів, strict-валідація, фінальний handoff.

#### Scenario: Успішна архівація завершеного change

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і відсутнім target-архівом
- **WHEN** виконується `npx agent-orchestrator-kit archive <name> --sync`
- **THEN** delta specs зливаються в `openspec/specs/`, change переміщується в `openspec/changes/archive/YYYY-MM-DD-<name>`, `openspec validate --all --strict` проходить, exit code 0, stdout містить підсумок (change, archive path, sync status)

#### Scenario: Відмова на незакритому гейті

- **GIVEN** change з незавершеними тасками (`- [ ]`) або без APPROVE при `require_spec_review: true`
- **WHEN** виконується `archive <name>`
- **THEN** exit code ≠ 0, stderr називає перший незакритий гейт, файли не переміщуються

#### Scenario: Delta specs вимагають явного sync-рішення

- **GIVEN** change містить delta specs
- **WHEN** виконується `archive <name>` без sync-прапорців
- **THEN** exit code ≠ 0, stderr пропонує `--sync` або `--no-sync --force`, файли не переміщуються

#### Scenario: Rollback при падінні валідації

- **GIVEN** архівація пройшла move, але `openspec validate --all --strict` падає
- **WHEN** CLI отримує ненульовий exit від validate
- **THEN** change повертається на початковий шлях, синхронізовані main specs відновлюються до pre-sync вмісту, новостворені spec-файли видаляються, exit code ≠ 0, помилка валідації в stderr

### Requirement: Тонка команда opsx-archive

Команда `templates/.agents/commands/opsx-archive.md` SHALL бути тонкою обгорткою над CLI: резолв імені change, виклик `archive`, показ stdout. Вона MUST NOT спавнити phase-субагентів і MUST NOT містити інструкцій ручного merge specs чи move.

#### Scenario: Розмір і зміст команди

- **GIVEN** встановлений kit після `init` або `update`
- **WHEN** читається `.agents/commands/opsx-archive.md`
- **THEN** файл ≤ 1.5 KB, не містить «spawn spec-archiver», містить виклик `npx agent-orchestrator-kit archive`
