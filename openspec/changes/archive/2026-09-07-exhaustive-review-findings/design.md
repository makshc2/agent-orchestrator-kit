## Context

Kit уже має двоярусний review: Tier 1 — `gate-check --review` (validate, task-контракт, секції proposal, непорожні delta-секції); падіння завершує review без LLM. Tier 2 — ізольований `spec-reviewer` зі скороченим семантичним чеклістом. На APPROVE пишеться `apply-notes.md`.

На практиці семантичні баги виходять по одному. `opsx-review.md` дає приклад RC на 2 пункти і каже «Fix the above, then re-run `/opsx:review`». `review.md` перезаписується кожним проходом, тож попередній punch list зникає, якщо reviewer не переніс його сам. `spec-reviewer.md` не каже «не зупинятись на першому blocking». Propose/architect після RC мають лише «fix artifacts»; емпірично правлять перелічене («no other semantics changed»). `openspec-guide` мапить будь-який `review.md` без `Verdict: APPROVE` знову на `/opsx:review`. Чекліст Vue 3 живе лише в `opsx-review.md` і може не потрапити в ізольований spawn.

Це зміна **шаблонів і інструкцій**, не CLI. `gate-check --review` уже збирає всі структурні помилки. Немає детермінованого гейта «рівно N семантичних findings».

Design: none (немає UI).

## Goals / Non-Goals

**Goals:**
- Максимум **два discovery-цикли**: опційний T1 structural RC, потім один вичерпний семантичний RC.
- Confirmation review після вичерпного propose очікує APPROVE і **не** є третім discovery-циклом: він перечитує previous findings і той самий LLM-only клас дефекту, не зупиняється на першому leftover.
- T1 лишається без LLM; сценарій «Падіння Tier 1 завершує review без LLM-читання» не змінюється.
- Після будь-якого **прийнятого** (schema-conforming) RC next command — `/opsx:propose <name>` (NEXT-AFTER-RC не застосовується до відхиленого файла).

**Non-Goals:**
- Варіант C (спавнити семантичний LLM при падінні T1).
- Зміна `gate-check --review` / `runTier1Review`.
- CLI-прапорець проти «одного finding».
- Вичерпний post-apply `code-reviewer`.
- Квота «N findings обов’язково».
- Зміна спеки `task-contract`; consumer-only патчі у vms-ext-frontend.

## Decisions

1. **Двоциклова машина (не «поки є ✗»).**  
   - Цикл 1 (опційний): `/opsx:review` → T1 fail → parent пише `review.md` з помилками gate-check, точним рядком `**Source:** gate-check` і **без** секції `## Checklist`, **без** спавну `spec-reviewer` і **без** читання артефактів → Session Exit `/opsx:propose <name>`. Це прийнятий виняток з main-spec «parent MUST NOT сама писати вердикт». Propose MAY виправити **лише** ці структурні помилки.  
   - Цикл 2: `/opsx:review` → T1 pass → T2 вичерпний семантичний скан → один RC з повним punch list → `/opsx:propose <name>` виправляє **весь** Required Before Apply **і** той самий LLM-only клас дефекту в усіх артефактах.  
   - Далі confirmation `/opsx:review`: очікуваний вердикт APPROVE. Це перевірка, не новий drip. Якщо confirmation знову RC — це провал architect/reviewer (метрика > 2), не легальний третій discovery.  
   Альтернатива «кожен RC одразу знову review» відкинута: саме вона фрагментує баги. Варіант C відкинуто: T1 має лишатись дешевим і детермінованим.

2. **Чому T1 лишається без LLM.**  
   Структурні помилки вже collect-all у скрипті. Підключати `spec-reviewer` на зламаній валідації коштує токени і змішує «почини секції» з семантикою. Parent на T1 fail пише короткий RC з маркером `**Source:** gate-check` (без `## Checklist`) і йде в propose. Це прийнятий extra cycle і прийнятий виняток «parent пише вердикт».

3. **Як Previous findings переживає overwrite.**  
   `review.md` і далі один файл на change; наступний прохід його перезаписує. Спеціаліст **спочатку читає** наявний файл, потім пише новий Checklist / Findings / Required Before Apply / Previous findings. Немає append-only журналу і немає другого файла: це prompt-контракт, як `apply-notes.md`. На T1 fail parent **не** читає артефакти, тому T1-запис не зобов’язаний мати Previous findings і не має `## Checklist`. Обов’язок заголовка починається з будь-якого T2-проходу (правило — у Decision 4).

4. **Схема `review.md` обов’язкова після T2, не як новий CLI.**  
   Після T2 RC (і на confirmation) файл MUST мати заголовки Checklist, Findings (Blocker / Major / Minor; порожні відра дозволені), Required Before Apply, Previous findings. Заголовок `Previous findings` ALWAYS присутній після будь-якого Tier 2 проходу. Якщо попереднього `review.md` не було — тіло є літеральним рядком `none — first review cycle`. Якщо був — кожен попередній пункт Required Before Apply з’являється як `resolved` | `unresolved` плюс однорядкове evidence. Checklist MUST містити кожен пункт T2 з ✓ або ✗ і MUST NOT бути порожнім. Перед спавном conductor MUST зафіксувати, чи існував `review.md`, і передати цей факт плюс шлях до файла в spawn-промпт. Conductor перевіряє заголовки/порожній Checklist **промптом** і MUST NOT переписувати файл. Відновлення: один повторний спавн `spec-reviewer` з причиною відхилення і списком обов’язкових заголовків; якщо другий файл знову неконформний — Session Exit з `## Blocked` (названі відсутні заголовки) і next command `/opsx:review <name>`; відхилений файл не є прийнятим вердиктом, тож NEXT-AFTER-RC на нього не діє.  
   T1-запис лишається списком помилок gate-check з `**Source:** gate-check`: повний LLM-Checklist там немає, бо T2 не виконувався. Parent heading check «порожній Checklist» застосовується **після T2**, не до T1-RC.  
   Альтернатива «CLI парсить findings» відкинута: семантична повнота недетермінована; новий прапорець «відхилити один finding» неможливий без хибних спрацювань.

