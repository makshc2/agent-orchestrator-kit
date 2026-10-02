# Cost-lean envelope — epic і brief першого зрізу

> Decision brief для `/opsx:propose lean-conductor-protocol`. Стан: HEAD `ece045d` (v0.17.0), 2026-10-02. Джерело: explore-сесія з розбором транскриптів R4 (`archive-from-terminal`) і його `metrics.json`. Propose-сесія читає **Частини I–II**; Частини III–IV — довідка для наступних зрізів і боргу.

## Частина I. Контекст

### I.1 Докази: R4 на Claude Code (Sonnet 5.5), ledger $41.69

| Сесія | $ | Ходи | Контекст на ході (старт→кінець) |
|---|---|---|---|
| propose, parent (conductor) | 10.8 | 109 | 37k→574k |
| propose, `spec-architect` | 16.2 | 160 | 39k→731k |
| review, parent | 1.4 | 24 | 39k→151k |
| review, `spec-reviewer` | 8.2 | 121 | 30k→459k |
| apply (parent-driven) | 5.3 | 87 | 40k→294k |
| archive (термінал, R4) | 0 | — | — |

Виміряно за транскриптами `~/.claude/projects/…` (сума збігається з ledger у межах 1%; ціни — estimator кіта: cache-read $0.20/M, write $2.5/M, output $10/M):

1. Вартість ≈ Σ ходів × розмір контексту: cache-read 75%, cache-write 13%, output 13%. Кеш parent і subagent не ділять, тож conductor + specialist = два великі контексти.
2. Parent propose: 67 ходів розвідки до спавну (≈$5.6: brief-план, ділянки `bin/`, чужі change-и) і 41 хід після (≈$5.2 при ~500k контексту: перечитав усі артефакти, scratch-симуляції, handoff). Його spawn-prompt (~10k токенів) — дайджест тієї ж розвідки, яку architect повторив у власному контексті.
3. ≈45% вартості ходів — shell-розвідка (`grep/cat/sed`) у вже роздутому контексті. Thinking лишається в контексті й платиться на кожному наступному ході (≈35% вартості main-thread сесій).
4. Start/Exit-протокол прямо коштує мало: ≈5 ходів, ≈$0.5 за сесію. Тому «exit в один виклик» (Зріз 2) — це детермінізм і вимірюваність, а не гроші.
5. Розмір артефактів (proposal+design+tasks+delta): R4 = 203 753 B (`tasks.md` 102 718 B, 21 таск, ~100 verbatim-блоків), fix-metrics-dedup-window = 189 427 B, pregate = 116 395 B, `tier1-delta-heading-check` = 32 407 B. Кожна фаза перечитує це на кожному ході; нічого не попереджає про розмір.
6. Opus 5.5 і Sonnet 5.5 мають однаковий cache-read ($0.20/M): зміна тиру моделі дає ≈ −20% на цій структурі — не головний важіль.

### I.2 Принципи епіка

- Дешевше = менше ходів × менший контекст, а не слабша модель.
- Brief пишеться в explore-сесії у git-tracked файл і передається в propose за шляхом: conductor не повторює розвідку (цей файл — приклад).
- Детерміноване — у скрипти (0 токенів); LLM — лише судження; ескалація — за детермінованим сигналом (гейт, тест, Done-when).
- Кожен зріз малий (одна ідея), вкладається в бюджет артефактів (II.3) і міряється проти бази.

### I.3 Жорсткі обмеження кіта (виміряно на HEAD ece045d)

- Always-apply rules: 11 912 з 12 000 символів (`test/smoke.test.js:2219`); `templates/AGENTS.md` 3 180 з 4 000; EN next-session prompt ≤ 1 536 B (`test/fix-next-session-prompt.test.js:138`); `opsx-archive.md` ≤ 1 536 B. Правки в таких файлах — розмір-нейтральні або менші.
- Кореневий `.agents/rules/session-handoff.mdc` = байтова копія шаблону: після правки шаблону — `cp`, ніколи `init --force`.
- Корінь кіта — не install: немає `.claude/agents`, `.claude/commands/opsx`, `.agents/orchestrator.yaml`. Спеціаліст = `general-purpose` із тілом `templates/.agents/subagents/<name>.md`. CLI — `node bin/agent-orchestrator.js …` (`npx` бере кешовану опубліковану копію).
- Не чіпати: схему `metrics.json` v2, `--summary-json`, архівні метрики, семантику `inputTokens`. spec `task-contract` забороняє новий детермінований лінт *якості* Done-when (бюджет розміру — не якість Done-when).

