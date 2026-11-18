## ADDED Requirements

### Requirement: Покроковий вердикт Task verdicts

`spec-reviewer` і `/opsx:review` MUST писати в `review.md` блок `## Task verdicts`: один рядок на таск `<id> | ✓/✗ | причина`, і список УСІХ blockers за один прохід. Авторство блока обов'язкове; скрипт `gate-check --review-md` MUST NOT його вимагати (старі файли лишаються валідними).

#### Scenario: RC містить Task verdicts

- **GIVEN** Tier 2 знайшов blocker у таску 2.1 і не знайшов у 2.2
- **WHEN** `spec-reviewer` пише `review.md`
- **THEN** файл містить `## Task verdicts` з рядками `2.1 | ✗ | <причина>` і `2.2 | ✓ | <причина>`

#### Scenario: Файл без Task verdicts проходить скрипт

- **GIVEN** `review.md` у форматі до цього change без блока `Task verdicts`
- **WHEN** виконується `gate-check --review-md <name>`
- **THEN** `pass` є `true`, якщо решта схеми дотримана

### Requirement: Порядок повторного review

Повторне review MUST спершу перевірити кожен Previous finding (`resolved`/`unresolved` з evidence), потім виконати повний наявний чекліст Tier 2 і додатково скан тих самих LLM-only класів дефекту. Нових класів чекліста немає. Обмеження «той самий клас» стосується лише додаткового скану, не виключає решту пунктів чекліста і не охоплює класи Tier 1.

#### Scenario: Повний чекліст зберігається

- **GIVEN** попередній finding був про самодостатність таску, а виправлення створило конфлікт із main spec
- **WHEN** виконується повторне review
- **THEN** спершу фіксуються статуси Previous findings
- **AND** пункт чекліста про конфлікти з main specs виконується так само повно, як у першому review

### Requirement: Визначення blocker

`Required Before Apply` SHALL містити лише blockers: таск неможливо виконати; суперечність main specs чи Non-goals; суттєва суперечність між proposal, design, tasks і delta specs; поведінка design без покриття в delta чи tasks. Major і Minor, які виконавець apply виправляє в межах однозначного затвердженого контракту Files/Do/Done-when, MUST іти в необов'язкову секцію `## Fix During Apply`.

#### Scenario: Суперечність таску і delta є blocker

- **GIVEN** таск виконуваний, але приписує поведінку, протилежну його delta requirement
- **WHEN** `spec-reviewer` пише вердикт
- **THEN** це пункт `Required Before Apply`, вердикт REQUEST CHANGES, навіть якщо main specs і Non-goals не зачеплено

#### Scenario: Відсутнє покриття design є blocker

- **GIVEN** `design.md` описує поведінку, якої немає ні в delta specs, ні в tasks
- **WHEN** `spec-reviewer` пише вердикт
- **THEN** це blocker у `Required Before Apply`

#### Scenario: Виконуваний Minor іде у Fix During Apply

- **GIVEN** Minor виправляється в межах Files/Do/Done-when одного таску без вибору між варіантами
- **WHEN** `spec-reviewer` пише вердикт
- **THEN** пункт іде в `## Fix During Apply`, а не в `Required Before Apply`

### Requirement: APPROVE з Fix During Apply

Без blockers вердикт APPROVE, а пункти `## Fix During Apply` коротко дублюються в `apply-notes.md` (≤ 20 рядків). Виконавець apply MUST виправити кожен пункт під час таску, якого він стосується; пункт, що потребує рішення поза Files/Do/Done-when, іде в наявний escape valve (next command `/opsx:propose <name>`).

#### Scenario: Лише Fix During Apply дає APPROVE

- **GIVEN** Tier 2 знайшов один Minor, який виконавець може виправити, і жодного blocker
- **WHEN** `spec-reviewer` пише вердикт
- **THEN** `Verdict: APPROVE`, `review.md` має `## Fix During Apply`, а `apply-notes.md` коротко повторює пункт
- **AND** next command є `/opsx:apply <name>`

#### Scenario: Невиправний пункт іде в escape valve

- **GIVEN** `apply-notes.md` і `review.md` мають пункт Fix During Apply, який потребує рішення поза Files/Do/Done-when
- **WHEN** виконавець apply не може його виправити
- **THEN** він зупиняється за escape valve з next command `/opsx:propose <name>`

### Requirement: checkReviewMd і секція Fix During Apply

`checkReviewMd` SHALL вважати секцію `Fix During Apply` необов'язковою: без неї помилки немає. Якщо секція є (будь-який вердикт Tier 2), вона MUST бути непорожньою, інакше помилка `review.md: "Fix During Apply" section is empty`. Решта перевірок і Tier 1 запис лишаються без змін.

#### Scenario: Непорожня і порожня секція

- **GIVEN** конформний RC з непорожньою секцією `## Fix During Apply`, і той самий файл із порожньою секцією
- **WHEN** виконується `gate-check --review-md <name> --json`
- **THEN** перший дає `pass: true`, другий `pass: false` з помилкою про порожню секцію

### Requirement: Ключ review_fast_fix

Ключ `pipeline.review_fast_fix` SHALL читатись як `reviewFastFix`: `true` лише для точного скаляра `on`, і в секції `pipeline:`, і в legacy-читачі для конфігів без неї. Відсутній ключ, `off` і будь-яке інше значення (`maybe`, `onion`) дають `false`. Кожен `orchestrator.yaml` у `templates/` і `profiles/` MUST мати `review_fast_fix: off`.

