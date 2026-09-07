## Why

Spec review і повторний propose зараз дроблять дефекти: один знайдений баг → propose лише його → наступний review знаходить наступний → ще один propose. Tier 1 без LLM лишається прийнятим окремим циклом; проблема в Tier 2 (зупинка на першому blocking, перезапис `review.md`, приклад RC на 2 пункти) і в propose/guide (немає контракту punch list, будь-який non-APPROVE мапиться знову на `/opsx:review`).

Design: none

## What Changes

- **EXHAUSTIVE-T2.** Після проходження Tier 1 `spec-reviewer` MUST завершити повний LLM-чекліст і повний скан артефактів (proposal, design, tasks, усі delta specs, згадані main specs / шляхи репо) **до** запису вердикту. MUST NOT зупинятись на першому blocking. Один ✗ → `Verdict: REQUEST CHANGES`, але `review.md` MUST перелічити **кожне** blocking-знаходження цього проходу. Косметика лишається поза Required Before Apply.
- **REVIEW-MD-SCHEMA.** `review.md` на REQUEST CHANGES і на будь-якому повторному review MUST мати секції: Checklist (кожен пункт Tier 2 позначений ✓ або ✗), Findings з відрами Blocker / Major / Minor (порожні відра дозволені), Required Before Apply (лише blocking), Previous findings. Заголовок `Previous findings` ALWAYS присутній після будь-якого Tier 2 проходу. Якщо попереднього `review.md` не було — тіло є літеральним рядком `none — first review cycle`. Якщо був — кожен попередній пункт Required Before Apply з’являється як `resolved` | `unresolved` плюс однорядкове evidence.
- **RE-REVIEW-CLASS.** Пізніший `/opsx:review` MUST взяти попередній punch list як вхід, перенести його в Previous findings і MUST ще раз просканувати той самий клас дефекту — лише LLM-only класи, наприклад: інший таск, чий `Do:` не виконується без design.md; інша design-поведінка без вимоги в delta; інший drift proposal↔tasks; інший згаданий заголовок/шлях, якого немає. Класи Tier 1 (відсутня секція proposal, порожня підсекція delta, провал validate / task-contract) NEVER входять у same-class rescan Tier 2 і NEVER входять у propose-side same-class rescan. MUST NOT видати однопунктовий RC, який називає лише перший leftover.
- **PARENT-HEADING-CHECK.** Перед спавном `spec-reviewer` conductor MUST зафіксувати, чи існував `review.md`, і передати цей факт плюс шлях до файла в spawn-промпт. Після T2 conductor MUST відхилити REQUEST CHANGES, якщо немає обов’язкових заголовків або Checklist порожній, і MUST NOT переписувати файл. Відновлення: один повторний спавн `spec-reviewer` з причиною відхилення і списком обов’язкових заголовків; якщо другий файл знову неконформний — Session Exit з `## Blocked` (названі відсутні заголовки) і next command `/opsx:review <name>`. Відхилений файл не є прийнятим вердиктом.
- **NEXT-AFTER-RC.** Після прийнятого (schema-conforming) REQUEST CHANGES Session Exit next command SHALL бути `/opsx:propose <name>`, не одразу `/opsx:review`. NEXT-AFTER-RC застосовується лише до прийнятого RC. Після APPROVE лишається `/opsx:apply <name>`.
- **PUNCH-LIST-PROPOSE.** Повторний propose після REQUEST CHANGES: у `opsx-propose.md` і `openspec-propose/SKILL.md` conductor MUST передати `review.md` (шлях + вердикт + список Required Before Apply) у spawn-промпт `spec-architect` і перевірити, що звіт закриває кожен пункт; parent MUST NOT сам редагувати proposal/design/specs/tasks. У `spec-architect.md` architect MUST прочитати файл, виправити кожен Required Before Apply і повторно просканувати той самий LLM-only клас. Виняток: якщо `review.md` містить рядок `**Source:** gate-check` і немає `## Checklist` (T1-only), дозволений structure-only propose (лише помилки gate-check).
- **GUIDE-ROUTING.** `openspec-guide`: немає `review.md` → `/opsx:review`; `Verdict: REQUEST CHANGES` → `/opsx:propose`; `Verdict: APPROVE` і відкриті таски → `/opsx:apply`. Замінює сьогоднішнє «будь-який non-APPROVE → знову review». У шаблоні замінити лише рядок 18; рядок 19 лишається єдиною гілкою APPROVE→apply.
- **VUE-CHECKLIST-SPAWN.** Parent MUST вставити повний чекліст Tier 2 у spawn-промпт `spec-reviewer`, включно з пунктами Vue 3, коли `project.stack: vue3`.
- **HEALTH-METRIC.** Текст метрики: Spec review discovery loops ≤ 2 (опційний цикл T1 + один семантичний RC); у skill точна форма `Spec review discovery loops: ≤ 2` (з двокрапкою). Confirmation APPROVE після вичерпного propose не рахується discovery loop. Після RC skill каже: run `/opsx:propose <name>` to fix the punch list. Анти-патерн «one-finding review loop» у skill / AGENTS.md.
- Без **BREAKING** CLI, без нового прапорця «один finding», без змін `gate-check --review` / `runTier1Review`.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `tiered-review`: вичерпний скан Tier 2; схема `review.md` (Checklist / Findings / Required Before Apply / Previous findings завжди після T2); повнота re-review і той самий LLM-only клас дефекту (класи Tier 1 виключені); prompt-перевірка заголовків conductor-ом після T2 з одним re-spawn і blocked-exit; next command після прийнятого RC → propose; метрика discovery loops ≤ 2. Наявні вимоги T1-перед-LLM і apply-notes-on-APPROVE без змін семантики; сценарій «Падіння Tier 1 завершує review без LLM-читання» лишається; parent-запис T1 `review.md` є прийнятим винятком «parent MUST NOT писати вердикт».
- `pipeline-subagents`: інструкції `spec-reviewer` (вичерпний скан + схема + не зупинятись на першому blocking + читати існуючий `review.md` перед overwrite); parent вставляє чекліст Tier 2 (і Vue 3) у spawn-промпт і передає факт існування `review.md`; `spec-architect` / propose — punch list у spawn + rescan LLM-only класу, виняток T1-only за маркером `**Source:** gate-check`; маршрутизація `openspec-guide` RC → propose.

