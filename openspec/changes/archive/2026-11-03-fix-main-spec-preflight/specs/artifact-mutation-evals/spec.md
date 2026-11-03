## MODIFIED Requirements

### Requirement: Ізольований детермінований запуск eval через Tier 1 CLI

Eval SHALL виконуватись через `node:test` у `test/artifact-mutation-evals.test.js` і автоматично входити до `npm test`. Він MUST запускати production CLI `gate-check --review <name> --json` у тимчасовому fixture-проєкті з `pipeline.task_contract: strict` та `artifact_budget: off`, використовуючи справжній локально встановлений OpenSpec validator. Запуск MUST бути без мережі, telemetry, LLM, встановлення пакетів та залежності від глобального OpenSpec. Для викликів `npx openspec validate <name> --strict --type change` та `npx --no-install openspec validate --specs --strict --json` із gate eval MUST надавати вузький launcher, який приймає лише ці два виклики, запускає локальний OpenSpec через `process.execPath`, передає йому stdout, stderr і status, а будь-який інший виклик відхиляє без запуску OpenSpec; telemetry MUST бути вимкнена (`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`), а CLI-процеси MUST мати timeout і обмеження буфера. Eval MUST NOT вимагати нового експорту `runTier1Review`, зміни JSON/verdict schema або production-лінтів.

#### Scenario: Targeted і загальний запуск охоплюють один корпус

- **WHEN** запускається `node --test test/artifact-mutation-evals.test.js` або `npm test`
- **THEN** запускається той самий визначений корпус через CLI у strict-профілі
- **AND** результат включає справжню перевірку OpenSpec validate без LLM або мережевих запитів

#### Scenario: Локальний валідатор відсутній

- **GIVEN** локальний OpenSpec package не встановлений
- **WHEN** eval готує запуск
- **THEN** тест завершується setup failure з поясненням
- **AND** не завантажує пакет і не підміняє validate успішним stub

#### Scenario: Preview використовує той самий локальний валідатор

- **WHEN** Tier 1 перевіряє тимчасовий результат sync через `npx --no-install openspec validate --specs --strict --json`
- **THEN** launcher передає виклик тому самому локальному OpenSpec без мережі, telemetry або встановлення пакетів
- **AND** інші комбінації аргументів відхиляються без запуску OpenSpec
