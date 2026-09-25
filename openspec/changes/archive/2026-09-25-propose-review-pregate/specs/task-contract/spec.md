## ADDED Requirements

### Requirement: Architect знає обов’язкові заголовки proposal і звітує Tier 1

Інструкція `templates/.agents/subagents/spec-architect.md` MUST вимагати в `proposal.md` англійські заголовки рівня 2 `## Non-goals` і `## Acceptance criteria`: з колонки 0, без перекладу і без bold-only міток. Ця вимога діє навіть тоді, коли шаблон схеми OpenSpec чи `openspec/config.yaml` їх не згадує, і для кожного spawn, зокрема з `/opsx:quick`. Коли architect заспавнений з `/opsx:propose` (перший propose, re-propose, structure-only re-propose), перед звітом він MUST:
- сам запустити `npx agent-orchestrator-kit gate-check --review <name>` (read-only);
- виправити в межах `openspec/changes/<name>/` усі помилки, які назвав gate-check;
- записати фінальний exit code у звіт рядком `**Gate:** gate-check --review exit <code>`.

Коли architect заспавнений з `/opsx:quick` (без фази review), він MUST зберегти легкий обсяг quick, MUST NOT запускати цей self-check і виправляти артефакти під нього (зокрема додавати delta specs лише заради gate-check) і пише у звіт рядок `**Gate:** not run (/opsx:quick)`; `templates/.agents/commands/opsx-quick.md` не змінюється. Правило вибору MUST бути вирішуваним без знання батьківської команди: spawn, чий промпт не згадує `/opsx:quick` чи quick-mode scope, architect MUST вважати spawn-ом з `/opsx:propose` і виконувати self-check.

Report contract `spec-architect` SHALL містити рядок `**Gate:** gate-check --review exit <code>`. Запуск Tier 1 архітектором не є review власних артефактів і не замінює запуск pre-gate conductor-ом.

#### Scenario: Proposal без Acceptance criteria не виходить з architect мовчки

- **GIVEN** architect записав `proposal.md` із заголовком `## Non-goals`, але без `## Acceptance criteria`
- **WHEN** architect перед звітом запускає `npx agent-orchestrator-kit gate-check --review <name>`
- **THEN** gate-check повідомляє `proposal.md: missing "Acceptance criteria" section`
- **AND** architect додає заголовок `## Acceptance criteria` і повторює запуск
- **AND** звіт містить рядок `**Gate:** gate-check --review exit 0`

#### Scenario: Quick-режим не запускає self-check Tier 1

- **GIVEN** `spec-architect` заспавнений з `/opsx:quick` з легким обсягом (без delta specs)
- **WHEN** architect завершує артефакти
- **THEN** інструкція `spec-architect.md` не вимагає від нього запускати `gate-check --review <name>` і виправляти артефакти під нього
- **AND** `proposal.md` усе одно має заголовки `## Non-goals` і `## Acceptance criteria`
- **AND** звіт містить рядок `**Gate:** not run (/opsx:quick)`

#### Scenario: Spawn без назви команди вважається propose

- **GIVEN** spawn-промпт `spec-architect` не згадує ні `/opsx:propose`, ні `/opsx:quick`, ні quick-mode scope
- **WHEN** architect завершує артефакти
- **THEN** інструкція `spec-architect.md` вимагає від нього запустити `npx agent-orchestrator-kit gate-check --review <name>` перед звітом
- **AND** звіт містить рядок `**Gate:** gate-check --review exit <code>`, а не `**Gate:** not run (/opsx:quick)`

#### Scenario: Перекладений заголовок не приймається

- **GIVEN** `proposal.md` має заголовок `## Критерії приймання (Acceptance criteria)` замість `## Acceptance criteria`
- **WHEN** architect запускає `gate-check --review <name>`
- **THEN** exit ≠ 0
- **AND** інструкція `spec-architect.md` вимагає точну англійську форму `## Acceptance criteria` з колонки 0

### Requirement: Якість Done-when у контракті тасків

Кожен `Done-when:` у `tasks.md` MUST перевіряти наявність нового стану, який приписує `Do:`, а не лише відсутність старого. Кількісна перевірка в `Done-when:` (`grep -c`, «рівно N рядків») MUST бути узгоджена з кодом або текстом, який приписує `Do:` того ж таску. `Do:` і `Done-when:` MUST NOT хардкодити мінливі значення репозиторію (поточний номер версії, дати, «верхній запис»); їх SHALL описувати як «поточне значення» плюс правило, що обчислюється на момент apply.

