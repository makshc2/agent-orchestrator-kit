# Apply notes: agentic-factory-roadmap

## Констрейнти
- Docs-only: писати лише в `openspec/changes/agentic-factory-roadmap/`, `README.md`, `CHANGELOG.md`.
- Не торкатися `bin/`, `templates/`, `profiles/`, `scripts/`, `test/`, `openspec/specs/`.
- Не редагувати proposal/design/spec/tasks — лише виконувати таски й ставити `[x]`.

## Підводні камені
- Таска 2.1: одна секція `## Roadmap` перед `## Changelog` (README, ~рядок 802), 5–8 рядків,
  чотири назви фаз, правило «одна фаза = один change», лінк на `openspec/specs/agentic-factory-roadmap/spec.md`.
- Таска 2.2: `### Added` саме під `## [Unreleased]` (верх CHANGELOG), не під `[0.3.0]`.
- Сценарій delta-спеки «не містить коду» не згадує README/CHANGELOG — відома Minor-неточність (див. review.md);
  скоуп визначає таска 1.3: README.md і CHANGELOG.md дозволені. Спеку не «виправляти».

## Перевірка (порядок тасок)
- `npx openspec validate agentic-factory-roadmap --strict --type change`
- `npx agent-orchestrator-kit gate-check --tasks agentic-factory-roadmap`
- `git status --porcelain` — лише дозволені шляхи
- `npm test`
- `npx openspec validate --all --strict`
