# session-handoff

## MODIFIED Requirements

### Requirement: Restore context at session start

На початку кожної рольової сесії агент MUST відновити контекст **до** будь-якої роботи, у такому порядку: (1) виконати `/opsx:<phase>` з pasted промпта, якщо він є, (2) виконати `npx agent-orchestrator-kit handoff --restore` — CLI друкує briefing із memory.json/handoff.md, (3) якщо CLI недоступний або впав — прочитати `openspec/changes/<active>/handoff.md`, (4) заспавнити `session-handoff` у режимі restore ЛИШЕ якщо і CLI, і handoff.md недоступні. Окремий крок читання Memory MCP entities НЕ вимагається — CLI-briefing є канонічним. Відсутність Memory MCP MUST NOT блокувати сесію.

#### Scenario: CLI briefing достатній без субагента

- **WHEN** `npx agent-orchestrator-kit handoff --restore` завершився exit 0 і надрукував briefing
- **THEN** сесія продовжується без спавну `session-handoff` і без читання Memory MCP entities

#### Scenario: Free-form continue uses handoff file

- **WHEN** є рівно одна активна зміна з `handoff.md`, де `next_command` = `/opsx:apply <name>`
- **AND** користувач у новому чаті пише «продовжуй» або «далі» без paste
- **THEN** інструкції start-протоколу вимагають виконати `/opsx:apply <name>`, а не питати «яка фаза?»

### Requirement: Persist Memory and handoff on session exit

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку в батьківській сесії**: (1) записати `openspec/changes/<name>/handoff.md`, (2) виконати `npx agent-orchestrator-kit handoff <name>` з exit 0 (CLI upsert memory.json абсолютним шляхом і друкує розширений промпт у stdout), (3) вставити stdout CLI у чат як один fenced промпт. Спавн `session-handoff` у режимі persist дозволений ЛИШЕ як fallback, коли крок (2) повернув помилку. Оновлення Memory MCP entities — опційне дзеркало (одним викликом, якщо tools доступні); його відсутність MUST NOT блокувати закриття. Вимоги до змісту промпта не змінюються: перший рядок `/opsx:<command>`, самодостатній, без службового ярлика.

#### Scenario: Exit без субагента

- **WHEN** фаза завершена і `npx agent-orchestrator-kit handoff <name>` повернув exit 0
- **THEN** батьківська сесія вставляє stdout-промпт і закривається без спавну `session-handoff`

#### Scenario: Archive закриває пайплайн без next-prompt

- **WHEN** `npx agent-orchestrator-kit archive <name>` завершився exit 0
- **THEN** фінальний `handoff.md` записаний в архівній папці з `next_command: none`
- **AND** fenced next-prompt не вимагається

## ADDED Requirements

### Requirement: Спільні Session Start/Exit блоки живуть в одному rule

Канонічний текст протоколів Session Start і Session Exit SHALL існувати лише в `templates/.agents/rules/session-handoff.mdc` (`alwaysApply: true`). Команди `templates/.agents/commands/opsx-*.md` MUST посилатися на протокол одним-двома рядками і MUST NOT дублювати його текст.

#### Scenario: Команди без дубльованих блоків

- **WHEN** після `init`/`update` читаються файли `.agents/commands/opsx-*.md`
- **THEN** жоден не містить повного тексту start/exit протоколу, лише посилання на `.agents/rules/session-handoff.mdc`
