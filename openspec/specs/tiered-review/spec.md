## Purpose

tiered-review — requirements merged from change lean-pipeline-v2.

## Requirements

### Requirement: Скриптовий Tier 1 перед LLM-review

Команда `npx agent-orchestrator-kit gate-check --review <name>` SHALL виконувати детерміновані перевірки: `openspec validate --strict --type change`, task-контракт-лінт, наявність секцій `Non-goals` і `Acceptance criteria` в proposal.md, наявність непорожніх ADDED/MODIFIED/REMOVED секцій у delta specs. Команда `/opsx:review` MUST запускати Tier 1 до читання артефактів LLM-ом.

#### Scenario: Падіння Tier 1 завершує review без LLM-читання

- **GIVEN** change, що не проходить task-контракт-лінт або validate
- **WHEN** виконується `/opsx:review <name>`
- **THEN** у чат виводиться REQUEST CHANGES з помилками gate-check, `review.md` записується з `Verdict: REQUEST CHANGES`, phase-субагент не спавниться, артефакти LLM не читає

#### Scenario: Tier 1 OK передає скорочений чекліст у Tier 2

- **GIVEN** change, що проходить `gate-check --review`
- **WHEN** спавниться `spec-reviewer`
- **THEN** його чекліст містить лише LLM-перевірки (узгодженість артефактів, конфлікти з main specs, scope creep, самодостатність тасків) без пунктів, які вже покрив Tier 1

### Requirement: apply-notes.md при APPROVE

При вердикті APPROVE reviewer MUST записати `openspec/changes/<name>/apply-notes.md` (≤ 20 рядків): критичні констрейнти, підводні камені, що не чіпати, команди перевірки. Це єдиний додатковий файл, дозволений reviewer-у поруч із `review.md`.

#### Scenario: APPROVE створює дистилят для apply

- **GIVEN** review завершився APPROVE
- **WHEN** перевіряється директорія change
- **THEN** існують `review.md` (`Verdict: APPROVE`) і `apply-notes.md` з констрейнтами для виконавця

### Requirement: Вичерпний скан Tier 2 до вердикту

Після проходження `gate-check --review` `spec-reviewer` MUST завершити повний LLM-чекліст Tier 2 і повний скан артефактів change (proposal.md, design.md, tasks.md, усі delta specs, згадані main specs і шляхи репозиторію) **до** запису вердикту в `review.md`. Він MUST NOT зупинятись на першому blocking-знаходженні. Один пункт чекліста ✗ усе одно SHALL давати `Verdict: REQUEST CHANGES`, але файл MUST перелічити **кожне** blocking-знаходження цього проходу. Косметичні зауваження MUST NOT потрапляти в Required Before Apply. Наявні вимоги «Скриптовий Tier 1 перед LLM-review» і «apply-notes.md при APPROVE» лишаються чинними; сценарій «Падіння Tier 1 завершує review без LLM-читання» MUST NOT змінюватись.

#### Scenario: Один ✗ не обрізає решту blocking

- **GIVEN** change пройшов `gate-check --review` і в артефактах є щонайменше два незалежні blocking-дефекти (наприклад design-поведінка без вимоги в delta і таск, чий `Do:` не виконується без design.md)
- **WHEN** виконується Tier 2 `/opsx:review <name>`
- **THEN** `review.md` має `Verdict: REQUEST CHANGES`
- **AND** Required Before Apply містить обидва дефекти, а не лише перший знайдений
- **AND** кожен пункт чекліста Tier 2 позначений ✓ або ✗

#### Scenario: Косметика лишається поза Required Before Apply

- **GIVEN** Tier 2 знайшов один blocking і одну косметичну примітку
- **WHEN** записується `review.md` з `Verdict: REQUEST CHANGES`
- **THEN** Required Before Apply містить лише blocking
- **AND** косметика потрапляє в Findings як Minor або в Notes, не в Required Before Apply

### Requirement: Схема review.md на REQUEST CHANGES і повторному review

