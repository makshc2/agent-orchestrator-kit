## Context

Tier 1 review (`gate-check --review`, `runTier1Review` у `bin/agent-orchestrator.js`) детерміновано перевіряє `openspec validate --strict`, task-контракт-лінт, заголовки `Non-goals` / `Acceptance criteria` у proposal.md (regex `/^#{2,}\s*Non-goals\b/im`, `/^#{2,}\s*Acceptance criteria\b/im`) і непорожні delta-секції. Сьогодні в pipeline його запускає лише `/opsx:review` (ще `openspec-guide` відтворює його локально, коли падає CI gate). Крок 6 у `opsx-propose.md` / `openspec-propose/SKILL.md` запускає тільки `npx openspec status --change "<name>"`; strict validation згадана лише в реченні «**Conductor delegation is mandatory:** …» («it may only verify files, run status, and run strict validation»). Розділ `### propose → review` у `agent-orchestration/SKILL.md` вимагає validate + status.

Наслідок у consumer-change `my-work-pf-absences`: review cycle 1 = Tier 1 RC лише через відсутній `## Acceptance criteria`; cycle 2 = Tier 2 RC через три дефекти Done-when (B1: `grep` «рівно 1 рядок», хоча `Do:` приписує 2 такі рядки; M1: літерал версії `v: '15.191'`; M2: застарілий якір дати і Done-when, що перевіряє лише відсутність старого значення).

Корінь проблеми з секціями: upstream-шаблон proposal OpenSpec 1.4.1 має лише `## Why`, `## What Changes`, `## Capabilities`, `## Impact`. Правило «Non-goals + Acceptance criteria» живе тільки в `profiles/vue3/` і `profiles/mvp/openspec-config.yaml.example`. Для `node` / `generic` `resolveTemplate('openspec-config.yaml.example', profile)` відкочується на `templates/openspec-config.yaml.example`, якого немає, і `installOpenspecConfigExample` мовчки повертається. До того ж OpenSpec 1.4.1 відкидає rules артефакта, якщо хоч один пункт не є рядком (`z.array(z.string())`): у vue3/mvp пункти з `": "` без лапок парсяться як map, тож ці rules ніколи не доходили до архітектора.

`spec-architect.md` не згадує обов’язкові секції proposal, не має правил якості Done-when, а крок 6 каже лише «Report which validation command the conductor should run».

Це зміна шаблонів, документації й тестів. Код CLI не змінюється.

## Goals / Non-Goals

**Goals:**
- Структурні дефекти (класи Tier 1) ловляться і виправляються в тій самій propose-сесії; `/opsx:review` отримує change, що вже проходить Tier 1.
- `spec-architect` знає обов’язкові заголовки proposal незалежно від `openspec/config.yaml`.
- Три типові дефекти Done-when описані як явні правила для architect.
- `init --profile node|generic` ставить робочий (такий, що парситься OpenSpec) `openspec/config.yaml.example`.

**Non-Goals:**
- Зміни логіки чи regex `gate-check --review` / `runTier1Review`; будь-які зміни `bin/agent-orchestrator.js`.
- Зміна метрики `Spec review discovery loops: ≤ 2`.
- Зміни `opsx-review.md`, `spec-reviewer.md`, `opsx-quick.md` і поведінки `/opsx:quick`: спільний `spec-architect.md` обмежує self-check Tier 1 spawn-ами з `/opsx:propose` (B2a).
- Автоміграція наявних `openspec/config.yaml`; детермінований лінт якості Done-when.
- Виправлення YAML-лапок у `profiles/vue3/` і `profiles/mvp/`.
- Bump версії, release, `npm publish`.

## Decisions

### A. Tier 1 pre-gate на propose

**A1. Pre-gate запускає conductor.** Після звіту `spec-architect` conductor сам запускає `npx agent-orchestrator-kit gate-check --review <name>`. Рядок `**Gate:**` у звіті architect (рішення B) його не замінює: це самозвіт спеціаліста, а conductor перевіряє результат, як уже перевіряє шляхи й `Status: done`. Подвійний запуск коштує секунди.
Альтернатива «довіряти `**Gate:**`» відкинута: звіт може бути застарілим або неточним.

