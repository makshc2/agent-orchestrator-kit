## Why

Споживацький change (11 тасків, 4 delta specs) пройшов два цикли REQUEST CHANGES. Другий RC знайшов таск, чий `Do:` («обгорнути всі три присвоєння `journalRows.value` у `applyOverlay`») суперечив його `Done-when:` (порожній `grep -v applyOverlay`, «рівно два» місця `applyOverlay`), непідтверджені твердження про код («blacklist-перевірка відсутня», хоча вона існувала) та Major/Minor пункти, яким не потрібен новий propose. Кожен зайвий цикл propose → review коштує двох сесій. Мета: менше циклів без зниження якості специфікації.

## What Changes

- **Самоперевірка architect** перед звітом (три пункти) і новий рядок звіту `**Self-check:** done | not applicable`; правило «Read narrowly» більше не забороняє читання для верифікації. Нового Tier 1 лінту немає.
- **Менше крихких grep** у `Done-when:`: поведінкові умови, `grep` лише для нечислової наявності/відсутності, «рівно N» заборонено без обґрунтування; пара good/bad у чотирьох місцях.
- **Покроковий прохід reviewer**: блок `## Task verdicts` у `review.md` (авторство обов'язкове, скрипт його не вимагає), повний список blockers за один прохід, порядок повторного review (спершу Previous findings, потім повний наявний чекліст Tier 2 і скан тих самих класів дефекту).
- **Blocker проти решти**: `Required Before Apply` для невиконуваного таску, конфліктів із main specs чи Non-goals, суттєвих суперечностей між proposal/design/tasks/delta і поведінки design без покриття; нова необов'язкова секція `## Fix During Apply`, яку виконавець apply виправляє без нового propose; `checkReviewMd` відхиляє порожню секцію.
- **Fast-fix (вимкнено за замовчуванням)**: `pipeline.review_fast_fix: off|on`, парситься як `reviewFastFix` (лише точне `on`, також у legacy-читачі). Лише для прийнятого Tier 2 RC (Tier 1 запис непридатний) з 1–2 локальними blockers; architect править `tasks.md` і оновлює `apply-notes.md`; після `gate-check --review` exit 0 і явного підтвердження користувача conductor переписує Verdict на `APPROVE (fast-fix, approved by user)`, додає `## Fast-fix`, перевіряє `--review-md`, next command `/opsx:apply`. Шаблони propose і orchestration узгоджені з цим маршрутом.
- **Підказка розміру**: понад 8 тасків або 4 і більше delta specs, architect пропонує розбиття в `**Risks:**`, не блокує.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `task-contract`: MODIFIED «Якість Done-when у контракті тасків»; ADDED самоперевірка architect, підказка розміру.
- `tiered-review`: ADDED `Task verdicts`, порядок re-review, визначення blocker, `Fix During Apply` (+ `checkReviewMd`), `review_fast_fix` і життєвий цикл fast-fix.

## Impact

`bin/agent-orchestrator.js` (`parsePipelineConfig`, `parsePipelineLegacy`, `checkReviewMd`), `templates/.agents/{subagents,commands,skills}` (зокрема `agent-orchestration`), `templates/orchestrator.yaml`, `profiles/*/orchestrator.yaml`, `templates/openspec-config.yaml.example` і копії профілів `mvp`, `vue3`, тести, README, CHANGELOG `[Unreleased]`. Споживацькі проєкти не чіпаємо.

## Non-goals

- Нового детермінованого Tier 1 лінту якості `Done-when:`; зміни виводу `gate-check --tasks`.
- Нових класів чекліста review.
- Зміни формату `handoff.md`, NEXT-AFTER-RC для прийнятого RC, T1-запису `**Source:** gate-check`.
- Зміни гейтів apply/archive і читачів вердикту (вони вже приймають `APPROVE (fast-fix, approved by user)`); зміни схеми Tier 1 запису, який лишається несумісним з APPROVE; зміни поведінки при `review_fast_fix: off`.
- Змін у споживацьких проєктах, publish, push, tag, bump `package.json`.

## Acceptance criteria

1. Шаблони architect (агент, команда propose, SKILL) містять самоперевірку з трьох пунктів, рядок `**Self-check:**` у контракті звіту, правила Done-when з прикладами good/bad і підказку розміру 8 / 4.
2. `rules.tasks` у `templates/openspec-config.yaml.example` і копіях `mvp`, `vue3` містять нове правило Done-when.
3. `spec-reviewer` і `opsx-review` вимагають `## Task verdicts` та описують `## Fix During Apply`, повний чекліст при повторному review і blockers, що включають суперечності та відсутнє покриття; `opsx-apply` і SKILL apply доручають виконавцю виправляти пункти Fix During Apply.
4. `checkReviewMd` приймає review.md без `Fix During Apply` і з непорожньою секцією та повертає помилку на порожній; `--review-md` не вимагає `Task verdicts`.
5. `parsePipelineConfig` повертає `reviewFastFix: true` лише для точного `on` (також без блока `pipeline:`, зокрема `onion` дає `false`) і `false` за замовчуванням та для некоректних значень; кожен `orchestrator.yaml` (шаблон і профілі) має `review_fast_fix: off`.
6. `opsx-propose`, SKILL propose, `spec-architect` і `agent-orchestration` описують повний життєвий цикл fast-fix (придатність, межі architect, підтвердження, відмова, збій перевірки, маршрут `/opsx:apply`), а фікстури тестів показують: прийнятий Tier 2 RC після переписування проходить `--review-md`, Tier 1 запис ні.
7. Правила Done-when і обидва приклади good/bad є у всіх трьох конфіг-шаблонах (шаблон і копії `mvp`, `vue3`).
8. Поведінка гейтів apply/archive при `off` не змінена; `npm test` і `npm pack --dry-run` проходять.