5. **Чому немає CLI «один finding».**  
   Кількість семантичних blocking не є оракулом якості: валідний change може мати нуль; поганий reviewer може вигадати десять. Єдиний перевірябельний контракт — «заверши чекліст і скан до вердикту» + схема секцій + same-class на re-review. Smoke-тести асертять наявність MUST-фраз у шаблонах, не лічильник findings.

6. **Виняток T1-only propose.**  
   Тригер structure-only propose: `review.md` має `Verdict: REQUEST CHANGES`, рядок `**Source:** gate-check` і немає `## Checklist`. Тоді виправити лише перелічені структурні помилки, не відкривати семантичний rescan. Інакше architect після першого T1 починав би «поліпшувати» спеки як T2, ламаючи цикл 1. Після T2 RC виняток **не** діє: треба весь punch list + той самий LLM-only клас дефекту. Conductor (`opsx-propose.md`, `openspec-propose/SKILL.md`) MUST передати `review.md` (шлях + вердикт + список Required Before Apply) у spawn і перевірити звіт; parent MUST NOT сам редагувати proposal/design/specs/tasks. Architect (`spec-architect.md`) MUST прочитати файл, виправити кожен пункт і зробити rescan.

7. **Vue 3 у spawn-промпті.**  
   Ізольований `spec-reviewer` не бачить тіло `opsx-review.md`, якщо parent не вставив чекліст. Parent MUST вставити повний T2-чекліст у spawn; пункти Vue 3 — коли `project.stack: vue3`. Джерело чекліста лишається `opsx-review.md`; `spec-reviewer.md` отримує ті самі правила вичерпності/схеми.

8. **Guide routing за вердиктом, не за «немає APPROVE».**  
   - немає `review.md` → `/opsx:review`  
   - `Verdict: REQUEST CHANGES` → `/opsx:propose`  
   - `Verdict: APPROVE` і є `- [ ]` → `/opsx:apply`  
   У `openspec-guide.md` замінити **лише** поточний рядок 18 (`proposal.md` exists but no `review.md` with `Verdict: APPROVE` → `/opsx:review`); рядок 19 лишається єдиною гілкою APPROVE→apply (перефразувати на `Verdict: APPROVE`). Старе правило зливало T1-RC, T2-RC і «ще не рев’юили» в один next command.

9. **Метрика.**  
   «Spec review loops: ≤ 1» замінюється на «Spec review discovery loops: ≤ 2» у skill (форма з двокрапкою; smoke regex MUST збігатися саме з нею) і «Spec review discovery loops ≤ 2» у `templates/AGENTS.md`. Confirmation APPROVE не рахується. Анти-патерн «one-finding review loop» у skill і `templates/AGENTS.md`. Після RC skill каже: run `/opsx:propose <name>` to fix the punch list.

## Risks / Trade-offs

- [Architect під час punch-list propose вносить нові баги] → Confirmation review MUST лишатись вичерпним: Previous findings + той самий LLM-only клас + повний чекліст. Це не третій drip: reviewer MUST NOT видати однопунктовий RC «перший leftover». Якщо confirmation знову RC — метрика провалена; правити знову через propose, не «ще один вузький review».
- [Overwrite `review.md` загубить історію, якщо Previous findings пропустять] → Заголовок `Previous findings` ALWAYS присутній після будь-якого Tier 2 проходу. Якщо попереднього `review.md` не було — тіло є літеральним рядком `none — first review cycle`. Якщо був — кожен попередній пункт Required Before Apply з’являється як `resolved` | `unresolved` плюс однорядкове evidence. Parent після T2 відхиляє файл без цього заголовка; один re-spawn, потім `## Blocked` і `/opsx:review <name>`.
- [T1 overwrite затирає попередній T2 punch list без Previous findings] → Прийнято: T1 parent не читає артефакти. Наступний T2 знову сканує повністю.
- [Рецензент формально заповнить схему, але пропустить клас] → Prompt-only; «same defect class» — лише LLM-only приклади (інший таск, чий `Do:` не виконується без design.md; інша design-поведінка без вимоги в delta; інший drift proposal↔tasks; інший згаданий заголовок/шлях, якого немає). Класи Tier 1 NEVER входять у same-class rescan Tier 2 і NEVER входять у propose-side rescan. Немає машинної квоти.
- [Консюмери зі старими командами] → `update` + `sync` підтягує `templates/.agents/`. Без міграції активних `review.md`.

## Migration Plan

1. Apply змінює лише шаблони в `templates/.agents/` (+ `templates/AGENTS.md`, `CHANGELOG.md`, smoke-асерти).  
2. Реліз kit; консюмери `npx agent-orchestrator-kit update` і `sync`.  
3. Rollback: попередня версія шаблонів; CLI-поведінка не змінюється.

## Open Questions

Немає. Рішення зациклені: два discovery-цикли, T1 без LLM, без CLI на «один finding», T1-only propose дозволений за маркером `**Source:** gate-check`.