**A2. Один re-spawn, потім `## Blocked`.** Exit ≠ 0 → conductor один раз переспавнює `spec-architect` з повним списком помилок gate-check (targeted fix) і запускає gate-check знову. Якщо exit усе ще ≠ 0 → Session Exit з `## Blocked`, де перелічені помилки, що лишились, і next command `/opsx:propose <name>`. Шаблон повторює прийнятий патерн tiered-review «Перевірка заголовків conductor-ом після Tier 2»: один re-spawn, потім Blocked. Next command — propose, а не review, бо дефект у артефактах, а review на провальному Tier 1 лише записав би T1 RC і повернув у propose. Handoff на `/opsx:review` без exit 0 заборонений. Conductor не виправляє артефакти сам (main spec pipeline-subagents).
Альтернатива «цикл до зеленого» відкинута: без межі сесія може зациклитись.

**A3. Однаково для всіх видів propose.** Правило діє для першого propose, re-propose після Tier 2 RC і structure-only re-propose після T1-only RC (маркер `**Source:** gate-check` без `## Checklist`). Structure-only прохід якраз виправляє помилки Tier 1, тож pre-gate — його природна перевірка.

**A4. Крок 6 запускає status + gate-check, без окремого validate.** `runTier1Review` уже запускає `npx openspec validate <name> --strict --type change`. Окремий рядок validate у кроці 6 дублював би цю перевірку. У `### propose → review` skill рядок validate лишається (це чекліст виходу), а поруч додається рядок gate-check.

**A5. Сумісність з main specs.**
- tiered-review «Скриптовий Tier 1 перед LLM-review»: `/opsx:review` і далі MUST запускати Tier 1 до читання артефактів LLM-ом. Pre-gate додає ще один запуск раніше і нічого не знімає: між сесіями артефакти можуть змінитись, а CI теж запускає gate-check. `opsx-review.md` не змінюється.
- tiered-review «Метрика discovery loops не більше двох»: рядок `Spec review discovery loops: ≤ 2 (...)` не змінюється (smoke його асертить). Очікувано T1 structural RC стане рідкісним, але зниження цілі — окреме рішення після статистики.
- tiered-review «Next command після REQUEST CHANGES є propose»: Blocked-вихід propose теж веде в `/opsx:propose <name>`, тож маршрутизація узгоджена.
- pipeline-subagents «openspec-guide маршрутизує REQUEST CHANGES на propose»: вона мапить «є `proposal.md`, немає `review.md`» на `/opsx:review <name>`. Після Blocked-виходу propose change саме в цьому стані, і guide радив би review-сесію, яка лише запише T1 RC і поверне в propose, тобто ту втрату, яку прибирає цей change. Guide не читає `handoff.md`, тож Blocked він не бачить. Delta містить MODIFIED цієї вимоги: у цьому стані guide запускає read-only `gate-check --review <name>` (крок 5 guide уже відтворює gate-check локально) і радить `/opsx:review <name>` лише при exit 0, а при exit ≠ 0 — `/opsx:propose <name>` з цитатою помилок. Пункт кроку 4 «`proposal.md` exists but no `review.md`» у `openspec-guide.md` змінює таск 1.8, smoke асертить обидві гілки. Переписаний текст вимоги посилається на пункти guide за змістом, а не за номерами рядків: успадковане з main spec «замінити лише поточний рядок 18; рядок 19 лишається єдиною гілкою APPROVE→apply» вже хибне (у поточному файлі APPROVE→apply — наступний пункт після REQUEST CHANGES) і після archive закріпило б мінливий номер рядка в main spec.
  Альтернатива «читати `## Blocked` з `handoff.md`» відкинута: handoff може бути застарілим, а gate-check детермінований і не залежить від того, як закрилась сесія.
- Повідомлення CLI apply-gate «Run /opsx:review <name> and get an explicit APPROVE before apply/merge» (`bin/`) стосується змін `src/` без APPROVE, а не маршрутизації propose, тож конфлікту немає; `bin/` не змінюється.
- Вивід gate-check при успіху — `Tier 1 review passed — proceed to spec-reviewer (Tier 2)`. У propose-сесії цей текст трохи не на місці, але зміна логіки чи виводу CLI — non-goal. Шаблони кажуть, що next command після exit 0 є `/opsx:review <name>`.

