## MODIFIED Requirements

### Requirement: Persist Memory and handoff on session exit

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку в батьківській сесії**: (1) записати `openspec/changes/<name>/handoff.md`, (2) виконати `npx agent-orchestrator-kit handoff <name>` з exit 0 (CLI upsert memory.json абсолютним шляхом, записує сесію в `metrics.json` і друкує розширений промпт у stdout), (3) вставити stdout CLI у чат як один fenced промпт. Спавн `session-handoff` у режимі persist дозволений ЛИШЕ як fallback, коли крок (2) повернув помилку. Оновлення Memory MCP entities — опційне дзеркало (одним викликом, якщо tools доступні); його відсутність MUST NOT блокувати закриття. Вимоги до змісту промпта не змінюються: перший рядок `/opsx:<command>`, самодостатній, без службового ярлика; єдиний виняток — зелений apply, коли замість промпту CLI друкує один рядок `npx agent-orchestrator-kit archive <name> --sync` (вимога «Зелений apply друкує команду archive замість промпту»).

#### Scenario: Exit без субагента

- **WHEN** фаза завершена і `npx agent-orchestrator-kit handoff <name>` повернув exit 0
- **THEN** батьківська сесія вставляє stdout-промпт і закривається без спавну `session-handoff`

#### Scenario: Session Exit has no metrics step

- **WHEN** the parent prepares Session Exit
- **THEN** the protocol has no step that asks to fill a `## Metrics` section
- **AND** session metrics reach `metrics.json` through the persist call (`--model`, optional `--platform` and spend flags, adapters)

#### Scenario: Archive закриває пайплайн без next-prompt

- **WHEN** `npx agent-orchestrator-kit archive <name>` завершився exit 0
- **THEN** фінальний `handoff.md` записаний в архівній папці з `next_command: none`
- **AND** fenced next-prompt не вимагається
- **AND** stdout містить зводку по всьому change

### Requirement: Handoff file template

Kit SHALL постачати шаблон `handoff.md` (у skill/команді) з секціями: Closed role, Change, Done, Decisions, Blocked, Next command, Next role, Attach, Subagents to spawn, Constraints, Runtime, і готовий текст промпта наступної сесії (без ярлика `NEXT_SESSION_PROMPT`). Секція Runtime SHALL містити поля `runtime` (`local` або `cloud`) і `agent_id`. Шаблон MUST NOT містити секцію `## Metrics`: метрики сесії приходять з прапорців і адаптерів persist-виклику.

Правила, які шаблон і канонічний протокол MUST фіксувати: `--model` SHALL бути LLM product id (наприклад `cursor-grok-4.6-xhigh-fast`, `claude-opus-5`), не Closed role і не ім'я субагента; family-ярлик (`cursor-grok-4.6`) MAY бути fallback, коли product id невідомий, але CLI все одно візьме product id з adapter sources, коли вони є. Closed role у `handoff.md` MAY містити речення після `—`; metrics зберігає лише канонічний токен (`Explorer|Architect|Spec Reviewer|Implementer|Archiver|Design Intake`).

Наявні файли без секції Runtime лишаються валідними — секція дописується наступним persist-ом без помилки; наявна секція `## Metrics` ігнорується і відкидається при наступному перезаписі файла (вимога «Legacy `## Metrics` section in handoff.md is ignored» у change-metrics). Файл SHALL жити в `openspec/changes/<name>/handoff.md` (не в gitignored cache). Він не є артефактом схеми OpenSpec. CLI `npx agent-orchestrator-kit handoff <name>` SHALL перезаписувати секцію Prompt розширеним самодостатнім текстом мовою `project.agent_language`.

#### Scenario: Init documents the template

- **WHEN** виконується init
- **THEN** `.agents/skills/agent-orchestration/SKILL.md` або always-apply rule містить секції шаблону `handoff.md` (включно з Runtime, без Metrics) і приклад промпта, що починається з `/opsx:`

#### Scenario: Handoff file is inside the change

- **WHEN** сесія закриває фазу для зміни `<name>`
- **THEN** інструкція вимагає шлях `openspec/changes/<name>/handoff.md`, а не `.agents/cache/handoffs/`

#### Scenario: Persist записує секцію Runtime

- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** `handoff.md` містить секцію `## Runtime` з полями `runtime` і `agent_id`

#### Scenario: Файл без Runtime не блокує persist

