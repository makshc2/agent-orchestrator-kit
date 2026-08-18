# Tasks: lean-pipeline-v2

## 1. Archive CLI

- [x] 1.1 Команда `archive <name>` у CLI
  Files: bin/agent-orchestrator.js
  Do: додати commander-команду `archive <name>` з прапорцями `--sync/--no-sync`, `--force`: резолв через `npx openspec status --change <name> --json`; гейти (APPROVE у review.md при `require_spec_review: true`, відсутність `- [ ]` у tasks.md, target-архів не існує); семантика для delta specs: `--sync` → merge+archive, без прапорців → exit 1 з вимогою `--sync` або `--no-sync --force`, `--no-sync` без `--force` → exit 1, `--no-sync --force` → archive без merge; без delta specs прапорці не впливають і archive виконується; перед merge зробити snapshot усіх main spec-файлів, які буде змінено/створено; merge у `openspec/specs/` при `--sync` (ADDED append, MODIFIED replace requirement, REMOVED delete; конфлікт → відмова з підказкою про openspec-sync-specs); `mv` у `archive/YYYY-MM-DD-<name>`; `npx openspec validate --all --strict` з повним rollback при падінні (відновити main specs до pre-sync стану, видалити нові spec-файли, відкотити move); фінальний handoff.md (`next_command: none`) + upsert memory.json; підсумок у stdout
  Done-when: на завершеному тест-change exit 0 і папка в archive/; на change з незакритим гейтом exit 1 зі stderr-назвою гейта

- [x] 1.2 Тонка команда opsx-archive
  Files: templates/.agents/commands/opsx-archive.md
  Do: переписати до ≤ 1.5 KB: посилання на start/exit протокол із session-handoff.mdc, резолв імені (AskUserQuestion при неоднозначності), виклик `npx agent-orchestrator-kit archive <name> [--sync]`, показ stdout as-is; прибрати spawn spec-archiver, ручний merge/move, HARD STOP-текст
  Done-when: `wc -c` ≤ 1536; файл не містить «spec-archiver» і містить «agent-orchestrator-kit archive»

- [x] 1.3 Оновити skill openspec-archive-change і субагент spec-archiver
  Files: templates/.agents/skills/openspec-archive-change/SKILL.md, templates/.agents/subagents/spec-archiver.md
  Do: skill — той самий тонкий CLI-протокол, що і команда; spec-archiver description → fallback-only («Use ONLY when `agent-orchestrator-kit archive` CLI is unavailable/failed»)
  Done-when: обидва файли згадують CLI-команду archive; description spec-archiver містить fallback-умову

## 2. Task-контракт і gate-check

- [x] 2.1 Лінт task-контракту в gate-check
  Files: bin/agent-orchestrator.js
  Do: додати до `gate-check` режим `--tasks <name>`: парсер тасків (`- [ ]`/`- [x]` + індентовані `Files:`/`Do:`/`Done-when:`); помилки: відсутнє поле, патерни `as needed|if necessary|as appropriate|де потрібно|за потреби` у Do, `Files:` вказує на неіснуючий шлях без префікса `new file:`; режим із `pipeline.task_contract: warn|strict|off` (default `warn`; strict → exit 1)
  Done-when: фікстурний tasks.md без Done-when і фікстура з неіснуючим шляхом у Files дають exit 1 у strict; невалідний контракт дає exit 0 з попередженням у warn

- [x] 2.2 Контракт у шаблонах propose
  Files: templates/.agents/commands/opsx-propose.md, templates/.agents/skills/openspec-propose/SKILL.md, templates/.agents/subagents/spec-architect.md, profiles/mvp/openspec-config.yaml.example, profiles/vue3/openspec-config.yaml.example
  Do: додати вимогу контрактного формату тасків (Files/Do/Done-when, самодостатність без design.md, заборона неконкретних формулювань) в інструкції архітектора і в rules.tasks конфіг-прикладів
  Done-when: усі п'ять файлів містять «Done-when»

- [x] 2.3 Прапорець task_contract у конфігах
  Files: templates/orchestrator.yaml, profiles/generic/orchestrator.yaml, profiles/vue3/orchestrator.yaml, profiles/node/orchestrator.yaml, profiles/mvp/orchestrator.yaml
  Do: додати `pipeline.task_contract: warn` (mvp: `off`)
  Done-when: grep `task_contract` знаходить рядок у всіх п'яти файлах

## 3. Двоярусний review

- [x] 3.1 `gate-check --review <name>` (Tier 1)
  Files: bin/agent-orchestrator.js
  Do: додати режим `--review`: openspec validate --strict --type change; лінт 2.1; перевірка секцій `Non-goals` і `Acceptance criteria` у proposal.md; непорожні ADDED/MODIFIED/REMOVED секції в delta specs; вихід — людський stdout + `--json` звіт `{pass, errors[]}`
  Done-when: change без Non-goals дає `pass: false` з відповідною помилкою; валідний change дає `pass: true`

- [x] 3.2 Оновити opsx-review під два яруси
  Files: templates/.agents/commands/opsx-review.md, templates/.agents/subagents/spec-reviewer.md
  Do: крок 1 — `gate-check --review`; при падінні: записати review.md (Verdict: REQUEST CHANGES, помилки скрипта), вивести вердикт, exit-протокол — без спавну spec-reviewer і читання артефактів; при OK — spawn spec-reviewer зі скороченим чеклістом (узгодженість proposal↔design↔tasks, конфлікти з main specs, scope creep, самодостатність тасків для сліпого виконавця); при APPROVE spec-reviewer пише також apply-notes.md (≤ 20 рядків: констрейнти, підводні камені, що не чіпати, команди перевірки) — другий дозволений файл
  Done-when: opsx-review.md містить «gate-check --review» до кроку спавну і «apply-notes.md» у кроці APPROVE; чекліст не дублює перевірки Tier 1

