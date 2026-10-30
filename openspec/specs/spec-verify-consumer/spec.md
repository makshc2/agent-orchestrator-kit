## Purpose

Opt-in AI Spec Verifier for consumer projects: Amp agent checks changed `src/` against `openspec/specs/` on MRs/PRs and can block the pipeline on BLOCKED.

## Requirements

### Requirement: init --spec-verify installs AI Spec Verifier files for GitLab

When `init` is run with `--ci gitlab --spec-verify`, the CLI SHALL install `.gitlab/spec-verify.yml`, `scripts/verify-specs.sh`, and `scripts/post-mr-verdict.sh` into the consumer project and make the scripts executable.

#### Scenario: GitLab init with spec-verify flag

- **WHEN** `agent-orchestrator-kit init --ci gitlab --spec-verify` runs in a project
- **THEN** `.gitlab/spec-verify.yml` exists in the project
- **AND** `scripts/verify-specs.sh` and `scripts/post-mr-verdict.sh` exist

#### Scenario: GitLab init without the flag

- **WHEN** `agent-orchestrator-kit init --ci gitlab` runs without `--spec-verify`
- **THEN** none of the spec-verify files are installed

#### Scenario: spec-verify flag with --ci none

- **WHEN** `init --ci none --spec-verify` runs
- **THEN** the CLI prints a warning that spec-verify requires `--ci gitlab` or `--ci github`
- **AND** no spec-verify files are installed

### Requirement: Spec verify CI fragment is blocking by default

The installed `.gitlab/spec-verify.yml` SHALL define a `spec-verify` job that runs on merge request events with `src/**/*` changes and SHALL NOT contain an active `allow_failure: true` directive. A commented Phase 1 fallback SHALL document how to make the job non-blocking.

#### Scenario: Fragment inspected after install

- **WHEN** the installed `.gitlab/spec-verify.yml` is inspected
- **THEN** job `spec-verify` extends a hidden base job
- **AND** rules restrict it to merge request events with `src/**/*` changes
- **AND** no uncommented `allow_failure: true` is present
- **AND** artifacts include `artifacts/verdict.json`

### Requirement: Verifier script degrades gracefully and never logs secrets

`scripts/verify-specs.sh` SHALL write a skipped passing verdict and exit 0 when there are no `src/` changes, no spec files, no `amp` CLI, or no `AMP_API_KEY`. The script SHALL NOT print token or key values and SHALL exclude sensitive file patterns from prompt content. Skipped verdicts MUST include empty `implemented`, `missing`, and `scope_creep` arrays.

#### Scenario: Missing AMP_API_KEY in CI

- **WHEN** `verify-specs.sh` runs without `AMP_API_KEY` set
- **THEN** `artifacts/verdict.json` contains `"pass": true` and `"skipped": true`
- **AND** the script exits 0 without printing any secret values

#### Scenario: Sensitive files excluded from prompt

- **WHEN** changed files include paths matching `.env`, `secret`, `token`, `key`, `.pem`, or `.p12` patterns
- **THEN** their content is not included in the verifier prompt

#### Scenario: All skipped paths include empty conformance groups

- **GIVEN** no changed source files, no specs, no Amp executable, or no API key
- **WHEN** the corresponding skip path writes the verdict
- **THEN** `implemented`, `missing`, and `scope_creep` are `[]`
- **AND** pass remains true, score remains 100, skipped remains true, and findings remains empty

### Requirement: Orchestrator gates include spec-verify-blocking when opted in

When `--spec-verify` is used with `--ci gitlab`, the CLI SHALL add `spec-verify-blocking` to `roles.verifier.gates` in `.agents/orchestrator.yaml`, idempotently.

#### Scenario: Gates patched on init

- **WHEN** `init --ci gitlab --spec-verify` completes
- **THEN** `.agents/orchestrator.yaml` lists `spec-verify-blocking` under verifier gates
- **AND** running init again does not duplicate the gate entry

### Requirement: update refreshes spec-verify files only when previously installed

The `update` command SHALL overwrite `.gitlab/spec-verify.yml`, `scripts/verify-specs.sh`, and `scripts/post-mr-verdict.sh` only if the corresponding file already exists in the consumer project.

