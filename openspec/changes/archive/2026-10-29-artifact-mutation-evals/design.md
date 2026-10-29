## Context

Explore завершено 2026-10-29. План: `docs/course-derived-plan-2026-10-29.md`, розділ 2. Поточний `runTier1Review` у `bin/agent-orchestrator.js` запускає `npx openspec validate`, task-contract lint, перевірки proposal, delta та `planSpecSync`. Він не експортований; CLI `--json` повертає лише `{ pass, errors }`, хоча внутрішній результат має warnings. За відсутності `.agents/orchestrator.yaml` task contract працює в `warn`.

`test/tier1-delta-heading-check.test.js` уже перевіряє heading-check через CLI, але використовує validate-stub. Новий eval вимірює весь Tier 1 на невеликому явно заданому корпусі. `npm test` включає `test/*.test.js`, CI вже запускає його після `npm ci`.

## Goals / Non-Goals

**Goals:** відтворювана таблиця детекції; чисті контрольні фікстури; по одному дефекту на кейс; обов'язкове виявлення структурних дефектів; видимі відомі прогалини; запуск без мережі та LLM.

**Non-Goals:** нові перевірки production-гейта, новий експорт, лінт якості Done-when, зміна verdict/JSON schema, Tier 2, зміни шаблонів, випадковий mutation engine. `spec-verify-conformance-report` залишається наступним окремим change з аналізом `head -200` і нумерації рядків.

## Decisions

### D1. Викликати CLI, залишити runTier1Review приватним

Запускати `process.execPath` з абсолютним шляхом до `bin/agent-orchestrator.js` та аргументами `gate-check --review <fixture-change> --json`, `cwd` — тимчасовий проєкт. Перевіряти і exit status, і JSON. Так eval охоплює реальний публічний шлях без зміни runtime-файлів.

Альтернатива — експортувати функцію: дешевше за процес, дає warnings, але додає production API лише заради eval і не перевіряє CLI exit/serialization. Парсинг кольорового текстового stdout також відхилено як крихкий.

### D2. Фіксований strict і справжній локальний валідатор

Кожна фікстура має `pipeline.task_contract: strict`; `artifact_budget: off` прибирає незалежний від цього корпусу фактор. Результати описують саме цей профіль, а не default warn. Відсутність Done-when є вже наявним структурним lint; семантика заповненого поля не отримує нового lint.

Замість validate-stub використовувати OpenSpec із `node_modules/@fission-ai/openspec`, встановлений через lockfile. У тимчасовому PATH створити вузький executable `npx` launcher: приймає лише очікуваний виклик `openspec validate <name> --strict --type change`, запускає локальний bin через `process.execPath`, передає stdout/stderr/status; невідомі аргументи відхиляє. Це адаптер запуску без package resolution/download, а не підміна результату validate. Відсутній локальний пакет — setup failure, без fallback на global/npx install. Вимкнути telemetry через `OPENSPEC_TELEMETRY=0` і `DO_NOT_TRACK=1` (підтримані локальним `dist/telemetry/index.js`), npm online resolution не використовувати. Node — той, під яким працює репозиторій/CI; нової вимоги engines цей change не вводить.

Для кейсів, де очікується помилка upstream validate, окремо викликати той самий локальний OpenSpec `validate <name> --strict --type change --json` та перевірити очікуваний issue. Gate зберігає лише перший рядок помилки валідатора, тому один його загальний префікс не доводить причину падіння. Решта кейсів повинні мати успішний validate: це унеможливлює маскування дефекту поломкою fixture/setup.

Альтернатива зі stub швидша, але не вимірює validate-складову Tier 1. Режим warn потребує зміни JSON або парсингу тексту й не дає однозначного блокувального результату.

### D3. Два заморожені проєкти з provenance

Структура майбутнього корпусу:

```text
test/artifact-mutation-evals.test.js
test/fixtures/mutations/README.md
test/fixtures/mutations/synthetic/       # мінімальний повний OpenSpec-проєкт
test/fixtures/mutations/real-tier1/      # адаптований snapshot реальної зміни
```