**A6. Конфлікт із pipeline-subagents «MAY лише прогнати validate».** Сценарій «Propose не пише артефакти в батькові» вимоги `Conductor must delegate specialist work` каже: «після звіту conductor MAY лише прогнати `npx openspec validate <name> --strict --type change`». Шаблони вже запускають і `openspec status`; тепер додаються pre-gate і один re-spawn. Delta містить MODIFIED цієї вимоги: повний текст скопійовано, змінено лише цей рядок сценарію, додано рядок про заборону самому виправляти помилки gate-check.
Альтернатива «речення про прийнятий виняток» (як у tiered-review «Схема review.md на REQUEST CHANGES і повторному review») відкинута: після archive main spec лишився б із двома суперечливими формулюваннями дозволених дій conductor-а.

**A7. Де живе текст Blocked-виходу.** `openspec-propose/SKILL.md` не має секції Session Exit, тому повне правило (re-spawn, Blocked, заборона handoff) стоїть у кроці 6, однаковому в обох файлах. У `opsx-propose.md` секція Session Exit отримує одне propose-специфічне речення про перший рядок промпта. Це не дублює канонічний протокол `.agents/rules/session-handoff.mdc` (session-handoff «Спільні Session Start/Exit блоки живуть в одному rule»). Речення «**Conductor delegation is mandatory:** …» про дозволені дії parent розширюється на pre-gate і один re-spawn. Рядок Output «All artifacts created and validated!» отримує «Tier 1 pre-gate passed», а рядок Output «Prompt: "Run `/opsx:review <name>` in a fresh session."» стає умовним: лише після exit 0, інакше `## Blocked` з помилками і `/opsx:propose <name>` замість цього рядка і рядка What's ready. У skill без Session Exit цей Prompt — єдиний текст next command поза кроком 6, тож безумовний він суперечив би Blocked-виходу. Рядок `**Gate:**` у кроці 6 названо інформаційним: будь-яке його значення (зокрема `not run` чи відсутній рядок) не скасовує запуску conductor-ом. Новий крок 6 замінює старий лише до закриття його bash-блоку: порожній рядок перед `**Output**` лишається, інакше за CommonMark `**Output**` став би ледачим продовженням пункту 6 списку.

**A8. Інші шаблони з умовами виходу propose.**
- `agent-orchestration/SKILL.md`: `### propose → review` (рядок gate-check у bash-блоці + окремий абзац про re-spawn / Blocked після примітки «(Use `npx` / `npm run` …)», відокремлений порожніми рядками) і пункт Orchestration Checklist.
- `templates/AGENTS.md`: рядок «Quality gates:». Бюджет < 4000 символів; зараз 2767, додається близько 150.
- `templates/CLAUDE.md`: рядок «Lean delegation:» описує гейти («Review is two-tiered: `gate-check --review` (deterministic) before `spec-reviewer`; `gate-check --tasks` lints…»), тому додається одне речення про pre-gate propose.
- `openspec-howto/SKILL.md`: рядок `- /opsx:propose → потім status, validate` доповнюється gate-check.
- README Role 2 **Exit gate:**: доповнюється рядком gate-check.
- `templates/.agents/subagents/openspec-guide.md`: гілка «`proposal.md` exists but no `review.md`» розгалужується за exit code `gate-check --review` (A5).

Не змінюються:
- `opsx-review.md`, `spec-reviewer.md`, `opsx-quick.md` — non-goals.
- `templates/.agents/rules/agent-orchestration.mdc` — лише маршрутизація; бюджет always-apply правил має запас 487 символів.
- Ключ `handoff.propose_to_review: validate_strict` у `templates/orchestrator.yaml` і профілях `node` / `vue3` / `generic`. Його не читає жоден код: `grep -rn propose_to_review bin/ test/` порожній. `update` копіює лише `KIT_MANAGED_PATHS` (commands, rules, subagents, skills, sync script) і ніколи не перезаписує `orchestrator.yaml`, а `init` пропускає наявний, тож зміна значення в шаблонах зачепила б лише нові init і consumer-конфіги не чіпала б. Ключ лишається як є, бо він лише описовий, а `validate_strict` і далі є частиною виходу (Tier 1 запускає `openspec validate --strict`). Проте він більше не описує повний gate. Перейменування (наприклад, на `tier1_pregate`) з правкою шаблону і трьох профілів винесено в Open Questions, бо воно не впливає на поведінку й лише розширило б обсяг.

