## Why

CLI-промпт наступної сесії (`buildNextSessionPrompt` у `bin/agent-orchestrator.js`, stdout `npx agent-orchestrator-kit handoff <name>`) з коміту 599e183 (2026-08-27) наказує семикроковий Start з окремим читанням Memory MCP (`Change:<name>`, `Handoff:<name>`, `Decision:*`) і spawn-ом `session-handoff` у режимі restore, а на виході — spawn `session-handoff` у режимі persist «never skip» і дзеркалення Memory MCP. Always-apply rule `templates/.agents/rules/session-handoff.mdc` каже протилежне («No separate Memory MCP read step»; spawn `session-handoff` «ONLY if … fallback, never a routine step»), `templates/orchestrator.yaml` має `handoff.spawn_handoff_subagent: false`, який `bin/` ніколи не читав, `templates/.agents/rules/agent-orchestration.mdc` дає третій варіант Exit («persist via `session-handoff`»), а `templates/.agents/skills/agent-orchestration/SKILL.md` у Session Rules вимагає Memory-read, хоча його ж «Mandatory Memory and Handoff Protocol» це заперечує. У контексті кожної сесії живуть три несумісні протоколи; кожен старт отримує промпт 3 263 B EN / 4 322 B UK, а `handoff --restore` друкує весь `decisions.md` (у архівах до 28 записів / 7,6 KB). CHANGELOG перевів `session-handoff` у fallback, промпт не оновили.

Design: none

## What Changes

- **A. CLI-промпт за протоколом rule.** `buildNextSessionPrompt(fields, agentLanguage, meta)` (EN і UK) втрачає семикроковий Start, кроки «Read Memory MCP» / «Прочитай Memory MCP», `status`, spawn `session-handoff` у restore, Exit-крок «Spawn `session-handoff` in persist mode … never skip», крок дзеркалення Memory MCP і блок Decisions. Лишаються: перший рядок `/opsx:<cmd> <name>`, блок ролі (субагент фази, Amp/Cursor/Claude spawn, conductor-only), секція `## Start` з одного виклику `npx agent-orchestrator-kit handoff <name> --restore` (handoff.md лише якщо restore впав), самодостатній контекст (Closed role, Change, Done, Blocked, Attach, Subagents to spawn, Constraints, status/tasks/review) і дворядковий `## Exit HARD STOP` (записати handoff.md → `handoff <name>` exit 0 → вставити stdout одним fenced-блоком → зупинитись; посилання на `.agents/rules/session-handoff.mdc`). Статичний скелет: 1 528 B EN (було 3 263), 1 542 символи UK.
- **B. Прапорець `handoff.spawn_handoff_subagent` читається.** `readOrchestratorMeta` одним regex повертає `spawnHandoffSubagent` (true лише при `true`; відсутній ключ або файл = false). Промпт друкує рядки fallback-спавну `session-handoff` (restore — лише коли недоступні і CLI, і handoff.md; persist — лише коли CLI впав; Amp: isolated `subagent-session-handoff`) тільки коли прапорець `true`. За дефолтом `false` промпт не згадує `session-handoff` взагалі.
- **C. Restore друкує Attach і останні 10 рішень.** Гілка `--restore` після Done друкує `attach:` і секцію Attach з handoff.md (разом із file:line-діапазонами, як їх записав батько), а з `decisions.md` — лише останні 10 записів і трейлер `(N older entries in openspec/changes/<name>/decisions.md)`, коли старіших > 0. Читання `decisions.md` і рядки `Memory entities: N` / `Memory JSON empty or missing` лишаються.
- **D. Шаблони синхронно.** `session-handoff.mdc`: Session Start з трьох кроків (announce; `handoff <name> --restore`; handoff.md лише якщо restore впав, spawn `session-handoff` лише якщо недоступні обидва), Exit-крок 4 згадує прапорець, формулювання self-contained стає «Done/Blocked/Attach/spawn/HARD STOP». `agent-orchestration.mdc`: Start через `handoff <name> --restore`, Exit «parent writes `handoff.md` → `npx agent-orchestrator-kit handoff <name>`», `session-handoff` persist лише якщо CLI впав. `SKILL.md`: видалено крок 4 «Read Memory entities» і «Memory is empty» у кроці 5 (Session Rules тепер 6 кроків), рядок шаблону `session-handoff` → «fallback only», формулювання self-contained без Decisions. `subagents/session-handoff.md`: у restore-режимі видалено крок 3 (читання Memory). Кореневий `.agents/rules/session-handoff.mdc` кіта скопійовано з шаблону вручну (`cp`), без `init --force`.
- **E. Spec і тести.** Delta `session-handoff`: MODIFIED «Orchestrator yaml handoff flags» (`spawn_handoff_subagent: false` — документований дефолт, CLI його шанує), «Memory entity schema for handoff» (без «Старт сесії MUST читати ці ключі»), «Next-session prompt follows agent_language» (сценарій без «прочитай Memory»); ADDED «Next-session prompt follows the parent-driven protocol» і «Restore briefing prints Attach and the last decisions». Новий `test/fix-next-session-prompt.test.js`; у `test/smoke.test.js` лише `assert.match(out, /xlsx/)` → `doesNotMatch` (рішення більше не інлайняться у промпт). Експортовано `buildNextSessionPrompt` і `readOrchestratorMeta`.
- Без **BREAKING**: шаблон `handoff.md`, `HANDOFF_REQUIRED_SECTIONS`, Memory JSON upsert у persist, самозвіт `## Metrics`, `AGENTS.md` і логіка `status` не змінюються.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `session-handoff`: промпт наступної сесії повторює parent-driven протокол (один CLI-виклик на старті, дворядковий HARD STOP, без Memory-read, без рутинного spawn `session-handoff`, без Decisions); `handoff.spawn_handoff_subagent` має документований дефолт `false`, який CLI читає і шанує; restore друкує Attach і останні 10 рішень із трейлером; схема Memory entities не вимагає читання на старті; сценарій українського промпта без «прочитай Memory».