Після Tier 2 будь-який `review.md` з `Verdict: REQUEST CHANGES` і будь-який повторний Tier 2 review MUST містити секції з цими заголовками (англійські імена в шаблонах): `Checklist`, `Findings`, `Required Before Apply`, `Previous findings`. У Findings SHALL бути відра Blocker, Major, Minor (або еквівалентні іменовані відра); порожні відра дозволені. Checklist MUST перелічити кожен пункт чекліста Tier 2 з ✓ або ✗. Заголовок `Previous findings` ALWAYS присутній після будь-якого Tier 2 проходу. Якщо попереднього `review.md` не було — тіло є літеральним рядком `none — first review cycle`. Якщо був — кожен попередній пункт Required Before Apply MUST з’явитись як `resolved` або `unresolved` з однорядковим evidence. Запис після падіння лише Tier 1 MUST містити рядок `**Source:** gate-check`, MUST перелічити помилки скрипта, MUST NOT мати секцію `## Checklist` і MUST NOT вимагати заповненого LLM-Checklist. Parent-запис цього T1 `review.md` є прийнятим винятком з вимоги pipeline-subagents «parent MUST NOT сама писати вердикт».

#### Scenario: T2 REQUEST CHANGES має всі обов'язкові секції

- **GIVEN** Tier 1 пройшов, перед спавном `review.md` не існував, і `spec-reviewer` ставить REQUEST CHANGES
- **WHEN** записується `openspec/changes/<name>/review.md`
- **THEN** файл містить заголовки Checklist, Findings, Required Before Apply і Previous findings
- **AND** Findings має відра Blocker, Major, Minor
- **AND** Checklist не порожній: кожен пункт T2 позначений ✓ або ✗
- **AND** тіло Previous findings є літеральним рядком `none — first review cycle`

#### Scenario: T1-only RC не вимагає LLM-Checklist

- **GIVEN** `gate-check --review` завершився з exit ≠ 0
- **WHEN** parent записує `review.md` з `Verdict: REQUEST CHANGES`, рядком `**Source:** gate-check` і без секції `## Checklist`
- **THEN** файл перелічує помилки скрипта
- **AND** phase-субагент не спавниться
- **AND** порожній LLM-Checklist не є порушенням цієї вимоги
- **AND** цей запис parent-а є прийнятим винятком з «parent MUST NOT сама писати вердикт»

### Requirement: Повнота повторного review і той самий клас дефекту

Пізніший `/opsx:review` після існуючого `review.md` MUST трактувати попередній punch list як вхід: прочитати існуючий `review.md` перед overwrite, перенести punch list у Previous findings і все одно виконати повний чекліст плюс скан того самого класу дефекту в усіх артефактах. Клас дефекту для цього rescan — лише LLM-only, наприклад: інший таск, чий `Do:` не виконується без design.md; інша design-поведінка без вимоги в delta; інший drift proposal↔tasks; інший згаданий заголовок/шлях, якого немає. Класи Tier 1 (відсутня секція proposal, порожня підсекція delta, провал validate / task-contract) NEVER входять у same-class rescan Tier 2. Confirmation review після вичерпного propose MUST виконати ту саму повноту; він MUST NOT вважатись третім discovery-циклом, але MUST NOT зупинятись на першому новому leftover. Файл MUST NOT бути однопунктовим RC, який називає лише перший leftover і залишає інші знайдені blocking поза Required Before Apply.

#### Scenario: Re-review переносить попередній punch list

- **GIVEN** існуючий `review.md` з трьома пунктами Required Before Apply
- **WHEN** виконується наступний Tier 2 `/opsx:review <name>`
- **THEN** спеціаліст читає існуючий `review.md` перед overwrite
- **AND** нова секція Previous findings містить усі три пункти зі статусом `resolved` або `unresolved` і однорядковим evidence
- **AND** reviewer усе одно завершує повний чекліст до вердикту

#### Scenario: Confirmation не дробить leftover того самого класу

- **GIVEN** попередній RC назвав один таск, чий `Do:` не виконується без design.md, а після propose в `tasks.md` лишились ще два таски без конкретного `Do:`
- **WHEN** виконується confirmation `/opsx:review <name>`
- **THEN** якщо вердикт REQUEST CHANGES, Required Before Apply перелічує всі знайдені такі таски цього проходу
- **AND** файл MUST NOT містити лише перший leftover як єдиний blocking
- **AND** reviewer MUST NOT додавати в цей rescan класи Tier 1

### Requirement: Перевірка заголовків conductor-ом після Tier 2

Після звіту `spec-reviewer` conductor MUST перевірити `review.md` з `Verdict: REQUEST CHANGES`: наявні обов’язкові заголовки схеми і Checklist не порожній. Перед першим спавном conductor MUST зафіксувати, чи існував `review.md`, і передати цей факт плюс шлях до файла в spawn-промпт. Якщо перевірка падає, conductor MUST один раз переспавнити `spec-reviewer` з причиною відхилення і списком обов’язкових заголовків. Якщо другий файл знову неконформний, conductor MUST закрити сесію з `## Blocked`, назвати відсутні заголовки і поставити next command `/opsx:review <name>`; відхилений файл не є прийнятим вердиктом. Conductor MUST NOT сам редагувати `review.md`. Ця перевірка застосовується після Tier 2, не до T1-запису від gate-check. На APPROVE conductor і далі перевіряє наявність `apply-notes.md` і MUST NOT переписувати файли спеціаліста.

