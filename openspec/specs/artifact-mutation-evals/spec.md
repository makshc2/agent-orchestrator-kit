## Purpose

artifact-mutation-evals — requirements merged from change artifact-mutation-evals.

## Requirements

### Requirement: Ізольований детермінований запуск eval через Tier 1 CLI

Eval SHALL виконуватись через `node:test` у `test/artifact-mutation-evals.test.js` і автоматично входити до `npm test`. Він MUST запускати production CLI `gate-check --review <name> --json` у тимчасовому fixture-проєкті з `pipeline.task_contract: strict` та `artifact_budget: off`, використовуючи справжній локально встановлений OpenSpec validator. Запуск MUST бути без мережі, telemetry, LLM, встановлення пакетів та залежності від глобального OpenSpec. Для виклику `npx openspec validate <name> --strict --type change` із gate eval MUST надавати вузький launcher, який приймає лише цей виклик, запускає локальний OpenSpec через `process.execPath`, передає йому stdout, stderr і status, а будь-який інший виклик відхиляє без запуску OpenSpec; telemetry MUST бути вимкнена (`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`), а CLI-процеси MUST мати timeout і обмеження буфера. Eval MUST NOT вимагати нового експорту `runTier1Review`, зміни JSON/verdict schema або production-лінтів.

#### Scenario: Targeted і загальний запуск охоплюють один корпус

- **WHEN** запускається `node --test test/artifact-mutation-evals.test.js` або `npm test`
- **THEN** запускається той самий визначений корпус через CLI у strict-профілі
- **AND** результат включає справжню перевірку OpenSpec validate без LLM або мережевих запитів

#### Scenario: Локальний валідатор відсутній

- **GIVEN** локальний OpenSpec package не встановлений
- **WHEN** eval готує запуск
- **THEN** тест завершується setup failure з поясненням
- **AND** не завантажує пакет і не підміняє validate успішним stub

### Requirement: Заморожені baseline-фікстури і незалежні мутації

Корпус SHALL містити синтетичний проєкт і адаптований snapshot реальної зміни `2026-10-02-tier1-delta-heading-check` у `test/fixtures/mutations/`. README MUST фіксувати source commit, вихідні файли, адаптації та режим eval. Кожна fixture MUST містити власні main specs і всі файли для чистого task contract; runtime MUST NOT читати живий архів, main specs робочого репозиторію чи git history. До мутацій кожен baseline MUST пройти validate і gate з exit 0, `pass: true`, `errors: []`.

Кожен кейс MUST отримувати свіжу копію baseline, вносити один визначений логічний дефект і перевіряти, що зміна справді відбулася у цільовому місці. Процеси MUST мати timeout; temporary project та user/config/cache state MUST очищатися також після помилки. Eval MUST NOT змінювати робочі артефакти, джерельні фікстури, metrics або handoff.

#### Scenario: Нечистий baseline зупиняє оцінювання

- **GIVEN** немутована fixture не проходить validate або Tier 1
- **WHEN** eval перевіряє baseline
- **THEN** suite падає з baseline failure
- **AND** mutants цієї fixture не виконуються, а їх не позначають caught

#### Scenario: Мутації не накопичуються

- **GIVEN** один кейс видаляє Done-when, а наступний псує MODIFIED-заголовок
- **WHEN** запускається наступний кейс
- **THEN** його tasks містять оригінальний Done-when
- **AND** джерельна fixture і робочі openspec-файли не змінені

#### Scenario: Mutator більше не знаходить ціль

- **GIVEN** fixture змінилась і цільове поле mutator відсутнє або неоднозначне
- **WHEN** mutator намагається застосувати дефект
- **THEN** кейс падає як invalid setup, а не звітує missed або caught

### Requirement: Явний корпус структурних дефектів і відомих прогалин

Кожен кейс SHALL мати стабільний ID, fixture, клас дефекту, expectation `must-catch` або `known-gap`, reason та цільові diagnostic matchers. Початковий корпус MUST охоплювати на синтетичній fixture: відсутній Done-when, неконкретне `as needed` у Do, відсутній Files-шлях без `new file:`, відсутні секції Non-goals і Acceptance criteria, порожню delta, відсутній у main MODIFIED-заголовок, вимогу без scenario та ADDED-заголовок, уже наявний у main. Реальна fixture MUST повторювати щонайменше missing Done-when, vague Do та зіпсований MODIFIED-заголовок.

Передумова S10: перший таск synthetic-фікстури приписує додати новий стан, а його Done-when перевіряє наявність цього стану; мутація S10 замінює Done-when на перевірку лише відсутності старого стану. Корпус MUST також містити дві `known-gap` мутації: семантично недостатній, але структурно заповнений Done-when і другу валідну активну зміну з несумісним MODIFIED-тілом того самого capability/requirement. Вони SHALL вимірювати наявну прогалину без вимоги додавати detector або забороняти його майбутнє додавання. Чинна заборона нового детермінованого lint якості Done-when з capability `task-contract` MUST зберігатись.

