# add-factory-gates-and-mcp

Design: none

## Why

Phase 1 роадмапу `agentic-factory-roadmap` закриває два щоденні розриви: локальний `git commit` у `src/` проходить без `Verdict: APPROVE` (governance-розрив на кожному коміті), а `github`, `gitlab` і `browser` існують лише як рядки в `mcp.optional` без launcher-ів, setup-команд і health-перевірки (Perceive-розрив на кожному PR/MR). Робочі репо власника живуть на GitLab (зокрема self-hosted), особисті — на GitHub, тому VCS MCP має визначатись з `git remote get-url origin`, а не з `--ci`.

## What Changes

- Новий opt-in pre-commit гейт: скрипт `templates/scripts/pre-commit-gate-check.sh`, який викликає `npx agent-orchestrator-kit gate-check --staged`; підключення через `init --hooks` / нову команду `hooks-setup` (husky-first, інакше `core.hooksPath`). No-op при `require_spec_review: false`. Прямий запис у `.git/hooks/` без opt-in заборонений.
- Новий режим `gate-check --staged`: перевірка staged-змін (`git diff --cached`) замість `HEAD~1`, для використання у pre-commit хуку.
- Нові MCP launcher-и за патерном Figma: `github-mcp-launcher.cjs`, `gitlab-mcp-launcher.cjs`, `browser-mcp-launcher.cjs` + gitignored env-файли `.agents/github.local.env`, `.agents/gitlab.local.env` з committed `.example`-файлами. Токени ніколи не друкуються і не потрапляють у committed конфіги.
- Нова команда `mcp-setup`: детекція VCS-хоста з `git remote get-url origin` (github.com → GitHub MCP; gitlab.com / self-hosted GitLab → GitLab MCP з base URL із remote; немає remote → жоден), установка browser MCP, запис у живі `.mcp.json` і `.amp/settings.json`. `--ci` не впливає на детекцію.
- MCP-health у `npx agent-orchestrator-kit status`: для кожного MCP з `mcp.baseline`/`mcp.optional` — configured / missing (launcher, env-файл, запис у конфігах), без друку токенів.
- `templates/orchestrator.yaml`: `mcp.optional` доповнюється `gitlab`.
- Committed examples (`.agents/mcp.json.example`, `.agents/amp.settings.json.example`) отримують записи `github`, `gitlab`, `browser` — усі три IDE (Cursor, Claude Code, Amp) запускають ті самі stdio launcher-и.
- `update` починає освіжати нові managed-файли; `.gitignore` доповнюється новими env-шляхами.

## Capabilities

### New Capabilities

- `commit-review-gate`: opt-in детермінований pre-commit гейт на `gate-check`, який блокує commit у `src/` без APPROVE-вердикту; no-op у MVP-режимі; не ламає наявний husky/lefthook консюмера.
- `optional-mcp-setup`: установка `mcp.optional` інструментів (`github`, `gitlab`, `browser`) патерном Figma-launcher-а: stdio launcher-и, gitignored env + committed examples, детекція VCS-хоста з git remote, MCP-health у `status`, паритет Cursor / Claude Code / Amp Code.

### Modified Capabilities

<!-- порожньо: вимоги наявних спек не змінюються; agentic-factory-roadmap виконується, а не модифікується -->

## Impact

- `bin/agent-orchestrator.js`: нові команди `hooks-setup`, `mcp-setup`; розширення `gate-check` (`--staged`), `status` (MCP health), `init` (`--hooks`), `update` (нові managed-файли), `.gitignore`-список.
- `templates/scripts/`: нові `pre-commit-gate-check.sh`, `github-mcp-launcher.cjs`, `gitlab-mcp-launcher.cjs`, `browser-mcp-launcher.cjs`.
- `templates/.agents/`: нові `github.local.env.example`, `gitlab.local.env.example`; оновлені `mcp.json.example`, `amp.settings.json.example`.
- `templates/orchestrator.yaml`: `mcp.optional` + `gitlab`.
- `test/smoke.test.js`: тести на opt-in хук, детекцію remote, MCP health, `--staged`.
- Зовнішні залежності (runtime, через `npx -y` у launcher-ах): `@modelcontextprotocol/server-github`, `@modelcontextprotocol/server-gitlab`, `@playwright/mcp`. У `package.json` kit-а нових залежностей немає.
- Наявні консюмери не зачіпаються, поки не виконають `update` + opt-in команди.

## Non-goals

- Memory/decisions у git як канон і skill-інвентар — Phase 2 (`add-factory-memory-and-skills`).
- Поле `runtime` у handoff і cloud-дисципліна workspace — Phase 3 (`add-cloud-agent-handoff`).
- Зовнішній orchestration runtime, Control Plane API, dashboard, multi-tenant/RBAC, token accounting, Docker sandbox — Phase 4, потребує окремого рішення.
- Безумовна установка pre-commit хука для всіх профілів або прямий запис у `.git/hooks/`.
- Cursor IDE browser як заміна Browser MCP — не закриває вимогу паритету Claude/Amp.
- Новий патерн зберігання MCP-секретів — використовується виключно наявний патерн Figma.

## Acceptance criteria

- Проєкт із `require_spec_review: true` і встановленим хуком: commit зі змінами у `src/` без `review.md` з `Verdict: APPROVE` відхиляється з non-zero exit; з APPROVE — проходить. При `require_spec_review: false` хук — no-op (exit 0).
- `init` без `--hooks` не торкається git hooks; `hooks-setup` у репо з наявним `.husky/` доповнює husky, не перезаписуючи чужі хуки.
- `mcp-setup` у репо з origin `github.com` ставить лише GitHub MCP; з origin на self-hosted GitLab — лише GitLab MCP з base URL із remote; `--ci` не перевизначає детекцію; без remote — жоден VCS MCP, `status` показує пропуск.
- `github`, `gitlab`, `browser` записи присутні в обох committed examples (Cursor/Claude і Amp) і вказують на ті самі `scripts/<tool>-mcp-launcher.cjs`; committed файли не містять реальних токенів.
- `npx agent-orchestrator-kit status` показує health кожного MCP з baseline/optional без друку значень токенів.
- `npm test` зелений; нові тести покривають opt-in хука, детекцію remote і MCP health.
