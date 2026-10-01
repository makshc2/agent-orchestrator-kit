## Context

`buildNextSessionPrompt` у `bin/agent-orchestrator.js` формує текст, який persist друкує у stdout і який користувач вставляє першим повідомленням наступної сесії. Текст не змінювався з коміту 599e183 (2026-08-27), коли `session-handoff` ще був обов'язковим: Start із 7 кроків (`status`, `handoff --restore`, читання Memory MCP, handoff.md, spawn `session-handoff` restore, spawn спеціаліста), повний блок попереднього контексту разом із Decisions і Exit із 6 кроків (spawn `session-handoff` persist «never skip», handoff.md, CLI, дзеркало Memory MCP, вставити stdout, зупинитись).

Згодом протокол став parent-driven: `templates/.agents/rules/session-handoff.mdc` (alwaysApply) каже «No separate Memory MCP read step» і «Spawn `session-handoff` … ONLY if … fallback, never a routine step»; `templates/orchestrator.yaml` отримав `handoff.spawn_handoff_subagent: false`, який `bin/` ніколи не читає (`grep spawn_handoff_subagent bin/` порожній; значення лише асертиться у smoke); `templates/.agents/rules/agent-orchestration.mdc` лишив «Exit HARD STOP: persist via `session-handoff`»; `SKILL.md` у Session Rules зберіг крок «Read Memory entities», хоча «Mandatory Memory and Handoff Protocol» того ж файлу каже «no separate Memory MCP read step». `handoff --restore` друкує всі записи `decisions.md` (у архівах до 28 / 7,6 KB) і не друкує Attach, хоча саме там батько лишає file:line-діапазони для наступної ролі.

Текст промпта в тестах покритий слабко: `test/smoke.test.js` асертить лише `/HARD STOP/`, `/Ти — conductor/`, `/You are the conductor/`, `/subagent-spec-reviewer/`, перший рядок `/opsx:` і `/xlsx/` (через інлайнений блок Decisions).

## Goals / Non-Goals

**Goals:**
- Один протокол Session Start / Exit у всіх джерелах: промпт, rule, routing-rule, skill, fallback-субагент.
- Промпт лишається самодостатнім (перший рядок `/opsx:<cmd> <name>`, Done, Blocked, Attach, Subagents to spawn, Constraints, HARD STOP), але без дубльованого протоколу і без Decisions.
- `handoff.spawn_handoff_subagent` стає робочим прапорцем із дефолтом `false`.
- Restore-брифінг обмежений (10 останніх рішень + трейлер) і містить Attach.
- Delta specs закривають дві застарілі вимоги spec (`spawn_handoff_subagent: true`, «Старт сесії MUST читати ці ключі»).

**Non-Goals:**
- Самозвіт `## Metrics`, `HANDOFF_SECTIONS`, `renderMetricsSection` (R2b, окрема зміна з M-обсягом spec-дельт).
- Memory JSON upsert у persist, `Decision:*` як дзеркало файлу, `memory-setup`.
- `AGENTS.md`, `README.md`, `CHANGELOG.md`, версія.
- `## Read set`, `gate-check --brief`, `status --health`.
- `init --force` / `update` / `sync` у корені кіта.

## Decisions

**D1. Start — один CLI-виклик, Exit — два рядки, решта за посиланням на rule.** Промпт більше не переписує протокол, а повторює його мінімум: `## Start` — один абзац (`handoff <name> --restore` канонічний; handoff.md лише якщо restore впав; потім spawn спеціаліста; free-form «continue» = `Handoff.next_command`), `## Exit HARD STOP` — рядок з ланцюжком «записати handoff.md → `handoff <name>` (exit 0) → вставити stdout одним fenced-блоком (перший рядок `/opsx:…`) → зупинитись» і рядок «Full protocol: `.agents/rules/session-handoff.mdc`». Rule (alwaysApply у Cursor/Claude) і `AGENTS.md` (Amp) несуть повний текст, тож дублювання в промпті лише створювало місце для дрейфу.
Альтернатива «два рядки-вказівники без контексту» відкинута: `prompt_self_contained: true` і вимога «Persist Memory and handoff on session exit» (самодостатній промпт) мають лишитись чинними, бо Amp може ігнорувати Memory MCP і `.mdc`.

**D2. Семантика `spawn_handoff_subagent`: лише видимість fallback-рядків.** `readOrchestratorMeta` (уже regex-парсер orchestrator.yaml без yaml-залежності) отримує `/spawn_handoff_subagent:\s*(true|false)/`; `true` → промпт містить рядки «Spawn `session-handoff` in restore mode only if both the CLI and handoff.md are unavailable» і «If the CLI failed, spawn `session-handoff` in persist mode» (Amp: isolated `subagent-session-handoff`); `false`, відсутній ключ або файл → промпт не згадує `session-handoff` взагалі (лише шлях rule у рядку «Full protocol»). Навіть при `true` spawn лишається fallback-ом, бо саме так його визначає rule, яка про прапорець не знає; робити spawn рутинним при `true` відтворило б ту саму суперечність для consumer-ів із `true`. Rule у кроці Exit 4 згадує прапорець одним реченням.

