## Why

`metrics.json` уже надійно пише час сесії (restore → persist), але spend лишається порожнім на реальних змінах: адаптери (Claude JSONL, Amp threads, Cursor hook) на практиці дають `null`, а spend-прапорці persist агенти просто пропускають. Через це `metrics <name>` показує сесії і тривалість, але `tokens`/`cost` — прочерки, і зведення по change недоступне ні людині, ні наступній сесії.

Причина не в адаптерах, а в тому, хто джерело правди. Модель, платформу і витрати знає **агент, який закриває сесію** — він бачить свій контекст, свою платформу (Cursor / Amp / Claude Code) і свій ліміт. Це знання треба зробити обов'язковою частиною Session Exit (як `handoff.md`), а не опційним прапорцем CLI, який легко забути.

## What Changes

- **Self-report як primary джерело spend.** У `handoff.md` з'являється секція `## Metrics`, яку агент заповнює під час Session Exit ще до запуску persist: `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`, `spend_source`.
- **Persist читає секцію, а не адаптери.** `handoff <name>` парсить `## Metrics` з файлу і пише `session.model`, `session.platform`, токени, `costUsd`, `ampCredits` і нове поле `session.spendSource`. Час (`startedAt` / `endedAt` / `durationMs`) далі ставить CLI — його агент не самозвітує.
- **BREAKING: адаптери більше не в дефолтному шляху.** `--no-collect` замінюється на opt-in `--collect` на `handoff <name>` і `archive`. `bin/spend-collect.js`, `metrics --collect` і Cursor spend hook лишаються як опційне доповнення, а не як основа.
- **BREAKING: Cursor spend hook перестає бути обов'язковим.** `ensureCursorSpendHook` викликається лише в `init` / `update` / `sync` / `mcp-setup`; self-heal з `handoff --restore` і persist прибирається (кожна сесія більше не чіпає `.cursor/hooks.json`).
- **Порядок stdout persist.** Спочатку CLI читає `## Metrics` і записує сесію, лише потім друкує next-thread prompt — щоб самозвіт ніколи не лишався «на потім».
- **Відсутня секція не валить persist.** Без `## Metrics` сесія пишеться з `spendSource: "unreported"`, null-spend і гучним попередженням у stderr; CLI дописує у `handoff.md` скелет секції з `unknown`, щоб наступний persist мав що заповнити.
- **Archive дає людську зводку.** Після успішного move сесія `Archiver` бере значення з того самого самозвіту, а фінальний stdout `archive` містить зведення по всьому change: sessions, work/lead time, tokens, cost, розбивка by phase / by platform / by model.
- **Крос-IDE протокол.** Однакова секція і однакова команда в Cursor, Amp і Claude Code; `spendByPlatform` рахується з `session.platform`, а не з host-евристик, тому сесії різних IDE на одному change складаються коректно. Канал синхронізації — git-tracked `metrics.json`.
- Оновлюються шаблони протоколу: `.agents/rules/session-handoff.mdc`, `.agents/subagents/session-handoff.md`, `.agents/subagents/spec-archiver.md`, `AGENTS.md`, README, CHANGELOG.

## Non-goals

- Будь-які API / SDK / billing-інтеграції: Cursor SDK, парсер Claude `/cost`, Amp billing API.
- Pricing-таблиця в кіті і обчислення USD з кількості токенів.
- Єдиний «total bill», що складає Amp credits з USD.
- Гейт persist на наявність або правдоподібність чисел самозвіту (відсутня секція лишається warning, не помилкою).
- Бекфіл spend у вже заархівовані зміни.
- Розвиток `spend-collect` як основного джерела spend — адаптери лишаються опційним доповненням.

## Capabilities

### New Capabilities

(немає — зміна перевизначає наявні можливості)

### Modified Capabilities

- `change-metrics`: джерело spend змінюється з адаптерів на self-report секцію `## Metrics`; додається `session.spendSource` і session-level `ampCredits`; `--no-collect` → opt-in `--collect`; Cursor hook стає опційним; archive друкує людську зводку по change; резолв `model` і `platform` враховує самозвіт.
- `session-handoff`: шаблон `handoff.md` отримує секцію `## Metrics`; Session Exit вимагає заповнити її до запуску persist; файли без секції лишаються валідними.
- `lean-archive`: дубльована вимога «Archive завжди фіналізує metrics.json» видаляється — вся семантика archive-метрик (ланцюжки резолву, opt-in `--collect`, зводка) лишається за `change-metrics`; `lean-archive` зберігає тільки те, що `metrics.json` і самозвіт не є гейтами archive і що невалідний `--platform` відхиляється до move.

## Impact

