# Tasks: Pipeline Automation Hardening

_40 atomic tasks across 8 sections._

## 1. CLI: `status`

- [x] 1.1 `bin/agent-orchestrator.js`: команда `status` — читає активні `openspec/changes/*/` (крім `archive/`), парсить `tasks.md` (`[x]`/`[ ]`), `review.md` (`Verdict:`)
- [x] 1.2 Вивід: назва зміни, прогрес задач `N/M`, review verdict (`APPROVE`/`REQUEST CHANGES`/`none`), прапорець `ready to archive` коли всі задачі `[x]`
- [x] 1.3 "No active changes" повідомлення + exit code 0, коли активних змін немає

## 2. CLI: `gate-check`

- [x] 2.1 `bin/agent-orchestrator.js`: команда `gate-check [change-name]` з опцією `--src-glob` (default `src/`)
- [x] 2.2 Читає `.agents/orchestrator.yaml` (`pipeline.require_spec_review`, `pipeline.max_active_changes`); graceful exit 0 якщо файл відсутній
- [x] 2.3 Git diff проти base (`--base` опція, fallback `HEAD~1`) для `--src-glob`; немає змін → exit 0
- [x] 2.4 `require_spec_review: false` → exit 0 з повідомленням "review not required"
- [x] 2.5 Пошук `review.md` для вибраної/активної зміни; `Verdict: APPROVE` → exit 0, інакше exit 1 з детальним повідомленням
- [x] 2.6 Warning (не fail) коли кількість активних changes > `max_active_changes`
- [x] 2.7 Ambiguous change (декілька активних, `change-name` не передано) — вибрати найновішу за `lastModified`, повідомити який саме, підказати explicit override

## 3. CLI: sync delete-семантика

- [x] 3.1 `copyDir()` отримує опцію `delete: true` — після копіювання видаляє з `dest` файли/директорії відсутні в `src`
- [x] 3.2 `sync` команда використовує `delete: true` для `.agents/skills/` → `.cursor/skills/`, `.claude/skills/` та `.agents/rules/` → `.cursor/rules/`
- [x] 3.3 Delete НЕ зачіпає `.cursor/memory.json`, `.mcp.json`, `.claude/CLAUDE.md`, `.amp/settings.json` (генеруються окремо, не з `.agents/skills|rules`)

## 4. GitHub AI Spec Verifier

- [x] 4.1 `templates/.github/workflows/spec-verify.yml` — job з `permissions: pull-requests: write`, встановлює `amp` CLI, запускає `scripts/verify-specs.sh` + `scripts/post-pr-verdict-github.sh`, exit 1 при `pass: false`
- [x] 4.2 `templates/scripts/post-pr-verdict-github.sh` — parse `artifacts/verdict.json`, `gh pr comment --body-file`, graceful skip поза PR контекстом, не логує `GH_TOKEN`/`GITHUB_TOKEN`
- [x] 4.3 `bin/agent-orchestrator.js`: `--spec-verify` дозволений з `--ci github` (не лише `gitlab`); `installSpecVerify()` копіює правильний набір файлів залежно від `ci`
- [x] 4.4 `KIT_OPTIN_PATHS` розширено GitHub-варіантом; `update` оновлює лише встановлені файли (як для GitLab)
- [x] 4.5 Next steps виводу для `init --ci github --spec-verify` (потрібні секрети: `AMP_API_KEY`; `GH_TOKEN`/`GITHUB_TOKEN` вже надається Actions runtime)

## 5. GitLab fragment: gate-check крок

- [x] 5.1 `templates/.gitlab/agent-verify.yml`: додати крок виклику `gate-check` (через локальний `node bin`-еквівалент або `npx agent-orchestrator-kit gate-check`, якщо kit встановлено як dependency) в `.agent-verify-base`
- [x] 5.2 Крок graceful degrade — не провалює job, якщо `.agents/orchestrator.yaml` відсутній
- [x] 5.3 `templates/.github/workflows/agent-verify.yml`: аналогічний крок `gate-check`

## 6. Tests (test/smoke.test.js)

- [x] 6.1 `status` виводить прогрес задач і review verdict для тестової зміни
- [x] 6.2 `status` без активних changes — "No active changes"
- [x] 6.3 `gate-check` exit 1 без `review.md` при `require_spec_review: true` і зміні в `src/`
- [x] 6.4 `gate-check` exit 0 з `review.md` (`Verdict: APPROVE`)
- [x] 6.5 `gate-check` exit 0 при `require_spec_review: false`
- [x] 6.6 `gate-check` exit 0 коли git diff не чіпає `src/`
- [x] 6.7 `sync` видаляє скіл з `.cursor/skills/`/`.claude/skills/` після видалення з `.agents/skills/`
- [x] 6.8 `sync` не видаляє `.cursor/memory.json`
- [x] 6.9 `init --ci github --spec-verify` встановлює 3 файли (workflow + 2 скрипти) + chmod +x
- [x] 6.10 `init --ci gitlab --spec-verify` продовжує працювати без регресій (existing tests)
- [x] 6.11 `update` оновлює GitHub spec-verify файли лише за наявності

## 7. Docs

- [x] 7.1 README: секції для `agent-orchestrator status`, `gate-check`, GitHub AI Spec Verifier паритет
- [x] 7.2 `templates/AGENTS.md` / `templates/.agents/skills/agent-orchestration/SKILL.md`: згадати `status`/`gate-check` як частину Handoff Protocol
- [x] 7.3 CHANGELOG: новий розділ версії

## 8. Release

- [x] 8.1 `package.json` version bump
- [x] 8.2 `npx openspec validate --all --strict` — pass
- [x] 8.3 `npm test` — pass
- [x] 8.4 `npm run release:check` — pass
- [ ] 8.5 Commit + tag (pending explicit user confirmation — not auto-committed)