Ці три правила SHALL бути в таких місцях:
- `templates/.agents/subagents/spec-architect.md`;
- блок Task contract у `templates/.agents/commands/opsx-propose.md` і `templates/.agents/skills/openspec-propose/SKILL.md`, з англійськими фразами «new state is present», «consistent with the code», «volatile repo values»;
- `rules.tasks` у `templates/openspec-config.yaml.example`.

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

### Requirement: Стек-нейтральний openspec config template для node і generic

Kit SHALL постачати `templates/openspec-config.yaml.example` — стек-нейтральний fallback, який `resolveTemplate` бере, коли профіль не має власного `openspec-config.yaml.example` (`node`, `generic`). Файл MUST містити:
- плейсхолдери `{{PROJECT_NAME}}` і `{{LANG}}`;
- `rules.proposal` з вимогою точних заголовків `## Non-goals` і `## Acceptance criteria`;
- `rules.tasks` з контрактом Files/Do/Done-when, забороною неконкретних формулювань і трьома правилами якості Done-when.

Файл MUST NOT містити Vue/Pinia-специфіки. Кожен пункт списків під `rules:` MUST бути YAML-рядком у подвійних лапках: неекранований `: ` робить пункт map-ом, і OpenSpec відкидає весь список rules артефакта з попередженням `must be an array of strings`; неекранований ` #` YAML мовчки обрізає як коментар.

`init --profile node` і `init --profile generic` SHALL створювати `openspec/config.yaml.example` із заміненими плейсхолдерами, коли `openspec/config.yaml` відсутній. Наявний `openspec/config.yaml` MUST NOT змінюватись під час `init` без `--force` і під час `update`. `init --force --profile node|generic` тепер перезаписує наявний `openspec/config.yaml` цим template, як `init --force` уже робить для `vue3` / `mvp`; розділ `## Update` у `README.md` і запис у `CHANGELOG.md` `[Unreleased]` MUST про це попереджати і MUST NOT стверджувати без застереження, що наявний config не змінюється. Автоміграції немає: README і CHANGELOG описують ручне додавання правила. Профілі `vue3` і `mvp` і далі беруть власні файли.

#### Scenario: Node init ставить config example з Acceptance criteria

- **GIVEN** порожня директорія без `openspec/config.yaml`
- **WHEN** виконується `init --profile node --name NodeApp --lang uk`
- **THEN** існує `openspec/config.yaml.example`, що містить `Non-goals`, `Acceptance criteria` і `NodeApp`
- **AND** файл не містить незамінених `{{`

#### Scenario: Generic init ставить той самий fallback

- **GIVEN** порожня директорія без `openspec/config.yaml`
- **WHEN** виконується `init --profile generic`
- **THEN** існує `openspec/config.yaml.example` з `Acceptance criteria` і rules.tasks Files/Do/Done-when
- **AND** файл не містить `Vue` чи `Pinia`

#### Scenario: Rules доходять до openspec instructions

- **GIVEN** `templates/openspec-config.yaml.example`, скопійований як `openspec/config.yaml` у тимчасовий проєкт зі створеним change
- **WHEN** виконується `npx openspec instructions proposal --change <name> --json`
- **THEN** JSON має масив `rules`, що містить `## Acceptance criteria`
- **AND** stderr не містить `must be an array of strings`

#### Scenario: Наявний config.yaml не чіпається

- **GIVEN** проєкт з наявним `openspec/config.yaml`
- **WHEN** виконується `init --profile node` без `--force` або `update`
- **THEN** `openspec/config.yaml` лишається байт-у-байт незмінним
- **AND** розділ `## Update` у `README.md` пояснює, як вручну додати правило в подвійних лапках

#### Scenario: Release note не приховує перезапис при --force

- **GIVEN** `CHANGELOG.md` після apply цього change
- **WHEN** читається секція `[Unreleased]`
- **THEN** запис про config template каже, що `update` і `init` без `--force` не чіпають наявний `openspec/config.yaml`
- **AND** попереджає, що `init --force --profile node|generic` перезаписує його template-ом
