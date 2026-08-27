# add-factory-memory-and-skills

Design: none

## Why

Phase 2 роадмапу `agentic-factory-roadmap` закриває Reason- і Skills-розриви. Рішення сесій накопичуються лише в gitignored `.cursor/memory.json` — вони невидимі в PR/MR і не існують на іншій машині; `handoff.md ## Decisions` git-tracked, але rolling: перезаписується на кожному виході з сесії без історії. Skills не мають машинного інвентаря: `KIT_SKILL_DIRS` захардкоджений у `bin/agent-orchestrator.js`, стекові скіли живуть як free-text `notes` у профілях, а `status` нічого не каже про стан скілів. Напрям файл → Memory уже існує в CLI `handoff <name>` (парсить Decisions з handoff.md і upsert-ить `Decision:*`) — Phase 2 міняє ролі місцями: git-файл стає durable-акумулятором, Memory — дзеркалом.

## What Changes

- Новий git-tracked файл `openspec/changes/<name>/decisions.md`: append-only канон рішень change-у; CLI `handoff <name>` дописує в нього записи з `handoff.md ## Decisions` з дедуплікацією; archive переносить його разом із папкою change без додаткового коду.
- `Decision:*` entities у `.cursor/memory.json` стають дзеркалом `decisions.md` (напрям синхронізації лише файл → Memory); memory.json лишається gitignored; наявні `Decision:*` не мігруються.
- `handoff --restore` друкує рішення з `decisions.md`, а не з Memory JSON.
- Нова секція `skills:` в `orchestrator.yaml` (шаблон і всі профілі): `kit:` — перелік скілів kit-а, `stack:` — стекові скіли профілю (замість free-text `notes` у vue3/node), `external:` — npm-пакет-джерело stack-скілів; дзеркалить наявний патерн `mcp: baseline/optional`.
- Хардкод `KIT_SKILL_DIRS` видаляється з CLI: managed-перелік kit-скілів визначається з вмісту `templates/.agents/skills/` пакета, очікування для health — з `skills:` конфігурації (з fallback-ом для legacy-проєктів без секції).
- Нова секція Skill health у `npx agent-orchestrator-kit status`: для кожного очікуваного скіла — `ok` / `missing` / `stale` (присутність у `.agents/skills/`, синхронність копій у `.cursor/` і `.claude/`, свіжість Amp `subagent-*` wrapper-ів); warn-only, без нового блокуючого гейта — паритет з MCP-health, який ніколи не валить CI.
- Протокольні шаблони (`session-handoff.mdc`, `memory-mcp-autosetup.mdc`, skill `agent-orchestration`, субагент `session-handoff`) фіксують decisions.md як канон і напрям файл → Memory.

## Capabilities

### New Capabilities

- `skill-inventory`: машинний інвентар skills у `orchestrator.yaml` (`kit:` / `stack:` / `external:`), заміна хардкоду `KIT_SKILL_DIRS`, секція Skill health у `status` з паритетом Cursor / Claude Code / Amp Code; presence-check без автоустановки external-пакетів.

### Modified Capabilities

- `session-handoff`: CLI `handoff <name>` додатково веде append-only `decisions.md`; `Decision:*` у Memory стають дзеркалом цього файлу; `handoff --restore` друкує рішення з git-файлу.

## Impact

- `bin/agent-orchestrator.js`: persist-гілка `handoff` (append у decisions.md), джерело `Decision:*` у `persistMemoryFromHandoff`, блок Decisions у `--restore`, парсер `skills:` (стиль `parseMcpInventory`), видалення `KIT_SKILL_DIRS`, `printSkillHealth` у `status`.
- `templates/orchestrator.yaml`, `profiles/generic|vue3|node|mvp/orchestrator.yaml`: секція `skills:`; у vue3/node видаляються free-text notes зі списками скілів.
- `templates/.agents/rules/session-handoff.mdc`, `templates/.agents/rules/memory-mcp-autosetup.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`: протокольний текст про decisions.md.
- `test/smoke.test.js`: тести append/dedup, мірора, restore, парсера інвентаря, skill health.
- `README.md`, `CHANGELOG.md`: документація Phase 2.
- Нових runtime-залежностей немає. Наявні консюмери не зачіпаються до `update`; decisions.md з'являється лише після першого `handoff` з непорожніми Decisions.

## Non-goals

- memory.json лишається gitignored; жодного ADR-фреймворку поза change-артефактами; жодного project-wide `docs/decisions/`.
- Автоустановка external skill-пакетів — лише перевірка присутності з підказкою.
- Міграція наявних `Decision:*` entities з memory.json — старі рішення живуть в архівних handoff.md.
- Новий блокуючий гейт на рішення: `gate-check`/pre-commit не перевіряють decisions.md — механічно неможливо визначити, чи мала сесія записати рішення; `handoff` CLI уже вимагає явну секцію Decisions (`none` дозволено).
- Усе з Phase 3 (`runtime` у handoff, cloud-дисципліна workspace) і Phase 4 (dashboard, sandbox, audit, Control Plane).
- Нові ролі пайплайна (роадмап-спека прямо забороняє).

## Acceptance criteria

- Після `npx agent-orchestrator-kit handoff <name>` з рішенням у `handoff.md ## Decisions` файл `openspec/changes/<name>/decisions.md` містить датований запис; повторний запуск з тим самим handoff.md не додає дублікатів; новий текст того самого topic-а додається новим рядком, старий не видаляється.
- `Decision:*` у `.cursor/memory.json` після persist відповідають записам decisions.md (останній запис topic-а перемагає); `handoff --restore` друкує рішення з decisions.md, а без файлу — `none`.
- `init` з будь-яким профілем дає `.agents/orchestrator.yaml` із секцією `skills:`; профіль vue3 містить stack-скіли машинним списком і `external: frontend-agent-skills` замість notes.
- У `bin/agent-orchestrator.js` немає хардкодного масиву `KIT_SKILL_DIRS`; `update` приносить той самий набір kit-скілів, що й до зміни.
- `npx agent-orchestrator-kit status` друкує секцію Skill health зі станами `ok` / `missing` / `stale` для kit- і stack-скілів та свіжістю Amp wrapper-ів; exit code лишається 0 при будь-якому стані скілів; для відсутнього stack-скіла виводиться підказка установки external-пакета без автозапуску.
- `npm test` зелений; `openspec validate add-factory-memory-and-skills --strict` проходить.
