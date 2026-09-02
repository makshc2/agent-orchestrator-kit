## Why

На kit v0.11.0 у бойовому Cursor-пайплайні (registration-log-fe, `workplace-warehouse-and-document-mask`, 2026-09-02) persist/archive збирають spend, поки `cursor-usage.jsonl` ще порожній; `stop` / `afterAgentResponse` приходять на 15–35 с пізніше. `sessionEnd` leftover або читає порожній/чужий jsonl, або не фільтрує `conversationId`, і рядок Archiver (1.06M) назавжди зникає з архівного `metrics.json`. Виправляємо гонку, фільтр і multi-root, поки споживачі рахують spend по цьому журналу.

Design: none

## What Changes

- **Hook після append запускає leftover.** Після успішного допису в `.agents/spend/cursor-usage.jsonl` події `stop` / `afterAgentResponse` SHALL виконати той самий leftover-backfill, що й `sessionEnd` (`scripts/cursor-spend-collect.cjs`), проти резолвленого кореня (коренів). Fail-open, без додаткового stdout. `sessionEnd` leftover MUST лишатись (ідемпотентний, dedup за `source.id` / fingerprint).
- **Рядок у leftover-вікні, який уже є на диску в момент collect, MUST причепитись**, навіть якщо persist/archive уже записали `sources: []` і `spendSource: unreported`.
- **sessionEnd leftover фільтрує `conversationId` як persist.** Коли `last.threadId` непорожній — пропускати jsonl-рядки з відсутнім або іншим `conversationId`. Коли `threadId` є `null` (Explorer без restore) — лишити time-only leftover. Hotfix-чат у тому ж вікні MUST NOT потрапляти в Archiver/Implementer.
- **Один multi-root резолв для hook і collect.** `resolveBaseDir` розглядає `cwd` плюс `payload.workspace_roots`. Перемагає корінь, чий active або найсвіжіший archive `metrics.json` має `pending.threadId` або `last.session.threadId` === цей `conversation_id`; інакше active `openspec/changes/<name>/`; інакше корінь, у чиєму jsonl уже є цей conversationId. MUST NOT обирати sibling лише тому, що в нього першим є `.agents` / `openspec`. Collect SHALL робити leftover для **кожного** кандидата з `openspec/changes`, читаючи **його** `.agents/spend/cursor-usage.jsonl`.
- **Оцінені USD-агрегати округлюються до 4 знаків** (`Math.round(x*10000)/10000`) на кожному записі `metrics.json`. `null` лишається `null`.
- **Межі фази — з сесій цієї фази, не клон change-wide годинника.** `phases.<phase>` SHALL мати `startedAt` (найраніший `session.startedAt` фази), `endedAt` (найпізніший `session.endedAt` фази), `durationMs` (сума `session.durationMs` фази — work time) і `leadTimeMs` (лише ця фаза: `endedAt − startedAt`). `durationMs` MUST NOT бути `totals.leadTimeMs` і MUST NOT бути `endedAt − startedAt`. `totals.leadTimeMs` / `totals.durationMs` лишаються change-wide. Трекер, який не знаходить per-phase bounds, сьогодні копіює `totals` / git first-last commit на кожен рядок (Спека = Рев’ю = Apply = Усього = 20 хв 1 с).
- Немає live HTTP, Cursor SDK, нових npm-залежностей, бекфілу вже заархівованих consumer `metrics.json`.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `change-metrics`: leftover attach після порожнього persist/archive collect; hook post-append leftover; sessionEnd фільтр `conversationId`; спільний multi-root `resolveBaseDir`; округлення `costUsdEstimated` агрегатів до 4 знаків; per-phase `startedAt` / `endedAt` / `leadTimeMs` (work `durationMs` не клонує `totals.leadTimeMs`).

## Impact

- `scripts/cursor-spend-hook.cjs` і `templates/scripts/cursor-spend-hook.cjs` — спільний `resolveBaseDir`; після успішного append викликати leftover (fail-open, без stdout). Поведінка байт-синхронна.
- `scripts/cursor-spend-collect.cjs` і `templates/scripts/cursor-spend-collect.cjs` — той самий `resolveBaseDir`; leftover фільтр за `last.threadId`; leftover по кожному кандидату з `openspec/changes`; округлення estimate; `recompute` пише ті самі `phases.*.startedAt` / `endedAt` / `leadTimeMs`, щоб leftover rewrite не зрізав нові поля. Поведінка байт-синхронна.
- `bin/agent-orchestrator.js` — `addNullable` / `recomputeSpendMaps` / `recomputeMetricsAggregates` / session totals: кожен записаний `costUsdEstimated` з сум — 4 знаки; `recomputeMetricsAggregates` пише `phases.*.startedAt` / `endedAt` / `leadTimeMs`; `renderMetricsSummary` друкує `phase.durationMs` як work time і MAY показати межі фази. Persist leftover уже передає `cursorConversationId: last.threadId` — не регресувати.
- `bin/spend-collect.js` — лише якщо фільтр conversationId для sessionEnd виноситься в спільний helper; інакше не змінювати контракт persist.
- `test/smoke.test.js`, `test/spend-collect.test.js` — live-order archive race (+35 с), conversationId leftover, multi-root, 4-decimal aggregates, дві фази з різними годинниками (не клон `totals.leadTimeMs`). Окремий новий тест-файл лише якщо існуючі стануть нечитабельними.
- `README.md`, `CHANGELOG.md` `[Unreleased]` — споживачі бачать hook leftover, conversationId на sessionEnd, multi-root, округлення estimate і per-phase `startedAt` / `endedAt` / `leadTimeMs`. Пише implementer в apply.
- Main spec `openspec/specs/change-metrics/spec.md` мержиться на archive, не в apply. Уже заархівовані consumer `metrics.json` (включно з FE-архівом цього прогону) не чіпаємо.