- **GIVEN** наявний `handoff.md` містить усі обов'язкові секції, але не має `## Runtime`
- **WHEN** виконується persist
- **THEN** команда завершується з exit 0
- **AND** секція Runtime присутня у файлі після запису

#### Scenario: A legacy Metrics section does not block persist

- **GIVEN** an existing `handoff.md` has all required sections and a legacy `## Metrics` section
- **WHEN** persist runs
- **THEN** the command exits 0
- **AND** the file after the write has no `## Metrics` section

## REMOVED Requirements

### Requirement: Session Exit вимагає самозвіт метрик у `## Metrics`

**Reason**: The self-report section is removed from Session Exit; no session has `spendSource: self-report` and archived handoffs hold only `unknown` values.
**Migration**: The rules that still apply move to the requirements «Session Exit protocol has no metrics self-report step» and «Session Exit keeps the model, persist-once and decisions rules».

## ADDED Requirements

### Requirement: Session Exit protocol has no metrics self-report step

The canonical Session Exit protocol (`session-handoff.mdc`) and its mirrors (skill `agent-orchestration`, subagents `session-handoff` and `spec-archiver`, templates `AGENTS.md` and `CLAUDE.md`) SHALL NOT ask the parent to write, fill or mention a `## Metrics` handoff section. Session metrics come from the persist call: `--model`, optional `--platform`, spend flags and adapters. The skill's `handoff.md` template SHALL have no Metrics block.

#### Scenario: The rule has no Metrics step

- **WHEN** `.agents/rules/session-handoff.mdc` is read after `init`/`update`
- **THEN** Session Exit lists writing `handoff.md` and then running `npx agent-orchestrator-kit handoff <name>`
- **AND** the text contains no `## Metrics`, `spend_source`, `amp_credits` or `self-report`

#### Scenario: The mirrors agree

- **WHEN** the skill `agent-orchestration`, the subagents `session-handoff` and `spec-archiver`, `AGENTS.md` and `CLAUDE.md` are read
- **THEN** none asks to fill a `## Metrics` section
- **AND** the skill's `handoff.md` template has no `## Metrics` block (its separate `## Metrics (health check per change)` section about the `metrics` command stays)

#### Scenario: The Archiver fallback passes flags, not a section

- **WHEN** the subagent `spec-archiver` is read
- **THEN** it tells the parent to pass `--model` (and `--platform` when detection fails) to `npx agent-orchestrator-kit archive <name>` and has no step that fills `## Metrics`
- **WHEN** the command `/opsx:archive` is read
- **THEN** it has no `## Metrics` step and no Session Start / Exit block

### Requirement: Session Exit keeps the model, persist-once and decisions rules

The protocol SHALL state: pass `--model <llm-product-id>` (never a Closed role, subagent name or Amp mode) and never guess token counts; `--platform` only when client detection is wrong; regenerate the prompt only with `handoff <name> --no-metrics`; no second full persist in a session; only the CLI writes `decisions.md`, from `## Decisions`; stop after persist.

#### Scenario: The protocol prefers a product id over a family

- **WHEN** `.agents/rules/session-handoff.mdc` and the skill `agent-orchestration` are read after `init`/`update`
- **THEN** the `--model` example contains product ids, not only the family `cursor-grok-4.6`
- **AND** the skill says adapter sources win over a family `--model` when a hook gave a more exact id

#### Scenario: The protocol forbids guessed token counts

- **WHEN** `.agents/rules/session-handoff.mdc` is read after `init`/`update`
- **THEN** it says the parent MUST NOT guess tokens
- **AND** it asks for no token numbers in `handoff.md`

#### Scenario: The protocol forbids a repeated persist and a manual decisions.md

- **WHEN** `.agents/rules/session-handoff.mdc` is read after `init`/`update`
- **THEN** it names `--no-metrics` as the only way to regenerate the prompt
- **AND** it forbids a second full persist in the same session and manual edits of `decisions.md`
- **AND** it requires a new chat for an out-of-OpenSpec hotfix after persist

#### Scenario: The same call works in three IDEs

- **WHEN** the rule, the skill `agent-orchestration` and the subagent `session-handoff` are read
- **THEN** all three describe the same `npx agent-orchestrator-kit handoff <name>` call
- **AND** none requires the Cursor SDK, a Claude `/cost` parser or an Amp billing API
