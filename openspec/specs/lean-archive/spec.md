## Purpose

lean-archive — requirements merged from change lean-pipeline-v2.

## Requirements

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

### Requirement: Гейті archive не залежать від metrics.json

Гейті команди `npx agent-orchestrator-kit archive <name>` (review APPROVE, усі таски `[x]`, явне sync-рішення, вільний target-шлях, rollback при падінні `openspec validate --all --strict`) MUST NOT включати перевірку наявності, вмісту чи заповненості `metrics.json` або секції `## Metrics` у `handoff.md`. Відсутній `metrics.json`, порожній spend, `null` модель, відсутній самозвіт і порожній collect MUST NOT робити exit code успішного archive ненульовим.

Невалідне значення `--platform` (не `cursor` / `claude` / `amp`) MUST відхилятись **до** переміщення change: команда завершується non-zero і не рухає файли.

Семантика самої фіналізації `metrics.json` на archive — створення файлу, `archivedAt`, `pending: null`, сесія `Archiver` / `archive` з `durationMs: null`, ланцюжки резолву `model` / `platform` / spend, opt-in `--collect`, warning про `null` `spend.costUsd` і зводка в stdout — належить capability `change-metrics` (див. «Archive завжди фіналізує metrics.json після успішного move»). `lean-archive` MUST NOT дублювати ці правила.

#### Scenario: Metrics не є archive-гейтом

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і валідним sync-рішенням
- **AND** `metrics.json` відсутній
- **WHEN** виконується `archive <name>`
- **THEN** відсутність файлу не є причиною відмови
- **AND** файли переміщуються, якщо інші гейті закриті

#### Scenario: Незаповнений самозвіт не блокує archive

- **GIVEN** change з закритими гейтами, у якого `handoff.md` не має секції `## Metrics`
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** exit code 0
- **AND** change переміщено в `openspec/changes/archive/YYYY-MM-DD-<name>`

#### Scenario: Невалідний --platform на archive не рухає файли

- **GIVEN** change готовий до archive (гейті закриті)
- **WHEN** виконується `archive <name> --platform foo` з валідним sync-рішенням
- **THEN** exit code ≠ 0
- **AND** change лишається в `openspec/changes/<name>/` (move не виконується)
