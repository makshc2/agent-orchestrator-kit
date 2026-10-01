## MODIFIED Requirements

### Requirement: CLI команда gate-check

CLI SHALL надавати команду `agent-orchestrator gate-check [change-name]`, яка перевіряє review-gate детерміновано (exit code), придатну для виклику з CI або pre-commit hook.

Значення `pipeline.require_spec_review`, `pipeline.require_design_brief`, `pipeline.max_active_changes`, `pipeline.task_contract` і `pipeline.src_glob` CLI MUST читати з `.agents/orchestrator.yaml` лише як прямі дочірні ключі top-level блоку `pipeline:`: рядки-коментарі (`# …`) на будь-якому відступі, включно з колонкою 0, MUST NOT впливати на результат і MUST NOT закривати блок `pipeline:`; той самий ключ під іншою секцією (наприклад `roles.verifier:`) MUST NOT впливати на результат, а хвіст `# …` після значення MUST відкидатися. Reader MUST лишатися рядковим (без YAML-залежності). Якщо у файлі немає блоку `pipeline:`, CLI MUST застосувати попередній regex-reader (перше входження ключа будь-де у файлі), щоб ручно відредаговані конфіги без секції зберегли поведінку.

`--src-glob` і `pipeline.src_glob` SHALL бути списком git pathspec, розділених комами та/або пробілами (наприклад `"bin/,scripts/,templates/"` або `"src/ lib/"`); кожен елемент MUST передаватися git-у окремим pathspec, а значення в лапках MUST читатися цілком, включно з пробілами. Порожній список MUST означати дефолт `src/`.

#### Scenario: Gate-check блокує без review approve

- **WHEN** `.agents/orchestrator.yaml` має `pipeline.require_spec_review: true`
- **AND** git diff проти base містить зміни у `src/` (або `--src-glob` шаблоні)
- **AND** для активної зміни немає `review.md` з `Verdict: APPROVE`
- **THEN** `gate-check` завершується з ненульовим exit code і повідомленням, яку зміну і що саме бракує

#### Scenario: Gate-check проходить з approve

- **WHEN** ті самі умови, але `review.md` містить `Verdict: APPROVE`
- **THEN** `gate-check` завершується з exit code 0

#### Scenario: Gate-check пропускає коли review не потрібен

- **WHEN** `pipeline.require_spec_review: false` (mvp/quick профіль)
- **THEN** `gate-check` завершується з exit code 0 і повідомленням "review not required"

#### Scenario: Gate-check пропускає коли немає змін у src

- **WHEN** git diff проти base не містить змін у `--src-glob` (default `src/`)
- **THEN** `gate-check` завершується з exit code 0 без перевірки review.md

#### Scenario: Gate-check попереджає про перевищення max_active_changes

- **WHEN** кількість активних (не заархівованих) changes перевищує `pipeline.max_active_changes`
- **THEN** `gate-check` виводить попередження (warning), але НЕ завершується ненульовим exit code лише через це

#### Scenario: Gate-check graceful degrade без orchestrator.yaml

- **WHEN** `.agents/orchestrator.yaml` відсутній у проєкті
- **THEN** `gate-check` завершується з exit code 0 і info-повідомленням, що конфігурацію не знайдено

#### Scenario: Закоментований ключ не вимикає гейт

- **GIVEN** `.agents/orchestrator.yaml` містить блок `pipeline:` з рядком `# require_spec_review: false` перед рядком `require_spec_review: true`
- **AND** git diff проти base містить зміни у `src/`
- **AND** активна зміна не має `review.md` з `Verdict: APPROVE`
- **WHEN** виконується `gate-check --base HEAD~1`
- **THEN** команда завершується з exit code 1 і повідомленням `review gate failed`
- **AND** вивід не містить "review not required"

#### Scenario: Коментар у колонці 0 не закриває блок pipeline

- **GIVEN** `.agents/orchestrator.yaml` містить блок `pipeline:` з `require_spec_review: true`, далі рядок `# require_spec_review: false` без відступу (колонка 0), а після нього `src_glob: "lib/"` і `max_active_changes: 1` з відступом блоку
- **WHEN** CLI читає конфігурацію
- **THEN** `require_spec_review` дорівнює `true`, `src_glob` дорівнює `lib/`, `max_active_changes` дорівнює `1`
- **AND** жоден ключ після коментаря не втрачено

#### Scenario: Ключ під іншою секцією не вимикає гейт

- **GIVEN** `.agents/orchestrator.yaml` має `pipeline.require_spec_review: true` і `require_spec_review: false` під `roles.verifier:`
- **AND** git diff проти base містить зміни у `src/`
- **AND** активна зміна не має `review.md` з `Verdict: APPROVE`
- **WHEN** виконується `gate-check --base HEAD~1`
- **THEN** команда завершується з exit code 1 і повідомленням `review gate failed`

#### Scenario: Legacy-файл без блоку pipeline читається попереднім способом

- **GIVEN** `.agents/orchestrator.yaml` не містить рядка `pipeline:`, але містить `require_spec_review: false` на верхньому рівні
- **WHEN** виконується `gate-check --base HEAD~1`
- **THEN** команда завершується з exit code 0 і повідомленням "review not required"

#### Scenario: Список src_glob гейтить кожен елемент

- **GIVEN** `pipeline.src_glob: "bin/,templates/"` і `pipeline.require_spec_review: true`
- **AND** git diff проти base містить лише `templates/a.js`
- **AND** активна зміна не має `review.md` з `Verdict: APPROVE`
- **WHEN** виконується `gate-check --base HEAD~1`
- **THEN** команда завершується з exit code 1 і повідомленням `review gate failed`
- **AND** вивід не містить "nothing to gate"

#### Scenario: Фігурні дужки у src_glob не розкриваються, CLI попереджає

- **GIVEN** `pipeline.src_glob: "{src,lib}/"`
- **AND** git diff проти base містить лише `lib/a.js`
- **WHEN** виконується `gate-check --base HEAD~1`
- **THEN** команда виводить попередження `src_glob entries with braces are not expanded ({src,lib}/)`
- **AND** команда завершується з exit code 0 і повідомленням `nothing to gate` (елементи з дужками — літеральні pathspec, що нічого не матчать)

#### Scenario: Зміна поза списком src_glob не гейтиться

- **GIVEN** `pipeline.src_glob: "bin/,templates/"`
- **AND** git diff проти base містить лише `docs/a.md`
- **WHEN** виконується `gate-check --base HEAD~1`
- **THEN** команда завершується з exit code 0 і повідомленням `no changes under bin/,templates/ — nothing to gate`