### B. spec-architect знає обов’язкові секції і звітує Tier 1

**B1. Форма заголовків.** `## Non-goals` і `## Acceptance criteria`: англійською, рівень 2, з колонки 0. Regex Tier 1 приймає рівень ≥ 2 і будь-який регістр. Він відкидає `#` рівня 1, відступ, `**Non-goals**`, переклад (`## Не-цілі`, `## Критерії приймання (Acceptance criteria)`) і `## Goals / Non-Goals`. Канонічна форма вже є в архівному `exhaustive-review-findings/proposal.md`. Інструкція каже «навіть коли шаблон схеми чи `openspec/config.yaml` їх не згадує», бо upstream-шаблон proposal їх не має.

**B2. Architect сам запускає gate-check.** Перед звітом architect, заспавнений з `/opsx:propose` (про `/opsx:quick` див. B2a), запускає `npx agent-orchestrator-kit gate-check --review <name>` (read-only: validate, lint, читання файлів), виправляє помилки в межах `openspec/changes/<name>/`, повторює запуск і пише фінальний exit code у звіт рядком `**Gate:** gate-check --review exit <code>`. Це детермінована перевірка без вердикту, тож правило «Do NOT approve or review your own artifacts» не порушується. Жоден код не парсить `## Subagent report:`, тож новий рядок контракту безпечний. Amp wrapper `subagent-spec-architect` генерується з цього файла при `init` / `update`.

**B2a. `/opsx:quick` не отримує self-check.** `opsx-quick.md` теж спавнить `spec-architect`, але з легким обсягом («proposal.md — problem, scope, non-goals (5–10 lines)», «Skip `specs/` delta for MVP») і без фази review. Безумовне «run gate-check, fix every error» змусило б quick-архітектора додавати delta specs і повний task contract, тобто непрямо змінило б `/opsx:quick` через спільний файл субагента, хоча це non-goal. Тому крок 6 `spec-architect.md` обмежує self-check spawn-ами з `/opsx:propose`, а під `/opsx:quick` architect пише `**Gate:** not run (/opsx:quick)`. Architect ізольований і бачить лише spawn-промпт; крок 2 propose («Spawn `spec-architect` with a self-contained prompt») не вимагає називати команду, а `opsx-quick.md` (незмінний) каже лише «with the quick-mode scope». Тому правило має default: spawn, чий промпт не згадує `/opsx:quick` чи quick-mode scope, є spawn-ом з `/opsx:propose`. Помилка в бік propose безпечна (зайвий read-only self-check), а quick завжди передає quick-mode scope. Альтернатива «вимагати в кроці 2 propose назву команди в spawn-промпті» відкинута як друга правка тих самих файлів без виграшу: default закриває і старі промпти. Вимога заголовків `## Non-goals` і `## Acceptance criteria` (B1) діє для кожного spawn, зокрема quick: це два короткі заголовки, і quick-change пройде Tier 1 за цим класом, якщо його згодом переведуть у повний pipeline. Conductor-ський pre-gate (A) живе лише в `opsx-propose.md` / `openspec-propose/SKILL.md`, тож quick його не отримує.
Альтернатива «quick свідомо успадковує self-check» відкинута: вона суперечила б «Skip `specs/` delta for MVP» у незмінному `opsx-quick.md`.

**B3. Розміщення без перенумерації.** Нові речення доповнюють наявні кроки 2 (заголовки), 4 (Done-when) і 6 (gate + звіт). Крок 5 з багаторядковим винятком `**Source:** gate-check` лишається як є: його асертить smoke.

### C. Якість Done-when (текстові правила, без лінту)

**C1. Три правила однаковими англійськими реченнями.**
1. «Done-when checks that the new state is present, not only that the old state is gone.»
2. «A quantitative `Done-when:` check (`grep -c`, "exactly N lines") must be consistent with the code or text that `Do:` of the same task prescribes.»
3. «Do not hardcode volatile repo values (current version number, dates, "top entry"); describe them as the current value plus a rule evaluated at apply time.»

Ключові фрази «new state is present», «consistent with the code» і «volatile repo values» є якорями smoke-тесту.