## Impact

- `bin/agent-orchestrator.js` — `readOrchestratorMeta` (новий regex, нове поле), `buildNextSessionPrompt` (переписані EN/UK гілки, третій аргумент `meta`), persist-виклик передає `orchestratorMeta`, гілка `--restore` (Attach, `RESTORE_DECISIONS_LIMIT = 10`, трейлер), два нові експорти.
- `templates/.agents/rules/session-handoff.mdc` (+ копія `.agents/rules/session-handoff.mdc`), `templates/.agents/rules/agent-orchestration.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`.
- `test/fix-next-session-prompt.test.js` (новий), `test/smoke.test.js` (один асерт).
- Бюджет always-apply rules (< 12 000 символів) і `AGENTS.md` (< 4 000) не змінюються по суті: rule коротшає.
- Generated copies (`.claude/`, `.cursor/`, Amp wrappers) оновлюються `update` / `sync` у consumer-проєктах, не окремими тасками.

## Non-goals

- Самозвіт `## Metrics` у Session Exit, `HANDOFF_SECTIONS`, `renderMetricsSection`, попередження «fill ## Metrics» — окрема зміна (R2b) зі своїми spec-дельтами.
- Memory JSON upsert у CLI persist і `Decision:*` як дзеркало файлу — не чіпати; прибирається лише текст, що велить агентові читати/дзеркалити Memory MCP.
- `templates/AGENTS.md` не тоншити: Amp не вантажить `.mdc`, і рядок Exit-підсумку в `AGENTS.md` лишається єдиним always-on джерелом для Amp.
- Нова секція `## Read set` у handoff.md, `--brief` для gate-check, `status --health` — поза обсягом.
- `README.md`, `CHANGELOG.md`, bump версії — окремий docs-прохід після merge.
- `init --force` / `update` / `sync` у корені кіта не запускати (інцидент ec7407a); кореневий rule копіюється вручну.

## Acceptance criteria

1. **Промпт без застарілих кроків.** `node --test test/fix-next-session-prompt.test.js` зелений: EN/UK промпт не містить `Read Memory MCP`, `Прочитай Memory MCP`, `Spawn \`session-handoff\` in persist mode`, `Spawn \`session-handoff\` in restore mode`, `- Decisions:` / `- Рішення:`, `agent-orchestrator-kit status` і нумерованих списків; містить перший рядок `/opsx:<cmd> `, `conductor`, `HARD STOP`, `subagent-<spawn>`, `handoff <name> --restore`, Closed role / Change / Done / Blocked / Attach / Subagents / Constraints; `## Start` — один абзац, `## Exit HARD STOP` — рівно два рядки.
2. **Прапорець.** `readOrchestratorMeta` повертає `spawnHandoffSubagent: false` після `init` і без файлу, `true` після правки yaml; persist через CLI друкує `subagent-session-handoff` і рядок «If the CLI failed, spawn `session-handoff` in persist mode» лише при `true`.
3. **Розмір.** Статичний EN-промпт із мінімальними полями ≤ 1 536 байт; UK ≤ 1 600 символів.
4. **Restore.** Для `decisions.md` з 13 записами `handoff <name> --restore --no-metrics` друкує записи 4–13, не друкує 1–3 і друкує `(3 older entries in openspec/changes/<name>/decisions.md)`; для 10 записів — усі без трейлера; вивід містить `attach:` і рядок секції Attach з file:line-діапазоном; рядок `Memory entities: N` лишається.
5. **Шаблони.** Session Start у `session-handoff.mdc` має рівно 3 нумеровані кроки, кореневий `.agents/rules/session-handoff.mdc` байт-у-байт дорівнює шаблону; `agent-orchestration.mdc` не містить «persist via `session-handoff`» і містить «parent writes `handoff.md`»; `SKILL.md` не містить «Read Memory entities», «Memory is empty», «Done/Decisions/Blocked», «restore at start, persist at exit»; restore-режим `subagents/session-handoff.md` має 4 кроки без читання `Change:<name>`.
6. **Існуючі тести.** `npm test` зелений (крім pre-existing rsync-тесту в контейнері без rsync); асерти `/HARD STOP/`, `/Ти — conductor/`, `/You are the conductor/`, `/subagent-spec-reviewer/`, `/^\/opsx:review/m`, `Memory entities: 2`, `decisions: none` лишаються.
7. **OpenSpec.** `npx openspec validate fix-next-session-prompt --strict --type change`, `node bin/agent-orchestrator.js gate-check --review fix-next-session-prompt` і `gate-check --tasks fix-next-session-prompt` завершуються з exit 0.