#### Scenario: Project with spec-verify installed

- **WHEN** `update` runs in a project where `.gitlab/spec-verify.yml` exists
- **THEN** the fragment and scripts are refreshed from kit templates

#### Scenario: Project without spec-verify

- **WHEN** `update` runs in a project where spec-verify files are absent
- **THEN** no spec-verify files are created

### Requirement: Additive conformance report contract

Verifier-промпт SHALL вимагати `implemented`, `missing`, `scope_creep` як масиви поруч із чинними полями verdict. Елемент MUST мати `spec`, `requirement`, `message`, `file`, `line`; `file` є source path або null, `line` — додатне ціле або null. `missing` і `scope_creep` MUST мати наданий `file`. Одна розбіжність MUST потрапляти рівно в одну групу. Legacy verdict без груп MUST залишатися підтриманим.

#### Scenario: Three meanings remain distinct

- **WHEN** читаються інструкції verifier-промпту
- **THEN** implemented означає підтверджену наданим кодом поведінку релевантної вимоги
- **AND** missing означає позитивну вимогу, поведінка якої відсутня або неповна в наданому файлі, де її очікує вимога
- **AND** scope_creep означає код, що робить заборонене чи виключене вимогою або явною межею

#### Scenario: Missing requires a provided file

- **GIVEN** модель не може назвати наданий файл, де очікується поведінка
- **WHEN** промпт задає критерії оцінювання
- **THEN** він забороняє елемент missing без file і вимагає warning або info finding про невизначеність
- **AND** line для missing може бути null, file — ні

#### Scenario: One discrepancy lands in one group

- **WHEN** промпт описує класифікацію розбіжностей
- **THEN** невиконана позитивна вимога потрапляє лише в missing, порушена заборона чи виключення — лише в scope_creep
- **AND** код без порушеної заборони, що робить інше, ніж вимагає позитивна вимога, є missing, не scope_creep

#### Scenario: Limited context is not evidence of absence

- **GIVEN** реалізація може бути в незміненому файлі поза наданим контекстом
- **WHEN** промпт задає критерії оцінювання
- **THEN** він забороняє вважати це доказом missing чи error і вимагає warning/info про невизначеність
- **AND** файл без відповідної спеки лишається info finding, не автоматичним scope_creep

### Requirement: Findings retain the verdict policy

Промпт MUST зберігати `findings` як джерело severity: pass false за наявності error, інакше true; score дорівнює max(0, 100 − 10 × errors − 3 × warnings). Кожен елемент missing/scope_creep MUST мати один дзеркальний finding із тими самими spec, requirement, file, line; він рахується один раз, елемент групи штрафу не додає. Скрипти MUST NOT додавати новий gate або переоцінювати legacy verdict.

#### Scenario: Mirrored finding severity

- **WHEN** промпт описує дзеркальні findings
- **THEN** missing дає error для SHALL/MUST при повній відсутності поведінки у вказаному файлі, інакше warning
- **AND** scope_creep дає error за порушення SHALL NOT/MUST NOT, інакше warning
- **AND** implemented не має finding

#### Scenario: Mirrored finding is counted once

- **WHEN** промпт описує підрахунок score
- **THEN** він вимагає ті самі spec, requirement, file і line у дзеркальному finding
- **AND** забороняє другий finding для тієї самої розбіжності та штраф за сам елемент групи

#### Scenario: Groups do not override passing verdict

- **GIVEN** verdict із warning-only findings, pass true та непорожньою групою missing
- **WHEN** скрипти зберігають і відображають verdict
- **THEN** pass і score не змінюються, статус лишається PASS
- **AND** промпт рахує severity лише за findings

#### Scenario: Error still blocks

- **GIVEN** verdict із error finding і pass false
- **WHEN** verdict потрапляє до чинного CI workflow
- **THEN** існуюча перевірка pass завершує job ненульовим кодом
- **AND** жодна група implemented не скасовує BLOCKED

### Requirement: Evidence uses original source line numbers