#### Scenario: Типово вимкнено

- **GIVEN** `orchestrator.yaml` без ключа, з `review_fast_fix: off` або `review_fast_fix: maybe`
- **WHEN** CLI читає конфігурацію
- **THEN** `reviewFastFix` є `false`, а кожен `orchestrator.yaml` у `templates/` і `profiles/` містить `review_fast_fix: off`

#### Scenario: Legacy-читач вимагає точного значення

- **GIVEN** конфіг без блока `pipeline:` із `review_fast_fix: onion`, і окремо з `review_fast_fix: on`
- **WHEN** CLI читає конфігурацію
- **THEN** перший дає `reviewFastFix: false`, другий `true`

### Requirement: Придатність до fast-fix

Fast-fix SHALL бути доступним лише при `reviewFastFix` true і прийнятому Tier 2 RC (конформний за `gate-check --review-md`, з секцією Checklist), чий `Required Before Apply` стосується 1–2 тасків і не потребує змін `design.md` чи delta specs. Tier 1 запис (`**Source:** gate-check`, без Checklist) MUST NOT бути придатним. Conductor передає умову в spawn-prompt; architect повертає `**Fast-fix:** eligible (tasks: <ids>) | ineligible (<reason>)`.

#### Scenario: Tier 1 запис непридатний

- **GIVEN** `review_fast_fix: on` і `review.md` із `**Source:** gate-check` без Checklist
- **WHEN** conductor вирішує, чи вмикати fast-fix
- **THEN** fast-fix не вмикається, діє звичайний re-propose
- **AND** переписаний на APPROVE такий запис відхиляє `gate-check --review-md` (чинна поведінка схеми)

#### Scenario: Непридатний випадок іде звичайним шляхом

- **GIVEN** `review_fast_fix: on`, прийнятий Tier 2 RC, чий blocker потребує зміни `design.md`
- **WHEN** architect оцінює придатність
- **THEN** він виконує звичайний re-propose і повертає `**Fast-fix:** ineligible (<reason>)`
- **AND** next command є `/opsx:review <name>` у новій сесії

### Requirement: Межі architect у fast-fix

У fast-fix architect SHALL змінювати лише `tasks.md` і `apply-notes.md`. Це виняток із правила, що `apply-notes.md` пише reviewer: файл створюється або оновлюється, ≤ 20 рядків (критичні обмеження, пастки, що не чіпати, команди перевірки, виправлені таски). Architect MUST запустити `gate-check --review <name>` і повернути її exit code в `**Gate:**`.

#### Scenario: Перший цикл RC без apply-notes

- **GIVEN** прийнятий Tier 2 RC без `apply-notes.md`, придатний до fast-fix
- **WHEN** architect завершує fast-fix
- **THEN** `apply-notes.md` існує, має ≤ 20 рядків, а `git` показує зміни лише в `tasks.md` і `apply-notes.md`

### Requirement: Підтвердження і запис fast-fix

Після `gate-check --review` exit 0 conductor MUST запитати явне підтвердження користувача. Лише після «так» він замінює значення єдиного рядка `Verdict:` на `APPROVE (fast-fix, approved by user)` і додає `## Fast-fix`: дата, id виправлених тасків, `gate-check --review exit 0`, примітка «Tier 2 пропущено». Потім `gate-check --review-md <name>` MUST мати exit 0, інакше conductor відновлює початковий файл.

#### Scenario: Fast-fix проходить існуючі гейти

- **GIVEN** `review_fast_fix: on`, прийнятий Tier 2 RC з одним локальним blocker, виправлений `tasks.md`, оновлений `apply-notes.md`, `gate-check --review` exit 0 і підтвердження користувача
- **WHEN** conductor записує `Verdict: APPROVE (fast-fix, approved by user)` та `## Fast-fix`
- **THEN** `gate-check --review-md <name>` має exit 0 і `parseReviewVerdict` повертає значення, що починається з APPROVE
- **AND** запис є прийнятим винятком із «parent MUST NOT сама писати вердикт»

#### Scenario: Відмова користувача лишає RC

- **GIVEN** `gate-check --review` exit 0 після fast-fix, але користувач не підтверджує
- **WHEN** conductor завершує сесію
- **THEN** `review.md` лишається REQUEST CHANGES без змін, next command `/opsx:review <name>` у новій сесії

#### Scenario: Збій перевірки після запису

- **GIVEN** після переписування Verdict `gate-check --review-md <name>` має exit ≠ 0
- **WHEN** conductor обробляє результат
- **THEN** він відновлює початковий `review.md` і закриває сесію з next command `/opsx:review <name>`

### Requirement: Маршрут після fast-fix і незмінні гейти

Після успішного fast-fix next command SHALL бути `/opsx:apply <name>` у новій сесії, а `fast-fix` MUST бути записано в Decisions handoff. Читач вердикту, гейти apply/archive і запис Tier 1 MUST NOT змінюватись; при `review_fast_fix: off` поведінка `/opsx:propose` і RC → propose → review лишається без змін.

#### Scenario: Вимкнений fast-fix зберігає маршрут

- **GIVEN** `review_fast_fix: off` і review.md із Verdict REQUEST CHANGES
- **WHEN** завершується `/opsx:propose <name>` з `gate-check --review` exit 0
- **THEN** next command є `/opsx:review <name>`, а `review.md` conductor не змінює
