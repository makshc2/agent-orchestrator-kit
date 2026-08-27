## ADDED Requirements

### Requirement: Pre-commit гейт є opt-in і не чіпає .git/hooks напряму

Kit SHALL постачати скрипт `scripts/pre-commit-gate-check.sh`, який викликає `npx agent-orchestrator-kit gate-check --staged`. Підключення хука MUST відбуватися лише через явний opt-in: команду `hooks-setup` або прапорець `init --hooks`. Kit MUST NOT писати у `.git/hooks/` напряму і MUST NOT вмикати хук за замовчуванням у жодному профілі.

#### Scenario: init без --hooks не торкається hooks

- **WHEN** виконується `npx agent-orchestrator-kit init` без `--hooks`
- **THEN** `.husky/`, `.githooks/` і `core.hooksPath` проєкту не змінюються
- **AND** скрипт `scripts/pre-commit-gate-check.sh` встановлюється у проєкт як managed-файл без підключення

#### Scenario: init --hooks підключає гейт

- **WHEN** виконується `npx agent-orchestrator-kit init --hooks` або `npx agent-orchestrator-kit hooks-setup`
- **THEN** pre-commit гейт підключається за правилами husky-first
- **AND** повторний запуск ідемпотентний (рядок або файл не дублюються)

### Requirement: Підключення хука поважає наявну hook-інфраструктуру консюмера

`hooks-setup` MUST діяти husky-first: якщо в проєкті існує `.husky/`, гейт додається одним маркованим рядком у `.husky/pre-commit` (файл створюється за відсутності). Якщо husky немає, kit SHALL створити committed `.githooks/pre-commit` і виконати `git config core.hooksPath .githooks`. Якщо `core.hooksPath` вже має інше значення, ніж `.githooks`, команда MUST відмовитись його перезаписувати і показати підказку.

#### Scenario: Репо з husky

- **GIVEN** у проєкті існує каталог `.husky/`
- **WHEN** виконується `hooks-setup`
- **THEN** у `.husky/pre-commit` додається рядок виклику `scripts/pre-commit-gate-check.sh` з маркер-коментарем kit-а
- **AND** наявний вміст `.husky/pre-commit` не видаляється
- **AND** `core.hooksPath` не змінюється

#### Scenario: Репо без husky

- **GIVEN** у проєкті немає `.husky/`
- **WHEN** виконується `hooks-setup`
- **THEN** створюється виконуваний `.githooks/pre-commit`, який викликає `scripts/pre-commit-gate-check.sh`
- **AND** `core.hooksPath` встановлюється у `.githooks`

#### Scenario: Чужий core.hooksPath не перезаписується

- **GIVEN** `git config core.hooksPath` повертає значення, відмінне від `.githooks`
- **AND** у проєкті немає `.husky/`
- **WHEN** виконується `hooks-setup`
- **THEN** команда завершується без зміни конфігурації з поясненням, як підключити гейт вручну

### Requirement: Гейт блокує commit коду без APPROVE і є no-op у MVP-режимі

`gate-check` SHALL мати режим `--staged`, який перевіряє staged-зміни (`git diff --cached`) замість diff від `HEAD~1`. За `pipeline.require_spec_review: true` commit зі staged-змінами під `src/` без `review.md` з вердиктом APPROVE в активному change MUST завершуватися non-zero exit. За `require_spec_review: false` гейт MUST бути no-op (exit 0). Якщо staged-diff неможливо обчислити, гейт MUST пропускати з попередженням, а не блокувати.

#### Scenario: Commit без APPROVE відхиляється

- **GIVEN** проєкт із `require_spec_review: true` і підключеним хуком
- **AND** активний change не має `review.md` з `Verdict: APPROVE`
- **WHEN** розробник комітить staged-зміни під `src/`
- **THEN** `gate-check --staged` завершується non-zero і commit блокується

#### Scenario: Commit з APPROVE проходить

- **GIVEN** активний change має `review.md` з `Verdict: APPROVE`
- **WHEN** розробник комітить staged-зміни під `src/`
- **THEN** `gate-check --staged` завершується з exit 0

#### Scenario: Без staged-змін у src гейт мовчки пропускає

- **WHEN** staged-зміни не зачіпають `src/` (наприклад, лише `openspec/`)
- **THEN** `gate-check --staged` завершується з exit 0 без вимоги review

#### Scenario: MVP-режим — no-op

- **GIVEN** `pipeline.require_spec_review: false`
- **WHEN** спрацьовує pre-commit гейт
- **THEN** exit 0 незалежно від наявності `review.md`
