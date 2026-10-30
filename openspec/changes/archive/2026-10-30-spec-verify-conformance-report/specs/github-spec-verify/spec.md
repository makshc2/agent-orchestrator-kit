## MODIFIED Requirements

### Requirement: post-pr-verdict-github.sh постить verdict через gh CLI

Скрипт SHALL парсити `artifacts/verdict.json` і постити коментар на pull request через `gh pr comment`, не логуючи токени. Коментар MUST зберігати summary, score, findings і показувати Implemented / Missing / Scope creep за спільним контрактом provider-коментарів у `spec-verify-consumer`, включно з legacy verdict.

#### Scenario: Успішний коментар

- **WHEN** `artifacts/verdict.json` існує і скрипт виконується в контексті GitHub Actions pull_request event (`GH_TOKEN`/`GITHUB_TOKEN` задано)
- **THEN** скрипт постить коментар з summary, score і таблицею findings на PR
- **AND** додає секції Implemented, Missing, Scope creep із доказами та відомими координатами

#### Scenario: Graceful skip поза PR контекстом

- **WHEN** скрипт виконується не в pull_request контексті (немає номера PR)
- **THEN** скрипт завершується з exit code 0 без спроби коментування

#### Scenario: Не логує токен

- **WHEN** скрипт виконується
- **THEN** значення `GH_TOKEN`/`GITHUB_TOKEN` ніколи не виводиться в stdout/stderr

#### Scenario: Старий verdict лишається придатним для коментування

- **GIVEN** verdict має pass, score, summary і findings, але не має нових груп і `skipped` не true
- **WHEN** скрипт формує коментар
- **THEN** старі поля відображаються як раніше
- **AND** секції `### Implemented`, `### Missing`, `### Scope creep` після Findings позначені `_Not reported by this verifier._`

#### Scenario: Skipped і inconclusive verdict не виглядають як перевірене coverage

- **GIVEN** verdict має `"skipped": true`, або `"inconclusive": true` без `skipped`
- **WHEN** скрипт формує коментар
- **THEN** усі три секції містять відповідно `_Not checked — verification skipped._` або `_Not checked — verifier response was inconclusive._`
- **AND** жодна секція не містить `_None reported._`
