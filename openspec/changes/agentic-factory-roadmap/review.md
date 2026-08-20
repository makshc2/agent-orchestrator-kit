# Spec Review: agentic-factory-roadmap

- Tier: 2 (LLM), Tier 1 зелений (`openspec validate --strict` exit 0, `gate-check --tasks` exit 0, `gate-check --review` passed)
- Дата: 2026-08-20
- Reviewer: spec-reviewer (subagent)

## Що перевірено

- Узгодженість proposal ↔ design ↔ delta spec ↔ tasks ↔ handoff: назви фаз (`add-factory-gates-and-mcp`, `add-factory-memory-and-skills`, `add-cloud-agent-handoff`, Phase 4) ідентичні в усіх п'яти артефактах; усі 7 acceptance criteria покриті тасками (1.1→AC4, 1.2→AC5, 1.3→AC6, 3.1→AC7, 3.2 — додаткова валідація; AC1–3 виконуються самими артефактами); non-goals збігаються між proposal, design і вимогою «Платформенний скоуп відкладений у Phase 4».
- Конфлікти з наявними спеками — не знайдено:
  - `orchestrator-cli-controls`: теза design про pre-commit підтверджується дослівно — вимога gate-check каже «придатну для виклику з CI або pre-commit hook»; сценарії no-op при `require_spec_review: false` узгоджені.
  - `figma-token-setup`: патерн у D5 (gitignored env + committed example + launcher + setup/status без друку токена) відповідає спеці один-в-один.
  - `--ci` семантика (`gitlab-consumer-verify`, `github-spec-verify`, код `bin/agent-orchestrator.js`): `--ci gitlab|github|none` керує лише CI-файлами — теза D9 «`--ci` керує лише шаблонами CI» точна; детекція VCS MCP з `git remote origin` — новий ортогональний механізм, не суперечить.
  - `session-handoff`: поле `runtime: local|cloud` у Phase 3 змінить шаблон handoff — proposal чесно фіксує це в коментарі Modified Capabilities як роботу фаз 1–3, цей change нічого не змінює.
  - `tiered-review`, `task-contract`, `pipeline-subagents`, `lean-archive`, `kit-ci-verify`, `design-intake`, `spec-verify-consumer`: суперечностей немає; вимога паритету IDE повторює вже прийняті правила sync/Amp-wrappers.
- Scope creep: платформенні пункти (runtime, Control Plane, dashboard, RBAC, token accounting, sandbox, audit) відсутні у межах фаз 1–3 — усі явно віднесені до Phase 4.
- Референси на репозиторій: `templates/scripts/memory-mcp-launcher.cjs` і `figma-mcp-launcher.cjs` існують; `test/smoke.test.js` існує; `## Changelog` у README (один збіг, рядок ~802) — якір таски 2.1 валідний, `## Roadmap` ще не існує; `## [Unreleased]` у CHANGELOG існує; `vue3` профіль справді оголошує `mcp.optional: figma, github, browser` без `gitlab` (в інших профілях лише `figma`) — фактаж proposal/design точний; дефолти `require_spec_review: true`, `max_active_changes: 1` у `templates/orchestrator.yaml` підтверджені.
- Самодостатність тасків: кожен таск виконується сліпим виконавцем з Files/Do/Done-when без читання design.md; команди перевірні.

## Знахідки (за спаданням серйозності)

1. **Minor — drift сценарію delta-спеки vs скоуп apply.** Сценарій «Планувальний change не містить коду» (THEN): «змінені шляхи належать лише `openspec/changes/agentic-factory-roadmap/`» — не згадує `README.md` і `CHANGELOG.md`, які proposal AC6 дозволяє, а таски 2.1/2.2 змінюють. Операційна перевірка (AND-клауза: `bin/`, `templates/`, `profiles/`, `scripts/` не змінені) і Done-when таски 1.3 узгоджені між собою, жоден механічний гейт літеральний THEN не перевіряє, тож імплементацію це не блокує. Виконавцю: скоуп визначає таска 1.3 (README/CHANGELOG дозволені), сценарій не «виправляти». Рекомендація на майбутнє: при archive/sync або в Phase 1 уточнити THEN-клаузу.
2. **Minor — неточне формулювання у сценарії паритету.** «committed Cursor/Claude MCP example (`.mcp.json` / `.agents/mcp.json.example`)» змішує живий конфіг `.mcp.json` із committed example `.agents/mcp.json.example`. Операційна вимога (committed конфіг без реального токена) сформульована окремо і коректно; деталізується у власному design Phase 1.
3. **Info — Done-when таски 2.2 не повністю механічний.** `rg -n "agentic-factory-roadmap" CHANGELOG.md` сам по собі не доводить «у межах блоку `[Unreleased]`» — виконавець має звірити номер рядка з межами секції. Тривіально, не матеріальний здогад.
4. **Info — Files таски 1.3 звужені.** Вказано лише `proposal.md`, хоча перевірка — repo-wide `git status --porcelain`; Do однозначний, плутанини не створює.
5. **Info — нумерація рішень у design.md.** D10 стоїть у файлі перед D9; зміст повний, handoff перелічує всі десять коректно. Косметика.

## Висновок

Артефакти взаємно узгоджені, конфліктів з наявними спеками немає, межі фаз і non-goals зафіксовані перевірно, таски виконувані без матеріальних здогадів. Знахідки 1–2 варто зачистити у Phase 1 або при sync, вони не впливають на apply цього change.

Verdict: APPROVE
