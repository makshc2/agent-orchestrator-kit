## ADDED Requirements

### Requirement: Gate 0: archive відмовляє для вже заархівованої зміни

`npx agent-orchestrator-kit archive <name>` SHALL виконувати Gate 0 одразу після резолву change (існування каталогу `openspec/changes/<name>/`) і **до** Gate 1, до sync-запису в `openspec/specs/`, до запису `pending` у `metrics.json` і до переміщення. Команда MUST відмовити (stderr, exit code 1, нічого не змінено), коли в АКТИВНОМУ каталозі change-у виконується хоча б одна умова: `metrics.json` є валідним JSON із непорожнім рядком `archivedAt`, або `handoff.md` має `## Next command` = `none` (без урахування регістру й бектиків). Повідомлення MUST містити `already-archived gate failed`, назву маркера (`metrics.json archivedAt is set (<значення>)` або `handoff.md Next command is none`) і спосіб відновлення: якщо каталог — повторно відкрита копія, очистити `archivedAt` у `metrics.json` або вписати справжній `## Next command` у `handoff.md` і повторити archive. Gate 0 MUST бути fail-open: відсутній, нечитабельний чи невалідний `metrics.json`, `archivedAt: null` або порожній рядок, відсутній `handoff.md` та будь-яке інше значення `## Next command` не є причиною відмови. Gate 0 MUST NOT визначати «вже заархівовано» за існуванням `openspec/changes/archive/*-<name>` будь-якої дати (повторно використане ім'я зміни не дає хибної відмови) і MUST NOT мати прапорця-обходу: `--force` лишається лише підтвердженням `--no-sync`.

#### Scenario: archivedAt в активному metrics.json відмовляє без змін

- **GIVEN** активний change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]`, delta specs і `metrics.json`, де `archivedAt` = `2026-09-01T10:00:00.000Z`
- **WHEN** виконується `archive <name> --sync`
- **THEN** exit code 1, stderr містить `already-archived gate failed` і `metrics.json archivedAt is set`
- **AND** change лишається в `openspec/changes/<name>/`, каталог `openspec/changes/archive/` не створено
- **AND** `metrics.json` лишається байт-у-байт незмінним (без `pending` і без нової сесії), а main specs у `openspec/specs/` не змінені

#### Scenario: Next command none відмовляє незалежно від регістру й бектиків

- **GIVEN** активний change із закритими гейтами, у `handoff.md` якого `## Next command` дорівнює `` `none` ``, `NONE` або `None`
- **WHEN** виконується `archive <name>`
- **THEN** exit code 1, stderr містить `already-archived gate failed` і `handoff.md Next command is none`
- **AND** change лишається на місці

#### Scenario: Повторно використане ім'я не дає хибної відмови

- **GIVEN** `openspec/changes/archive/2026-01-01-<name>/` існує (старий архів тієї самої назви), а активний change `<name>` не має маркерів Gate 0 і закриває гейти
- **WHEN** виконується `archive <name>`
- **THEN** exit code 0 і change переміщено в `openspec/changes/archive/YYYY-MM-DD-<name>` сьогоднішньою датою

#### Scenario: Відсутній, невалідний або порожній маркер не відмовляє

- **GIVEN** активний change із закритими гейтами та один із варіантів: `metrics.json` з невалідним JSON; `archivedAt: null`; `archivedAt: ""`; `handoff.md` з реальною командою в `## Next command`
- **WHEN** виконується `archive <name>`
- **THEN** exit code 0 і change заархівовано (Gate 0 не є причиною відмови)

### Requirement: archive --if-ready для CI: не готова зміна — це skip, а не помилка

`npx agent-orchestrator-kit archive <name> --if-ready` SHALL бути CI-режимом тієї самої команди. Після валідації імені та `--platform` і резолву change (існування каталогу) вона MUST перевіряти в такому порядку й **до** будь-якого запису (sync, `pending`, переміщення): (1) `pipeline.archive_after_merge` = `false` → skip з причиною `archive_after_merge is false`; (2) маркер Gate 0 → skip з причиною `already archived — <маркер>`; (3) готовність — результат єдиної функції блокерів, яку використовує й `status`: `tasks incomplete`, коли `tasks.md` відсутній, не містить тасків або не всі таски `[x]`; відсутній APPROVE у `review.md`, коли `require_spec_review: true`; відсутні `design-brief.md` і `Design: none`, коли `require_design_brief: true`; непорожній список блокерів → skip з причиною `not ready — <блокери через "; ">`. Skip SHALL бути рівно одним рядком stdout, що починається з `skip:` і називає причину, з exit code 0 і без жодної зміни файлів. Коли жоден skip не спрацював, команда MUST виконати звичайний archive: Gate 1–3, sync-конфлікти й rollback валідації лишаються без змін і завершуються exit code 1 (справжні збої у CI мають бути гучними). Без `--if-ready` Gate 0 MUST відмовляти з exit code 1 (а не skip-ати), а `pipeline.archive_after_merge` MUST NOT перевірятись — людина завжди може заархівувати вручну.