- `bin/agent-orchestrator.js`: `HANDOFF_SECTIONS`, `buildHandoffMarkdown`, `fieldsFromSections`, парсер секції `## Metrics`, `metricsRecordSessionEnd`, `metricsFinalizeArchive`, `resolveModel` / `resolvePlatform`, прапорці `handoff` і `archive`, stdout `archive`, місця виклику `ensureCursorSpendHook`.
- `bin/spend-collect.js`: коду не змінює, змінює статус — викликається лише за явним `--collect`.
- `openspec/specs/lean-archive/spec.md` (через `archive --sync`): вимога «Archive завжди фіналізує metrics.json» видаляється як дубль `change-metrics`, натомість з'являється «Гейті archive не залежать від metrics.json». Після sync у `openspec/specs/` лишається один опис archive-метрик, і жоден main spec не згадує `--no-collect`.
- `templates/.agents/rules/session-handoff.mdc`, `templates/.agents/subagents/session-handoff.md`, `templates/.agents/subagents/spec-archiver.md`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/AGENTS.md`, `templates/CLAUDE.md`.
- `test/smoke.test.js` (нові кейси persist/archive), `test/spend-collect.test.js` (лишається, адаптери тестуються під `--collect`).
- README, CHANGELOG, bump версії кіта.
- Зворотна сумісність даних: схема `metrics.json` лишається версією `1`; наявні файли без `spendSource` читаються без міграції. Бекфіл архівів не робиться.

## Acceptance criteria

Кожен критерій перевіряється спостережуваною поведінкою CLI.

1. **Persist із заповненою секцією.** `handoff <name>` на файлі з `## Metrics` (`platform: cursor`, `model: claude-opus-5`, `input_tokens: 128000`, `output_tokens: 9400`, `cost_usd: 0.42`) і без spend-прапорців завершується exit 0 і пише в `metrics.json` сесію з `platform: "cursor"`, `model: "claude-opus-5"`, `inputTokens: 128000`, `totalTokens: 137400`, `costUsd: 0.42` і `spendSource: "self-report"`.
2. **Persist без секції.** `handoff <name>` на файлі без `## Metrics` завершується exit 0, пише сесію зі `spendSource: "unreported"` і null-spend, друкує іменоване попередження в stderr із переліком очікуваних ключів і дописує в `handoff.md` скелет `## Metrics` зі значеннями `unknown` (після `## Runtime`, перед `## Prompt`).
3. **Порядок stdout у persist.** Після exit 0 `metrics.json` уже містить новий запис сесії, попередження лежать у stderr, а stdout містить лише next-thread prompt, що починається з `/opsx:` — без метрик і без службових рядків.
4. **Прапорці перекривають самозвіт, самозвіт перекриває env і host.** `handoff <name> --input-tokens 7 --cost-usd 9.99` на секції з іншими числами дає `inputTokens: 7`, `costUsd: 9.99` і `outputTokens` із секції; при `CURSOR_AGENT=1` і `platform: amp` у секції сесія пишеться з `platform: "amp"`; при `AOK_MODEL=gpt-5.6-sol` і `model: claude-opus-5` у секції — `model: "claude-opus-5"`. Секція `## Metrics` у `handoff.md` після цього persist лишається такою, як її написав агент (`input_tokens: 100`, `cost_usd: 0.10`) — CLI не переписує самозвіт резолвленими значеннями.
5. **Дефолт не читає адаптери.** З наявними tmp-фікстурами Claude JSONL / Amp threads / `cursor-usage.jsonl` `handoff <name>` і `archive <name>` без `--collect` дають `sessions[*].sources: []` і `spendByPlatform.*.source: "none"`, exit 0.
6. **`--collect` — opt-in на обох командах.** `handoff <name> --collect` і `archive <name> --collect` наповнюють `session.sources` і бакети `spendByPlatform` / `spendByModel`, але MUST NOT перекривати totals із прапорців або самозвіту; `handoff <name> --help` і `archive --help` показують `--collect` і не показують `--no-collect`, а виклик із `--no-collect` завершується повідомленням про невідомий прапорець.
7. **Amp credits окремо від USD.** Секція з `amp_credits: 20` і `cost_usd: unknown` дає `session.ampCredits: 20`, `session.costUsd: null`, `spend.costUsd: null` і `spendByPlatform.amp.ampCredits: 20`; жоден вивід не друкує total, що дорівнює сумі credits і USD.
8. **Зводка archive.** `archive <name>` після успішного move друкує в stdout зведення по всьому change: `sessions`, work time, lead time, `tokens`, `cost`, таблиці by phase / by platform / by model і кількість сесій зі `spendSource: "unreported"`. Блок зводки в stdout `archive` посимвольно збігається з блоком, який друкує `metrics <name>` без `--json` на тому самому файлі. Помилка рендера не змінює exit code.
9. **Archiver самозвітує тим самим протоколом.** `archive <name>` без прапорців моделі й платформи бере `platform`, `model` і spend сесії `Archiver` із `## Metrics` уже переміщеного `openspec/changes/archive/<date>-<name>/handoff.md`.
10. **Cursor hook — лише setup.** `handoff <name> --restore`, persist і `metrics` у проєкті без `.cursor/hooks.json` не створюють цей файл і не друкують рядок про spend hook; `npx agent-orchestrator-kit update` копіює обидва скрипти і додає entries для `stop`, `subagentStop`, `afterAgentResponse`, `sessionEnd`, не видаляючи чужі hooks.
11. **Крос-IDE агрегація.** Сесія з `platform: cursor` (`totalTokens: 1000`) і сесія з `platform: amp` (`totalTokens: 500`, `ampCredits: 12`) на одному change дають `spendByPlatform.cursor.totalTokens: 1000`, `spendByPlatform.amp.totalTokens: 500`, `spendByPlatform.amp.ampCredits: 12` і `spend.totalTokens: 1500`; сесія, у якої сума `sources` дорівнює session-level totals, не рахується двічі.
12. **Гейти не залежать від самозвіту.** `gate-check` і pre-commit hook не змінюють exit code через відсутню секцію `## Metrics` або відсутній `metrics.json`; legacy-запис сесії без поля `spendSource` читається як `unreported` без міграції файлу.
13. **Документація і шаблони синхронні.** `.agents/rules/session-handoff.mdc`, субагенти `session-handoff` і `spec-archiver`, skill `agent-orchestration`, `AGENTS.md`, README і CHANGELOG описують крок заповнення `## Metrics` перед запуском CLI, позначають `--collect` як опційний і не згадують `--no-collect` як чинний прапорець.
14. **Локальний verify зелений.** `npm test` і `npx openspec validate --all --strict` завершуються exit 0.
