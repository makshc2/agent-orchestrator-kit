# fix-metrics-model-and-spend

Design: none

## Why

v0.5.0 уже пише git-tracked `openspec/changes/<name>/metrics.json` і команду `metrics`, але без OpenSpec-спеки: модель і spend лишаються порожніми, бо CLI чекає прапорців, яких протокол не вимагає як LLM-ідентифікатор; таблиця `metrics` ховає моделі за колонкою `agents` з ролями пайплайна; `archive` мовчки пропускає відсутній файл. Користувач питає «які агенти яку фазу писали» — маються на увазі продуктові LLM (Claude Fable 5, Opus 5, GPT 5.6 Sol, Cursor Grok 4.6), а не Closed role.

Owner відхилив шлях «лише прапорці / без колекторів»: на одних і тих самих проєктах ідуть Cursor + Claude Code + Amp, і usage треба збирати **автоматично з кожної платформи окремо**. Зливати Amp credits, Claude USD і Cursor $ в один «рахунок» заборонено — це фейковий unified bill.

## What Changes

- Нова capability `change-metrics` фіксує схему `metrics.json`, цикл restore → persist → archive, команду `metrics [name] [--json]`, null-honest агрегати, `--no-metrics` і `--no-collect`.
- `session.model` і `phases.*.models` зберігають **ідентифікатор LLM-продукту**. `session.role` / `phases.*.agents` лишаються Closed role пайплайна. Резолв моделі: джерела колектора (primary = найбільший `totalTokens`) або `--model` → env `AOK_MODEL` → `null` (D2, якщо джерел немає). Persist і archive MUST NOT падати через відсутню модель; CLI SHALL попереджати в stderr, коли модель `null`.
- На persist (`handoff <name>`, коли metrics увімкнено) і на `archive` finalize CLI MUST запускати три локальні read-only адаптери (claude jsonl, amp threads, cursor vscdb). Прапорці `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` OVERRIDE лише session-level totals; вони MUST NOT витирати `spendByPlatform` / `spendByModel`. Ніколи не вгадувати. Ніколи не конвертувати Amp credits у USD. Відсутнє значення = `null`, не `0`. Порожній collect MUST NOT валити persist/archive.
- `metrics.json` отримує `spendByPlatform` (окремо cursor / claude / amp) і `spendByModel`. Кожна сесія зберігає `sources[]` і опційно `models[]`. Людська команда `metrics` друкує дві додаткові таблиці — **by platform** і **by model** — і MUST NOT друкувати єдиний «total $», що змішує одиниці.
- `archive <name>` після успішного move завжди створює/фіналізує `metrics.json` (`archivedAt`, `pending: null`, перерахунок агрегатів), додає сесію Archiver, запускає collect для вікна Archiver і попереджає в stderr через `console.error`, якщо `spend.costUsd` є `null` (Amp credits і заповнені токени не скасовують warning). Exit code archive не залежить від metrics.
- Опційний `session.platform`: `--platform cursor|claude|amp` → env `AOK_PLATFORM` → `null`. Немає `CURSOR_AGENT` як маркера.
- Протокол Session Exit: persist сам збирає локальний usage; батько SHOULD передати `--model`; батько MUST NOT вгадувати токени; прапорці лише override totals. Заборонені як обов'язковий крок: Cursor SDK, парсер Claude `/cost`, Amp billing API.
- `gate-check` / pre-commit MUST NOT вимагати `metrics.json`. Бекфілу архівів немає.

Не BREAKING: наявний `metrics.json` без `platform` / `spendByPlatform` лишається валідним (merge з default); `--no-metrics` лишається opt-out.

## Capabilities

### New Capabilities

- `change-metrics`: git-tracked метрики change-у — схема файлу (включно з `spendByPlatform` / `spendByModel` / `session.sources`), старт сесії на restore, закриття на persist (роль→фаза, модель D2/D10, spend D3′, platform D5, collect D9/D11), null-honest агрегати, CLI `metrics` з таблицями platform/model, фіналізація на archive (D4), паритет трьох IDE через CLI + rules + локальні адаптери.

### Modified Capabilities