#### Scenario: Структурне видалення Done-when має бути виявлене

- **GIVEN** чиста fixture з task contract у strict-режимі
- **WHEN** видалено Done-when одного task
- **THEN** кейс вимагає exit 1, `pass: false` і `missing Done-when:` для цього task
- **AND** семантична оцінка тексту поля не додається

#### Scenario: Міжзмінна колізія лишається спостережуваною прогалиною

- **GIVEN** дві окремо валідні зміни містять різні несумісні тіла MODIFIED для однакового заголовка у тому самому capability
- **WHEN** gate перевіряє вихідну зміну за наявності сусідньої
- **THEN** успішний gate відображається як `missed` із reason про міжзмінну колізію без падіння eval
- **AND** цей change не вводить нову заборону кількох MODIFIED одного заголовка у production-гейті

### Requirement: Причинна класифікація caught і missed

Eval MUST зараховувати `caught` лише коли процес нормально завершується exit 1, JSON містить `pass: false`, а errors містять цільові diagnostics і не містять непов'язаних помилок. Якщо кейс очікує помилки OpenSpec validate, eval MUST додатково підтвердити конкретний issue через JSON-вивід того самого локального валідатора; загальний `openspec validate --strict failed` не є достатнім доказом. Для інших кейсів validate MUST проходити.

`missed` SHALL означати exit 0, `pass: true`, порожні errors. Crash, timeout, signal, невалідний JSON/schema, несумісні exit/pass або сторонні errors MUST класифікуватися `invalid` і провалювати тест. `must-catch` + missed MUST провалювати тест. `known-gap` + missed SHALL проходити з видимим записом у звіті; `known-gap` + цільовий caught SHALL проходити як `newly caught`. Для `known-gap` matcher MUST ідентифікувати причину прогалини: для семантики Done-when — діагностику якості Done-when конкретного таска, для міжзмінної колізії — діагностику, що називає capability, заголовок вимоги та обидві зміни; матчер «будь-яка помилка» MUST NOT використовуватись. Expectation MUST NOT автоматично змінюватись, щоб приховати regression.

#### Scenario: Втрата відомого детектора падає

- **GIVEN** MODIFIED heading mutation має expectation must-catch
- **WHEN** gate повертає exit 0, `pass: true`, `errors: []`
- **THEN** рядок звіту має missed і тест падає

#### Scenario: Сторонній збій не видається за виявлення

- **GIVEN** кейс має виявляти зіпсований MODIFIED-заголовок
- **WHEN** процес падає або повертає лише помилку validate іншої причини
- **THEN** кейс класифікується invalid, тест падає і caught counter не зростає

#### Scenario: Відсутній scenario перевіряє справжній validate

- **GIVEN** із валідної MODIFIED-вимоги видалено її єдиний scenario
- **WHEN** запускається gate та локальний validate з JSON
- **THEN** caught вимагає відмови gate через validate та конкретного validation issue про scenario цієї вимоги

#### Scenario: Known-gap matcher не приймає сторонню помилку

- **GIVEN** known-gap кейс очікує діагностику, що називає capability, заголовок і обидві зміни
- **WHEN** gate повертає exit 1 з помилкою без цих елементів або з додатковою непов'язаною помилкою
- **THEN** кейс класифікується invalid і тест падає
- **AND** результат не зараховується ні як newly caught, ні як missed

#### Scenario: Покращення виявлення known-gap не закріплює старий пропуск

- **GIVEN** known-gap кейс раніше повертав missed
- **WHEN** gate повертає цільову діагностику цього дефекту, що відповідає matcher, без сторонніх помилок
- **THEN** тест проходить і звіт показує caught із позначкою newly caught

### Requirement: Відтворюваний звіт про корпус

Eval SHALL виводити таблицю через diagnostics `node:test` у стабільному порядку ID з колонками ID, profile, fixture, клас дефекту, expectation, фактичний result (caught/missed/invalid) і reason. Підсумок SHALL показувати caught/total mutations, відомі пропуски і newly caught; baseline MUST бути виключений зі знаменника. Звіт MUST явно називати strict-профіль і межі корпусу, не інтерпретуючи частку як загальну якість Tier 1. При invalid або baseline failure він MUST позначати вимірювання incomplete і MUST NOT виводити caught/total. Timestamp, випадкові absolute paths і persisted verdict не потрібні.

#### Scenario: Відомі прогалини не губляться серед зелених тестів

- **WHEN** усі must-catch виявлені, а known-gap пропущені
- **THEN** тестовий запуск проходить
- **AND** таблиця містить окремі missed-рядки з причинами, а summary включає їх у total mutations

#### Scenario: Невалідне вимірювання не дає успішного score

- **WHEN** baseline failure або invalid кейс робить запуск неповним
- **THEN** звіт містить incomplete та причину помилки
- **AND** не подає часткове caught/total як валідну оцінку корпусу
