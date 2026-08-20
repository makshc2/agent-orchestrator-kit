## Why

Kit уже є Agentic Software Factory для IDE (пайплайн, субагенти, task-контракт, двоярусний review, archive CLI), але три дірки ламають щоденний цикл: review-гейт не тримає локальний `git commit`, оголошені `mcp.optional` (`github`, `browser`) не встановлюються патерном Figma-launcher-а і **не покривають робочий GitLab**, а cloud-сесії лишають артефакти поза git. Особисті репо (включно з цим kit) живуть на GitHub; робочі Vue-консюмери — на GitLab. Роадмап потрібен до коду, щоб ці інкременти не злилися в один PR/MR і щоб «фабрика» не стала GitHub-only оркестратором.

## What Changes

- Планувальний change без коду: фіксує послідовність фаз розвитку kit-а до Agentic Factory і межі кожної фази.
- Нова capability `agentic-factory-roadmap`: вимоги до порядку фаз, до того, що кожна фаза є окремим change, і до явних non-goals платформенного рівня.
- Phase 1 (`add-factory-gates-and-mcp`), Phase 2 (`add-factory-memory-and-skills`), Phase 3 (`add-cloud-agent-handoff`), Phase 4 (control plane / sandbox) описані як **наступні окремі changes**, а не як таски цього change.
- Phase 1 VCS MCP: GitHub для особистих репо, GitLab для робочих (у тому числі self-hosted). Хост і base URL беруться з `git remote get-url origin`, не з прапорця `--ci` (той лишається лише для CI-файлів).
- Паритет IDE: фази 1–3 MUST працювати повноцінно в **Cursor**, **Claude Code** і **Amp Code**. Cursor-native browser / Cursor-only MCP не є контрактом kit-а.
- `README.md` отримує короткий вказівник на роадмап-спеку, `CHANGELOG.md` — запис в `[Unreleased]`. Розгорнутий опис стовпів фабрики в README — таск Phase 1.

Не BREAKING: жодна наявна команда, спека чи шаблон не змінює поведінку.

## Capabilities

### New Capabilities
- `agentic-factory-roadmap`: послідовність і межі фаз розвитку kit-а до Agentic Factory — по одному change на фазу, з зафіксованими non-goals і критерієм переходу до наступної фази.

### Modified Capabilities
<!-- Немає: цей change не змінює вимоги наявних спек (orchestrator-cli-controls, session-handoff, pipeline-subagents, task-contract, tiered-review тощо). Гейти, MCP-лаунчери й cloud-handoff змінять їх у Phase 1–3. -->

## Non-goals

- Імплементація Phase 1 (pre-commit hook, GitHub/Browser MCP launcher, MCP health у `status`) — окремий change після archive цього.
- Другий оркестратор або runtime: LangGraph, CrewAI, Temporal, hosted Control Plane API.
- Docker sandbox для `code-writer` / shell.
- Vue-dashboard run-ів, multi-tenant, RBAC, token accounting.
- Зміни в `bin/agent-orchestrator.js`, `templates/`, `profiles/` у межах цього change.
- Перенос артефактів із cloud-VM гілки `cursor/agentic-factory-gap-analysis-a18e` — карта пишеться заново в git.

## Acceptance criteria

1. `openspec/changes/agentic-factory-roadmap/` містить `proposal.md`, `design.md`, `tasks.md` і `specs/agentic-factory-roadmap/spec.md`.
2. `design.md` описує фази 1–4 з мапінгом на `explore → [design] → propose → review → apply → verify → archive` і назвами наступних changes.
3. Delta spec фіксує: одна фаза = один change, Phase 1 не стартує до archive цього change, платформенні пункти належать Phase 4 і вимагають окремого рішення.
4. `npx openspec validate agentic-factory-roadmap --strict --type change` завершується з exit 0.
5. `npx agent-orchestrator-kit gate-check --tasks agentic-factory-roadmap` завершується з exit 0.
6. Змінені файли обмежені `openspec/changes/agentic-factory-roadmap/`, `README.md` і `CHANGELOG.md` (перевірка: `git status --porcelain`).
7. `npm test` завершується з exit 0 (регресії від docs-змін немає).

## Impact

- **Код**: не зачіпається. `bin/`, `templates/`, `profiles/`, `scripts/` без змін.
- **Спеки**: додається `openspec/specs/agentic-factory-roadmap/spec.md` після `/opsx:archive --sync`.
- **Процес**: наступні три changes стартують у зафіксованому порядку; Phase 4 лишається стелею, не спринтом.
- **Залежності**: немає нових npm-залежностей.