## Impact

- `templates/.agents/commands/opsx-review.md` — вичерпний T2, схема `review.md`, Previous findings, next_command propose після прийнятого RC, parent heading check після T2 з recovery, T1-маркер `**Source:** gate-check`, зберегти T1-без-LLM.
- `templates/.agents/subagents/spec-reviewer.md` — ті самі правила спеціаліста (джерело Amp wrapper); читати існуючий `review.md` перед overwrite.
- `templates/.agents/commands/opsx-propose.md`, `templates/.agents/subagents/spec-architect.md`, `templates/.agents/skills/openspec-propose/SKILL.md` — punch list + same-class rescan з розділеними суб’єктами; виняток T1-only за маркером.
- `templates/.agents/subagents/openspec-guide.md` — замінити лише рядок 18; рядок 19 лишається APPROVE→apply.
- `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/AGENTS.md` — метрика ≤ 2 і анти-патерн one-finding review loop.
- `test/smoke.test.js` — string-match на нові MUST-фрази в цих шаблонах; без гейта, що рахує findings.
- `CHANGELOG.md` `[Unreleased]` — user-visible зміна шаблонів review/propose/guide.
- Джерело істини — `templates/.agents/`; generated consumer copies і kit `.agents/` після sync не є окремими тасками. Main specs мержаться на archive. `task-contract` не змінюється.

## Non-goals

- Варіант C: спавнити семантичний LLM, коли падає Tier 1.
- Зміна `gate-check --review` / `runTier1Review` collect-all (вже збирає всі структурні помилки).
- Новий CLI-прапорець, що відхиляє «лише один семантичний finding» (недетерміновано).
- Вичерпний post-apply `code-reviewer`.
- UI / Figma / `design-brief.md`.
- Consumer-only патчі в vms-ext-frontend (лише kit templates + update/sync).
- Машинна квота «N findings обов’язково».
- Зміна спеки `task-contract` (контракт Files/Do/Done-when уже є; у propose лише речення про punch list).

