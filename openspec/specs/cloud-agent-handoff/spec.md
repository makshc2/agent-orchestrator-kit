## Purpose

cloud-agent-handoff — requirements merged from change add-cloud-agent-handoff.

## Requirements

### Requirement: Runtime сесії зафіксований у handoff.md

`handoff.md` MUST містити секцію `## Runtime` з полями `runtime` (`local` або `cloud`) і `agent_id` (ідентифікатор або `none`). Persist-гілка CLI `npx agent-orchestrator-kit handoff <name>` і фінальний handoff команди `archive <name>` SHALL записувати цю секцію завжди. Значення runtime SHALL визначатися детермінованим пріоритетом: прапорець `--runtime <local|cloud>` → env `AOK_RUNTIME` → best-effort cloud-маркери середовища з однієї константи CLI → значення з наявної секції Runtime → `local`. Значення `agent_id` SHALL визначатися пріоритетом: `--agent-id` → env `AOK_AGENT_ID` → значення з наявної секції → `none`. Невалідне значення `--runtime` (не `local` і не `cloud`) MUST завершувати команду з помилкою. Інтерактивні питання для визначення runtime MUST NOT використовуватись.

#### Scenario: Persist пише runtime за прапорцем

- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --runtime cloud`
- **THEN** `openspec/changes/<name>/handoff.md` містить секцію `## Runtime` з `runtime: cloud`

#### Scenario: Env AOK_RUNTIME визначає cloud без прапорця

- **GIVEN** середовище має `AOK_RUNTIME=cloud`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` без `--runtime`
- **THEN** записана секція Runtime містить `runtime: cloud`

#### Scenario: Дефолт local без прапорця, env і маркерів

- **GIVEN** немає `--runtime`, `AOK_RUNTIME` і жодного cloud-маркера середовища
- **WHEN** виконується persist
- **THEN** секція Runtime містить `runtime: local` і `agent_id: none`

#### Scenario: Legacy handoff.md без Runtime не падає

- **GIVEN** наявний `handoff.md` без секції `## Runtime`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з валідними обов'язковими секціями
- **THEN** persist завершується exit 0
- **AND** секція Runtime дописана у файл

#### Scenario: Archive фіксує runtime у фінальному handoff

- **WHEN** виконується `npx agent-orchestrator-kit archive <name>`
- **THEN** фінальний `handoff.md` в архівній папці містить секцію Runtime

### Requirement: Cloud-check верифікує git-стан артефактів change-у

CLI SHALL надавати перевірку `npx agent-orchestrator-kit handoff <name> --cloud-check`, яка верифікує: (1) `git status --porcelain` не показує змінених або untracked шляхів під `openspec/changes/<name>/`; (2) поточна гілка має upstream і не має локальних комітів попереду upstream. Вердикт SHALL залежати від runtime, визначеного тим самим пріоритетним ланцюжком, що й у persist: при `runtime: cloud` невиконання будь-якої умови MUST завершувати команду з non-zero exit code і переліком проблемних шляхів або причин; при `runtime: local` ті самі знахідки SHALL виводитись як warning з exit 0. Помилка git-команд (немає upstream, detached HEAD) при cloud-runtime MUST трактуватись як фейл перевірки з підказкою, а не як crash CLI. Перевірка MUST NOT виконувати `git commit` чи `git push` самостійно.

#### Scenario: Cloud з незакоміченими артефактами падає

- **GIVEN** `handoff.md` має `runtime: cloud`
- **AND** під `openspec/changes/<name>/` є незакомічений або untracked файл
- **WHEN** виконується `handoff <name> --cloud-check`
- **THEN** команда завершується з non-zero exit code
- **AND** вивід містить проблемні шляхи

#### Scenario: Cloud з незапушеною гілкою падає

- **GIVEN** `runtime: cloud`, артефакти закомічені
- **AND** гілка не має upstream або має коміти попереду upstream
- **WHEN** виконується `handoff <name> --cloud-check`
- **THEN** команда завершується з non-zero exit code
- **AND** вивід містить підказку про `git push`

#### Scenario: Cloud з чистим і запушеним станом проходить

- **GIVEN** `runtime: cloud`, `git status --porcelain -- openspec/changes/<name>/` порожній
- **AND** гілка має upstream без локальних комітів попереду
- **WHEN** виконується `handoff <name> --cloud-check`
- **THEN** команда завершується з exit 0

#### Scenario: Local з брудним станом лише попереджає

- **GIVEN** `handoff.md` має `runtime: local`
- **AND** під `openspec/changes/<name>/` є незакомічені файли
- **WHEN** виконується `handoff <name> --cloud-check`
- **THEN** знахідки виведені як warning
- **AND** команда завершується з exit 0

### Requirement: Cloud-сесія закривається лише через commit, push і cloud-check

Persist із `runtime: cloud` SHALL друкувати в stderr обов'язкові кроки закриття: додати `openspec/changes/<name>/` у git, закомітити, запушити і виконати `handoff <name> --cloud-check` з exit 0; stdout MUST лишатися чистим next-thread prompt-ом. Канонічний протокол Session Exit (rule `session-handoff.mdc`, skill `agent-orchestration`, субагент `session-handoff`) SHALL фіксувати: агент (local або cloud) пише артефакти сесії лише в git-tracked шляхи; закриття cloud-сесії без commit + push + зеленого cloud-check вважається неповним handoff-ом. Автоматичний запуск `git commit`/`git push` з CLI MUST NOT виконуватись.

#### Scenario: Persist у cloud друкує кроки закриття

- **WHEN** виконується `npx agent-orchestrator-kit handoff <name> --runtime cloud`
- **THEN** stderr містить кроки commit, push і `handoff <name> --cloud-check`
- **AND** stdout містить лише next-thread prompt

#### Scenario: Протокол фіксує git-tracked шляхи і cloud-вихід

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** правило вимагає писати артефакти сесії лише в git-tracked шляхи
- **AND** описує cloud-кроки Session Exit: commit → push → cloud-check з exit 0

#### Scenario: Local persist не змінює поведінку виходу

- **WHEN** виконується persist з `runtime: local`
- **THEN** stdout-prompt і порядок кроків Session Exit не відрізняються від поведінки до Phase 3
