## ADDED Requirements

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
