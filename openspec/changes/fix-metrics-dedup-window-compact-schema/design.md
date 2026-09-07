## Context

`metrics.json` v1 зберігає на кожній сесії масив `sources[]` per-message об'єктів (~12 рядків JSON кожен). На consumer-зміні 2026-09-07 це дало 27 163 рядки / 849 KB, з яких 88% — одна помилково зібрана сесія (persist без pending, Amp local threads без нижньої межі). Паралельно три адаптери мають різну повноту: Cursor — hook-рядки з conversationId; Claude — streamed jsonl (2–3 рядки на `message.id`, subagent-файли у вкладеній папці, `cwd` рядка змінюється після `cd`); Amp — export без helper-моделей, usage з повними тотал-ами і Cost. Kit 0.13.0, Node 22, без залежностей; тести на `node:test`. Споживачі читають файл як рахунок change-у і git-tracked артефакт.

## Goals / Non-Goals

**Goals:**
- Компактний запис сесії: агрегати + `sourceIds` + `byModel`, без per-message об'єктів; файл change-у з 8 сесій ≈ 1k рядків.
- Жодного вікна без нижньої межі; persist/archive без pending не сканує історію і не подвоює Cost.
- Правдиві Claude-числа: dedup за `message.id`, subagents, cwd-префікс.
- Правдиві Amp-числа: session totals і Cost з usage, модель чату з export.
- Leftover, який не приростає чужою роботою для сесій без thread id.
- Читабельність v1-файлів і одноразова міграція на першому записі.

**Non-Goals:**
- Перерахунок чисел у вже заархівованих consumer-файлах (лише схема через `--migrate`).
- Claude thread-фільтр за `sessionId`.
- Нові джерела даних (HTTP, SDK), зміна rate table.

## Decisions

