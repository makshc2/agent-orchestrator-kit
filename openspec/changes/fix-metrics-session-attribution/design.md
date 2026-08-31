## Context

`change-metrics` v1 уже збирає Cursor hook / Amp / Claude в `metrics.json`, але вікно persist і archive навмисно стартує з `last.endedAt` («не різати пізній stop»). Cursor пише jsonl ~18–25 с після persist. Наступний persist і Archiver забирають чужий stop. Другий leftover source додається в `sources`, але `spendSource: self-report` (placeholder `unknown`) блокує `syncAdapterSessionTotals` / `keepReportedTotals` — session-поля лишаються від першого source. `recomputeSpendMaps` тоді додає і session.model (family з `--model`), і hook product id. `metricsFinalizeArchive` пише `startedAt = endedAt = now`, `durationMs: null`; `sessionEnd` скіпає `openspec/changes/archive/`. `phaseForRole` матчить `/review/` раніше за `/architect/`. `detectSessionClient` для Cursor ставить `threadId: null` навіть коли є `CURSOR_CONVERSATION_ID`.

Бойовий приклад: VMS `align-unavailable-cameras-admin-ui` (2026-08-31), kit v0.10.0, 9 сесій. Не бекфілимо той архів — лише інвертуємо правила кіта.

Два вікна, не третє: **persist цієї сесії** і **leftover останньої закритої**.

## Goals / Non-Goals

**Goals:**

- Persist не краде stop попередньої сесії.
- Leftover завжди перераховує totals з усіх sources, якщо немає числового override.
- Archive має ненульову тривалість; leftover після move бачить архівний файл.
- Карти й phase spend з sources, без family-фантома.
- `session.model` = adapter product id, коли sources мають model.
- Чужий same-cwd чат не потрапляє в collect, якщо відомий conversation id.
- Канонічна роль у metrics; Architect не стає review.

**Non-Goals:**

- Amp timestamp / `amp-default`, live HTTP, нові npm-залежності, grok table, Factory UI, VMS app, бекфіл історичних архівів, політика `archive_after_merge`.

## Decisions

### D1. Persist-вікно = `[pending.startedAt, endedAt]`, не `[last.endedAt, endedAt]`

Поточне правило «CLI MUST NOT ставити нижню межу на pending.startedAt» і сценарій «пізня подія потрапляє в наступну сесію» кодують steal.

**Обрано:** нижня межа persist — `pending.startedAt` (або `--started-at`). Подія з `at` після `last.endedAt` і до `next.pending.startedAt` належить leftover попередньої сесії.

**Відхилено:** лишити `last.endedAt` як start (статус-кво; бойовий steal propose→review і apply-2→apply-3).

### D2. Leftover-кінець: pending, якщо є; інакше +120s

**Обрано:** `leftoverEnd = pending.startedAt`, якщо pending є; інакше `last.endedAt + 120s`. Коли pending є, він перемагає навіть якщо пізніший за 120s (інакше повторюється miss Archiver-1 367k, який причепився лише після наступного restore). Події з `at >= last.endedAt` і `at < leftoverEnd` (або `<= leftoverEnd` для гілки +120s), яких ще немає за `source.id`, йдуть в останню закриту сесію. Після attach CLI MUST перерахувати session totals з усіх sources, якщо немає flag або числового (не-placeholder) самозвіту.

**Відхилено:** `min(endedAt+120s, pending.startedAt)` завжди — це «whichever ends first» у вузькому сенсі і знову ріже leftover, коли restore пізніший за 120s. **Відхилено:** не чіпати leftover після archive (stop +5s після move зникає).

Persist і archive SHALL зробити leftover-backfill попередньої сесії **до** collect поточної, щоб steal не залежав лише від hook `sessionEnd`.

### D3. Archive: pending-старт → leftover попередньої → вікно Archiver → leftover у `archive/`

**Обрано:**

1. На старті `archive`, якщо `pending` null — записати `pending.startedAt = now` у ще активний `metrics.json`.
2. Leftover на останню не-Archiver сесію з `leftoverEnd = pending.startedAt`.
3. Після move finalize: collect Archiver у `[pending.startedAt, now]`, `startedAt` = pending, `endedAt` = now, `durationMs` = дельта (не `null`), `pending = null`.
4. `sessionEnd` MUST розглядати найсвіжіший `openspec/changes/archive/*-<name>/metrics.json` (за `archivedAt` або mtime), не скіпати `archive/` наосліп.

**Відхилено:** `startedAt = endedAt = now`, `durationMs: null` (чинна спека; нульова сесія 9 краде 568k). **Відхилено:** лишити `main()` зі `if (name === 'archive') continue` без читання архівного файла.

