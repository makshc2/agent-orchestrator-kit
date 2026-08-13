# Proposal: Pipeline subagent conductor + session handoff

## Why

Кастомні субагенти кіта існують, але не ведуть пайплайн: команди `/opsx:*` самі пишуть артефакти й код, автовибір тримається на слабкому `use proactively`, а на межі сесій контекст губиться. Memory MCP уже задокументований, але ніхто не зобов’язаний його писати на виході чи читати на вході — тож кожну нову фазу доводиться збирати вручну. Потрібен conductor з жорсткою таблицею делегування на всіх етапах OpenSpec і обов’язковий handoff (Memory + файл + промпт на наступну сесію), щоб нова чат-сесія стартувала сама.

## What Changes

- Батьківська `/opsx:*` сесія стає **conductor**: обирає субагентів за таблицею, не виконує роботу спеціаліста сама
- Нові stage-субагенти: `codebase-explorer`, `design-intake`, `spec-architect`, `spec-reviewer`, `spec-archiver` (існуючі apply-агенти лишаються)
- Always-apply правило + skill `agent-orchestration` + кожна `/opsx:*` команда: обов’язкове делегування за таблицею «фаза × сигнал → субагент»
- **Старт сесії (обов’язково до будь-якої роботи):** відновити контекст — pasted prompt, інакше `handoff.md`, плюс Memory MCP `Change:*` / `Handoff:*` / `Decision:*`
- **Кінець сесії:** спочатку оновити Memory, потім `handoff.md`, потім вивести промпт, який у новій сесії наказує **прочитати це Memory** (без службового ярлика; перший рядок `/opsx:`)
- Amp skill-wrappers `subagent-*`: інструкція MUST spawn isolated subagent (не виконувати skill у головному треді)
- Документація в AGENTS.md / README / memory rule; smoke-тести на наявність агентів, таблиці маршрутів і шаблону handoff

## Capabilities

### New Capabilities

- `pipeline-subagents`: conductor-модель, таблиця маршрутизації, набір stage-субагентів на всі фази OpenSpec, Amp wrappers з ізольованим spawn
- `session-handoff`: на виході — persist Memory, потім файл; на вході промпт дає задачу прочитати ці Memory entities

### Modified Capabilities

- (немає — поведінка сесій і субагентів раніше не була в `openspec/specs/`)

## Impact

- Шаблони: `.agents/subagents/*`, `.agents/commands/opsx-*.md`, `.agents/skills/agent-orchestration`, `.agents/rules/agent-orchestration.mdc`, `memory-mcp-autosetup.mdc`, AGENTS.md / CLAUDE.md / README
- CLI: шаблон Amp wrapper у `bin/agent-orchestrator.js` і `scripts/sync-local-agent-skills.sh` (преамбула MUST spawn)
- `templates/orchestrator.yaml` (+ profiles): прапорці handoff restore/persist
- Тести: `test/smoke.test.js` — init кладе нових субагентів і фрагменти протоколу
- Не breaking для консюмерів: `update` + `sync` підтягує шаблони; старі проєкти без нових агентів деградують лише після `update`
- `figma-token-setup` лишається активним complete change в цьому репо — перед apply цього change його треба заархівувати (`max_active_changes: 1`)