#### Scenario: Порожній Checklist після T2 блокує сесію

- **GIVEN** `spec-reviewer` повернув `Status: done` і `review.md` з `Verdict: REQUEST CHANGES` без секції Checklist або з порожнім Checklist
- **WHEN** conductor перевіряє звіт
- **THEN** він один раз переспавнює `spec-reviewer` з причиною відхилення і списком обов’язкових заголовків
- **AND** вміст файлу лишається без правок conductor-а

#### Scenario: Другий неконформний RC веде в review, не в propose

- **GIVEN** conductor уже один раз відхилив T2 `review.md` за відсутніми заголовками і переспавнив `spec-reviewer`
- **AND** другий файл знову неконформний (немає обов’язкового заголовка або Checklist порожній)
- **WHEN** conductor закриває сесію
- **THEN** `handoff.md` має `## Blocked` із названими відсутніми заголовками
- **AND** next command є `/opsx:review <name>`
- **AND** відхилений файл не є прийнятим вердиктом, тож NEXT-AFTER-RC не застосовується

#### Scenario: T1 RC без LLM-Checklist не блокується цією перевіркою

- **GIVEN** parent записав `review.md` після падіння `gate-check --review` з рядком `**Source:** gate-check` і без `## Checklist`, без спавну `spec-reviewer`
- **WHEN** сесія йде в Session Exit
- **THEN** відсутність заповненого LLM-Checklist MUST NOT вважатись провалом parent heading check

### Requirement: Next command після REQUEST CHANGES є propose

Після прийнятого (schema-conforming) `Verdict: REQUEST CHANGES` (Tier 1 або Tier 2) Session Exit next command SHALL бути `/opsx:propose <name>`. NEXT-AFTER-RC застосовується лише до прийнятого RC; відхилений неконформний файл не є прийнятим вердиктом і MUST NOT мапитись на `/opsx:propose`. Після другого неконформного T2 файла next command SHALL бути `/opsx:review <name>`. Він MUST NOT бути негайним `/opsx:review <name>` після прийнятого RC. Після `Verdict: APPROVE` next command SHALL лишатись `/opsx:apply <name>`. Шаблони `/opsx:review` MUST NOT вказувати «потім знову `/opsx:review`» як next command після прийнятого RC.

#### Scenario: T2 RC веде в propose

- **GIVEN** прийнятий schema-conforming `review.md` містить `Verdict: REQUEST CHANGES` після Tier 2
- **WHEN** закривається review-сесія
- **THEN** `handoff.md` / pasted prompt починається з `/opsx:propose <name>`
- **AND** не починається з `/opsx:review <name>`

#### Scenario: APPROVE веде в apply

- **GIVEN** `review.md` містить `Verdict: APPROVE`
- **WHEN** закривається review-сесія
- **THEN** next command є `/opsx:apply <name>`

### Requirement: Метрика discovery loops не більше двох

Шаблони kit (`templates/.agents/skills/agent-orchestration/SKILL.md` і `templates/AGENTS.md`) SHALL описувати health-метрику: Spec review discovery loops ≤ 2 — опційний цикл Tier 1 structural RC плюс один семантичний RC Tier 2. У skill точна форма рядка — `Spec review discovery loops: ≤ 2` (з двокрапкою; smoke regex MUST збігатися саме з цією формою). Confirmation `/opsx:review` з очікуваним APPROVE після вичерпного propose MUST NOT рахуватись discovery loop. Текст MUST NOT лишати «Spec review loops: ≤ 1» як ціль. Анти-патерн one-finding review loop SHALL бути названий у цих шаблонах. Після Request Changes skill MUST містити фразу `run `/opsx:propose <name>` to fix the punch list`.

#### Scenario: Skill більше не цілить ≤ 1 discovery loop

- **WHEN** після apply читається `templates/.agents/skills/agent-orchestration/SKILL.md`
- **THEN** метрика містить «Spec review discovery loops: ≤ 2»
- **AND** текст пояснює, що confirmation APPROVE не є discovery loop
- **AND** рядок «Spec review loops: ≤ 1» відсутній
- **AND** файл містить «run `/opsx:propose <name>` to fix the punch list»