## Non-goals

- Explorer без restore (`threadId: null`, `startedAt` = first stop) — процес/CLI уже специфіковані.
- Агенти, що лишають `## Metrics` як `unknown` — протокол уже забороняє вигадувати числа; CLI MUST NOT переписувати `## Metrics`.
- Archive handoff з `platform: unknown` / `model: unknown` — не розширювати в rewrite handoff; максимум один рядок як leftover restore-клієнта, якщо без цього не обійтись (у цьому change не вимагається).
- `subagentStop` без токенів — payload Cursor часто без полів; вигадувати MUST NOT.
- Розтягувати `durationMs`, коли leftover `at > endedAt`.
- Бекфіл уже заархівованих consumer `metrics.json`.
- Live HTTP, Cursor SDK, нові npm-залежності.
- Зміна grok cost table / змішування `costUsd` з estimate.
- Протокол `session-handoff` (агентський текст) — поведінка hook/collect живе в `change-metrics`.
- YouTrack / трекер UI — kit лише дає поля в `metrics.json`; експорт і клонування рядків у борді поза scope.
- Вигадані per-phase лічильники комітів — у кіта немає commit ledger; MUST NOT рахувати `git log` на фазу.

## Acceptance criteria

Кожен критерій відповідає бойовому багу. Спостережувана поведінка hook / CLI / `metrics.json`.

1. **Live-order leftover після порожнього archive.** Finalize archive при порожньому jsonl → Archiver `sources: []`. Потім `stop`-рядок з `at = endedAt + 35s` (усе ще `<= endedAt + 120s`) → collect як `sessionEnd` або post-append hook. `Archiver.sources` містить цей `id`, `spendSource: adapter`, totals resync з усіх sources.
2. **Hook post-append leftover.** Після успішного append `stop` / `afterAgentResponse` leftover виконується без окремого `sessionEnd`. Fail-open, stdout порожній. Повторний `sessionEnd` не дублює `source.id`.
3. **conversationId на sessionEnd leftover.** Archiver `threadId: A`, hotfix-рядок `conversationId: B` у leftover-вікні MUST NOT з’являтись у `Archiver.sources`. Рядок з `conversationId: A` у вікні MUST причепитись. Коли `last.threadId` є `null` — time-only (рядки не відкидаються лише через conversationId).
4. **Multi-root: той самий consumer.** У вікні kit + consumer hook MUST писати jsonl у consumer, якщо `conversation_id` збігається з `pending.threadId` / `last.threadId` consumer (або є active change лише там). MUST NOT обирати kit лише тому, що його cwd має `.agents` першим. Один `sessionEnd` MUST оновити archive consumer, не лише kit. Кожен кандидат читає **свій** jsonl.
5. **4 знаки estimate.** Sources `2.3911 + 2.8153 + 1.355` → `spend.costUsdEstimated === 6.5614`, не `6.561400000000001`. Те саме для `spendByPlatform.*.costUsdEstimated`, `spendByModel[].costUsdEstimated`, `phases.*.costUsdEstimated` і session-level. `null` лишається `null`.
6. **Persist leftover не регресує.** `attachLeftoverSources` / `runCollectSpend` і далі передають `cursorConversationId: last.threadId` для cursor. Схема `version: 1`; `costUsd` і `costUsdEstimated` не змішуються; немає HTTP і нових npm-залежностей; hook/collect fail-open. `npx openspec validate fix-cursor-leftover-race-and-multiroot --strict --type change` проходить.
7. **Per-phase wall clock не клонує Усього.** Сесії explore/spec/review/apply з різними `startedAt` / `endedAt` / `durationMs` → `phases.spec.startedAt` / `endedAt` / `durationMs` лише зі spec-сесій; `phases.review.*` не дорівнюють `phases.spec.*`, коли межі різні; жоден `phase.durationMs` не дорівнює `totals.leadTimeMs`, якщо є розрив між сесіями або більше однієї фази з іншим work time. `phases.<phase>.leadTimeMs` = лише ця фаза. `totals.leadTimeMs` лишається earliest→latest по всіх сесіях. Human `metrics` MUST NOT друкувати той самий timestamp/duration для двох фаз з різними session bounds.
