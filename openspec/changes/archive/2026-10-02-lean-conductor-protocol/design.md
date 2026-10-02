## Context

`runTier1Review` (`gate-check --review`) повертає `{pass, errors, warnings}`; warnings друкуються, exit не міняють. `parsePipelineConfig` — єдиний reader ключів `pipeline.*`; п'ять повнооб'єктних `deepEqual` у `test/gate-check-config-parser-and-src-glob.test.js` фіксують його форму. `parseReviewVerdict` бере перший збіг `Verdict:`. Схему `review.md` (спека `tiered-review`, `opsx-review.md` §5) перевіряє conductor-LLM. Факти: розміри 26 наявних changes; з 20 архівних `review.md` лише 3 мають заголовок `Previous findings`; `test/smoke.test.js` пінить фрази шаблонів.

## Goals / Non-Goals

**Goals:** попередження про завеликий change у Tier 1; детермінована перевірка `review.md`; тонкий conductor у propose; вужче читання спеціалістів.

**Non-Goals:** хуки, зміни handoff, зміна `--review --json`, `strict` за замовчуванням.

## Decisions

**D1. Що міряємо і пороги.** Байти (`statSync().size`) чотирьох груп: `proposal.md`, `design.md`, `tasks.md`, усі файли `listDeltaSpecFiles`. Два незалежні тригери, порівняння строге `>`: `tasks.md` > 60 000 B, сума > 150 000 B. Інші файли change (`review.md`, `apply-notes.md`) не рахуються. Калібрування за 26 changes: медіана суми ≈ 48 KB; найбільші 203 753 (R4), 189 427 (dedup-window), далі ≤ 125 018 (pregate 116 395). Поріг 150 KB ловить рівно два дорогі; `tasks.md` > 60 KB лише в R4 (102 718 B, наступний 40 679 B). Уточнення порогів за наступними ledger-ами — окремий крок.

**D2. Ключ і режими.** `pipeline.artifact_budget: warn|strict|off` читає `parsePipelineConfig` (поле `artifactBudget`; відсутнє чи невідоме значення дає `warn`; legacy-reader бере ключ так само). `artifactBudgetMode(projectDir)` — як `taskContractMode`: без `.agents/orchestrator.yaml` це `warn`. У `runTier1Review`: `off` — вимірювання не виконується; `warn` — рядки в `warnings`; `strict` — в `errors` (отже `pass: false`, exit 1). `templates/orchestrator.yaml` отримує ключ; профілі не чіпаємо (відсутній ключ = `warn`). Нове поле ламає 5 повнооб'єктних `deepEqual`, тому вони оновлюються в тому ж таску (`artifactBudget: 'warn'`).

**D3. JSON не міняємо.** Питання про `warnings` у `--review --json` закрито «ні»: warnings task-контракту теж не в JSON, споживача немає; у `strict` бюджет і так в `errors`.

**D4. `checkReviewMd(changeDir)` — чиста функція плюс CLI-обгортка.** Повертає `{pass, errors}` і експортується: контракт-тест читає архівні каталоги (`openspec/changes/archive/<dir>`), яких CLI за іменем не знайде. `runReviewMd(projectDir, name)` перевіряє ім'я (`isSafeChangeName`) і каталог; режим друкує як `--review`, `--json` дає `{pass, errors}`. Правила — у вимозі «review.md schema gate».

**D5. Толерантність (ризик хибних відмов).** Перевіряється лише обов'язкове: заголовок = `^#{1,6}\s*<Name>\b` без регістру і з довільним рівнем (`Checklist summary` приймається), відро = заголовок або `**Blocker**`, вердикт може мати суфікс (`APPROVE ✓`), зайві секції ігноруються. Лічильник `Verdict:` бере ту саму регулярку, що `parseReviewVerdict` (спільна константа `REVIEW_VERDICT_LINE`): другий збіг — помилка, бо `status` і `archive` читають перший. Tier 1 запис = рядок точно `**Source:** gate-check` і відсутній заголовок Checklist (так само в `opsx-propose.md` і спеці): файл пише conductor із виводу скрипта, не LLM, тож лишається лише вердикт RC.

