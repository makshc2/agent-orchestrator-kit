## MODIFIED Requirements

### Requirement: Handoff file template

Kit SHALL постачати шаблон `handoff.md` (у skill/команді) з секціями: Closed role, Change, Done, Decisions, Blocked, Next command, Next role, Attach, Subagents to spawn, Constraints, Runtime, Metrics, і готовий текст промпта наступної сесії (без ярлика `NEXT_SESSION_PROMPT`). Секція Runtime SHALL містити поля `runtime` (`local` або `cloud`) і `agent_id`. Секція Metrics SHALL містити рядки `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits` і опційно `spend_source`; її заповнює агент на виході сесії, а CLI persist зберігає її як самозвіт і лише дописує відсутні рядки зі значенням `unknown`. CLI MUST NOT перезаписувати секцію резолвленими значеннями (прапорці, env, host env, `--collect`) — вони живуть у `metrics.json`.

Правила, які шаблон і канонічний протокол MUST фіксувати: `model` у `## Metrics` і `--model` SHALL бути LLM product id (наприклад `cursor-grok-4.6-xhigh-fast`, `claude-opus-5`), не Closed role і не ім'я субагента; family-ярлик (`cursor-grok-4.6`) MAY бути fallback, коли product id невідомий, але CLI все одно візьме product id з adapter sources, коли вони є. Агент MUST NOT ставити `spend_source: self-report`, коли числові поля `unknown` / порожні — тоді `spend_source` SHALL бути `unknown` або рядок відсутній. Closed role у `handoff.md` MAY містити речення після `—`; metrics зберігає лише канонічний токен (`Explorer|Architect|Spec Reviewer|Implementer|Archiver|Design Intake`).

Наявні файли без секцій Runtime або Metrics лишаються валідними — секція дописується наступним persist-ом без помилки. Файл SHALL жити в `openspec/changes/<name>/handoff.md` (не в gitignored cache). Він не є артефактом схеми OpenSpec. CLI `npx agent-orchestrator-kit handoff <name>` SHALL перезаписувати секцію Prompt розширеним самодостатнім текстом мовою `project.agent_language`.

#### Scenario: Init documents the template

- **WHEN** виконується init
- **THEN** `.agents/skills/agent-orchestration/SKILL.md` або always-apply rule містить секції шаблону `handoff.md` (включно з Runtime і Metrics) і приклад промпта, що починається з `/opsx:`

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

#### Scenario: Файл без Metrics не блокує persist

- **GIVEN** наявний `handoff.md` містить усі обов'язкові секції, але не має `## Metrics`
- **WHEN** виконується persist
- **THEN** команда завершується з exit 0
- **AND** секція Metrics присутня у файлі після запису зі значеннями `unknown`

#### Scenario: Протокол забороняє self-report при unknown токенах

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** правило забороняє писати `spend_source: self-report`, коли `input_tokens` / `output_tokens` є `unknown`
- **AND** каже, що placeholder самозвіт не є spend override для leftover

### Requirement: Session Exit вимагає самозвіт метрик у `## Metrics`

Канонічний протокол Session Exit SHALL вимагати від батьківської сесії заповнити секцію `## Metrics` у `openspec/changes/<name>/handoff.md` **до** запуску `npx agent-orchestrator-kit handoff <name>`. Секція SHALL містити рядки `platform` (`cursor` | `claude` | `amp`), `model` (LLM product id цього чату), `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits` і опційно `spend_source`.

Правила заповнення, які текст протоколу MUST фіксувати: агент бере числа з того, що бачить сам; невідоме поле MUST записуватись як `unknown`, а не як `0` і не як вигадане число; `model` MUST бути LLM product id (`claude-opus-5`, `claude-fable-5`, `gpt-5.6-sol`, `cursor-grok-4.6-xhigh-fast`, `accounts/fireworks/models/glm-5p2`) і MUST NOT бути Closed role чи ім'ям субагента; family `cursor-grok-4.6` без суфікса tier/speed SHALL використовуватись лише коли точніший product id невідомий; `amp_credits` MUST лишатись окремо від `cost_usd`; `spend_source: self-report` MUST ставитись лише коли є хоч одне відоме число; при всіх `unknown` агент MUST NOT маркувати секцію як self-report — CLI тоді бере adapter leftover. Протокол MUST NOT казати, що самозвіт з `unknown` є первинним джерелом spend.

Той самий протокол і той самий виклик CLI SHALL діяти в Cursor, Claude Code і Amp; жоден MUST NOT вимагати Cursor SDK, парсер Claude `/cost` або Amp billing API як обов'язковий крок. Канонічний текст живе в `templates/.agents/rules/session-handoff.mdc` і дзеркалиться в skill `agent-orchestration`, субагенті `session-handoff` і субагенті `spec-archiver`. Відсутність секції MUST NOT блокувати persist — CLI попереджає і пише сесію як `unreported`.

#### Scenario: Правило описує секцію і порядок кроків

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** Session Exit містить крок «заповнити `## Metrics`» перед кроком запуску `handoff <name>`
- **AND** перелічує ключі `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`

#### Scenario: Протокол забороняє вигадані числа і нулі

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** правило вимагає `unknown` для невідомих полів
- **AND** забороняє підставляти `0` або вгадане значення

#### Scenario: Протокол віддає перевагу product id над family

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** приклад `--model` / `model` містить product id, не лише family `cursor-grok-4.6`
- **AND** правило каже, що adapter sources перемагають family, коли hook дав точніший id

#### Scenario: Той самий самозвіт у трьох IDE

- **WHEN** після `init`/`update` читаються `session-handoff.mdc`, skill `agent-orchestration` і субагент `session-handoff`
- **THEN** усі три тексти описують ту саму секцію `## Metrics` і той самий виклик `npx agent-orchestrator-kit handoff <name>`
- **AND** жоден не вимагає Cursor SDK, парсер Claude `/cost` або Amp billing API

#### Scenario: Archiver самозвітує так само

- **WHEN** після `init`/`update` читається субагент `spec-archiver` або команда `/opsx:archive`
- **THEN** текст вимагає заповнити `## Metrics` перед `npx agent-orchestrator-kit archive <name>`
- **AND** описує фінальну зводку archive як завершення пайплайна