## Acceptance criteria

1. **T1 лишається без LLM.** `templates/.agents/commands/opsx-review.md` досі вимагає: падіння `gate-check --review` → записати RC з помилками скрипта і точним рядком `**Source:** gate-check`, без секції `## Checklist`, **не** спавнити `spec-reviewer`, **не** читати артефакти. Це прийнятий виняток з «parent MUST NOT писати вердикт».
2. **T2 не зупиняється на першому blocking.** `opsx-review.md` і `spec-reviewer.md` містять MUST-фразу не зупинятись на першому blocking і завершити повний чекліст + скан артефактів до вердикту; один ✗ усе одно дає REQUEST CHANGES з повним списком blocking.
3. **Схема RC.** Обидва файли вимагають заголовки Checklist, Findings (Blocker / Major / Minor), Required Before Apply, Previous findings після будь-якого T2; якщо попереднього `review.md` не було — тіло Previous findings є `none — first review cycle`; косметика не в Required Before Apply.
4. **Re-review.** Обидва файли вимагають перенести попередній Required Before Apply в Previous findings (`resolved` | `unresolved` + evidence) і просканувати той самий LLM-only клас дефекту; класи Tier 1 NEVER у цьому rescan; забороняють однопунктовий RC лише з першим leftover. `spec-reviewer.md` вимагає прочитати існуючий `review.md` перед overwrite.
5. **Parent check після T2.** `opsx-review.md` вимагає: зафіксувати існування `review.md` до спавну; відхилити RC без обов’язкових заголовків або з порожнім Checklist; один re-spawn; другий неконформний файл → `## Blocked` і `/opsx:review <name>`; conductor не переписує `review.md`.
6. **Next command.** Після прийнятого (schema-conforming) RC next command у `opsx-review.md` — `/opsx:propose <name>` (NEXT-AFTER-RC не застосовується до відхиленого файла); після APPROVE — `/opsx:apply <name>`. Рядок «Fix the above, then re-run `/opsx:review`» як next command після RC відсутній.
7. **Vue чекліст у spawn.** `opsx-review.md` вимагає вставити повний чекліст Tier 2 (включно з Vue 3 при `project.stack: vue3`) у промпт `spec-reviewer` («paste the full Tier 2 checklist»).
8. **Propose punch list.** `opsx-propose.md` і `openspec-propose/SKILL.md` вимагають передати punch list у spawn і перевірити звіт, не редагуючи артефакти. `spec-architect.md` вимагає прочитати `review.md`, виправити весь Required Before Apply і rescan LLM-only класу. Structure-only propose дозволений лише коли файл має `**Source:** gate-check` і немає `## Checklist`.
9. **Guide routing.** `openspec-guide.md` мапить відсутній `review.md` → review, `Verdict: REQUEST CHANGES` → propose, `Verdict: APPROVE` + відкриті таски → apply; рядок 19 лишається єдиною гілкою APPROVE→apply; більше не мапить будь-який non-APPROVE на review.
10. **Метрика і анти-патерн.** `agent-orchestration/SKILL.md` має «Spec review discovery loops: ≤ 2» (не `≤ 1`) і пояснює, що confirmation APPROVE не є discovery loop; skill містить «run `/opsx:propose <name>` to fix the punch list»; skill і `templates/AGENTS.md` містять анти-патерн one-finding review loop.
11. **Smoke.** `test/smoke.test.js` асертить наявність цих MUST-фраз у перелічених шаблонах (у т.ч. `Verdict: REQUEST CHANGES` і `/opsx:propose` в одному рядку; regex метрики — форма skill з двокрапкою); немає асерта/гейта, що рахує кількість findings.
12. **CHANGELOG.** `[Unreleased]` описує вичерпний Tier 2 punch list і routing RC → propose.
