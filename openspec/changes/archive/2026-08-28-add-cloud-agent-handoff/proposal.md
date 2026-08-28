# add-cloud-agent-handoff

Design: none

## Why

Phase 3 роадмапу `agentic-factory-roadmap` закриває Workspace-розрив: cloud-сесія (Cursor Cloud Agent на VM) пише OpenSpec-артефакти у файлову систему, якої не існує для ноутбука і колег, поки гілка не закомічена й не запушена (кейс: гілка `cursor/agentic-factory-gap-analysis-a18e` з gap-аналізом, що так і не потрапив на GitHub). Сьогодні `handoff.md` не фіксує, де виконувалась сесія (local чи cloud), а CLI `handoff <name>` завершує persist з exit 0 навіть коли жоден артефакт change-у не доданий у git. Роадмап-спека вимагає: закриття cloud-сесії з незакоміченими OpenSpec-артефактами = неповний handoff, і `handoff.md` MUST фіксувати runtime сесії.

## What Changes

- `handoff.md` отримує секцію `## Runtime` (`- runtime: local|cloud`, `- agent_id: <id|none>`); її пишуть persist-гілка CLI `handoff <name>` і фінальний handoff команди `archive`.
- Детекція runtime детермінована з фіксованим пріоритетом: прапорець `--runtime <local|cloud>` → env `AOK_RUNTIME` → best-effort cloud-маркери середовища (одна константа в CLI) → `local`. `agent_id`: `--agent-id` → env `AOK_AGENT_ID` → `none`.
- Нова перевірка `npx agent-orchestrator-kit handoff <name> --cloud-check`: (а) `git status --porcelain` не показує змінених чи untracked шляхів під `openspec/changes/<name>/`, (б) поточна гілка має upstream і не ahead (артефакти запушені). Вирішення open question роадмапу: при `runtime: cloud` невиконання будь-якої умови = exit non-zero; при `runtime: local` — warning з exit 0.
- Persist при `runtime: cloud` друкує обов'язкові наступні кроки виходу: `git add openspec/changes/<name>/` → commit → push → `handoff <name> --cloud-check` (exit 0).
- Протокольні шаблони (`session-handoff.mdc`, skill `agent-orchestration`, субагент `session-handoff`) фіксують дисципліну workspace: агент (local або cloud) пише артефакти сесії лише в git-tracked шляхи; cloud-сесія не закривається без commit + push + зеленого cloud-check.
- `README.md` (Phase 3 у роадмап-секції) і `CHANGELOG.md` (`[Unreleased]`).

Не BREAKING: наявні `handoff.md` без секції Runtime лишаються валідними — persist не падає, а дописує секцію зі значенням за замовчуванням.

## Capabilities

### New Capabilities

- `cloud-agent-handoff`: дисципліна workspace для local/cloud runtime — фіксація runtime і agent_id у `handoff.md`, детермінований `--cloud-check` git-стану артефактів change-у, правило «артефакти сесії лише в git-tracked шляхах» у протоколі Session Exit; паритет Cursor / Claude Code / Amp Code через CLI + rules без IDE-специфічних механізмів.

### Modified Capabilities

- `session-handoff`: шаблон `handoff.md` доповнюється секцією Runtime; CLI persist пише runtime/agent_id і при cloud-runtime друкує кроки commit → push → cloud-check.

## Impact

- `bin/agent-orchestrator.js`: `HANDOFF_SECTIONS`/`buildHandoffMarkdown`/`fieldsFromSections` (секція Runtime), детекція runtime, гілка `--cloud-check` у команді `handoff`, cloud-підказка в persist, Runtime у фінальному handoff команди `archive`.
- `templates/.agents/rules/session-handoff.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`: протокольний текст про git-tracked шляхи і cloud-вихід.
- `test/smoke.test.js`: тести Runtime-секції, детекції, cloud-check (clean/dirty/unpushed, cloud/local).
- `README.md`, `CHANGELOG.md`: документація Phase 3.
- Нових npm-залежностей немає. Наявні консюмери не зачіпаються до `update`; поведінка persist для local-сесій не змінюється, крім появи секції Runtime.

## Non-goals

- Тягнути артефакти з cloud-VM через API або відновлювати стару гілку gap-аналізу — карта пишеться заново в git (рішення роадмапу D7).
- Робити Claude Code чи Amp Code «cloud-агентами»: Phase 3 лише робить артефакти видимими в усіх трьох IDE через git (роадмап D10.4).
- Блокуючий гейт для local-сесій: локальний dirty-стан — warning, не помилка; commit-дисципліну local тримають наявні pre-commit gate-check і review-гейт.
- Автоматичний `git commit`/`git push` з CLI — команди виконує агент/користувач, CLI лише перевіряє результат.
- Усе з Phase 4: Control Plane, dashboard, sandbox, audit log, зовнішній runtime.
- Нові ролі пайплайна і нові субагенти (роадмап-спека прямо забороняє).

## Acceptance criteria

- Після `npx agent-orchestrator-kit handoff <name>` файл `handoff.md` містить секцію `## Runtime` з `runtime:` і `agent_id:`; `--runtime cloud` і `AOK_RUNTIME=cloud` дають `runtime: cloud`; без прапорця, env і маркерів — `runtime: local`.
- `handoff <name> --cloud-check` при `runtime: cloud` і незакомічених/untracked шляхах під `openspec/changes/<name>/` або незапушеній гілці завершується non-zero з переліком проблемних шляхів; при чистому стані і запушеній гілці — exit 0; при `runtime: local` той самий брудний стан дає warning і exit 0.
- Persist з `runtime: cloud` друкує в stderr кроки commit → push → `handoff <name> --cloud-check`; persist з `runtime: local` поведінку stdout-промпта не змінює.
- `archive <name>` пише фінальний `handoff.md` з секцією Runtime.
- Наявний `handoff.md` без секції Runtime не валить persist (exit 0, секція дописується).
- `session-handoff.mdc` містить правило git-tracked шляхів і cloud-кроки Session Exit; skill `agent-orchestration` і субагент `session-handoff` узгоджені з ним.
- `npm test` зелений; `npx openspec validate add-cloud-agent-handoff --strict` проходить; `npx agent-orchestrator-kit gate-check --tasks add-cloud-agent-handoff` exit 0.