Кожен проєкт містить config, proposal/design/tasks/delta, відповідні main specs і потрібні локальні файли-заглушки для `Files:`. У синтетичному — одна MODIFIED-вимога з єдиним scenario та окрема ADDED-вимога; main містить MODIFIED-заголовок, а ADDED-заголовка не містить. Усі baseline task-контракти структурно валідні. Фіксовані імена synthetic (на них спираються мутації та matchers): зміна `synthetic-change`, capability `sample-capability`, вимоги `Sample modified requirement` (MODIFIED) і `Sample added requirement` (ADDED), заглушка `src/sample.txt`. Перший таск synthetic приписує додати в `src/sample.txt` рядок `New marker is present`, а його Done-when перевіряє наявність цього нового стану; це передумова S10. Конфіги кожного проєкту: `.agents/orchestrator.yaml` (strict/off) і `openspec/config.yaml` (`schema: spec-driven`). У real-tier1 зміна називається `tier1-delta-heading-check` (без дати), а заглушки створюються для `bin/agent-orchestrator.js`, `templates/.agents/commands/opsx-review.md`, `templates/.agents/subagents/spec-reviewer.md`, `test/tier1-delta-heading-check.test.js`.

Джерело real-tier1: `openspec/changes/archive/2026-10-02-tier1-delta-heading-check/` у коміті `046e5f3e6955493b3857b3487bd344c16582c67f`. Копіювати proposal, design, tasks і обидві delta specs. Зберегти текст delta-вимог і сценаріїв. Main specs `tiered-review` і `lean-archive` взяти з того самого коміту; із main `lean-archive` вилучити повний блок ADDED-вимоги `Sync застосовує RENAMED Requirements`, що вже потрапив туди після archive. Це реконструйований сумісний baseline, не заява про точний історичний стан до review. Для кожного наявного шляху з `Files:` створити порожню заглушку в fixture; шляхи з `new file:` не потребують заглушок. Файли-заглушки не виконувати. Не копіювати review/handoff/metrics.

README фіксує source commit, перелік скопійованих файлів, усі адаптації та профіль eval. На runtime корпус не читає архів, поточні main specs або git history. Альтернатива live-copy коротша, але зміна архіву/main specs змінювала б baseline без редагування eval-корпусу.

### D4. Малий явний корпус і контроль мутацій

Кейси задані в тестовому JS як дані: `id`, `fixture`, `defectClass`, `expectation` (`must-catch` / `known-gap`), `reason`, mutator і matcher очікуваних diagnostics. Кожен mutator перевіряє, що ціль знайдено рівно один раз, та що результат відрізняється від baseline. Для видалення секції змінюється весь відповідний блок, а не випадкова згадка слова в прозі чи code fence.

Початкова матриця:

| ID | Fixture | Єдина мутація | Очікування / діагностика |
|---|---|---|---|
| S01 | synthetic | Видалити Done-when першого task | must-catch: `missing Done-when:` |
| S02 | synthetic | Додати `as needed` у Do першого task | must-catch: `vague wording in Do:` |
| S03 | synthetic | Files вказує на відсутній шлях без `new file:` | must-catch: `Files: path does not exist:` |
| S04 | synthetic | Видалити Non-goals із proposal | must-catch: `missing "Non-goals" section` |
| S05 | synthetic | Видалити Acceptance criteria із proposal | must-catch: `missing "Acceptance criteria" section` |
| S06 | synthetic | Залишити delta лише з порожнім operation heading | must-catch: `no non-empty ADDED/MODIFIED/REMOVED/RENAMED Requirements section` і validate issue про відсутні entries/deltas |
| S07 | synthetic | Замінити MODIFIED-заголовок на унікальне відсутнє ім'я | must-catch: `MODIFIED requirement not found in main spec` з цим ім'ям |
| S08 | synthetic | Видалити єдиний scenario MODIFIED-вимоги | must-catch: validate issue про відсутній scenario цієї вимоги |
| S09 | synthetic | Перенести одну вимогу з MODIFIED у ADDED, зберігаючи її заголовок і тіло та незалежну ADDED-вимогу | must-catch: `ADDED requirement already exists in main spec`; одна логічна мутація operation MODIFIED → ADDED, решта delta валідна |
| S10 | synthetic | Замінити Done-when на `Old marker is absent`, хоча Do вимагає додати новий стан | known-gap: структурно поле є, семантику не перевіряють |
| S11 | synthetic | Додати другу валідну активну зміну з тим самим MODIFIED-заголовком і несумісним тілом | known-gap: перевіряється цільова зміна проти main, не міжзмінний конфлікт |
| R01 | real-tier1 | Видалити Done-when першого task | must-catch: `missing Done-when:` |
| R02 | real-tier1 | Додати `as needed` у Do першого task | must-catch: `vague wording in Do:` |
| R03 | real-tier1 | Змінити заголовок MODIFIED `Скриптовий Tier 1 перед LLM-review` на унікальне відсутнє ім'я | must-catch: heading conflict із цим ім'ям |

