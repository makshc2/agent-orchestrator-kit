## Purpose

Deterministic CLI controls for orchestration gates: `status`, `gate-check`, and sync cleanup of stale skills/rules.

## Requirements

### Requirement: CLI команда status

CLI SHALL надавати команду `agent-orchestrator status`, яка виводить агрегований стан усіх активних (не заархівованих) OpenSpec changes без потреби вручну запускати `openspec status` для кожної зміни.

#### Scenario: Status для активної зміни з задачами

- **WHEN** користувач виконує `agent-orchestrator-kit status` у проєкті з активною зміною, що має `tasks.md` (3 з 7 позначено `[x]`)
- **THEN** вивід показує назву зміни та прогрес `3/7 tasks`

#### Scenario: Status показує review verdict

- **WHEN** активна зміна має `review.md` з `Verdict: APPROVE`
- **THEN** вивід status позначає цю зміну як "review: APPROVE"
- **WHEN** `review.md` відсутній
- **THEN** вивід позначає зміну як "review: none"

#### Scenario: Status позначає готовність до archive

- **WHEN** усі задачі в `tasks.md` позначені `[x]`
- **THEN** вивід status позначає зміну як "ready to archive"

#### Scenario: Немає активних changes

- **WHEN** `openspec/changes/` не містить активних змін (окрім `archive/`)
- **THEN** `agent-orchestrator status` виводить повідомлення "No active changes" і завершується з exit code 0

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

### Requirement: sync видаляє застарілі skills та rules

`agent-orchestrator sync` SHALL видаляти з `.cursor/skills/`, `.cursor/rules/`, `.claude/skills/` файли й директорії, яких більше немає у відповідних джерелах `.agents/skills/`, `.agents/rules/` — щоб поведінка була ідентична `sync-local-agent-skills.sh` (`rsync --delete`).

#### Scenario: Видалений skill зникає після sync

- **WHEN** скіл `openspec-howto` існує в `.cursor/skills/openspec-howto/` з попереднього sync
- **AND** директорія `.agents/skills/openspec-howto/` більше не існує (видалена, наприклад, після `update` на новішу версію kit-а)
- **AND** користувач виконує `agent-orchestrator-kit sync --target cursor`
- **THEN** `.cursor/skills/openspec-howto/` більше не існує після sync

#### Scenario: Delete не зачіпає generated-only файли поза skills/rules

- **WHEN** користувач виконує `agent-orchestrator-kit sync --target cursor`
- **AND** `.cursor/memory.json` існує (локальний Memory MCP стан)
- **THEN** `.cursor/memory.json` залишається недоторканим після sync

#### Scenario: Claude sync теж видаляє застарілі skills

- **WHEN** скіл видалено з `.agents/skills/`
- **AND** користувач виконує `agent-orchestrator-kit sync --target claude`
- **THEN** відповідна директорія в `.claude/skills/` видаляється

### Requirement: CLI читає pipeline.archive_after_merge

CLI SHALL читати `pipeline.archive_after_merge` з `.agents/orchestrator.yaml` тим самим рядковим reader-ом, що й решту ключів `pipeline.*`: лише як прямий дочірній ключ top-level блоку `pipeline:`, рядки-коментарі й той самий ключ під іншою секцією MUST NOT впливати на результат, хвіст `# …` після значення відкидається, а файл без блоку `pipeline:` читається попереднім regex-fallback-ом (перше входження ключа). Значення — `true` або `false`; відсутній ключ, невалідне значення і відсутній файл MUST давати `true` (значення шаблонів), а `false` — лише явний `archive_after_merge: false`. Прапорець є політикою, а не гейтом: `status` SHALL друкувати рядок `archive_after_merge: <true|false>` одразу під заголовком, коли `.agents/orchestrator.yaml` існує (окремого рядка на change немає; без файлу рядка немає), `archive <name> --if-ready` і CI-job MUST його поважати, а ручний `archive` без `--if-ready` MUST його ігнорувати.

#### Scenario: Дефолт true

- **WHEN** `pipeline:` не містить ключа `archive_after_merge`, значення невалідне (`maybe`) або `.agents/orchestrator.yaml` порожній
- **THEN** результат reader-а має `archiveAfterMerge: true`

#### Scenario: Явний false береться до уваги

- **WHEN** `pipeline:` містить `archive_after_merge: false` (профіль mvp)
- **THEN** результат reader-а має `archiveAfterMerge: false`
- **AND** `true` з хвостом `# …` читається як `true`

#### Scenario: Закоментований ключ і ключ під іншою секцією не впливають

- **GIVEN** `.agents/orchestrator.yaml` має у `pipeline:` рядок `# archive_after_merge: false` перед `archive_after_merge: true`, а під `verifier:` — `archive_after_merge: false`
- **WHEN** CLI читає конфігурацію
- **THEN** `archiveAfterMerge` дорівнює `true`

#### Scenario: Файл без блоку pipeline читається legacy-способом

- **GIVEN** `.agents/orchestrator.yaml` не містить рядка `pipeline:`, але має `archive_after_merge: false` на верхньому рівні
- **WHEN** CLI читає конфігурацію
- **THEN** `archiveAfterMerge` дорівнює `false`, а без цього ключа — `true`

#### Scenario: Status друкує значення прапорця

- **GIVEN** проєкт після `init` з профілем `generic`
- **WHEN** виконується `npx agent-orchestrator-kit status`
- **THEN** stdout містить рядок `archive_after_merge: true` (для профілю `mvp` — `archive_after_merge: false`)
- **AND** після видалення `.agents/orchestrator.yaml` команда завершується з exit code 0 і не друкує рядка `archive_after_merge`