#### Scenario: archive_after_merge false дає skip

- **GIVEN** `.agents/orchestrator.yaml` з `pipeline.archive_after_merge: false` і готовий до archive change
- **WHEN** виконується `archive <name> --sync --if-ready`
- **THEN** exit code 0, stdout містить рівно один рядок `skip: archive_after_merge is false`
- **AND** change лишається в `openspec/changes/<name>/`, каталог `openspec/changes/archive/` не створено

#### Scenario: Маркер Gate 0 дає skip замість помилки

- **GIVEN** активний change, у `metrics.json` якого `archivedAt` заповнено
- **WHEN** виконується `archive <name> --sync --if-ready`
- **THEN** exit code 0, stdout містить рядок, що починається з `skip: already archived — metrics.json archivedAt is set`
- **AND** `metrics.json` і main specs лишаються байт-у-байт незмінними

#### Scenario: Не готова зміна дає skip з блокерами status

- **GIVEN** change без `review.md` при `require_spec_review: true`
- **WHEN** виконується `archive <name> --sync --if-ready`
- **THEN** exit code 0, stdout містить `skip: not ready — no review.md`
- **AND** нічого не переміщено й не записано
- **WHEN** у change є незакритий таск `- [ ]`
- **THEN** stdout містить `skip: not ready — tasks incomplete`

#### Scenario: Change без tasks.md за require_spec_review false дає skip

- **GIVEN** `pipeline.require_spec_review: false` (профіль mvp) і каталог explore-стадії, де лежить лише `handoff.md` без `tasks.md`
- **WHEN** виконується `archive <name> --sync --if-ready`
- **THEN** exit code 0, stdout містить `skip: not ready — tasks incomplete`
- **AND** change лишається на місці й нічого не заархівовано (власний Gate 2 пропустив би відсутній `tasks.md`, тому готовність визначає спільна функція `status`)

#### Scenario: Готова зміна архівується як звичайно

- **GIVEN** `pipeline.archive_after_merge: true`, `review.md` з `Verdict: APPROVE`, усі таски `[x]`, жодного маркера Gate 0
- **WHEN** виконується `archive <name> --sync --if-ready`
- **THEN** exit code 0, stdout не містить рядка `skip:` і містить `archived <name>`
- **AND** change переміщено в `openspec/changes/archive/YYYY-MM-DD-<name>`, delta specs злито в `openspec/specs/`

#### Scenario: Без --if-ready archive_after_merge не перевіряється

- **GIVEN** `pipeline.archive_after_merge: false` і готовий до archive change
- **WHEN** виконується `archive <name>` без `--if-ready`
- **THEN** exit code 0 і change заархівовано
- **AND** Gate 0 за наявності маркера натомість відмовляє з exit code 1, а не друкує `skip:`

#### Scenario: Справжні збої лишаються гучними

- **GIVEN** готовий change, delta якого містить MODIFIED-вимогу, відсутню в main spec
- **WHEN** виконується `archive <name> --sync --if-ready`
- **THEN** exit code 1, stderr містить `sync conflict:` і `MODIFIED requirement not found in main spec`, stdout не містить рядка `skip:`
- **AND** так само exit code 1 і `archive gate failed — target already exists`, коли цільовий каталог `openspec/changes/archive/YYYY-MM-DD-<name>` уже існує

### Requirement: CI-архівація є opt-in у consumer-workflow-ах

Шаблони `templates/.github/workflows/agent-verify.yml` і `templates/.gitlab/agent-verify.yml` SHALL містити додатковий job архівації, який за замовчуванням вимкнений і вмикається лише явним `AOK_ARCHIVE_ON_MERGE=true` (змінна репозиторію на GitHub, CI/CD variable на GitLab); термінал лишається шляхом за замовчуванням. GitHub-job `archive` MUST мати `needs: verify`, умову `github.event_name == 'push' && github.ref_name == github.event.repository.default_branch && vars.AOK_ARCHIVE_ON_MERGE == 'true'`, `concurrency` з `group: agent-archive` і `cancel-in-progress: false`, `permissions: contents: write` та власний `actions/checkout` з `fetch-depth: 0` і `token: ${{ secrets.AOK_ARCHIVE_TOKEN || github.token }}` (окремий job, бо облікові дані checkout-а job-а `verify` перебили б токен із правом bypass на push). GitLab-job `agent-archive` MUST мати `extends: .agent-verify-base`, `needs: ["agent-verify"]` і `rules` з умовою `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $AOK_ARCHIVE_ON_MERGE == "true"` та пушити через CI/CD variable `AOK_ARCHIVE_TOKEN`. Обидва job-и MUST для кожного `openspec/changes/<name>/` (крім `archive`) викликати `npx agent-orchestrator-kit archive "$name" --sync --if-ready` — готовність вирішує CLI, а не YAML; потім `git add -A openspec`, нічого не комітити, коли `git diff --cached --quiet`, інакше зробити один коміт `chore(openspec): archive merged change [skip ci]` і запушити його в default-гілку. Коментар біля job-а MUST пояснювати opt-in змінну, токен із правом push у захищену гілку (branch-protection bypass), `[skip ci]` проти циклу запусків і те, що термінал — шлях за замовчуванням. Наявні job-и `verify`, `.agent-verify-base`, `agent-verify` і їхні кроки MUST лишатися без змін.

