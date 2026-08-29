## ADDED Requirements

### Requirement: Persist передає LLM product id; CLI auto-collect usage

На кроці Session Exit батьківська сесія MUST викликати `npx agent-orchestrator-kit handoff <name>` з `--model <llm-product-id>` — ідентифікатором LLM-продукту, який виконував цей чат (наприклад `claude-opus-5`, `claude-fable-5`, `gpt-5.6-sol`, `cursor-grok-4.6`), або покладатись на env `AOK_MODEL` з тим самим значенням. Батько SHOULD передавати `--model` навіть коли collect заповнить primary model з usage. Батько MUST NOT передавати Closed role пайплайна (`Architect`, `Implementer`, `Explorer`) і MUST NOT передавати ім'я субагента (`spec-architect`, `session-handoff`) як `--model`. Persist SHALL сам збирати локальний usage з Claude JSONL, Amp threads і Cursor vscdb. Батько MUST NOT вгадувати токени чи вартість і MUST NOT підставляти `0`. Прапорці `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` SHALL override лише session-level totals і MUST NOT бути єдиним джерелом платформенних карт. Опційно `--platform cursor|claude|amp` або env `AOK_PLATFORM`. Той самий CLI викликається з Cursor, Claude Code і Amp. Як обов'язковий крок протоколу MUST NOT вимагатись Cursor SDK, парсер Claude `/cost` або Amp billing API. Канонічний текст живе в `templates/.agents/rules/session-handoff.mdc` і дзеркалиться в skill `agent-orchestration` та субагенті `session-handoff`.

#### Scenario: Протокол вимагає --model як LLM id

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** Session Exit вимагає передати `--model` з LLM product id поточної сесії
- **AND** забороняє підставляти роль пайплайна або ім'я субагента як значення `--model`

#### Scenario: Протокол описує auto-collect і забороняє вгадувати токени

- **WHEN** після `init`/`update` читається `.agents/rules/session-handoff.mdc`
- **THEN** правило каже, що persist збирає локальний usage з Claude JSONL, Amp threads і Cursor vscdb
- **AND** забороняє батькові вгадувати токени й вартість
- **AND** каже, що spend-прапорці override лише totals

#### Scenario: Той самий CLI у трьох IDE без SDK як обов'язкового кроку

- **WHEN** після `init`/`update` читаються `session-handoff.mdc`, skill `agent-orchestration` і субагент `session-handoff`
- **THEN** усі три тексти називають `npx agent-orchestrator-kit handoff <name>` як persist-виклик для Cursor, Claude Code і Amp
- **AND** жоден не вимагає Cursor SDK, парсер Claude `/cost` або Amp billing API як обов'язковий крок