### I.4 Як міряти

База R4: $41.69 (propose 26.9 / review 9.5 / apply 5.3); parent propose 109 ходів. Для наступних змін: вартість, ходи й піковий контекст parent/subagent, RC-раунди (≤2), apply-ітерації (≤2), post-archive фікси (0). До `metrics --profile` (Зріз 2) рахувати з `sessions[].sourceIds` (ходи) і `sourceTotals` (контекст на хід; падіння >50% = новий тред/subagent). Ціль епіка: −30% вартості зміни без росту RC-раундів. Гіпотеза для Зрізу 1: parent propose ≤ 25 ходів і ≤ $4; propose+review+apply цього change ≤ $15.

## Частина II. Brief зрізу 1: `lean-conductor-protocol`

### II.0 Як запускати цей propose (застосовуємо принципи самі)

- Новий чат. Рекомендовано `/effort high`, не `max`: thinking лишається в контексті й платиться на кожному ході.
- Conductor читає лише цей файл (Частини I–II) і `node bin/agent-orchestrator.js status`; перша команда чату — `date -u +%Y-%m-%dT%H:%M:%SZ` (це `--started-at` для persist: change ще не існує, restore немає). Спавнить `spec-architect` за ≤5 викликів, передаючи **шлях** до цього файлу й назву change, без вставленого змісту. Жодної власної розвідки репо.
- Architect читає: Частини I–II; `openspec/config.yaml`; вимоги main-spec **за заголовками** через grep (НЕ читати `change-metrics` 151 KB і `session-handoff` 28 KB повністю); якорі II.6 ± 40 рядків; один приклад формату — `openspec/changes/tier1-delta-heading-check`. Незалежні shell-читання — одним викликом; файл, який уже читав, не перечитувати. Мова артефактів — як у R4: проза українською, заголовки й ключові слова (`SHALL/MUST`, `GIVEN/WHEN/THEN`) англійською; `proposal.md` має `## Non-goals` і `## Acceptance criteria` точно так.
- Після звіту architect-а conductor: `node bin/agent-orchestrator.js gate-check --review lean-conductor-protocol` (≤3 виклики разом із persist); якщо зелений — артефакти не перечитує; якщо червоний — один re-spawn зі списком помилок.
- Persist без ручного handoff.md: `node bin/agent-orchestrator.js handoff lean-conductor-protocol --closed-role Architect --done "<що створено>" --next-command "/opsx:review lean-conductor-protocol" --started-at <STARTED_AT> --model <llm-product-id>`.

### II.1 Проблема

Conductor propose веде розвідку й верифікацію у власному роздутому контексті, а architect повторює її (I.1 п.2). Розмір артефактів нічим не обмежений (I.1 п.5). Перевірку схеми `review.md` («conductor MUST reject…», `opsx-review.md` §5) виконує LLM, хоча правила детерміновані.

### II.2 Що будуємо

**A. Бюджет розміру артефактів у Tier 1.** `runTier1Review` (bin:3577) уже повертає `warnings` (друкуються `gate-check --review`, exit не змінюють). Додати попередження з виміряним значенням, лімітом і порадою «розбий на зрізи — кожен у бюджет», коли `tasks.md` > 60 000 B або сума `proposal.md`+`design.md`+`tasks.md`+усіх delta > 150 000 B (стартові пороги, констатанти з коментарем-походженням; архітектор калібрує за ledger). Ключ `pipeline.artifact_budget: warn|strict|off` за зразком `pipeline.task_contract` (`parsePipelineConfig` bin:3448; default `warn`; `strict` — помилки замість попереджень; `off` — нічого). Відкрите: чи додавати `warnings` у `--review --json` (зараз `{pass, errors}`) — адитивно, але перевірити тести з `deepEqual` на цей JSON.

