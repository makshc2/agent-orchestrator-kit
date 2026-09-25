## Why

У consumer-change `my-work-pf-absences` (cadence-data-worklog) review cycle 1 був Tier 1 REQUEST CHANGES лише через відсутню `## Acceptance criteria` у proposal.md — детермінована перевірка, яку propose міг прогнати сам, коштувала окремої review-сесії. Cycle 2 був Tier 2 RC через три дефекти Done-when: кількісна перевірка суперечила `Do:`, хардкод мінливої версії, перевірка лише відсутності старої дати. Для профілів node/generic kit не ставить `openspec/config.yaml.example`, тож архітектор не дізнається про обов’язкові секції proposal.

Design: none

## What Changes

- **A. Tier 1 pre-gate на propose.** У `opsx-propose.md` і `openspec-propose/SKILL.md` (крок 6) conductor після звіту `spec-architect` MUST запустити `npx agent-orchestrator-kit gate-check --review <name>`. Exit ≠ 0 → один повторний spawn `spec-architect` з повним списком помилок gate-check, потім повторний запуск; якщо exit усе ще ≠ 0 → Session Exit з `## Blocked` і next command `/opsx:propose <name>`. Handoff на `/opsx:review` без exit 0 заборонений: рядок Prompt у розділі **Output** обох файлів і Session Exit команди пропонують `/opsx:review <name>` лише після exit 0. Рядок `**Gate:**` звіту architect лише інформаційний. Правило діє для першого propose, re-propose і structure-only re-propose. Речення «parent may only verify files, run status, and run strict validation» розширюється на pre-gate і один re-spawn. Умови виходу «### propose → review» і Orchestration Checklist в `agent-orchestration/SKILL.md`, рядок Quality gates у `templates/AGENTS.md`, одне речення в `templates/CLAUDE.md`, рядок CLI↔Cursor в `openspec-howto/SKILL.md` і README Role 2 **Exit gate:** називають pre-gate. `openspec-guide.md` для стану «є `proposal.md`, немає `review.md`» запускає read-only `gate-check --review <name>` і радить `/opsx:review <name>` лише при exit 0, інакше `/opsx:propose <name>`, тож після `## Blocked` guide не відправляє на review.
- **B. Architect знає обов’язкові секції.** `templates/.agents/subagents/spec-architect.md` явно вимагає в proposal.md англійські заголовки рівня 2 `## Non-goals` і `## Acceptance criteria` (форма, що проходить regex Tier 1). Коли його спавнить `/opsx:propose`, перед звітом architect сам запускає `gate-check --review <name>` (read-only) і додає в звіт рядок `**Gate:** gate-check --review exit <code>`. Під `/opsx:quick` (без review) self-check не запускається, а звіт має `**Gate:** not run (/opsx:quick)`; заголовки proposal обов’язкові і там. Spawn-промпт, що не згадує `/opsx:quick` чи quick-mode scope, architect вважає spawn-ом з `/opsx:propose`.
- **C. Якість Done-when (текстові правила, без лінту).** У `spec-architect.md`, у блоці Task contract `opsx-propose.md` / `openspec-propose/SKILL.md` і в новому config template: Done-when перевіряє наявність нового стану, а не лише відсутність старого; кількісні перевірки узгоджені з кодом, який приписує `Do:` того ж таску; мінливі значення репо (поточна версія, дати, «верхній запис») описуються як «поточне значення» + правило на момент apply.
- **D. Стек-нейтральний openspec config для node/generic.** Новий `templates/openspec-config.yaml.example` (англійською, плейсхолдери `{{PROJECT_NAME}}` / `{{LANG}}`, кожне правило — рядок у подвійних лапках) з `rules.proposal` (Non-goals + Acceptance criteria, точна форма заголовків) і `rules.tasks` (контракт Files/Do/Done-when без Vue-специфіки + правила C). `resolveTemplate` уже відкочується на `templates/`, тож `init --profile node|generic` ставить `openspec/config.yaml.example` без змін коду. `update` і `init` без `--force` наявні `openspec/config.yaml` не чіпають; для них лише нотатка в README («## Update») і запис у `CHANGELOG.md` `[Unreleased]`. `init --force --profile node|generic` тепер перезаписує наявний `openspec/config.yaml` template-ом (як `init --force` для vue3/mvp), і README та CHANGELOG про це прямо попереджають.
- Smoke-асерти на нові фрази шаблонів (зокрема гілки `openspec-guide`), на стек-нейтральний template і на `init --profile node` / `generic`.
- Без **BREAKING**: CLI, `gate-check`, `runTier1Review` і його regex не змінюються.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `tiered-review`: propose-side Tier 1 pre-gate перед handoff на review (conductor, один re-spawn, `## Blocked` з `/opsx:propose <name>`), і шаблонні умови виходу Architect називають pre-gate. Вимога «Скриптовий Tier 1 перед LLM-review» і метрика discovery loops без змін: review і далі сам запускає Tier 1.
- `task-contract`: architect знає обов’язкові заголовки proposal і звітує результат Tier 1 (self-check лише для spawn з `/opsx:propose`, під `/opsx:quick` — `**Gate:** not run (/opsx:quick)`); три правила якості Done-when; стек-нейтральний config template з rules.proposal / rules.tasks для node/generic.
- `pipeline-subagents`: сценарій «Propose не пише артефакти в батькові» дозволяє conductor-у після звіту також pre-gate і один re-spawn; речення «спека `task-contract` не змінюється» в «Повторний propose після REQUEST CHANGES бере повний punch list» уточнюється як обсяг лише цієї вимоги; «openspec-guide маршрутизує REQUEST CHANGES на propose»: стан «є `proposal.md`, немає `review.md`» веде на `/opsx:review <name>` лише при `gate-check --review` exit 0, інакше на `/opsx:propose <name>`.

## Impact

- `templates/.agents/commands/opsx-propose.md`, `templates/.agents/skills/openspec-propose/SKILL.md` — речення про дозволені дії parent, блок Done-when quality після Task contract, новий крок 6 з pre-gate / re-spawn / Blocked, Output; у команді — Session Exit.
- `templates/.agents/subagents/spec-architect.md` — обов’язкові заголовки, правила Done-when, самозапуск `gate-check --review` для spawn з `/opsx:propose` (під `/opsx:quick` — `**Gate:** not run (/opsx:quick)`), рядок `**Gate:**` у report contract (джерело Amp wrapper `subagent-spec-architect`).
- `templates/.agents/skills/agent-orchestration/SKILL.md` — «### propose → review» і Orchestration Checklist.
- `templates/AGENTS.md` (бюджет < 4000 символів), `templates/CLAUDE.md`, `templates/.agents/skills/openspec-howto/SKILL.md`.
- `templates/.agents/subagents/openspec-guide.md` — рядок маршрутизації «`proposal.md` exists but no `review.md`» розгалужується за exit code `gate-check --review`.
- Новий `templates/openspec-config.yaml.example` (потрапляє в npm через `"files": ["templates/"]`).
- `README.md` («## Update» — ручне правило для наявного `openspec/config.yaml`; Role 2 **Exit gate:**), `CHANGELOG.md` `[Unreleased]`.
- `test/smoke.test.js` — нові тести; наявні асерти (`Spec review discovery loops: ≤ 2`, `Required Before Apply`, `**Source:** gate-check`) лишаються.
- Generated copies (`.claude/`, `.cursor/`, Amp wrappers, kit `.agents/`) оновлюються `update` / `sync`, не окремими тасками. `bin/agent-orchestrator.js` не змінюється.

## Non-goals

- Логіку й regex `gate-check --review` / `runTier1Review` (Tier 1) не змінювати; жодних змін `bin/agent-orchestrator.js`.
- Метрику `Spec review discovery loops: ≤ 2` не змінювати; зниження до ≤ 1 — окреме рішення після статистики.
- Review flow, `spec-reviewer.md`, `opsx-review.md`, `/opsx:quick` (`opsx-quick.md`) не чіпати; поведінка quick не змінюється, бо self-check Tier 1 у `spec-architect.md` обмежено spawn-ами з `/opsx:propose`.
- Жодної автоміграції наявних `openspec/config.yaml` у consumer-проєктах; `update` і далі не чіпає openspec config.
- Жодного детермінованого лінту якості Done-when — лише текстові правила для architect.
- Не виправляти YAML-лапки в `profiles/vue3/` і `profiles/mvp/openspec-config.yaml.example` (окремий change).
- Без bump версії, release-коміту та `npm publish` — лише запис у `CHANGELOG.md` `[Unreleased]`.

## Acceptance criteria

1. **Pre-gate у propose.** `opsx-propose.md` і `openspec-propose/SKILL.md` у кроці 6 вимагають від conductor-а `npx agent-orchestrator-kit gate-check --review <name>` для першого propose, re-propose і structure-only re-propose; exit ≠ 0 → один re-spawn `spec-architect` з повним списком помилок; далі ≠ 0 → `## Blocked` і next command `/opsx:propose <name>`; handoff на `/opsx:review` без exit 0 заборонений, і рядок Prompt у **Output** (та Session Exit команди) пропонує `/opsx:review <name>` лише після exit 0. Речення про дозволені дії parent називає pre-gate і re-spawn.
2. **Умови виходу Architect.** Розділ «### propose → review» в `agent-orchestration/SKILL.md` містить `gate-check --review` і Blocked-вихід; Orchestration Checklist має пункт pre-gate; `templates/AGENTS.md` (Quality gates), `templates/CLAUDE.md`, `openspec-howto/SKILL.md` і README Role 2 **Exit gate:** називають pre-gate; `openspec-guide.md` для «є `proposal.md`, немає `review.md`» радить `/opsx:review <name>` лише при `gate-check --review` exit 0, інакше `/opsx:propose <name>`; рядок `Spec review discovery loops: ≤ 2 (...)` у skill не змінений.
3. **Architect і секції.** `spec-architect.md` вимагає заголовки `## Non-goals` і `## Acceptance criteria` (англійські, рівень 2, з колонки 0), під `/opsx:propose` сам запускає `gate-check --review <name>` перед звітом (під `/opsx:quick` — ні, з рядком `**Gate:** not run (/opsx:quick)`; spawn без згадки quick вважається propose), а report contract має рядок `**Gate:** gate-check --review exit <code>`.
4. **Якість Done-when.** `spec-architect.md`, `opsx-propose.md` і `openspec-propose/SKILL.md` містять три правила: наявність нового стану («new state is present»), узгодженість кількісних перевірок з `Do:` того ж таску («consistent with the code»), заборона мінливих значень репо («volatile repo values»).
5. **Config template.** `templates/openspec-config.yaml.example` існує, містить `{{PROJECT_NAME}}` і `{{LANG}}`, `rules.proposal` з `## Non-goals` і `## Acceptance criteria`, `rules.tasks` з Files/Do/Done-when і правилами C, не згадує Vue/Pinia; кожен пункт під `rules:` — рядок у подвійних лапках, тож `openspec instructions` віддає ці rules без попередження «must be an array of strings».
6. **Init.** `init --profile node` і `init --profile generic` у порожній директорії створюють `openspec/config.yaml.example` з `Acceptance criteria` і без незамінених `{{`; наявний `openspec/config.yaml` після `init --profile node` без `--force` лишається байт-у-байт незмінним.
7. **Документація.** README «## Update» пояснює, як вручну додати правило в наявний `openspec/config.yaml` (з лапками); `CHANGELOG.md` між `## [Unreleased]` і наступним заголовком `## [` описує pre-gate, маршрутизацію guide і новий config template, попереджає, що `init --force --profile node|generic` перезаписує наявний `openspec/config.yaml`, і не дублює підзаголовки `### Added` / `### Changed`; `package.json` не змінений.
8. **Тести.** `test/smoke.test.js` містить усі асерти з брифу (propose/skill → `gate-check --review`; architect → `Non-goals` і `Acceptance criteria`; slice propose→review → `gate-check --review`; template існує з обома секціями; `init --profile node` → `openspec/config.yaml.example` з `Acceptance criteria`) і асерти гілок `openspec-guide`, і `npm test` зелений.