S06 лишає в delta єдиний рядок `## ADDED Requirements` без вимог. S09 реалізується як заміна operation для однієї вимоги з коректним перегрупуванням секцій (блок переходить у кінець секції ADDED, порожній заголовок MODIFIED видаляється); існуюча незалежна ADDED-вимога зберігається. S10 замінює pristine Done-when першого таска (який перевіряє новий стан) на `Old marker is absent`. У S11 сусідня зміна — `neighbor-change`, копія `synthetic-change` з delta лише з тим самим MODIFIED-заголовком, текстом `The system SHALL reject the new value.` і одним scenario; перед вимірюванням її окрема валідність підтверджується прямим validate. Конфлікт має бути між різними тілами одного заголовка; до додавання сусіда цільовий baseline проходить, а сусід окремо валідний. Виклик gate спрямований на вихідну зміну. Це adversarial fixture, а не дозвіл кількох активних changes у робочому процесі. Специфікація не забороняє майбутнього детектора колізій; тут він не додається.

### D5. Класифікація без хибних caught

Спочатку перевірити кожен pristine baseline: validate exit 0; gate exit 0, `pass: true`, `errors: []`. Якщо baseline несправний, його mutants не виконувати і suite падає. Кожен кейс отримує новий `mkdtemp` і копію fixture; cleanup — через `finally`/test cleanup навіть при assert failure. На CLI встановити timeout 60000 мс, обмеження буфера 1 MiB (`maxBuffer: 1048576`) й ізольовані user/config/data/cache каталоги; не запускати `init`, `archive`, handoff, metrics чи будь-який LLM.

`caught` = нормальне завершення exit 1 + `pass: false` + усі потрібні diagnostics саме цього класу. Усі інші errors повинні входити до явно дозволеного для кейса набору (S06 законно зачіпає і validate, і delta parser). `missed` = нормальне завершення exit 0 + `pass: true` + порожні errors. Timeout, signal, parse/schema error, інший exit або непов'язана діагностика — `invalid`, падає тест і не зараховується як caught/missed.

Для `must-catch` missed падає. Для `known-gap` missed проходить і лишається видимим; новий цільовий caught теж проходить з позначкою `newly caught`. Matcher gap мусить ідентифікувати його причину: S10 — діагностика якості Done-when конкретного task; S11 — діагностика колізії з capability, заголовком і обома change names. Не застосовувати matcher «будь-яка помилка». Якщо майбутній detector має інший формат, явно оновити matcher під час його розробки; це не привід додавати detector зараз.

Альтернатива — вимагати exact missed для known-gap — закріпила б дефект як бажану поведінку. Натомість зростання коректної детекції допускається. Невідомі пропуски не можна автоматично переводити в known-gap, щоб приховати regression.

### D6. Звіт як diagnostics node:test

Послідовні awaited subtests збирають результати; після них `t.diagnostic` друкує Markdown-таблицю зі стабільним порядком рядків за ID і колонками ID, profile (`strict`), fixture, defect class, expectation, caught/missed/invalid, reason. Додати підсумок `caught / total`, перелік missed known-gap та newly caught. Baseline виключений зі знаменника. Якщо є invalid/setup failure, summary позначається incomplete і score не подається як валідне вимірювання: у такому виводі немає жодної частки `caught / total`, лише слово `incomplete` і причина. Без timestamp, абсолютних temp-paths, persisted verdict або snapshot результату, який треба вручну оновлювати.

Це частка виявлення на цьому корпусі у strict-режимі, не оцінка всіх можливих дефектів або default-конфігурації. Наявний glob npm test підхопить файл; package.json і workflow не змінюються.

## Risks / Trade-offs

- Процес на кожний кейс дорожчий за function call → корпус обмежений явною матрицею; локальний launcher не запускає npm package resolution.
- OpenSpec може змінити diagnostics → lockfile, targeted issue matching, явний setup failure; не вважати generic validate failure виявленим дефектом.
- Реальна архівна зміна вже синхронізована з main → заморожена документована реконструкція й обов'язковий baseline; не читати живі specs у тесті.
- Грубий matcher може приховати сторонню помилку → дозволені diagnostics на кейс і validate oracle для upstream-помилок.
- Не всі класи Tier 1 охоплені (наприклад, бюджети та всі RENAMED-комбінації) → таблиця називає точний корпус; чинні regression-тести залишаються.

## Migration Plan

Додати лише тест і fixture-дерева, перевірити targeted test та `npm test`. Production rollout/міграції відсутні; rollback — видалення нового eval-корпусу. Реалізація лише в окремій apply-сесії після review.

## Open Questions

Блокувальних питань немає. Рішення для цього change: CLI, strict, synthetic + archived tier1 snapshot, collision як known-gap. Нові lint-кандидати та LLM-eval оцінювати за фактичним звітом після реалізації.
