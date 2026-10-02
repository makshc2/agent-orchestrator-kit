## ADDED Requirements

### Requirement: Tier 1 попереджає про бюджет розміру артефактів

Команда `gate-check --review <name>` SHALL міряти в байтах `proposal.md`, `design.md`, `tasks.md` і всі delta specs change (інші файли change не рахуються) і SHALL повідомляти про перевищення двох стартових порогів: `tasks.md` більше 60 000 B і сума цих файлів більше 150 000 B (порівняння строге `>`). Кожне повідомлення MUST містити виміряне значення, ліміт і пораду розбити change на зрізи, кожен у бюджет. Режим задає `pipeline.artifact_budget: warn|strict|off` у `.agents/orchestrator.yaml` (відсутнє або невідоме значення — `warn`): `warn` SHALL друкувати повідомлення як warnings без зміни exit code, `strict` SHALL додавати їх до `errors` (exit 1), `off` SHALL не міряти і не друкувати нічого. CLI MUST читати цей ключ тим самим рядковим reader-ом, що й решту `pipeline.*` (як `pipeline.archive_after_merge`): лише як прямий дочірній ключ top-level блоку `pipeline:`; рядки-коментарі і той самий ключ під іншою секцією MUST NOT впливати на результат; файл без блоку `pipeline:` читається попереднім regex-fallback-ом (перше входження ключа); невалідне значення, відсутній ключ і відсутній файл дають `warn`. Шаблон `templates/orchestrator.yaml` SHALL містити `artifact_budget: warn` у блоці `pipeline:`. Формат `gate-check --review --json` MUST лишатись `{pass, errors}`.

#### Scenario: warn попереджає про завеликий change

- **GIVEN** change із `tasks.md` 102 718 B і сумою 203 753 B, ключ `pipeline.artifact_budget` не задано
- **WHEN** виконується `gate-check --review <name>`
- **THEN** вивід містить `artifact budget: tasks.md is 102718 B (limit 60000 B)` і `artifact budget: proposal+design+tasks+delta specs total 203753 B (limit 150000 B)` разом із порадою розбити change на зрізи
- **AND** exit code 0

#### Scenario: Спрацьовує лише сума

- **GIVEN** change із `tasks.md` 22 799 B і сумою 189 427 B
- **WHEN** виконується `gate-check --review <name>`
- **THEN** вивід містить лише повідомлення про суму (`total 189427 B (limit 150000 B)`), повідомлення про `tasks.md` немає, exit code 0

#### Scenario: Change у межах бюджету мовчить

- **GIVEN** change із сумою 116 395 B (`tasks.md` 40 679 B) або 32 407 B, або із `tasks.md` рівно 60 000 B і сумою рівно 150 000 B
- **WHEN** виконується `gate-check --review <name>`
- **THEN** вивід не містить `artifact budget`

#### Scenario: Ключ читається як решта pipeline.*

- **GIVEN** `.agents/orchestrator.yaml` має у `pipeline:` рядок `# artifact_budget: off` перед `artifact_budget: strict`, а під `roles.verifier:` — `artifact_budget: off`
- **WHEN** CLI читає конфігурацію
- **THEN** режим бюджету дорівнює `strict`
- **AND** файл без блоку `pipeline:` з `artifact_budget: off` на верхньому рівні дає `off`, а значення `loud`, відсутній ключ чи відсутній файл дають `warn`

#### Scenario: strict дає помилки, off нічого

- **GIVEN** `pipeline.artifact_budget: strict` і change із сумою 203 753 B
- **WHEN** виконується `gate-check --review <name> --json`
- **THEN** `pass` є `false`, exit code 1, а `errors` містить обидва повідомлення про бюджет
- **AND** за `pipeline.artifact_budget: off` той самий change не дає жодного повідомлення про бюджет і exit code 0

### Requirement: review.md schema gate

