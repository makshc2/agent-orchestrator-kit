## Why

Вартість зміни в Claude Code ≈ Σ ходів × розмір контексту (cache-read ≈ 75%). У R4 (`archive-from-terminal`, ledger $41,69) parent `/opsx:propose` зробив 109 ходів: 67 розвідки до спавну і 41 після, а `spec-architect` повторив ту саму розвідку у власному контексті. Артефакти R4 важили 203 753 B (`tasks.md` 102 718 B), і нічого не попереджало про розмір, хоча кожна фаза перечитує їх на кожному ході. Схему `review.md` («conductor MUST reject…») перевіряє LLM, хоча правила детерміновані. Джерело: `docs/cost-lean-envelope-2026-10-02.md` (Частини I–II).

Design: none

## What Changes

- **A. Бюджет розміру артефактів у Tier 1.** `gate-check --review` міряє в байтах `proposal.md`, `design.md`, `tasks.md` і всі delta specs та повідомляє, коли `tasks.md` > 60 000 B або сума > 150 000 B: виміряне значення, ліміт і порада розбити change на зрізи. Ключ `pipeline.artifact_budget: warn|strict|off` (default `warn`) читає `parsePipelineConfig` за зразком `task_contract`: `warn` — попередження і exit 0, `strict` — помилки і exit 1, `off` — нічого. Пороги стартові: з 26 наявних changes `tasks.md` > 60 KB лише в R4, сума > 150 KB лише в R4 і dedup-window.
- **B. `gate-check --review-md <name>`.** Новий режим поруч із `--tasks` і `--review` детерміновано перевіряє `review.md` за схемою `/opsx:review`: рівно один рядок `Verdict:`; Tier 1 запис (`**Source:** gate-check` без `Checklist`) — лише вердикт RC; інакше заголовок `Previous findings`; для RC непорожні `Checklist`, `Findings` (Blocker/Major/Minor) і `Required Before Apply`; для APPROVE `apply-notes.md` ≤ 20 рядків. Додаткові секції дозволені. Exit 1 з переліком помилок, `--json` дає `{pass, errors}`.
- **C. Протокол тонкого conductor-а (лише текст шаблонів).** `opsx-propose.md` і дзеркало `skills/openspec-propose/SKILL.md` (один таск): conductor не досліджує репо, читає лише brief за шляхом, `status` і `handoff --restore` (на re-propose ще й `review.md`), спавнить `spec-architect` за ≤ 5 викликів зі шляхом brief і назвою change, після звіту робить ≤ 3 виклики, за зеленого гейта не перечитує артефакти і передає користувачу попередження бюджету. `opsx-review.md` замінює ручну перевірку заголовків викликом `--review-md` і додає `Previous findings` у приклад APPROVE. `spec-architect.md` і `spec-reviewer.md` отримують правила читання (main spec за заголовками вимог, інші файли > 20 KB діапазонами, файли change повністю, без повторних читань); architect — правило щодо повідомлень `artifact budget`, reviewer — писати `review.md` під `--review-md`.
- Без **BREAKING**: exit-коди і формат наявних режимів `gate-check` не змінюються, новий ключ необов'язковий.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `tiered-review`: ADDED «Tier 1 попереджає про бюджет розміру артефактів» і «review.md schema gate»; наявні вимоги не змінюються.
- `pipeline-subagents`: ADDED «Conductor не дублює розвідку спеціаліста» і «Спеціалісти читають вузько».

## Impact

- `bin/agent-orchestrator.js`: ключ у reader-і, бюджет у `runTier1Review`, `checkReviewMd` і `runReviewMd`, опція `--review-md`, `export`.
- Шаблони: `templates/orchestrator.yaml`, `templates/.agents/commands/opsx-propose.md` і `opsx-review.md`, `templates/.agents/skills/openspec-propose/SKILL.md`, `templates/.agents/subagents/spec-architect.md` і `spec-reviewer.md`. Згенеровані копії в install-ах оновлюються `update`/`sync`, не тасками.
- Тести: `test/gate-check-config-parser-and-src-glob.test.js`; нові `test/artifact-budget.test.js`, `test/review-md-gate.test.js`, `test/conductor-protocol-templates.test.js`.
- `openspec/specs/tiered-review/spec.md`, `openspec/specs/pipeline-subagents/spec.md` — через delta. `README.md`, `CHANGELOG.md`, `package.json` — окремий docs pass після merge.

## Non-goals

- Хуки і лічильники викликів (окремий зріз): тут лише текстове правило.
- `handoff`/`session-handoff`, derived exit, `metrics --profile`, architect-by-artifact, запис explore-brief у файл (`opsx-explore.md` не змінюється).
- `effort:`/`model:` у frontmatter, зміна моделі чи чекліста Tier 2, генерація дзеркал, блокування інструментів, `init --force`, metrics v3.
- `strict` за замовчуванням; зміна `--review --json`; зміна always-apply правил, `templates/AGENTS.md`, кореневого `.agents/rules/`.
- Новий лінт якості Done-when (спека `task-contract` забороняє).

## Acceptance criteria

1. **Бюджет.** На фікстурах (proposal/design/tasks/delta, B) R4 19 209/31 479/102 718/50 347 (сума 203 753) і dedup-window 18 394/11 814/22 799/136 420 (189 427) `gate-check --review` друкує `artifact budget:` із виміряним значенням і лімітом, exit 0 (для dedup-window лише про суму); на pregate (116 395) і tier1-delta-heading-check (32 407) не друкує нічого. Рівно 60 000 і 150 000 B — без попередження.
2. **Режими.** `strict` дає exit 1 і ті самі рядки в `errors` (`--json`), `off` — жодного повідомлення; невідоме значення і відсутній ключ дають `warn`.
3. **review.md gate.** `--review-md` проходить на всіх архівних `review.md`, крім 17 задокументованих legacy-винятків (до схеми `Previous findings`), і падає на синтетичних: без Verdict, з двома, RC без Required Before Apply, Tier 2 без Previous findings, APPROVE без `apply-notes.md` або з 21 рядком.
4. **Шаблони.** `opsx-propose.md` і SKILL.md мають байт-ідентичний абзац із «at most 5 tool calls» до спавну і «at most 3 tool calls» після; `opsx-review.md` вимагає `gate-check --review-md <name>`; наявні pin-фрази (`test/smoke.test.js`) збережені.
5. **Тести.** `node --test test/artifact-budget.test.js` (`# pass 8`), `test/review-md-gate.test.js` (`# pass 10`), `test/conductor-protocol-templates.test.js` (`# pass 4`); `npm test` і `npx openspec validate --all --strict` зелені.
6. **Межі.** Артефакти цього change вкладаються в бюджет (proposal ≤ 8 KB, design ≤ 10 KB, tasks ≤ 25 KB і ≤ 12 тасків, ≤ 6 delta-вимог), `gate-check --review lean-conductor-protocol` не друкує `artifact budget`; always-apply бюджети без змін.
