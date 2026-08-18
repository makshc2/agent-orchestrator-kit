# Proposal: Lean pipeline v2 — церемонія пропорційна невизначеності фази

## Why

Після 0.1.13–0.1.14 кожна `/opsx:*` фаза стала мінімум 3-контекстною: conductor-parent + `session-handoff` (restore) + phase-специаліст + `session-handoff` (persist). Для фаз з високою невизначеністю (propose, review) це виправдано, але для механічних фаз — ні: `/opsx:archive` коштує $1–2 навіть на low-моделях заради операції «перевір гейти → mv → validate», а apply платить за повторне читання proposal+design+specs свіжим субагентом на кожен таск. Блоки Session Start / HARD STOP (~2 KB) продубльовано в усіх 7+ командах. Токени течуть у механіку, а не в думання.

Принцип v2: **дорогий LLM-час лише там, де є рішення; де рішень нема — детермінований CLI**. Propose і review лишаються глибокими, але їхній вихід стає самодостатнім планом, за яким дешевий apply пише код без перечитування сирих артефактів, а archive виконується одним CLI-викликом.

## What Changes

- **`npx agent-orchestrator-kit archive <name>`** — новий детермінований CLI: перевірка гейтів (review APPROVE при `require_spec_review`, всі tasks `[x]`), `openspec` archive-move з датою, strict validate, фінальний handoff. Команда `opsx-archive.md` стискається до тонкої обгортки: запустити CLI, показати stdout.
- **Task-контракт у tasks.md** — кожен таск зобов'язаний мати `Files:`, `Do:`, `Done-when:`; заборонені формулювання «as needed» / «update X». Лінт контракту вбудовується в `gate-check` (0 токенів). Правила пишуться в `openspec/config.yaml` rules + шаблони propose.
- **Двоярусний review** — Tier 1: скрипт (`gate-check --review`): validate --strict, task-контракт-лінт, наявність Non-goals/Acceptance. Падає → REQUEST CHANGES без жодного LLM-читання. Tier 2: LLM перевіряє лише те, що машина не бачить (узгодженість, конфлікти зі specs, реалізовність тасків «сліпим» виконавцем). Review на виході пише `apply-notes.md` — дистилят констрейнтів для apply (10–20 рядків).
- **Apply пише сам** — прибрати «Conductor delegation is mandatory» з opsx-apply: implementer читає `tasks.md` + `apply-notes.md` (fallback: design.md для неповного таска) і пише код у власному треді. Субагенти (`code-writer`, `test-writer`) — опція для паралельних незалежних тасків, не обов'язок. Escape-клапан посилюється: таск неповний → STOP і повернення в propose, без імпровізації.
- **Session-handoff без субагента** — persist робить parent сам: `handoff.md` + `npx agent-orchestrator-kit handoff <name>` (CLI вже пише memory.json і друкує next-prompt). Restore: лише CLI `handoff --restore`. Субагент `session-handoff` лишається fallback-ом, коли CLI зламаний. Memory MCP — опційне дзеркало, не крок HARD STOP.
- **Дедуплікація Session Start / HARD STOP** — спільні блоки виносяться в `.agents/rules/session-handoff.mdc` (він і так always-apply); у командах — 1–2 рядки посилання. Статика в командах впорядковується стабільно (rules → команда → динаміка) для provider prompt caching.
- **Model hints** — `orchestrator.yaml`: archive → `fast`, review Tier 2 → `medium` (вже так), apply/propose → `strong` (без змін).

## Capabilities

### New Capabilities

- `lean-archive`: детермінований archive через CLI з гейтами й фінальним handoff; агентна сесія — тонка обгортка
- `task-contract`: машинно-перевірний формат tasks.md (Files/Do/Done-when) + лінт у gate-check
- `tiered-review`: скриптовий Tier 1 перед LLM Tier 2; вихідний артефакт `apply-notes.md`

### Modified Capabilities

- `pipeline-subagents`: conductor-делегування стає диференційованим за фазою — обов'язкове для propose/review (spec-architect, spec-reviewer), опційне для apply, скасоване для archive
- `session-handoff`: persist/restore виконує parent через CLI; субагент — fallback; Memory MCP — не обов'язковий гейт

## Impact

- CLI: `bin/agent-orchestrator.js` — нові команди `archive`, розширення `gate-check` (task-контракт-лінт, `--review` tier 1)
- Шаблони команд: `templates/.agents/commands/opsx-{archive,apply,review,propose}.md` — стиснення і зміна протоколу; спільні блоки → `templates/.agents/rules/session-handoff.mdc`
- Субагенти: `templates/.agents/subagents/{session-handoff,spec-archiver}.md` — переведення у fallback-режим; `code-writer`/`test-writer` — опційний режим в apply
- Скіли: `templates/.agents/skills/{agent-orchestration,openspec-apply-change,openspec-archive-change}/SKILL.md` — оновлення протоколу
- Конфіг: `templates/orchestrator.yaml` + `profiles/*` — `handoff.spawn_handoff_subagent: false` (default), model hints, прапорець `pipeline.task_contract: true`
- Docs: `templates/AGENTS.md`, `templates/CLAUDE.md`, `README.md`, CHANGELOG
- Тести: `test/smoke.test.js` — archive CLI, gate-check лінт, тонка opsx-archive, відсутність mandatory-delegation в apply
- Не breaking для консюмерів: підтягується через `update` + `sync`; старі change-и без task-контракту лінт попереджає (warning), не блокує — жорсткий режим вмикається прапорцем

## Non-goals

- Не чіпаємо explore/design фази і `/opsx:quick` понад дедуплікацію спільних блоків
- Не змінюємо OpenSpec CLI (`openspec`) і схему spec-driven
- Не прибираємо review-гейт (`require_spec_review`) і не слабшаємо verify/CI
- Не видаляємо субагентів — лише змінюємо, коли вони обов'язкові
- Без міграції старих архівованих changes під новий task-контракт

## Acceptance criteria

- `npx agent-orchestrator-kit archive <name>` на завершеному change: гейти → move у `archive/YYYY-MM-DD-<name>` → validate → handoff, exit 0; на незавершеному — exit ≠ 0 з назвою незакритого гейта
- `gate-check` падає (exit ≠ 0 у strict-режимі) на таску без `Files:`/`Do:`/`Done-when:` або з «as needed»
- `opsx-archive.md` ≤ 1.5 KB; `opsx-apply.md` без «Conductor delegation is mandatory»; Session Start/Exit блоки присутні лише в `session-handoff.mdc`
- Review-команда: Tier 1 запускається перед читанням артефактів; при падінні Tier 1 у чаті REQUEST CHANGES без LLM-читання артефактів; при APPROVE існує `apply-notes.md`
- `npm test` зелений; `npx openspec validate lean-pipeline-v2 --strict --type change` проходить