**D6. Контракт над архівом із явним списком винятків.** Проходять 3 з 20 архівних `review.md` (exhaustive-review-findings, pregate, archive-from-terminal). Решта 17 передують схемі: усі без `Previous findings`, 5 найстаріших ще й без `apply-notes.md`, add-factory-gates-and-mcp має `apply-notes.md` на 24 рядки. Виняток — явний масив із 17 імен у `test/review-md-gate.test.js`: не дата-відсічка (fix-metrics-dedup-window має ту саму дату 2026-09-07, що exhaustive-review-findings, але без схеми) і не правило «без Previous findings» (воно звільнило б і майбутні файли).

**D7. Протокол conductor-а — текст.** Один абзац «Thin conductor» у `opsx-propose.md` і SKILL.md, байт-ідентичний (один таск, тест порівнює). Піни: `MUST NOT research the repo`, `at most 5 tool calls`, `at most 3 tool calls`, `brief PATH`, `MUST NOT re-read the artifacts`. Червоний гейт додає лише re-spawn і повторний gate. Без brief-файлу conductor передає опис користувача дослівно. На re-propose після RC він читає й `review.md` (шлях, вердикт, Required Before Apply) у тих самих 5 викликах і передає їх: вимога про punch list лишається чинною, ADDED її доповнює. Речення про передачу попередження `artifact budget` дописується в кінець кроку 6; піни `Tier 1 pre-gate`, `exit 0 is forbidden`, `If the pre-gate still fails after the one re-spawn…` не чіпаємо.

**D8. `opsx-review.md` і `spec-reviewer.md`.** Два сусідні абзаци кроку 5 («The conductor verifies…» і «After Tier 2, the conductor MUST reject…») замінюються одним: MUST звірити `Verdict:` зі звітом і запустити `gate-check --review-md <name>`; exit ≠ 0 — відхилення без переписування, один re-spawn зі списком помилок і обов'язкових заголовків, далі `## Blocked` і next `/opsx:review <name>`; T1 запис не перевіряється. `spec-reviewer.md` отримує правило писати `review.md` так, щоб скрипт пройшов; APPROVE-приклад `opsx-review.md` отримує `## Previous findings` (інакше зразок не проходить скрипт). Наявна вимога «Перевірка заголовків conductor-ом після Tier 2» лишається істинною (скрипт і є перевіркою), тому ADDED, не MODIFIED.

**D9. Правила читання спеціалістів.** Однаковий пункт у «Rules» обох файлів: main specs за заголовками (`grep -n '^### Requirement:'`) і лише вимоги, яких торкається delta чи з якими вона може конфліктувати; інші файли > 20 KB діапазонами (якір ± 40 рядків); файли change (артефакти, наявний `review.md`) повністю, раз: скан Tier 2 цього вимагає; без повторних читань; незалежні читання одним викликом. `spec-architect.md` додатково: `artifact budget` не приховувати: у `warn` — у `**Risks:**` з пропозицією нарізки, у `strict` — `**Status:** blocked` з нею в `**Risks:**` (виняток із кроку 6: нарізка є рішенням про scope).

**D10. Місце в специфікаціях.** `--review-md` і ключ `artifact_budget` — в ADDED вимогах `tiered-review`, де вже специфіковано `gate-check --review`; вимога «CLI команда gate-check» перелічує п'ять інших ключів `pipeline.*`, тож правила reader-а для нового ключа задає та сама вимога бюджету (як `archive_after_merge` має власну), без MODIFIED. Заголовки ADDED перевірено grep за main specs: колізій немає.

## Risks / Trade-offs

- Текстове правило D7 не гарантує поведінку: міряти ходи parent до і після спавну на наступних 2–3 змінах; якщо не тримається — хуки в окремому зрізі.
- Пороги стартові, `warn` за замовчуванням: хибне спрацювання коштує рядок у виводі.
- `--review-md` занадто суворий → хибні відмови блокують review-цикл: пом'якшення D5, один re-spawn, потім `## Blocked`.
- Контракт-тест упаде на майбутньому архівному `review.md` поза схемою: свідомий сигнал (виправити файл або додати виняток).