#### Scenario: GitHub-шаблон містить opt-in job archive

- **WHEN** парситься `templates/.github/workflows/agent-verify.yml`
- **THEN** `jobs` містить `verify` і `archive`, а `archive.needs` дорівнює `verify`
- **AND** `archive.if` містить `github.event_name == 'push'`, `github.event.repository.default_branch` і `vars.AOK_ARCHIVE_ON_MERGE == 'true'`
- **AND** `archive.concurrency` дорівнює `{ group: agent-archive, cancel-in-progress: false }`, а перший крок `actions/checkout@v5` має `fetch-depth: 0` і `token: ${{ secrets.AOK_ARCHIVE_TOKEN || github.token }}`
- **AND** кроки `run` містять `archive "$name" --sync --if-ready`, `git diff --cached --quiet` і коміт `chore(openspec): archive merged change [skip ci]`

#### Scenario: Без змінної AOK_ARCHIVE_ON_MERGE job не виконується

- **GIVEN** репозиторій, де змінна `AOK_ARCHIVE_ON_MERGE` не задана або не дорівнює `true`
- **WHEN** запускається workflow на push у default-гілку
- **THEN** умова job-а `archive` хибна, job пропускається, а `verify` виконується як раніше
- **AND** для GitLab правило `rules` job-а `agent-archive` не збігається, і job не створюється

#### Scenario: GitLab-фрагмент містить opt-in job agent-archive

- **WHEN** парситься `templates/.gitlab/agent-verify.yml`
- **THEN** верхні ключі — `.agent-verify-base`, `agent-verify`, `agent-archive`
- **AND** `agent-archive` має `extends: .agent-verify-base`, `needs: ["agent-verify"]` і єдине правило `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $AOK_ARCHIVE_ON_MERGE == "true"`
- **AND** його `script` викликає `archive "$name" --sync --if-ready`, комітить з `[skip ci]` і пушить через `oauth2:${AOK_ARCHIVE_TOKEN}` у `HEAD:${CI_DEFAULT_BRANCH}`

#### Scenario: Наявні job-и не змінені

- **WHEN** порівнюються шаблони до й після зміни
- **THEN** GitHub-job `verify` має ті самі кроки, що й раніше (multi-PM, OpenSpec validate, gate-check, lint, build, test), а GitLab `.agent-verify-base` і `agent-verify` лишаються без змін

#### Scenario: README описує opt-in і застереження

- **WHEN** читається розділ Archive у `README.md`
- **THEN** він називає змінну `AOK_ARCHIVE_ON_MERGE`, секрет `AOK_ARCHIVE_TOKEN`, потребу в bypass захищеної гілки й `[skip ci]`
- **AND** попереджає, що Cursor `sessionEnd`-hook може дописати leftover у локальний `metrics.json` і дати конфлікт із CI-комітом

### Requirement: Archive з терміналу не потребує клієнта IDE

`npx agent-orchestrator-kit archive <name> --sync`, запущений зі звичайного терміналу (жодного `CURSOR_*`, `CLAUDE*`, `AMP_*` env і без `--platform`), SHALL завершуватись exit code 0 за закритих гейтів, фіналізувати `metrics.json` (`archivedAt` заповнено, `pending: null`) і додавати сесію `Archiver` з `platform: null` (за capability `change-metrics`, вимога «Опційна платформа сесії»), `spendSource: "unreported"` і без токенів. Попередження `metrics: …` у stderr (невідомий клієнт, `null` модель, `null` USD) MUST NOT впливати на exit code. Існуючі сесії change-у й механізм leftover (`metricsPrepareArchiveStart` приєднує leftover до останньої не-Archiver сесії) та вся семантика вимоги «Archive завжди фіналізує metrics.json після успішного move» лишаються без змін: ця вимога фіксує лише, що запуск без клієнта IDE її не ламає.