**C2. Розміщення.**
- Блок Task contract у `opsx-propose.md` / `openspec-propose/SKILL.md`: conductor передає його в spawn.
- `spec-architect.md`, крок 4: ізольований спеціаліст читає свій файл.
- `rules.tasks` у новому config template: доходить через `openspec instructions tasks`.

Детермінований лінт відкинуто (non-goal): узгодженість кількості в `grep -c` з кодом у `Do:` і «мінливість» значення не визначаються regex-ом без хибних спрацювань.

**C3. Застереження pipeline-subagents «спека `task-contract` не змінюється».** Це речення завершує вимогу «Повторний propose після REQUEST CHANGES бере повний punch list». Воно прийшло з change `exhaustive-review-findings`, де «Зміна спеки task-contract» була non-goal, тобто описувало обсяг того change, а не вічну заборону. Проте після archive цього change буквальне читання суперечило б новим ADDED-вимогам task-contract. Тому delta містить MODIFIED цієї вимоги: повний текст скопійовано, а речення змінено на «ця вимога сама не змінює спеку `task-contract`; правила якості Done-when і обов’язкових заголовків proposal задають окремі вимоги `task-contract`». Решта тексту і сценарії без змін.

### D. Стек-нейтральний openspec config для node/generic

**D1. Розташування.** Новий `templates/openspec-config.yaml.example`. `resolveTemplate` бере профільний файл, якщо він є (vue3, mvp), інакше `templates/`. Отже `init --profile node|generic` поставить `openspec/config.yaml.example` без змін коду, а vue3/mvp поводяться як раніше. `package.json` `"files"` містить `"templates/"`, тож файл потрапить у npm. Жоден інший код не копіює файли з кореня `templates/` (лише явні шляхи).

**D2. Мова template — англійська.**
- `init --lang` за замовчуванням `en`.
- Файли кореня `templates/` (`AGENTS.md`, `CLAUDE.md`, `orchestrator.yaml`) англійські.
- `generic` / `node` — стек-нейтральна, не лише україномовна аудиторія.
- Обов’язкові заголовки мусять бути англійськими за будь-якої мови, бо regex Tier 1 англійський.

Мову прози артефактів задає `{{LANG}}` у `context` і перше правило `rules.proposal`. Профілі vue3/mvp лишаються українськими: це стеки автора і вони поза обсягом.

**D3. YAML-безпека.** Кожен пункт під `rules:` є рядком у подвійних лапках. Неекранований `": "` робить пункт map-ом, і тоді OpenSpec 1.4.1 відкидає всі rules артефакта з попередженням `Rules for '<id>' must be an array of strings`. Неекранований `" #"` YAML читає як початок коментаря: правило мовчки обрізається, а список лишається (перевірено: `- Use issue #42 style refs` дає правило `Use issue` без жодного попередження). Текст таску 2.1 і README-нотатки R1 описує обидва ефекти саме так. Цю форму перевірено в scratch-проєкті: `openspec instructions proposal|tasks|specs --json` віддав усі rules без попереджень. Smoke асертить, що кожен пункт під `rules:` починається з `- "`. Виправлення vue3/mvp — окремий change (non-goal): воно змінить поведінку наявних профілів, бо rules раптом почнуть діяти.

**D4. Наявний `openspec/config.yaml`.**
- `init` без `--force`: `installOpenspecConfigExample` логує `skip (exists): openspec/config.yaml` і не пише ні config, ні example.
- `update` / `sync` цю функцію не викликають.
- `init --force` перезаписує `openspec/config.yaml`. Це задокументована семантика прапорця («Overwrite existing files»), так само для vue3/mvp. Це явна дія користувача, а не автоміграція, і вона узгоджена з non-goal. README-нотатка про це попереджає.
- Для наявних проєктів лише ручне правило: README «## Update» (після переліку «never overwrites», перед `### Upgrading an existing project to v0.1.7`) і `CHANGELOG.md` `[Unreleased]`.

**D5. Обмеження порядку Quickstart.** README Quickstart спершу запускає `npx openspec init`, який створює `openspec/config.yaml`. Тоді `init` kit-а пропускає example (так само сьогодні для vue3). Для таких користувачів D нічого не ставить: їх покривають рішення B і A (architect знає заголовки, pre-gate ловить пропуск) і README-нотатка. Запис example поруч із наявним config потребує зміни коду й винесений у Open Questions.

