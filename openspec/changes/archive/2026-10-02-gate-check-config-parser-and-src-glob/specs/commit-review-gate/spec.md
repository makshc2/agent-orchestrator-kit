## MODIFIED Requirements

### Requirement: Гейт блокує commit коду без APPROVE і є no-op у MVP-режимі

`gate-check` SHALL мати режим `--staged`, який перевіряє staged-зміни (`git diff --cached`) замість diff від `HEAD~1`. За `pipeline.require_spec_review: true` commit зі staged-змінами під `src/` без `review.md` з вердиктом APPROVE в активному change MUST завершуватися non-zero exit. За `require_spec_review: false` гейт MUST бути no-op (exit 0). Якщо staged-diff неможливо обчислити, гейт MUST пропускати з попередженням, а не блокувати. Режим `--staged` MUST використовувати той самий список pathspec `--src-glob` / `pipeline.src_glob` (через кому або пробіл), що й режим `--base`: staged-зміна під будь-яким елементом списку вважається зміною коду.

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

#### Scenario: Staged-зміна під другим елементом списку --src-glob блокується

- **GIVEN** проєкт із `require_spec_review: true` і активним change без `review.md`
- **AND** в index є лише `lib/a.js`
- **WHEN** виконується `gate-check --staged --src-glob bin/,lib/ <name>`
- **THEN** команда завершується з exit 1 і повідомленням `review gate failed`
- **AND** `gate-check --staged --src-glob bin/ <name>` для тієї самої index завершується з exit 0 і повідомленням "nothing to gate"