Дозволені source-файли у промпті SHALL мати 1-based нумерацію всіх оригінальних рядків, включно з порожніми, інструментом без семантики роздільників (`awk` із `NR`, не `nl`). Промпт MUST вимагати ці координати для findings і груп або null, коли місце невідоме. Нумерація MUST застосовуватися після чинного sensitive-path фільтра і не змінювати scope збору файлів.

#### Scenario: Blank lines preserve coordinates

- **GIVEN** дозволений файл має порожній другий рядок і реалізацію в третьому
- **WHEN** створюється verifier prompt
- **THEN** реалізація позначена рядком 3 цього файла
- **AND** інструкції забороняють підміняти координати номерами рядків diff або зібраного промпту

#### Scenario: Delimiter-like lines and missing final newline

- **GIVEN** файл містить рядки `\:\:\:` і `\:` та останній рядок без кінцевого переносу
- **WHEN** створюється verifier prompt
- **THEN** усі рядки мають суцільну нумерацію від 1 без пропусків і скидання лічильника
- **AND** останній рядок має свій номер

#### Scenario: Unknown location

- **WHEN** промпт описує finding або implemented без доведеного місця реалізації
- **THEN** він дозволяє line null і вимагає file null, якщо шлях також невідомий

### Requirement: Preserve complete JSON responses and inconclusive fallback

Verifier SHALL зберігати повний JSON object із відповіді Amp без 200-рядкового обрізання, включно з legacy та новими полями. Відповідь MUST передаватися Python через тимчасовий файл у `artifacts/` (видаляється після обробки), не через argv чи env. Невалідний кандидат або помилка Python MUST давати inconclusive verdict із `"inconclusive": true` і трьома порожніми групами, без підміни вкладеним object і без аварії скрипта.

#### Scenario: Large report survives extraction

- **GIVEN** валідний verdict містить понад 200 рядків і всі три групи
- **WHEN** обробляється відповідь Amp
- **THEN** збережений JSON містить усі елементи та поля без обрізання і не є fallback

#### Scenario: Response above the argument-size limit

- **GIVEN** валідний verdict займає понад 131 072 байти
- **WHEN** обробляється відповідь Amp
- **THEN** він зберігається повністю і не є fallback

#### Scenario: Legacy and fenced responses

- **WHEN** Amp повертає legacy object без груп, compact object або object у markdown fence
- **THEN** він зберігається без втрати полів і без обов'язкової міграції груп
- **AND** текст навколо коректного JSON object допускається, якщо `{` починає рядок

#### Scenario: Invalid response is inconclusive

- **WHEN** відповідь не містить валідного verdict object або перший кандидат пошкоджений
- **THEN** fallback має pass true, score 50, skipped false, `"inconclusive": true` та чинний warning finding
- **AND** implemented, missing, scope_creep є порожніми масивами
- **AND** валідний вкладений finding не використовується як verdict

#### Scenario: Object after text on the same line

- **GIVEN** відповідь має вигляд `Verdict: {…}` на одному рядку
- **WHEN** обробляється відповідь Amp
- **THEN** результат є inconclusive fallback: кандидат починається лише з рядка, що починається з `{`

#### Scenario: Python failure does not abort the script

- **GIVEN** Python-екстракція завершується ненульовим кодом або `python3` недоступний
- **WHEN** скрипт працює під `set -euo pipefail`
- **THEN** записується inconclusive fallback і скрипт завершується з кодом 0

### Requirement: Provider comments present compatible conformance groups

GitLab і GitHub comment-скрипти SHALL зберігати Summary, Score, Findings, статус і після `### Findings`, перед футером `---`, додавати `### Implemented`, `### Missing`, `### Scope creep` з колонками Spec, Requirement, Evidence, File. Вони MUST підтримувати legacy verdict, читати файл незалежно від cwd та відрізняти ненадану, порожню й неперевірену групу.

#### Scenario: Section order and columns

- **GIVEN** verdict містить елементи всіх трьох груп
- **WHEN** будується PR або MR коментар
- **THEN** заголовки йдуть у порядку Findings, Implemented, Missing, Scope creep, потім `---`
- **AND** кожна таблиця має колонки `| Spec | Requirement | Evidence | File |`, Evidence — це message

