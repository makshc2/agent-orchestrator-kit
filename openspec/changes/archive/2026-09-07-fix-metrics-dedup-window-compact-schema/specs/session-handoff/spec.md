## MODIFIED Requirements

### Requirement: Next-session prompt follows agent_language

Тіло промпта наступної сесії MUST бути мовою `project.agent_language` з `.agents/orchestrator.yaml`. Команди-ідентифікатори (`/opsx:review`, ключі Memory `Change:`, `Handoff:`, `Decision:`, шляхи файлів) SHALL лишатися як у протоколі (латиниця). Англійська мова тіла промпта не є вимогою якості і MUST NOT використовуватись, коли `agent_language` не `en`.

Ім'я субагента фази у промпті (`Наступна роль / субагент фази`, `subagent-<name>`, `.cursor/agents/<name>.md`) SHALL братися лише з backtick-токена у `## Subagents to spawn` / `## Next role` або з карти канонічна роль → субагент (`Explorer`→`explorer`, `Architect`→`spec-architect`, `Spec Reviewer`→`spec-reviewer`, `Implementer`→порожньо, `Archiver`→порожньо); вільний текст Next role MUST NOT парситись на слова. Коли ім'я невідоме, промпт SHALL друкувати плейсхолдер `<phase-specialist>`.

#### Scenario: Ukrainian project gets Ukrainian prompt body

- **WHEN** `.agents/orchestrator.yaml` має `project.agent_language: uk`
- **AND** агент виводить промпт наступної сесії
- **THEN** інструктивне тіло (починаю сесію, прочитай Memory, conductor) написане українською
- **AND** перший рядок лишається `/opsx:<command> <name>`

#### Scenario: English project keeps English body

- **WHEN** `project.agent_language` є `en` або відсутній
- **THEN** тіло промпта MAY бути англійською; команда `/opsx:` не змінюється

#### Scenario: Apply exit does not start archive in the same chat

- **WHEN** усі таски `[x]` і apply-сесія закривається
- **THEN** агент виводить prompt на наступну роль (verify/archive)
- **AND** інструкція забороняє запускати `/opsx:archive` у цій же сесії

#### Scenario: Вільний текст Next role не стає ім'ям субагента

- **WHEN** `## Next role` містить `Implementer — відновити verification після усунення baseline lint` без backtick
- **THEN** промпт не містить `subagent-baseline` і `.cursor/agents/baseline.md`
- **AND** рядок субагента фази містить `<phase-specialist>` або порожнє ім'я

#### Scenario: Backtick-ім'я і карта ролей працюють

- **WHEN** `## Next role` містить `Architect (spawn \`spec-architect\`)`
- **THEN** промпт містить `subagent-spec-architect`
- **WHEN** `## Next role` містить лише `Spec Reviewer`
- **THEN** промпт містить `subagent-spec-reviewer`

### Requirement: Session Exit вимагає самозвіт метрик у `## Metrics`

Канонічний протокол Session Exit SHALL вимагати від батьківської сесії заповнити секцію `## Metrics` у `openspec/changes/<name>/handoff.md` **до** запуску `npx agent-orchestrator-kit handoff <name>`. Секція SHALL містити рядки `platform` (`cursor` | `claude` | `amp`), `model` (LLM product id цього чату), `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits` і опційно `spend_source`.

Правила заповнення, які текст протоколу MUST фіксувати: агент бере числа з того, що бачить сам; невідоме поле MUST записуватись як `unknown`, а не як `0` і не як вигадане число; `model` MUST бути LLM product id (`claude-opus-5`, `claude-fable-5`, `gpt-5.6-sol`, `cursor-grok-4.6-xhigh-fast`, `accounts/fireworks/models/glm-5p2`) і MUST NOT бути Closed role чи ім'ям субагента; family `cursor-grok-4.6` без суфікса tier/speed SHALL використовуватись лише коли точніший product id невідомий; `amp_credits` MUST лишатись окремо від `cost_usd`; `spend_source: self-report` MUST ставитись лише коли є хоч одне відоме число; при всіх `unknown` агент MUST NOT маркувати секцію як self-report — CLI тоді бере adapter leftover. Протокол MUST NOT казати, що самозвіт з `unknown` є первинним джерелом spend.

Той самий протокол і той самий виклик CLI SHALL діяти в Cursor, Claude Code і Amp; жоден MUST NOT вимагати Cursor SDK, парсер Claude `/cost` або Amp billing API як обов'язковий крок. Канонічний текст живе в `templates/.agents/rules/session-handoff.mdc` і дзеркалиться в skill `agent-orchestration`, субагенті `session-handoff` і субагенті `spec-archiver`. Відсутність секції MUST NOT блокувати persist — CLI попереджає і пише сесію як `unreported`.

Той самий протокол MUST фіксувати: `platform` і `model` є обов'язковими значеннями, не `unknown` (агент завжди знає свій клієнт і модель чату); перегенерація next-thread промпта після правки `handoff.md` виконується лише `npx agent-orchestrator-kit handoff <name> --no-metrics`, повторний повний persist у тій самій сесії MUST NOT запускатись (кожен повний persist = нова сесія в `metrics.json`); `decisions.md` MUST NOT редагуватись агентом напряму — лише через `## Decisions` і persist; після persist сесія зупиняється, будь-яка інша робота (хотфікс поза OpenSpec, наступна фаза, archive) — новий чат.

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

#### Scenario: Правило забороняє повторний persist і ручний decisions.md

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** текст містить `--no-metrics` як єдиний спосіб перегенерувати промпт
- **AND** містить заборону повторного повного persist у тій самій сесії
- **AND** містить заборону ручного редагування `decisions.md`
- **AND** вимагає новий чат для хотфіксу поза OpenSpec після persist
- **AND** позначає `platform` і `model` як обов'язкові (не `unknown`)
