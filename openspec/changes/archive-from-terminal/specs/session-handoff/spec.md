## ADDED Requirements

### Requirement: Зелений apply друкує команду archive замість промпту

Коли `npx agent-orchestrator-kit handoff <name>` (persist, не `--restore`) закриває сесію, CLI SHALL після перевірки обов'язкових секцій `handoff.md` і підрахунку progress у `tasks.md`, але **до** побудови next-session промпта, визначити «зелений apply»: канонічна Closed role — `Implementer` (`Implementer — …` теж), `tasks.md` має хоча б один таск і всі таски `[x]`, а секція `## Blocked` порожня — рівно `none`, `none.`, `-`, `—`, `n/a` або `немає` (без урахування регістру, з необов'язковим маркером списку); будь-який інший текст не вважається порожнім. У зеленому apply CLI MUST: виставити Next command = `npx agent-orchestrator-kit archive <name> --sync` і Next role = `none` (Next command, вказаний агентом через `--next-command` чи в `handoff.md`, MUST бути замінений, а коли він відрізнявся — stderr-нотатка `green apply — Next command replaced with the archive command (was: …)`); записати `handoff.md` із цими полями та блоком `## Prompt`, що містить той самий рядок; надрукувати в stdout РІВНО цей рядок і `\n` — жодних інших рядків (решта повідомлень persist лишається в stderr, плюс один рядок-підказка: запустити в терміналі після merge, новий чат не потрібен, `/opsx:archive` — fallback). У решті станів (інша роль, незакритий таск, відсутній `tasks.md` або `tasks.md` без тасків, непорожній `## Blocked`) поведінка MUST лишатися незмінною, включно з промптом, чий перший рядок — `/opsx:…`. Тригер MUST NOT залежати від `pipeline.archive_after_merge` і від мови `project.agent_language`; повторний `handoff <name> --no-metrics` MUST давати той самий stdout і той самий `handoff.md`; `handoff <name> --restore` MUST лишатися без змін (без підказки про archive). Це єдиний виняток із вимоги, що перший рядок stdout persist — `/opsx:…`. Шаблон `/opsx:apply` і skill `openspec-apply-change` SHALL вимагати на виході зеленого apply записати `## Blocked` = `none`, `## Next command` = буквальний рядок `npx agent-orchestrator-kit archive <name> --sync` і `## Next role` = `none`, а інакше лишати `/opsx:apply <name>` (є таски) або `/opsx:propose <name>` (escape valve із записом прогалини в `## Blocked`).

#### Scenario: Зелений apply друкує один рядок

- **GIVEN** `tasks.md` з усіма тасками `[x]`, `handoff.md` із Closed role `Implementer — all tasks done` і `## Blocked` = `none`
- **WHEN** виконується `npx agent-orchestrator-kit handoff <name>` з exit 0
- **THEN** stdout дорівнює рівно `npx agent-orchestrator-kit archive <name> --sync` плюс `\n`
- **AND** `handoff.md` має `## Next command` = `` `npx agent-orchestrator-kit archive <name> --sync` ``, `## Next role` = `none` і блок `## Prompt` з тим самим рядком
- **AND** stderr містить підказку запустити рядок у терміналі після merge і не містить «Copy the prompt below»
- **AND** сесія `Implementer` записана в `metrics.json`, як і раніше

#### Scenario: Інші ролі й стани не змінюються

- **WHEN** Closed role — `Architect`, а всі таски `[x]` і `## Next command` = `/opsx:review <name>`
- **THEN** stdout, як і раніше, починається з `/opsx:review <name>` і містить `HARD STOP`
- **WHEN** Closed role — `Implementer`, але є незакритий таск, або `## Blocked` = `waiting for CI on the PR`, або `tasks.md` відсутній чи без тасків
- **THEN** stdout — звичайний промпт, чий перший рядок — Next command із `handoff.md`, і містить `HARD STOP`
- **AND** stderr не містить підказки про запуск archive у терміналі

#### Scenario: Next command агента замінюється з нотаткою

- **GIVEN** зелений apply, де агент записав `## Next command` = `/opsx:archive <name>`
- **WHEN** виконується `handoff <name>`
- **THEN** stdout дорівнює рядку `npx agent-orchestrator-kit archive <name> --sync`
- **AND** stderr містить `green apply — Next command replaced with the archive command (was: /opsx:archive <name>)`, а `handoff.md` має команду archive

#### Scenario: Повторна генерація і мова не міняють результат

- **GIVEN** зелений apply, що вже пройшов persist
- **WHEN** виконується `handoff <name> --no-metrics`
- **THEN** stdout і `handoff.md` байт-у-байт збігаються з попереднім результатом
- **AND** у проєкті з `project.agent_language: uk` або з `pipeline.archive_after_merge: false` stdout той самий один рядок

#### Scenario: Restore не змінюється

- **GIVEN** `handoff.md` після зеленого apply
- **WHEN** виконується `handoff <name> --restore`
- **THEN** брифінг друкує `next_command: npx agent-orchestrator-kit archive <name> --sync` і `next_role: none`
- **AND** жодна підказка про archive не додається

#### Scenario: Шаблони apply вимагають буквальний рядок

- **WHEN** після `init`/`update` читаються `.agents/commands/opsx-apply.md` і `.agents/skills/openspec-apply-change/SKILL.md`
- **THEN** обидва містять буквальний рядок `npx agent-orchestrator-kit archive <name> --sync`
- **AND** `opsx-apply.md` на виході вимагає `## Blocked` = `none`, `## Next role` = `none` і забороняє запускати archive у цьому apply-чаті