- `session-handoff`: Session Exit persist MUST передавати `--model` як LLM product id; MUST NOT передавати роль/субагент як модель; CLI auto-collect локальний usage; прапорці override totals only; той самий CLI на Cursor / Claude Code / Amp без SDK/`/cost`/billing API.
- `lean-archive`: успішний `archive` завжди лишає `metrics.json` з `archivedAt`; collect на finalize для вікна Archiver; попередження коли `spend.costUsd` є `null`; metrics MUST NOT бути archive-гейтом.

## Impact

- `bin/spend-collect.js` (новий файл): три адаптери, вікно, cwd-match, dedup; без нових npm-залежностей; unit-testable.
- `bin/agent-orchestrator.js`: `import` collect-модуля; резолв `--model`/`AOK_MODEL` і `--platform`/`AOK_PLATFORM`; `--no-collect`; попередження при `model: null`; колонка `models` і таблиці platform/model; `metricsFinalizeArchive` створює файл, якщо його немає, додає сесію Archiver, запускає collect.
- `templates/.agents/rules/session-handoff.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`: протокол `--model` + auto-collect + чесний override.
- `templates/.agents/commands/opsx-archive.md`: згадка, що archive завжди фіналізує metrics (не гейт).
- `test/spend-collect.test.js` (новий) і `test/smoke.test.js`: фікстури в tmp (`HOME` / `AMP_DATA_DIR` / `XDG_CONFIG_HOME`); CI MUST NOT читати реальний `~/.claude` розробника.
- `README.md` (секція Change metrics), `CHANGELOG.md` (`[Unreleased]`).
- Нових npm-залежностей немає (`better-sqlite3`, `sql.js`, `ccusage` заборонені). `orchestrator-cli-controls` не змінюється.

## Non-goals

- Вигаданий unified bill: сума Amp credits + Claude USD + Cursor $ як одне число.
- Cursor SDK, Cursor server CSV, cookies.
- Нові npm-залежності для SQLite чи usage (`better-sqlite3`, `sql.js`, `ccusage`).
- Вбудована pricing table / вигадування USD з токенів або з Amp credits.
- Парсер Claude `/cost` як обов'язковий крок протоколу; Amp billing API; будь-який network collect.
- Бекфіл історичних архівів без `metrics.json`.
- Phase 4 dashboard, нові ролі пайплайна, нові субагенти.
- Робити metrics гейтом persist, archive, `gate-check` або pre-commit.
- Вгадувати модель чи spend, коли адаптер і прапорець/env нічого не дали.
- Складати таксономію назв моделей — зберігати рядок як передано / як у usage-записі.
- Ховати `metrics` CLI всередину `orchestrator-cli-controls`.

## Acceptance criteria

- Persist з `--model claude-opus-5` записує `session.model` і `phases.*.models` як `claude-opus-5`, якщо collect не дав sources; `AOK_MODEL` без прапорця дає те саме; без прапорця, env і sources — `model: null`, persist exit 0, stderr містить попередження.
- Persist з `--model Architect` або ім'ям субагента як значенням моделі **не** валить CLI, але протокол забороняє це батьківській сесії.
- Порожній collect і відсутній spend-прапорець лишають `null` (не `0`); persist і archive exit 0.
- Collect з фікстури Claude JSONL заповнює `spendByPlatform.claude` і `session.sources`; `--cost-usd` змінює лише session-level `costUsd` і не витирає карту платформ.
- `metrics <name>` друкує колонку `models` з LLM id, таблиці **by platform** і **by model**, і не друкує єдиний total $, що змішує Amp credits з USD.
- `metrics <name>` і `metrics <name> --json` працюють для активної зміни і для `archive/*-<name>`.
- `archive <name>` без попереднього `metrics.json` створює файл з `archivedAt`, `pending: null` і сесією Archiver; collect на finalize; якщо `spend.costUsd` є `null` — warning у stderr через `console.error`, exit 0.
- `--no-metrics` на restore/persist не пише сесію і не запускає collect; `--no-collect` пише сесію без адаптерів; archive все одно фіналізує файл.
- `gate-check` / pre-commit не вимагають `metrics.json`.
- Після `init`/`update` `session-handoff.mdc` вимагає `--model`, описує auto-collect і забороняє роль/субагент як модель та вгадування токенів.
- `npm test` зелений на tmp-фікстурах (не на реальному home розробника); `npx openspec validate fix-metrics-model-and-spend --strict` проходить.