**B. `gate-check --review-md <name>`.** Новий режим поруч із `--tasks`/`--review` (action bin:4469/4488). Детерміновано перевіряє `review.md` за правилами `opsx-review.md`: файл є; рівно один рядок `Verdict:` (APPROVE | REQUEST CHANGES; база — `parseReviewVerdict` bin:3346, що бере перший збіг, тож додатково позначати другий); T1-виняток — рядок `**Source:** gate-check` ⇒ без `## Checklist`; інакше (Tier 2) заголовок `Previous findings` присутній завжди; для REQUEST CHANGES — непорожні `Checklist`, `Findings` (Blocker/Major/Minor) і `Required Before Apply`; для APPROVE — `apply-notes.md` існує і ≤ 20 рядків. Exit ≠ 0 з переліком; `--json` → `{pass, errors[]}`. Реальні формати для толерантності: R4 (APPROVE) — `## Checklist summary`, `## Notes`, `## Previous findings`; pregate (RC) — `## Checklist`, `## Findings` + `### Blocker/Major/Minor`, `## Previous findings`. Додаткові секції дозволені — перевіряються лише обов'язкові. Контракт-тест: усі `openspec/changes/archive/*/review.md` проходять (винятки документувати), синтетичні порушення падають.

**C. Протокол тонкого conductor-а (текст шаблонів, без нового коду).**
- `opsx-propose.md` і дзеркало `skills/openspec-propose/SKILL.md` (тести пінять фрази в обох): conductor не досліджує репо; читає лише brief (за шляхом), `status`, `handoff --restore`; спавн `spec-architect` за ≤5 викликів, передає шлях і назву; після звіту — `gate-check --review` (≤3 виклики), артефакти не перечитує при зеленому гейті; при червоному — один re-spawn (як зараз).
- `opsx-review.md` (+ узгодити `spec-reviewer.md`): після Tier 2 — `gate-check --review-md <name>` замість ручної перевірки заголовків; відхилення й один re-spawn — як зараз.
- `subagents/spec-architect.md`, `spec-reviewer.md`: правила читання — main-spec не повністю, а за заголовками вимог із delta; файли > 20 KB діапазонами; без повторних читань; незалежні читання одним викликом.
- Spec: `tiered-review` — ADDED «Tier 1 попереджає про бюджет розміру», ADDED «review.md schema gate»; `pipeline-subagents` — ADDED «Conductor не дублює розвідку спеціаліста» (нова вимога, не MODIFIED наявної, яку вже міняв R4). Always-apply правила не росте.

### II.3 Бюджет артефактів цього change

`proposal.md` ≤ 8 KB; `design.md` ≤ 10 KB; `tasks.md` ≤ 25 KB і ≤ 12 тасків (контракт Files/Do/Done-when; verbatim-блоки лише там, де тест пінить точний рядок); delta-вимог ≤ 6. Якщо не вкладається — зупинитись і запропонувати, що відрізати (перший кандидат — підпункт C про subagent-и).

### II.4 Acceptance criteria (кандидати)

1. `gate-check --review` на change із `tasks.md` > 60 000 B або сумою > 150 000 B друкує попередження з виміряним значенням і лімітом: exit 0 (`warn`), exit 1 (`strict`), нічого (`off`). На фікстурах R4 (203 753 B) і dedup-window (189 427 B) — попереджає; pregate (116 395 B) і `tier1-delta-heading-check` (32 407 B) — ні.
2. `gate-check --review-md` проходить на всіх архівних `review.md` (крім задокументованих винятків) і падає на синтетичних: без Verdict, два Verdict, RC без Required Before Apply, Tier 2 без Previous findings, APPROVE без `apply-notes.md`.
3. `opsx-propose.md`/SKILL і `opsx-review.md` містять числові ліміти (≤5 викликів до спавну, ≤3 після) і `--review-md`; усі наявні pin-фрази збережені (див. II.6); бюджети I.3 не порушені; кореневий `.agents/rules` без змін.
4. Наявні тести зелені, нові додані; `openspec validate --all --strict` зелений.
5. Власні артефакти change вкладаються в II.3, а `gate-check --review lean-conductor-protocol` не видає попереджень бюджету.