## MODIFIED Requirements

### Requirement: Persist Memory and handoff on session exit

Агент MUST NOT оголошувати фазу закритою, поки не виконає кроки **в цьому порядку в батьківській сесії**: (1) записати `openspec/changes/<name>/handoff.md`, включно із заповненою секцією `## Metrics`, (2) виконати `npx agent-orchestrator-kit handoff <name>` з exit 0 (CLI upsert memory.json абсолютним шляхом, записує сесію в `metrics.json` і друкує розширений промпт у stdout), (3) вставити stdout CLI у чат як один fenced промпт. Спавн `session-handoff` у режимі persist дозволений ЛИШЕ як fallback, коли крок (2) повернув помилку. Оновлення Memory MCP entities — опційне дзеркало (одним викликом, якщо tools доступні); його відсутність MUST NOT блокувати закриття. Вимоги до змісту промпта не змінюються: перший рядок `/opsx:<command>`, самодостатній, без службового ярлика; єдиний виняток — зелений apply, коли замість промпту CLI друкує один рядок `npx agent-orchestrator-kit archive <name> --sync` (вимога «Зелений apply друкує команду archive замість промпту»).

#### Scenario: Exit без субагента

- **WHEN** фаза завершена і `npx agent-orchestrator-kit handoff <name>` повернув exit 0
- **THEN** батьківська сесія вставляє stdout-промпт і закривається без спавну `session-handoff`

#### Scenario: Метрики заповнені до запуску CLI

- **WHEN** батьківська сесія готує Session Exit
- **THEN** протокол вимагає заповнити `## Metrics` у `handoff.md` до кроку (2)
- **AND** CLI не використовується як спосіб «додати метрики пізніше»

#### Scenario: Archive закриває пайплайн без next-prompt

- **WHEN** `npx agent-orchestrator-kit archive <name>` завершився exit 0
- **THEN** фінальний `handoff.md` записаний в архівній папці з `next_command: none`
- **AND** fenced next-prompt не вимагається
- **AND** stdout містить зводку по всьому change

### Requirement: Next-session prompt follows agent_language

Тіло промпта наступної сесії MUST бути мовою `project.agent_language` з `.agents/orchestrator.yaml`. Команди-ідентифікатори (`/opsx:review`, ключі Memory `Change:`, `Handoff:`, `Decision:`, шляхи файлів) SHALL лишатися як у протоколі (латиниця). Англійська мова тіла промпта не є вимогою якості і MUST NOT використовуватись, коли `agent_language` не `en`.

Ім'я субагента фази у промпті (`Наступна роль / субагент фази`, `subagent-<name>`, `.cursor/agents/<name>.md`) SHALL братися лише з backtick-токена у `## Subagents to spawn` / `## Next role` або з карти канонічна роль → субагент (`Explorer`→`explorer`, `Architect`→`spec-architect`, `Spec Reviewer`→`spec-reviewer`, `Implementer`→порожньо, `Archiver`→порожньо); вільний текст Next role MUST NOT парситись на слова. Коли ім'я невідоме, промпт SHALL друкувати плейсхолдер `<phase-specialist>`.

#### Scenario: Ukrainian project gets Ukrainian prompt body

- **WHEN** `.agents/orchestrator.yaml` має `project.agent_language: uk`
- **AND** агент виводить промпт наступної сесії
- **THEN** інструктивне тіло (починаю сесію, запусти restore, conductor, HARD STOP) написане українською
- **AND** перший рядок лишається `/opsx:<command> <name>`

#### Scenario: English project keeps English body

- **WHEN** `project.agent_language` є `en` або відсутній
- **THEN** тіло промпта MAY бути англійською; команда `/opsx:` не змінюється

#### Scenario: Apply exit does not start archive in the same chat

- **GIVEN** усі таски `[x]`, канонічна Closed role `Implementer` і порожня секція `## Blocked`
- **WHEN** apply-сесія закривається через `handoff <name>`
- **THEN** CLI друкує замість next-role промпта один рядок `npx agent-orchestrator-kit archive <name> --sync` (його запускають у терміналі після merge)
- **AND** інструкція забороняє запускати archive (CLI чи `/opsx:archive`) у цьому ж apply-чаті

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

- **WHEN** після `init`/`update` читається субагент `spec-archiver` (fallback без CLI)
- **THEN** текст вимагає заповнити `## Metrics` перед `npx agent-orchestrator-kit archive <name>`
- **AND** описує фінальну зводку archive як завершення пайплайна
- **WHEN** читається команда `/opsx:archive` (fallback над CLI)
- **THEN** вона не містить кроку самозвіту `## Metrics` і блоку Session Start / Exit: лише викликає CLI, показує stdout, а на exit ≠ 0 друкує відмову і зупиняється

#### Scenario: Правило забороняє повторний persist і ручний decisions.md

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** текст містить `--no-metrics` як єдиний спосіб перегенерувати промпт
- **AND** містить заборону повторного повного persist у тій самій сесії
- **AND** містить заборону ручного редагування `decisions.md`
- **AND** вимагає новий чат для хотфіксу поза OpenSpec після persist
- **AND** позначає `platform` і `model` як обов'язкові (не `unknown`)
