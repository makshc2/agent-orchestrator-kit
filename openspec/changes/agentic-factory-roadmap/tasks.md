## 1. Верифікація артефактів роадмапу

- [x] 1.1 Прогнати strict-валідацію change-у
  Files: openspec/changes/agentic-factory-roadmap/proposal.md, openspec/changes/agentic-factory-roadmap/design.md, openspec/changes/agentic-factory-roadmap/specs/agentic-factory-roadmap/spec.md
  Do: виконати `npx openspec validate agentic-factory-roadmap --strict --type change`; якщо валідатор скаржиться на формат, виправити рівні заголовків (`### Requirement:` / `#### Scenario:`) і секції delta у spec.md
  Done-when: команда завершується з exit 0 і без warning-ів

- [x] 1.2 Прогнати лінт task-контракту
  Files: openspec/changes/agentic-factory-roadmap/tasks.md
  Do: виконати `npx agent-orchestrator-kit gate-check --tasks agentic-factory-roadmap`; за наявності помилок дописати відсутні поля `Files:`/`Do:`/`Done-when:` у названі таски
  Done-when: команда завершується з exit 0

- [x] 1.3 Підтвердити, що change не містить коду
  Files: openspec/changes/agentic-factory-roadmap/proposal.md
  Do: виконати `git status --porcelain` і звірити список зі скоупом; змінені шляхи мають належати лише `openspec/changes/agentic-factory-roadmap/`, `README.md`, `CHANGELOG.md`
  Done-when: у виводі немає шляхів із `bin/`, `templates/`, `profiles/`, `scripts/`, `test/`

## 2. Вказівник у документації

- [x] 2.1 Додати секцію Roadmap у README
  Files: README.md
  Do: перед секцією `## Changelog` вставити секцію `## Roadmap` на 5–8 рядків: назвати чотири фази (`add-factory-gates-and-mcp`, `add-factory-memory-and-skills`, `add-cloud-agent-handoff`, Phase 4 як opt-in рішення), вказати правило «одна фаза = один change» і дати посилання на `openspec/specs/agentic-factory-roadmap/spec.md`
  Done-when: `rg -n "^## Roadmap" README.md` дає один збіг, і секція стоїть перед `## Changelog`

- [x] 2.2 Додати запис у CHANGELOG
  Files: CHANGELOG.md
  Do: у секцію `## [Unreleased]` дописати підсекцію `### Added` з одним рядком про capability `agentic-factory-roadmap` (планувальний change, фази 1–4, non-goals платформенного рівня)
  Done-when: `rg -n "agentic-factory-roadmap" CHANGELOG.md` дає збіг у межах блоку `[Unreleased]`

## 3. Фінальні гейти перед PR

- [x] 3.1 Прогнати тести kit-а
  Files: test/smoke.test.js
  Do: виконати `npm test` і переконатись, що docs-зміни не зламали smoke-тести CLI
  Done-when: `npm test` завершується з exit 0

- [x] 3.2 Прогнати повну валідацію OpenSpec
  Files: openspec/changes/agentic-factory-roadmap/specs/agentic-factory-roadmap/spec.md
  Do: виконати `npx openspec validate --all --strict` і переконатись, що новий change не конфліктує з наявними спеками
  Done-when: команда завершується з exit 0