### II.5 Non-goals і ризики

Non-goals: хуки (Зріз 3); derived exit і `metrics --profile` (Зріз 2); architect-by-artifact (Зріз 4); `effort:`/`model:` frontmatter; зміна моделі reviewer чи чекліста Tier 2; генерація дзеркал (R9-lite); блокування інструментів; `init --force`; metrics v3; `strict` за замовчуванням.

Ризики: (1) текстове правило не гарантує поведінку — міряти ходи parent до/після спавну на наступних 2–3 змінах; не тримається — Зріз 3 (хуки-лічильники). (2) Пороги стартові, `warn` за замовчуванням. (3) `--review-md` занадто суворий ⇒ хибні відмови блокують review-цикл; тому лише обов'язкові секції. (4) Дубль тексту opsx-propose ↔ SKILL.md: правити обидва в одному таску.

### II.6 Якорі (HEAD ece045d)

- `bin/agent-orchestrator.js`: `runTier1Review` :3577–3625 (`{pass, errors, warnings}`); `gate-check` :4458 (`--tasks` :4469, `--review` :4488, друк warnings :4495); `parsePipelineConfig` :3448 (ключі requireSpecReview, requireDesignBrief, maxActiveChanges, taskContract, srcGlob, archiveAfterMerge) і `parsePipelineSection` :3402; `taskContractMode` :3498; `parseReviewVerdict` :3346; `parseTasksProgress` :3337; `listDeltaSpecFiles` :3627, `parseDeltaSpec` :3677, `planSpecSync` :3701; `readPipelineConfig` :3465 (null без `.agents/orchestrator.yaml`).
- Шаблони: `templates/orchestrator.yaml` (блок `pipeline:`), `templates/.agents/commands/opsx-propose.md` (8.5 KB; кроки 1–2 спавн, крок 6 гейт), `opsx-review.md` (8.8 KB; §3 Tier 2, §5 «conductor MUST reject»), `skills/openspec-propose/SKILL.md`, `subagents/spec-architect.md`, `spec-reviewer.md`, `openspec-guide.md`.
- Pin-фрази (`test/smoke.test.js:696–760`, не прибирати): `gate-check --review`, `Tier 1 pre-gate`, `exit 0 is forbidden`, `If the pre-gate still fails after the one re-spawn, report \`## Blocked\``, `**Source:** gate-check`, `Previous findings`, `Required Before Apply`, `MUST NOT stop at the first blocking`, `new state is present`.
- Specs: `openspec/specs/tiered-review/spec.md` («Скриптовий Tier 1 перед LLM-review»), `pipeline-subagents/spec.md`, `task-contract/spec.md` (заборона лінту *якості* Done-when).
- Зразки тестів: `test/tier1-delta-heading-check.test.js` (Tier 1), `test/gate-check-config-parser-and-src-glob.test.js` (ключі `pipeline.*`).

## Частина III. Черга зрізів (довідка)