1. **Схема сесії v2.** `session` = поля v1 без `sources` плюс `sourceIds: string[]`, `sourceTotals: { [id]: totalTokens }`, `byModel: [{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, costUsdEstimated, costSource? }]`, де `costSource` є `api-estimate` | `api-estimate-fallback` | `amp-usage` або відсутній; `usageModels`, `models`, `agentMode` лишаються. `version: 2`. Альтернатива «лишити sources, але обрізати поля» відкинута: розмір усе одно лінійний від кількості повідомлень, а dedup потребує лише id (+ totals для Cursor upgrade). `sourceTotals` замість `Set` id — щоб leftover міг «підняти» кумулятивний Cursor-рядок того самого id.
2. **Collect повертає компакт.** `collectSpend` віддає `{ ids, totals, byModel, byPlatform, ampThreads, notes }`; per-message об'єкти живуть лише в пам'яті адаптера. `existingSourceIds` і `existingSourceTotals` передаються з усіх сесій для dedup/upgrade. Альтернатива «сховати sources у gitignored cache» відкинута: спец вимагає один git-tracked файл, і cache не переживає clone.
3. **Агрегати з `byModel`.** `recomputeMetricsAggregates` бере токени/estimate з `session.byModel` (коли непорожній) або з session-level полів; `costUsd` — з session-level (billed / self-report / Amp Cost), `spendByModel[amp].costUsd` — з `byModel` рядків usage-таблиці, `spendByPlatform.*.costUsd` — із сесій. Правило «Cost один раз на сесію» зберігається природно, бо per-message cost більше не існує.
4. **Вікно persist без pending.** `startedAt = --started-at || pending.startedAt || last.endedAt || metrics.createdAt`; `windowStart = (startedAt взято з --started-at || pending.startedAt) ? startedAt − 120s : startedAt` — grace визначається походженням start, а не наявністю pending: явний `--started-at` перемагає pending і задає grace anchor навіть без pending; `last.endedAt` / `metrics.createdAt` — без grace. Відкритої межі немає ніколи. Leftover попередньої сесії виконується першим і має пріоритет через dedup за id.
5. **Amp без listRecent на persist.** `collectAmpCli` на persist/archive бере лише `ampThreadId` (`--amp-thread` / `pending.threadId` / env). `listRecentAmpThreadIds` лишається тільки для `detectSessionClient` (`amp-session-list`). Локальні `threads/*.json` скануються лише при `--collect` або коли є thread id; без нього — пропуск з note. Thread-level Cost dedup: `ampThreads[].costUsd` додається лише якщо цей thread id не є `threadId` жодної попередньої сесії.
6. **Amp usage як джерело totals.** Якщо usage віддав `Input tokens`/`Output tokens`, вони стають session totals (перекривають суму export-повідомлень), `byModel` — рядки Models з `matchAmpUsageModel`; `session.model` визначається лише з transient export-повідомлень як модель чату з найбільшим usage і зберігає її product id, навіть якщо `byModel` містить display/helper rows Sol/Luna/Terra. Leftover повторно бере свіжі usage totals і Models; лише коли usage totals відсутні, використовує суму transient export-подій. Свіжий `Cost: $N` перемагає `priorCost`.
7. **Claude адаптер.** Dedup `bestById` за `message.id` (max total); файли: `<projectDir>/*.jsonl` + `<projectDir>/*/subagents/*.jsonl` + `<projectDir>/agent-*.jsonl`; cwd: `row.cwd === cwd || row.cwd.startsWith(cwd + sep)`. `inputTokens` = `input + cache_read + cache_creation` як зараз.
8. **Leftover cap.** `leftoverEnd = threadId ? pending.startedAt : min(pending.startedAt, endedAt + 120s)`; Cursor `threadId` заповнюється з env на persist без pending, тож Cursor майже завжди має id. Claude лишається time-only з cap.
9. **Міграція.** `loadMetricsFile` нормалізує v1 → v2 в пам'яті (`sources` → `sourceIds`, `sourceTotals`, `byModel` через `aggregate(sources)`), детерміновано переносить на model buckets наявний provenance і не вигадує billed Cost. Конвертація схеми точно зберігає всі наявні числові поля кожної сесії та top-level `spend`, `totals`, `spendByPlatform`, `spendByModel`, `phases`: ні перший реальний write, ні явний `metrics <name> --migrate` не роблять numeric backfill/recompute як частину конвертації. Звичайні `metrics <name>` / `--json` нормалізують лише в пам'яті й не пишуть файл; подальші реальні записи застосовують звичайний recompute до вже v2 даних. Hook/collect-скрипти (`.cjs`) отримують ту саму нормалізацію (спільна функція, продубльована байт-у-байт у templates).
10. **Estimate для всіх платформ.** `bin/claude-cost-estimate.js` за зразком `bin/cursor-cost-estimate.js`: таблиця `{ family: { inputPerM, cacheReadPerM, cacheWritePerM, outputPerM } }` (`fable-5`: 10 / 0.25 / 12.5 / 50; `opus`: 5 / 0.5 / 6.25 / 25; `sonnet-5`: 2 / 0.2 / 2.5 / 10; `sonnet-4-6`: 3 / 0.3 / 3.75 / 15; `haiku-4-5`: 1 / 0.1 / 1.25 / 5), match за префіксом model id, невідомий → fallback $3 / $15 (без cache-split). Claude-адаптер рахує per message з реальним cache-split (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) і сумує в `byModel[].costUsdEstimated`. Amp без Cost: та сама функція за нормалізованим ім'ям (`Claude Opus 5` → `claude-opus-5`), інакше fallback. Альтернатива «тягнути ціни з Models API» відкинута: kit без HTTP; таблиця версіонується в CHANGELOG. Long-context tier (> 200k input) не моделюється — оцінка зверху не претендує на invoice.
11. **Контракт для дашбордів.** Per-phase межі вже є в `phases.<phase>` з 0.12.0; дашборд, що читає git, ігнорує їх. Kit не може виправити чужий код, але може зробити контракт очевидним: `--summary-json` без сесій (стабільний, малий, для віджетів), README-розділ і явна заборона git-меж. Альтернатива «додати `commits` per phase» відкинута вимогою `openspec/specs/change-metrics/spec.md` «Межі фази — з сесій цієї фази, не клон totals»; git-похідні межі не є метрикою kit.
12. **Spawn name.** `firstSpawnName(value)`: backtick-токен → карта `Explorer→explorer`, `Architect→spec-architect`, `Spec Reviewer→spec-reviewer`, `Implementer→null`, `Archiver→null` (порожньо = `<phase-specialist>`) → `''`. Вільний текст не парситься.

## Risks / Trade-offs

- [v2 ламає зовнішні читачі `sessions[].sources`] → `metrics --json` віддає v2; CHANGELOG позначає **BREAKING** для схеми; `--migrate` документований; v1 читається без падіння.
- [Pre-restore grace 120s захопить чужий чат тієї ж платформи] → лише за dedup id і з фільтром conversationId/thread; для Claude ризик лишається, обмежений 120s.
- [Usage недоступний офлайн] → fail-open: totals з export, `costUsd` з `priorCost`, `spendSource` `adapter`.
- [Leftover cap 120s відріже довгий останній хід Claude] → cap рахується від `endedAt` persist; типовий хвіст (друк промпта) ≤ 60s; довші хвости втрачаються свідомо на користь відсутності витоку.
- [Міграція під час hook leftover на archive] → нормалізація спільна для CLI і `.cjs`; тест «hook на v1 архіві пише v2 без втрати ids».

## Migration Plan

1. Реліз kit `0.14.0` з v2 і `--migrate`. 2. Consumer `update` копіює нові `.cjs` і rule. 3. Активні change-файли мігруються на першому persist; архіви — за бажанням `metrics <name> --migrate`. Rollback: попередній kit читає v2 як legacy (невідомі поля ігноруються, `sources` порожні → session-level поля), числа не втрачаються.

## Open Questions

- Чи потрібен `metrics <name> --repair`, який видаляє сесії з `startedAt` раніше за `createdAt` файла (як runaway 2026-06-06)? Не в цій зміні; фіксується як follow-up.