#### Scenario: Terminal archive без env клієнта

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і `metrics.json` з однією сесією `Implementer`; у середовищі немає `CURSOR_*`, `CLAUDE*`, `AMP_*`
- **WHEN** виконується `archive <name> --sync` з терміналу
- **THEN** exit code 0, а в архівному `metrics.json` `archivedAt` заповнено і `pending` дорівнює `null`
- **AND** сесія `Archiver` має `platform: null`, `spendSource: "unreported"` і `inputTokens: null`
- **AND** сесія `Implementer` лишилась без змін
- **AND** stderr містить попередження `metrics: …`, що не змінюють exit code

## MODIFIED Requirements

### Requirement: Тонка команда opsx-archive

Команда `templates/.agents/commands/opsx-archive.md` SHALL бути тонкою fallback-обгорткою над CLI: нормальний шлях archive — термінал (`npx agent-orchestrator-kit archive <name> --sync`) або opt-in CI, а команду використовують лише коли це було неможливо чи CLI відмовив. Вона SHALL резолвити ім'я change, викликати `archive`, показувати stdout, а на exit ≠ 0 друкувати відмову зі stderr і зупинятись. Вона MUST NOT спавнити phase-субагентів, MUST NOT містити інструкцій ручного merge specs чи move і MUST NOT містити блоку Session Start / Exit (фінальний `handoff.md` пише CLI).

#### Scenario: Розмір і зміст команди

- **GIVEN** встановлений kit після `init` або `update`
- **WHEN** читається `.agents/commands/opsx-archive.md`
- **THEN** файл ≤ 1.5 KB, не містить підрядка `spec-archiver`, містить виклик `npx agent-orchestrator-kit archive`

#### Scenario: Нормальний шлях — термінал, команда — fallback

- **WHEN** читається `.agents/commands/opsx-archive.md`
- **THEN** перший абзац називає термінал (`npx agent-orchestrator-kit archive <name> --sync`) або opt-in CI нормальним шляхом, а команду — fallback
- **AND** файл не має заголовків Session Start / Session Exit

#### Scenario: Відмова CLI друкується і зупиняє команду

- **WHEN** `archive` у fallback-чаті завершується з exit code ≠ 0
- **THEN** команда друкує відмову зі stderr і зупиняється
- **AND** не виконує ручний merge чи move

### Requirement: Гейті archive не залежать від metrics.json

Гейті команди `npx agent-orchestrator-kit archive <name>` (review APPROVE, усі таски `[x]`, явне sync-рішення, вільний target-шлях, rollback при падінні `openspec validate --all --strict`) MUST NOT включати перевірку наявності, вмісту чи заповненості `metrics.json` або секції `## Metrics` у `handoff.md`, за єдиним винятком Gate 0 (наступний абзац). Відсутній `metrics.json`, порожній spend, `null` модель, відсутній самозвіт і порожній collect MUST NOT робити exit code успішного archive ненульовим.

Виняток — Gate 0 (вимога «Gate 0: archive відмовляє для вже заархівованої зміни»): archive MUST відмовити лише за **позитивного** свідчення, що АКТИВНИЙ каталог change-у вже заархівовано, — валідний JSON `metrics.json` із непорожнім `archivedAt` або `## Next command` = `none` у `handoff.md`. Відсутній, нечитабельний, невалідний чи порожній `metrics.json`, відсутній `handoff.md` і відсутня секція `## Metrics` ніколи не є причиною відмови; Gate 0 читає `## Next command`, а не `## Metrics`, і не оцінює вміст чи заповненість метрик.

Невалідне значення `--platform` (не `cursor` / `claude` / `amp`) MUST відхилятись **до** переміщення change: команда завершується non-zero і не рухає файли.

Семантика самої фіналізації `metrics.json` на archive — створення файлу, `archivedAt`, `pending: null`, сесія `Archiver` / `archive` з `startedAt` з pending start і `durationMs` = дельта (не штучний `null`), leftover попередньої сесії до вікна Archiver, ланцюжки резолву `model` / `platform` / spend, opt-in `--collect`, warning про `null` `spend.costUsd` і зводка в stdout — належить capability `change-metrics` (див. «Archive завжди фіналізує metrics.json після успішного move»). `lean-archive` MUST NOT дублювати ці правила.

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

#### Scenario: Невалідний або порожній metrics.json не блокує archive

- **GIVEN** change із закритими гейтами і `metrics.json` з невалідним JSON, або з `archivedAt: null`, або з порожнім `archivedAt`
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** exit code 0 і change заархівовано

#### Scenario: Заповнений archivedAt в активному каталозі — єдиний виняток

- **GIVEN** change із закритими гейтами і `metrics.json`, де `archivedAt` заповнено
- **WHEN** виконується `archive <name>`
- **THEN** exit code ≠ 0 за Gate 0, а не за вмістом чи заповненістю метрик
- **AND** change лишається в `openspec/changes/<name>/`