`scripts/cursor-spend-collect.cjs` і `templates/scripts/cursor-spend-collect.cjs` лишаються поведінково синхронними (однакова семантика leftover/archive).

### D4. Карти й phase spend лише з sources, коли sources непорожні

**Обрано:** `sources.length > 0` → `spendByPlatform` / `spendByModel` / `phases.*.spend` = сума sources. Session-level поля в карти лише коли sources порожні. Не додавати `session.model` (family) поруч із hook id.

**Відхилено:** чинне «додати session і sources, якщо totals не збігаються» — це family phantom (+1 018 043 на `cursor-grok-4.6`).

### D5. Product id з sources перемагає `--model` / `## Metrics` / `AOK_MODEL`

**Обрано:** primary model = max `totalTokens` серед sources з непорожнім `model`. Flag/самозвіт/env лише коли жоден source не має model. `session.models` = унікальні id з sources.

**Відхилено:** чинне «`--model` завжди перемагає» — усі 9 сесій стали `cursor-grok-4.6` при hook `…-xhigh-fast` / `…-low`.

### D6. Placeholder самозвіт не є spend override

**Обрано:** `unknown` / `none` / `n/a` / порожнє в числах `## Metrics` нормалізується в `null`. Ключ `spend_source: self-report` при всіх null числах MUST NOT ставити `keepReportedTotals` і MUST NOT блокувати `syncAdapterSessionTotals`. Після leftover `spendSource` стає `adapter`. Числовий самозвіт і `--input-tokens` як і раніше freeze.

**Відхилено:** будь-який `spendSource !== adapter` блокує resync (бойовий review 954984+508064 → поля лише 954984).

### D7. Cursor `conversationId`, коли id відомий

**Обрано:** restore пише `CURSOR_CONVERSATION_ID` у `pending.threadId`. Collect Cursor пропускає рядок, якщо filter id є (`pending.threadId` або env) і `row.conversationId` не збігається. Якщо filter id немає — time-only, як сьогодні (не ламати фікстури без conversationId).

**Відхилено:** ігнорувати `conversationId` (same-cwd observer 2.5M у чужому jsonl). **Відхилено:** вимагати conversationId завжди (зламає старі hook-рядки без поля).

### D8. Канонічна роль і порядок `phaseForRole`

**Обрано:** `canonicalRole(closedRole)` — перший відомий токен `Explorer|Architect|Spec Reviewer|Implementer|Archiver|Design Intake` (або перший сегмент до `—` / коми, якщо це токен). Речення після `—` не пишеться в `session.role` / `phases.*.agents`. `phaseForRole` перевіряє architect/propose **до** review.

**Відхилено:** зберігати повний рядок Closed role. **Відхилено:** лишити `/review/` перед `/architect/` (міна для `Architect — … ready for Spec Reviewer`).

### D9. startedAt без restore = earliest `source.at`

**Обрано:** немає pending і немає `--started-at` → `startedAt` = min `source.at` цієї сесії, інакше `null`; `durationMs` з дельти або `null`. Два persist підряд лишаються двома записами (apply-2 / apply-3 не зливати).

**Відхилено:** завжди `null` (Explorer без restore втрачає тривалість навіть коли hook є). **Відхилено:** злити два persist в одну сесію.

## Risks / Trade-offs

- **[Ризик] Подія з `at === last.endedAt`, записана після persist A, при відкритому leftover `[endedAt, leftoverEnd)` може втратитись, якщо вікно leftover виключне на старті.** → leftover інклюзивний на `last.endedAt`, dedup за `source.id` (вже зібране не подвоюється). Тест `at: endedAt` після persist A має причепитись до A, не до B.
- **[Ризик] Hook між `last.endedAt` і стартом archive більше не потрапляє в Archiver.** → це навмисно (steal). Чинні smoke `archive collects Cursor hook` з `at: 2026-08-30` (між endedAt 07:00 і now) MUST інвертуватись: leftover на Implementer; для Archiver — рядок з `at` після archive `pending.startedAt`.
- **[Ризик] `lean-archive` досі каже `durationMs: null` як вказівник.** → маленька MODIFIED у цьому change, щоб після merge не було суперечності.
- **[Ризик] WIP у working tree spend-collect не є цим change.** → таски пишуть цільовий стан відносно committed main + наявних файлів; не покладатись на незакомічені дифи.
- **[Ризик] Історичні архіви лишаються кривими.** → свідомо; бекфіл поза scope.

## Migration Plan

Немає міграції файлів. Нові persist/archive пишуть за новими правилами. Rollback = попередня версія кіта. Споживачі читають той самий schema v1.

## Open Questions

Немає. Рішення D1–D9 закривають бойові баги без третьої моделі вікна.