Команда `gate-check --review-md <name>` SHALL детерміновано перевіряти `openspec/changes/<name>/review.md` за схемою `/opsx:review` і завершуватись exit 1 з переліком помилок, інакше exit 0; з `--json` SHALL друкувати `{pass, errors[]}`. Перевірки: файл існує; у ньому рівно один рядок `Verdict:` (та сама регулярка, що в `parseReviewVerdict`; другий збіг є помилкою) зі значенням, що починається з APPROVE або REQUEST CHANGES (без урахування регістру, суфікс на кшталт `✓` дозволений); для Tier 1 запису (рядок точно `**Source:** gate-check` і немає заголовка Checklist) вердикт MUST бути REQUEST CHANGES, інших перевірок немає; інакше (Tier 2) MUST бути заголовок `Previous findings`; для REQUEST CHANGES MUST бути непорожні `Checklist`, `Findings` з відрами Blocker, Major, Minor і `Required Before Apply`; для APPROVE MUST існувати `apply-notes.md` не довший за 20 рядків. Заголовки порівнюються без урахування регістру і рівня, відро Findings може бути й рядком `**Blocker**`, додаткові секції дозволені й не перевіряються. Ім'я, що не є безпечним ім'ям change, і відсутній `openspec/changes/<name>/` SHALL давати exit 1 з помилкою `invalid change name: <name>` або `change not found: <name>`. Після звіту `spec-reviewer` команда `/opsx:review` MUST звірити `Verdict:` у `review.md` з вердиктом зі звіту і запустити цей режим замість ручної перевірки заголовків: exit ≠ 0 відхиляє файл (conductor MUST NOT його переписувати), далі один re-spawn зі списком помилок скрипта і списком обов'язкових заголовків, а після другої відмови `## Blocked` і next command `/opsx:review <name>`; T1-запис parent-а не перевіряється. `spec-reviewer` MUST записувати `review.md` так, щоб цей режим проходив; приклад APPROVE `review.md` в `opsx-review.md` MUST містити розділ `Previous findings` (літерал `none — first review cycle`), щоб скопійований зразок проходив. Наявна вимога «Перевірка заголовків conductor-ом після Tier 2» лишається чинною: скрипт є способом цієї перевірки.

#### Scenario: Конформні Tier 2 і Tier 1 файли проходять

- **GIVEN** `review.md` у форматі R4 (`Verdict: APPROVE`, `## Checklist summary`, `## Previous findings`) з `apply-notes.md` на 20 рядків, або RC у форматі pregate із зайвою секцією, або T1-запис з `**Source:** gate-check` без Checklist
- **WHEN** виконується `gate-check --review-md <name>`
- **THEN** `pass` є `true` і exit code 0

#### Scenario: Приклад APPROVE у шаблоні проходить скрипт

- **GIVEN** блок-приклад APPROVE `review.md` з `opsx-review.md` і `apply-notes.md` на 3 рядки
- **WHEN** виконується `gate-check --review-md <name>`
- **THEN** `pass` є `true` і exit code 0

#### Scenario: Синтетичні порушення падають

- **GIVEN** `review.md` без рядка `Verdict:`, або з двома такими рядками, або RC без `Required Before Apply`, або Tier 2 без `Previous findings`, або APPROVE без `apply-notes.md` чи з 21 рядком
- **WHEN** виконується `gate-check --review-md <name> --json`
- **THEN** `pass` є `false`, exit code 1, а `errors` називає відповідне порушення

#### Scenario: Архівні review.md

- **GIVEN** `review.md` усіх архівних changes
- **WHEN** контракт-тест застосовує `checkReviewMd` до кожного
- **THEN** проходять усі, крім changes з явного списку в тесті (вони передують схемі `Previous findings`)
- **AND** помилки цих changes стосуються лише `Previous findings` або `apply-notes.md`

#### Scenario: Небезпечне ім'я і відсутній change

- **GIVEN** ім'я `../x` або ім'я неіснуючого change
- **WHEN** виконується `gate-check --review-md <name> --json`
- **THEN** `pass` є `false`, exit code 1, а `errors` містить `invalid change name: ../x` або `change not found: <name>`

#### Scenario: Conductor запускає скрипт після Tier 2

- **GIVEN** `spec-reviewer` повернув `Status: done`, а `review.md` з `Verdict: REQUEST CHANGES` не має `Required Before Apply`
- **WHEN** conductor запускає `gate-check --review-md <name>`
- **THEN** exit code 1, conductor один раз переспавнює `spec-reviewer` зі списком помилок скрипта і списком обов'язкових заголовків та не редагує файл
- **AND** якщо другий файл знову не проходить скрипт, сесія закривається з `## Blocked` і next command `/opsx:review <name>`