**D3. Decisions не інлайняться; Attach лишається; бюджет розміру.** Restore друкує рішення з `decisions.md`, а `## Decisions` лишається у handoff.md, тож блок у промпті був третьою копією. Формулювання self-contained у rule, SKILL.md і promt стає «Done/Blocked/Attach/spawn/HARD STOP». Статичний скелет з мінімальними полями: EN ≤ 1 536 байт (факт 1 528; було 3 263), UK ≤ 1 600 символів (факт 1 542; у байтах 2 209, бо кирилиця — 2 байти на символ, тому для UK межа задана в символах). Тест фіксує обидві межі. Smoke-асерт `/xlsx/` (рішення з фікстури) стає `doesNotMatch` — це єдина зміна в `test/smoke.test.js`.

**D4. Restore: Attach після Done, останні 10 рішень + трейлер, Memory-рядки без змін.** `RESTORE_DECISIONS_LIMIT = 10`; `entries.slice(entries.length - 10)` і трейлер `(N older entries in openspec/changes/<name>/decisions.md)` лише коли N > 0, бо Spec Reviewer спирається на повну історію рішень і має знати, де вона. Attach друкується як рядок `attach:` + вміст секції без парсингу (file:line-діапазони — просто текст батька). Рядки `Memory entities: N` / `Memory JSON empty or missing` лишаються: їх асертять `smoke.test.js` (`Memory entities: 2`, `decisions: none`). Нова секція `## Read set` не додається (non-goal).

**D5. Шаблони: три кроки Start у rule; `status` лишається у skill.** Rule: 1 announce, 2 `handoff <name> --restore` (описує, що саме друкує брифінг: Done, Attach, останні 10 рішень, Memory-count), 3 fallback-ланцюжок (handoff.md → `session-handoff` лише якщо недоступні обидва) і початок роботи фази. `status` зникає з Session Start rule і з промпта (один CLI-виклик), але лишається в SKILL.md кроці 2 («resolve the active change and gates») і в `agent-orchestration.mdc` як «`status` when you need gates» — це довідкова команда, а не крок протоколу. SKILL.md Session Rules: 6 кроків (видалено Memory-read, «Memory is empty» у наступному кроці, spawn-крок уточнено «only if both … failed»); рядок шаблону `session-handoff` — «fallback only»; «Mandatory Memory and Handoff Protocol» без Decisions у self-contained. `subagents/session-handoff.md`: restore-режим без кроку читання Memory (4 кроки), persist-режим без змін (крок Memory-дзеркала там уже опційний і збігається з rule Exit 5).

**D6. Кореневий rule кіта — ручна копія.** `.agents/rules/session-handoff.mdc` у корені кіта tracked і застарілий (ще старіший за шаблон до цієї зміни). Після правки шаблону файл скопійовано `cp` (ідентичний байт-у-байт; тест це перевіряє). `init --force` / `update` / `sync` у корені не запускались (інцидент ec7407a). Інших кореневих копій (`agent-orchestration.mdc`, `SKILL.md`, `subagents/session-handoff.md`) у кіті немає.

**D7. Spec-дельти: три MODIFIED + дві ADDED у `session-handoff`.** MODIFIED «Orchestrator yaml handoff flags» (було: усі прапорці `true`; стає: чотири `true`, `spawn_handoff_subagent: false` як дефолт, CLI читає і шанує), «Memory entity schema for handoff» (без «Старт сесії MUST читати ці ключі»), «Next-session prompt follows agent_language» (сценарій «починаю сесію, прочитай Memory, conductor» → «починаю сесію, запусти restore, conductor»). ADDED «Next-session prompt follows the parent-driven protocol» (зміст і межі промпта) і «Restore briefing prints Attach and the last decisions». Вимоги «Restore context at session start» і «Persist Memory and handoff on session exit» уже описують parent-driven протокол і не змінюються.

**D8. Тести: окремий файл + два експорти.** `buildNextSessionPrompt` і `readOrchestratorMeta` експортуються (як `firstSpawnName`), щоб тести промпта були детермінованими без init; CLI-інтеграція (прапорець через yaml, restore-кап, Attach) — через `node bin/agent-orchestrator.js` у temp-проєкті з ізольованим HOME, як у smoke.

## Risks / Trade-offs

- [Consumer-и з `spawn_handoff_subagent: true` раніше бачили «never skip», тепер — fallback-рядок] → Так визначає rule; значення `true` у шаблонах і профілях відсутнє (усі п'ять — `false`).
- [Промпт без Decisions, а `prompt_self_contained: true`] → Рішення друкує restore (перший крок промпта), `## Decisions` лишається у handoff.md; Done/Blocked/Attach/spawn/HARD STOP інлайн.
- [Spec Reviewer потребує повної історії рішень] → Трейлер з кількістю і шляхом до `decisions.md`; файл git-tracked.
- [Текст rule коротшає, але бюджет always-apply < 12 000] → Rule стає коротшою; smoke-тест бюджету лишається.
- [`status` більше не крок Start у rule/промпті, але є в SKILL.md] → Задокументовано як довідкова команда (D5); жоден тест не вимагає `status` у Start.
- [Кореневий rule кіта оновлено вручну, інші кореневі файли не існують] → Тест рівності шаблон ↔ корінь ловить майбутній дрейф цього файлу.
- [`## Metrics` self-report лишається у rule/skill/subagent] → Свідомо (R2b); ця зміна не чіпає рядки Metrics.