**Зріз 2 — `lean-session-exit` (derived exit + `metrics --profile`).** Вартість Start/Exit мала (I.1 п.4), цінність — детермінізм (клас persist-flow багів) і вимірюваність. Дослідження:
- Flags-first persist уже працює: `handoff` приймає `--closed-role --done --decisions --blocked --attach --next-command --next-role --tasks --review …`, а без `handoff.md` CLI сам його пише (bin:~5195). Бракує виведення `closedRole/nextCommand/nextRole/spawn`: зараз без них exit 1 (`handoff.md incomplete — missing: …`; `missingHandoffFields` :1450).
- `closedRole` ← `metrics.pending.role`, який restore ставить із попереднього `next_role` (bin:~5100 → `metricsRecordSessionStart` :2900); без restore — вимагати `--closed-role`.
- Таблиця за замовчуванням (прапор > handoff.md > виведене): Architect → Tier 1 pass ⇒ `/opsx:review <n>`, інакше `/opsx:propose <n>` + Blocked = перші помилки; Spec Reviewer → APPROVE ⇒ `/opsx:apply`, RC ⇒ `/opsx:propose`, без verdict ⇒ відмова; Implementer → зелений ⇒ archive-рядок (`isGreenApplyExit` :1440), інакше `/opsx:apply`, при Blocked ⇒ `/opsx:propose` (escape valve); Design Intake → `/opsx:propose`; Explorer — без виведення. Непорожній `--blocked` ніколи не просуває пайплайн. stderr друкує кожне виведене поле.
- Tier 1 у persist = `npx openspec validate` (1–3 с); fail-open: не вдалося ⇒ не «просувати».
- Prompt: Exit-рядок `buildNextSessionPrompt` (:1468; EN і UK) оновити на `handoff <name> --done "…"`; ≤ 1 536 B (I.3).
- Тексти (усі дзеркала): `session-handoff.mdc` (канон, always-apply — правка має зменшити), `AGENTS.md`, `CLAUDE.md`, `skills/agent-orchestration/SKILL.md` (6× `## Metrics`), `subagents/session-handoff.md`, `subagents/spec-archiver.md`, README (11×); корінь — `cp` із шаблону.
- Spec session-handoff: MODIFIED «Persist Memory and handoff on session exit», «Next-session prompt follows agent_language», «Session Exit вимагає самозвіт метрик у `## Metrics`» (лише послабити; повне зняття — R2b); ADDED: виведення полів, flags-only exit. Ці вимоги вже змінював R4: база — поточний main (див. Частину IV).
- `metrics <name> --profile [--json]` без зміни схеми з `sourceIds/sourceTotals/cacheReadTokens/costUsdTotal`: ходи, контекст first/avg/peak, сегменти, частка cache-read, $/хід; Cursor/Amp без per-call даних → `n/a`. Контрольний тест: Architect-сесія R4 (268 ходів, avg ≈393k, peak 731k, cache-read ≈98.8%).
- Ідемпотентний restore: `metricsRecordSessionStart` перезаписує `pending` на кожен restore, а для Claude `threadId` = null (`bin/session-client.js:192`) — ідемпотентність можлива, лише коли thread id відомий (Cursor, Amp, Claude через hook `session_id`) ⇒ Зріз 3.

**Зріз 3 — `lifecycle-hooks` (probe-first).** Спершу зняти реальні payload-и як фікстури: Claude Code (`SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`), Cursor (`sessionStart`, `stop`, `preToolUse`), Amp-плагін (`session.start`, `agent.start`, `tool.call`, `agent.end`). Далі тонкі fail-open шими `node scripts/aok-hook.cjs <event>`: інжекція брифінгу (Claude `additionalContext`, Cursor `sessionStart.additional_context`, Amp `agent.start`), м'які лічильники (conductor: ходи до спавну; сторож контексту на ~250k токенів чи ~120 ходів — лише nudge), Stop-guard persist із лімітом циклів. Інсталятор: `.claude/settings.json` (нового немає), `.cursor/hooks.json` (є `mergeHookCommands`, bin:~491), `.amp/plugins/` (нового немає). Бонус: hook-ове `session_id` дає Claude точний thread id ⇒ точна атрибуція транскрипту й ідемпотентний restore. Деталі JSON-схем Claude Code перевірити за документацією перед проєктуванням (довідкові твердження були зібрані через агента).

**Зріз 4 — `architect-by-artifact` (A/B).** Окремі спавни за графом `openspec status --json`: proposal+design → delta-спеки → tasks батчами; кожен із чистим контекстом і шляхами залежностей; дрейф ловить Tier 1 (трасування вимога↔таск). Оцінка: architect $16 → $8–10; ризик середній ⇒ міряти на 2–3 змінах.

**Зріз 5 — `effort-policy` (probe-first).** Перевірити, чи `effort:`/`model:` у frontmatter команд і субагентів діють у Claude Code та що роблять Cursor/Amp. Політика: apply патч-тасків medium/low з ескалацією на high лише коли Done-when/тест червоний; explorer low.