## 4. Lean apply

- [x] 4.1 Прибрати обов'язкове делегування з apply
  Files: templates/.agents/commands/opsx-apply.md, templates/.agents/skills/openspec-apply-change/SKILL.md
  Do: замінити «Conductor delegation is mandatory» на: parent читає tasks.md + apply-notes.md (design/proposal — лише за посиланням із таска чи неповного контракту) і пише код/тести сам; субагенти — для ≥ 2 незалежних тасків без спільних файлів або на явний запит; design-implementer лишається для design-brief/Figma; escape-клапан: інформація поза контрактом+notes+згаданими артефактами → STOP, gap у handoff.md, next `/opsx:propose <name>`, імпровізація заборонена
  Done-when: обидва файли без «delegation is mandatory», містять «apply-notes.md» і STOP-клапан

- [x] 4.2 Routing-таблиця і orchestration-скіл
  Files: templates/.agents/rules/agent-orchestration.mdc, templates/.agents/skills/agent-orchestration/SKILL.md
  Do: оновити таблицю «фаза × сигнал → субагент»: propose/review — mandatory; apply — optional (паралельні таски/явний запит) + design-implementer за сигналом; archive — CLI, субагент заборонений; узгодити текст скіла
  Done-when: таблиця в обох файлах відображає mandatory/optional/CLI статуси за фазами

## 5. Handoff без субагента

- [x] 5.1 Прапорець і конфіги
  Files: templates/orchestrator.yaml, profiles/generic/orchestrator.yaml, profiles/vue3/orchestrator.yaml, profiles/node/orchestrator.yaml, profiles/mvp/orchestrator.yaml
  Do: `handoff.spawn_handoff_subagent: false`
  Done-when: grep показує `spawn_handoff_subagent: false` у всіх п'яти файлах

- [x] 5.2 Канонічний протокол в одному rule
  Files: templates/.agents/rules/session-handoff.mdc
  Do: переписати: Start — status → `handoff --restore` (briefing канонічний, без окремого Memory MCP кроку) → fallback handoff.md → субагент лише якщо все впало; Exit — parent пише handoff.md → `handoff <name>` exit 0 → paste stdout-prompt; Memory MCP — опційне дзеркало одним викликом; субагент persist — fallback при падінні CLI; archive — фінальний handoff без next-prompt
  Done-when: rule містить обидва протоколи повністю; спавн субагента згаданий лише як fallback

- [x] 5.3 Дедуплікація в командах і субагенті
  Files: templates/.agents/commands/opsx-explore.md, templates/.agents/commands/opsx-design.md, templates/.agents/commands/opsx-propose.md, templates/.agents/commands/opsx-review.md, templates/.agents/commands/opsx-apply.md, templates/.agents/commands/opsx-quick.md, templates/.agents/commands/opsx-sync.md, templates/.agents/subagents/session-handoff.md
  Do: у кожній команді замінити блоки «Session Start (Before Any Work)» і «Session Exit (HARD STOP)» на 1–2 рядки посилання на `.agents/rules/session-handoff.mdc`; статика перед динамікою (стабільний префікс для prompt caching); session-handoff.md description → fallback-only
  Done-when: жодна opsx-команда не містить повного тексту start/exit протоколу; `wc -c` opsx-apply.md зменшився ≥ на 1.5 KB

## 6. Docs і тести

- [x] 6.1 Документація
  Files: templates/AGENTS.md, templates/CLAUDE.md, README.md, CHANGELOG.md
  Do: описати lean-модель (диференційоване делегування, archive CLI, task-контракт, tiered review, apply-notes, handoff без субагента); CHANGELOG-запис в Unreleased без bump версії
  Done-when: усі чотири файли згадують нову модель; README містить `agent-orchestrator-kit archive`

- [x] 6.2 Smoke-тести
  Files: test/smoke.test.js
  Do: додати тести: `archive` відмовляє на незакритому гейті (фікстурний change без APPROVE → exit ≠ 0); успішний `archive <name> --sync` на fixture change дає exit 0, переносить change в archive/ і зливає delta specs у main specs для ADDED/MODIFIED/REMOVED; падіння `openspec validate --all --strict` відкочує change на початковий шлях і відновлює main specs до pre-sync вмісту; `gate-check --tasks` strict падає на таску без Done-when; warn mode дає exit 0 з warning для неконтрактного таска; `gate-check --review` дає `pass: true` на валідній фікстурі та `pass: false` на фікстурі без Non-goals; після init opsx-archive.md ≤ 1.5 KB і без «spec-archiver»; opsx-apply.md без «delegation is mandatory»; orchestrator.yaml містить `task_contract` і `spawn_handoff_subagent: false`
  Done-when: `npm test` зелений локально

- [x] 6.3 Валідація change
  Files: openspec/changes/lean-pipeline-v2/
  Do: прогнати `npx openspec validate lean-pipeline-v2 --strict --type change` і виправити знайдені помилки артефактів
  Done-when: validate exit 0