## Risks / Trade-offs

- [Pre-gate подовжує propose-сесію на один запуск gate-check (і re-spawn при провалі)] → Це дешевше за окрему review-сесію плюс structure-only propose. Re-spawn обмежено одним.
- [Architect звітує `**Gate:** … exit 0`, а conductor отримує ≠ 0 (гонка, змінене дерево)] → Обов’язковий запуск conductor-ом (A1) вирішує.
- [Текст CLI «proceed to spec-reviewer (Tier 2)» у propose-сесії плутає] → Шаблони прямо називають next command `/opsx:review <name>`. Зміна CLI — non-goal.
- [Правила C лише текстові, architect може їх проігнорувати] → Вони є в трьох місцях (command/skill, architect, config). Tier 2 review і далі бачить Done-when. Лінт відкинуто свідомо.
- [Consumer з наявним `openspec/config.yaml` не отримає rules] → Нотатка README / CHANGELOG. A і B працюють незалежно від config.
- [`init --force` перезапише кастомний `openspec/config.yaml` у node/generic; до цього change для node/generic такого перезапису не було, а README (рядок про `skills.kit`) радить re-init з `--force`] → Семантика прапорця, як у vue3/mvp. README-нотатка і запис у CHANGELOG прямо попереджають про перезапис, а не кажуть, що config «not touched» без застереження.
- [`openspec-guide` тепер запускає `gate-check --review` для стану «є proposal, немає review»] → Це read-only перевірка на секунди; guide уже відтворює gate-check для CI-збоїв. Натомість guide не відправляє на review-сесію, яка гарантовано закінчиться T1 RC.
- [Architect під `/opsx:quick` не запускає self-check] → Свідомо (B2a): quick без review, `opsx-quick.md` не змінюється; заголовки proposal однаково обов’язкові.
- [Quick-change без `review.md`: guide і раніше радив для нього `/opsx:review`, бо гілка «немає `review.md`» не розрізняє quick; тепер при провальному Tier 1 (наприклад, quick без delta specs) guide радить `/opsx:propose`] → Жодна з відповідей не описує quick-потік, а окрема quick-гілка в guide поза обсягом. Guide однаково цитує помилки gate-check, тож користувач бачить причину.
- [Бюджет `templates/AGENTS.md` < 4000 символів] → Додається одне коротке речення (~150 символів при запасі 1232). Таск перевіряє довжину.
- [vue3/mvp і далі мають rules, які OpenSpec відкидає] → Задокументовано як non-goal і follow-up. B і A покривають обов’язкові заголовки для всіх профілів.

## Migration Plan

1. Apply змінює `templates/` (команда, skills, subagents `spec-architect` і `openspec-guide`, `AGENTS.md`, `CLAUDE.md`, новий config template), `README.md`, `CHANGELOG.md` `[Unreleased]` і `test/smoke.test.js`. `bin/` і `package.json` не змінюються.
2. Після релізу consumer-и запускають `npx agent-orchestrator-kit update` + `sync` і отримують A/B/C і нову маршрутизацію `openspec-guide`. D діє для нових `init --profile node|generic`. Наявним проєктам потрібне ручне правило в `openspec/config.yaml` за README.
3. Rollback: відкотити шаблони й видалити `templates/openspec-config.yaml.example`. Поведінка CLI не змінювалась.

## Open Questions

- Follow-up: чи має `init` писати `openspec/config.yaml.example` поруч із наявним `openspec/config.yaml` (Quickstart-порядок)? Це зміна `installOpenspecConfigExample`, поза цим change.
- Follow-up: виправити YAML-лапки у `profiles/vue3/` і `profiles/mvp/openspec-config.yaml.example`.
- Follow-up: перейменувати описовий ключ `handoff.propose_to_review: validate_strict` у `templates/orchestrator.yaml` і профілях `node` / `vue3` / `generic` (наприклад, на `tier1_pregate`). Лише для нових init, бо `update` не чіпає `orchestrator.yaml`.
- Після статистики pre-gate: чи знижувати ціль `Spec review discovery loops` до ≤ 1 (окреме рішення, non-goal тут).