**Далі — «смуги» для складних задач** (Slice/epic із бюджетом, Probe, Fix, Amend, глибина review від ризику) — окрема explore-сесія.

## Частина IV. Передумова: борг на корені кіта

- `status` показує 4 незаархівовані зміни (`fix-next-session-prompt`, `gate-check-config-parser-and-src-glob`, `metrics-ledger-integrity`, `tier1-delta-heading-check`; усі «no review.md», вже в 0.17.0). Для `handoff` без імені це «Multiple active changes» ⇒ завжди передавати ім'я.
- **Пастка при archive.** `fix-next-session-prompt` у delta MODIFIED-ить «Next-session prompt follows agent_language», а R4 (уже заархівований) змінив ту саму вимогу: main має текст R4 (2 521 символ), delta R2a — старіший (2 313). `archive fix-next-session-prompt --sync` перезапише main і прибере сценарій зеленого apply («GIVEN усі таски `[x]` … CLI друкує … archive») на користь протилежного. Перед archive: прибрати цей MODIFIED-блок із delta R2a (main уже містить надмножину), `openspec validate --strict`, далі archive. Інші три зміни не перетинаються з R4.
- Gate 1 на корені (немає `review.md` і `.agents/orchestrator.yaml` ⇒ `require_spec_review` за замовчуванням true): див. decisions R4 `gate1-heads-up` — тимчасовий кореневий `.agents/orchestrator.yaml` з `pipeline.require_spec_review: false`, не коммітити. Рішення — за власником.

## Next-session prompt (вставити в НОВИЙ чат)

```text
/opsx:propose lean-conductor-protocol

You are the conductor for the propose session of the new change `lean-conductor-protocol`.
Chat language: Ukrainian. OpenSpec artifacts: prose in Ukrainian, headings and keywords in English (as in archived R4). Do not mix phases: review starts in a NEW chat after HARD STOP.

## Role
- Phase subagent: `spec-architect`. The kit root is not an install: spawn a `general-purpose` agent whose prompt carries the body of `templates/.agents/subagents/spec-architect.md` (Amp: isolated skill).
- The parent is conductor-only: no repo research, no artifact writing.

## Start
1. First command: `date -u +%Y-%m-%dT%H:%M:%SZ` — remember it as STARTED_AT (the change does not exist yet, so there is no restore).
2. Read ONLY `docs/cost-lean-envelope-2026-10-02.md` (Parts I–II) and `node bin/agent-orchestrator.js status`.
3. Spawn the architect within your first 5 tool calls, passing the brief PATH and the change name — do not paste its content. Use `node bin/agent-orchestrator.js …`, never `npx agent-orchestrator-kit` (cached published copy at the kit root).

## Context
- Closed role: Explorer (explore session 2026-10-02; no change directory yet)
- Done: cost anatomy of R4 from transcripts; brief for `lean-conductor-protocol` (Part II); slice queue (Part III).
- Blocked: none. Heads-up: Part IV (four unarchived changes; archive hazard for `fix-next-session-prompt`).
- Attach: `docs/cost-lean-envelope-2026-10-02.md`; `bin/agent-orchestrator.js:3577` (runTier1Review), `:4458` (gate-check), `:3448` (parsePipelineConfig)
- Constraints: artifact budget II.3 (tasks.md ≤ 25 KB, ≤ 12 tasks); `/effort high`, not max; no hooks and no handoff changes in this change.

## After the architect's report
`node bin/agent-orchestrator.js gate-check --review lean-conductor-protocol` (≤ 3 calls including persist). Green: do not re-read the artifacts. Red: one re-spawn with the full error list, then run it again.

## Exit HARD STOP (you are NOT done until this succeeds)
`node bin/agent-orchestrator.js handoff lean-conductor-protocol --closed-role Architect --done "<what was created>" --next-command "/opsx:review lean-conductor-protocol" --started-at <STARTED_AT> --model <llm-product-id>` (exit 0) → paste CLI stdout as one fenced block → stop. Do not start review in this chat.
```
