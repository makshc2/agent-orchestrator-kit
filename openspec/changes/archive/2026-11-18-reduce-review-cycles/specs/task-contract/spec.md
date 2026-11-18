## MODIFIED Requirements

### Requirement: Якість Done-when у контракті тасків

Кожен `Done-when:` у `tasks.md` MUST перевіряти наявність нового стану, який приписує `Do:`, а не лише відсутність старого. Кількісна перевірка в `Done-when:` (`grep -c`, «рівно N рядків») MUST бути узгоджена з кодом або текстом, який приписує `Do:` того ж таску. `Do:` і `Done-when:` MUST NOT хардкодити мінливі значення репозиторію (поточний номер версії, дати, «верхній запис»); їх SHALL описувати як «поточне значення» плюс правило, що обчислюється на момент apply.

Ці три правила SHALL бути в таких місцях:
- `templates/.agents/subagents/spec-architect.md`;
- блок Task contract у `templates/.agents/commands/opsx-propose.md` і `templates/.agents/skills/openspec-propose/SKILL.md`, з англійськими фразами «new state is present», «consistent with the code», «volatile repo values»;
- `rules.tasks` у `templates/openspec-config.yaml.example` і в копіях `profiles/mvp/openspec-config.yaml.example`, `profiles/vue3/openspec-config.yaml.example`.

Правила лишаються текстовими інструкціями: `gate-check --tasks` і `gate-check --review` MUST NOT отримувати новий детермінований лінт якості Done-when.

#### Scenario: Кількісна перевірка узгоджена з Do

- **GIVEN** `Do:` таску приписує додати два рядки з підрядком X
- **WHEN** architect пише `Done-when:` для цього таску
- **THEN** `Done-when:` не вимагає «рівно 1 рядок» з X
- **AND** кількість у перевірці обчислена з baseline плюс те, що додає `Do:`, або перевірка є перевіркою наявності

#### Scenario: Мінлива версія описується правилом

- **GIVEN** таск має підняти номер версії в артефакті репозиторію
- **WHEN** architect пише `Do:` і `Done-when:`
- **THEN** вони описують значення як «поточне значення + 0.001», обчислене на момент apply, а не як літерал на кшталт `15.191`

#### Scenario: Перевірка лише відсутності старого значення недостатня

- **GIVEN** таск замінює застарілу дату `LAST_UPDATED`
- **WHEN** architect пише `Done-when:`
- **THEN** перевірка вимагає наявності нового значення, обчисленого за правилом на момент apply
- **AND** `Done-when:`, який проходить на незміненому дереві, не відповідає цій вимозі

#### Scenario: Без нового лінту

- **GIVEN** change, чий `Done-when:` порушує ці правила, але має поля `Files:`, `Do:`, `Done-when:`
- **WHEN** виконується `npx agent-orchestrator-kit gate-check --tasks <name>`
- **THEN** звіт лінта такий самий, як до цього change (правила застосовує architect, не лінт)

## ADDED Requirements

### Requirement: Самоперевірка architect перед звітом

Перед звітом `spec-architect` MUST виконати чекліст: (a) після будь-якої правки `Do:` перечитати `Done-when:` цього й залежних тасків; (b) кожне твердження «X існує / відсутнє / на рядку N» про код перевірити читанням файлу і записати `path:line` поруч у артефакті; (c) кожну grep-умову `Done-when:` прогнати проти поточного коду, очікуваний результат MUST бути досяжним. Звіт MUST мати рядок `**Self-check:** done | not applicable`. Нового детермінованого лінту немає.

#### Scenario: Звіт має рядок Self-check

- **GIVEN** `spec-architect` завершив change з твердженнями про код і grep-умовами
- **WHEN** він повертає звіт за контрактом
- **THEN** звіт містить рядок `**Self-check:** done`
- **AND** `spec-architect.md`, `opsx-propose.md` і `openspec-propose/SKILL.md` мають ці три пункти

#### Scenario: Читання для верифікації дозволене

- **GIVEN** правило «Read narrowly» у `spec-architect.md`
- **WHEN** architect перевіряє твердження про код у `src/` або `bin/`
- **THEN** він читає потрібні діапазони рядків і не порушує правила

### Requirement: Підказка розміру change

Якщо change має понад 8 тасків або 4 і більше delta specs, `spec-architect` SHALL запропонувати розбиття на два changes і написати це в `**Risks:**`. Підказка MUST NOT блокувати propose і MUST NOT додавати помилку в `gate-check`.

#### Scenario: Дев'ять тасків дають пропозицію розбиття

- **GIVEN** `tasks.md` має дев'ять тасків
- **WHEN** architect формує звіт
- **THEN** `**Risks:**` пропонує розбиття на два changes
- **AND** `**Status:**` лишається `done`, якщо gate-check має exit 0

### Requirement: Поведінкові умови Done-when і приклади

Done-when SHALL віддавати перевагу поведінковим умовам (запуск тесту, спостережувана поведінка); `grep` дозволений лише для нечислової наявності чи відсутності; «рівно N» і «exactly N» заборонені, якщо таск не пояснює, чому точне число гарантоване. Кожне з чотирьох місць правила (architect, Task contract у propose і SKILL, `rules.tasks` у трьох конфіг-шаблонах) MUST мати пару прикладів good/bad з англійськими словами «behavioral», «exactly N».

#### Scenario: Поведінкова перевірка замість числового grep

- **GIVEN** `Do:` таску обгортає всі три присвоєння функцією `applyOverlay`
- **WHEN** architect пише `Done-when:`
- **THEN** `Done-when:` є запуском тесту або іншою поведінковою умовою, а не «рівно два входження `applyOverlay`»
- **AND** якщо `grep` лишився, він перевіряє нечислову наявність чи відсутність

#### Scenario: Приклади good/bad в усіх конфіг-шаблонах

- **GIVEN** `templates/openspec-config.yaml.example`, `profiles/mvp/openspec-config.yaml.example` і `profiles/vue3/openspec-config.yaml.example`
- **WHEN** читається `rules.tasks` кожного файла
- **THEN** кожен містить правило «behavioral», заборону «exactly N» і пару прикладів bad (`Do:` обгортає всі три присвоєння, `Done-when:` вимагає рівно двох збігів) та good (тест, що перевіряє всі три)
- **AND** профілі `mvp` і `vue3` містять також правила new state is present, consistent with the code і volatile repo values