#### Scenario: Legacy and empty groups remain distinguishable

- **WHEN** не-skipped, не-inconclusive verdict має групу відсутньою, null або не масивом
- **THEN** її секція містить `_Not reported by this verifier._`
- **WHEN** така група є порожнім масивом
- **THEN** її секція містить `_None reported._`

#### Scenario: Skipped verdict is not confirmed coverage

- **GIVEN** verdict має `"skipped": true`, із групами чи без
- **WHEN** будується коментар
- **THEN** усі три секції містять `_Not checked — verification skipped._`, і жодна не містить `_None reported._`

#### Scenario: Inconclusive verdict is not confirmed coverage

- **GIVEN** verdict має `"inconclusive": true` і `"skipped"` не true
- **WHEN** будується коментар
- **THEN** усі три секції містять `_Not checked — verifier response was inconclusive._`, і жодна не містить `_None reported._`
- **AND** маркер, а не текст summary, визначає цей підпис; `skipped: true` має пріоритет над `inconclusive`

#### Scenario: GitLab comment above the argument-size limit

- **GIVEN** verdict, чий JSON-payload для GitLab перевищує 131 072 байти (кирилиця в `json.dumps` дає 6 байтів на літеру)
- **WHEN** виконується `post-mr-verdict.sh` з fake curl, що повертає HTTP 201
- **THEN** payload передається з файла або stdin (`--data-binary`), а не одним аргументом, і доходить цілком як валідний JSON
- **AND** скрипт завершується з кодом 0, а заголовки, токен і JSON POST збережені

#### Scenario: Malformed entries do not break comments

- **GIVEN** група містить non-object елементи поряд із коректними
- **WHEN** будується таблиця
- **THEN** non-object елементи пропускаються
- **AND** якщо придатних елементів немає, секція містить `_Not reported by this verifier._`

#### Scenario: Provider parity and working directory

- **GIVEN** однаковий verdict і виконання скриптів поза коренем проєкту
- **WHEN** fake gh і fake curl перехоплюють тіла коментарів у тесті
- **THEN** тіла від `### Findings` до футера однакові
- **AND** verdict береться з `$VERDICT_FILE`, а не з файла в cwd
- **AND** production-відправка зберігає чинні provider auth та skip-правила

### Requirement: Provider comments render cells and coordinates safely

Comment-скрипти MUST екранувати кожну комірку таблиць (групи та findings): `|` → `\|`, `\r\n`, `\r`, `\n` → один пробіл; null або відсутнє → `—`, не-рядок → його JSON-вигляд. `file:line` MUST з'являтися лише для file — непорожнього рядка — і line — JSON-цілого > 0. Некоректні дані MUST NOT піднімати виняток.

#### Scenario: Evidence and valid coordinates

- **GIVEN** елементи груп і findings мають відомий file і line 12
- **WHEN** будується PR або MR коментар
- **THEN** File показує `file:12`
- **AND** boolean, float (`3.0`), рядок (`"3"`), нульовий, від'ємний і null line дають лише `file`

#### Scenario: Unknown file

- **GIVEN** file null, відсутній, порожній рядок або не рядок, а line заданий
- **WHEN** будується коментар
- **THEN** File показує `—`

#### Scenario: Findings tolerate malformed data

- **GIVEN** `findings` не є масивом, або містить non-object елементи, null-поля чи non-string severity
- **WHEN** будується коментар
- **THEN** non-object елементи пропускаються, null-поля показуються як `—`, non-string severity дає іконку ⚪
- **AND** `findings`, що відсутнє, null, не масив, порожнє або без object-елементів, дає `_No findings._`
- **AND** жодна з цих вхідних даних не призводить до винятку і зупинки кроку

#### Scenario: Pipes and line breaks stay inside the cell

- **GIVEN** значення комірки містить `|`, CR, LF або CRLF
- **WHEN** будується таблиця групи чи findings
- **THEN** `|` стає `\|`, кожна послідовність переносу — одним пробілом
- **AND** це застосовано до Spec, Requirement, Evidence/Message та File
