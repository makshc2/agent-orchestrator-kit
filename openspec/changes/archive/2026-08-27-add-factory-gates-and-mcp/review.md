# Spec Review: add-factory-gates-and-mcp

- Tier: 2 (LLM), Tier 1 зелений (`openspec validate --strict` exit 0, `gate-check --tasks` exit 0, `gate-check --review` passed)
- Дата: 2026-08-27
- Reviewer: spec-reviewer

## Що перевірено

- Узгодженість proposal ↔ design ↔ delta specs ↔ tasks: усі 6 acceptance criteria покриті — AC1 (гейт блокує/пропускає/no-op) → commit-review-gate сценарії + таска 1.1; AC2 (init без --hooks, husky-append) → commit-review-gate + 1.3; AC3 (детекція origin, --ci, --vcs, no remote) → optional-mcp-setup + 3.1/3.2; AC4 (паритет examples) → вимога «Паритет» + 2.3; AC5 (health без токенів) → вимога «MCP-health» + 3.3; AC6 (npm test) → 4.1. Рішення D1–D6 design відображені у сценаріях один-в-один.
- Фактаж проти коду v0.3.0 підтверджений: `gate-check` diff-ить через `gitDiffTouchesGlob(base)` і при `null` робить warning + exit 0 (`bin/agent-orchestrator.js` ~1634–1640) — семантика «never block on unknown» для `--staged` успадковується коректно; `readPipelineConfig`, `ensureFigmaEnvFile`, `ensureFigmaMcpEntry`, `FIGMA_MANAGED_PATHS`, `GITIGNORE_LINES` існують і відповідають описам design; `templates/orchestrator.yaml` справді має `mcp.optional: figma, github, browser` без `gitlab`; у `templates/scripts/` немає жодного з трьох нових launcher-ів.
- Відповідність роадмапу (`agentic-factory-roadmap`): скоуп = Phase 1 дослівно (гейт на commit + mcp.optional патерном Figma + health у status + VCS з origin); сценарії «--ci не перевизначає», «self-hosted GitLab base URL з remote», «Cursor IDE browser не замінює Browser MCP» перенесені в delta-спеки без drift-у. Non-goals коректно відкидають Phase 2–4.
- Паритет Amp: роадмап-клауза «абсолютний шлях за правилом Memory MCP» виконується наявним патерном — у конфігах відносний `scripts/<tool>-mcp-launcher.cjs`, абсолютні шляхи обчислює сам launcher (як `memory-mcp-launcher.cjs` з `MEMORY_FILE_PATH`); delta-спека «ті самі launcher-шляхи в обох examples» цьому не суперечить.
- Конфлікти з наявними спеками не знайдено: `orchestrator-cli-controls` прямо дозволяє виклик gate-check із pre-commit hook; `figma-token-setup` не поглинається (D3 зберігає `figma-setup`/`figma-status`); `--ci` семантика (лише CI-шаблони) не змінюється.
- Самодостатність тасків: кожна має Files/Do/Done-when, виконувана без читання design.md; Done-when перевірні.

## Знахідки (за спаданням серйозності)

1. **Minor — upstream-статус reference-серверів.** `@modelcontextprotocol/server-github` і `@modelcontextprotocol/server-gitlab` заархівовані upstream-ом. Design це чесно фіксує в Risks і Open Questions з мітигацією (контракт ізольований у launcher-і, заміна = один файл). Виконавцю: при apply перевірити, що пакети досі ставляться через `npx -y` і працюють по stdio; якщо ні — замінити пакет у launcher-і без зміни спеки (спека фіксує поведінку, не пакет).
2. **Info — перетин тасків 1.3 і 3.4.** Обидві згадують додавання `pre-commit-gate-check.sh` до managed-списків init/update. Не блокує: виконати один раз, у 3.4 лише переконатися, що вже зроблено.
3. **Info — свіжий live-конфіг з example містить figma.** D6 чистить лише недетектований VCS; створений з example `.mcp.json` міститиме й `figma` без токена — launcher впаде з підказкою. Це наявна семантика example (не регресія цього change), спека figma-token-setup це покриває.
4. **Info — рекомендація попереднього review не взята в скоуп.** Review роадмапу радив у Phase 1 уточнити THEN-клаузу сценарію «Планувальний change не містить коду». Modified Capabilities порожні свідомо («роадмап виконується, а не модифікується») — прийнятно, рекомендація лишається на archive/sync.
5. **Info — вартість хука в консюмері без kit-а в devDependencies.** `npx agent-orchestrator-kit` на commit може тягнути пакет з registry. Design фіксує ризик cold start; README (таска 4.2) має згадати рекомендацію мати kit у devDependencies.

## Висновок

Артефакти взаємно узгоджені, фактаж проти коду точний, скоуп збігається з Phase 1 роадмапу, non-goals тримають межі, таски виконувані сліпим виконавцем. Знахідки не матеріальні для apply.

Verdict: APPROVE
