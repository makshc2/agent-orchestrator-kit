## Why

Журнал `metrics.json` на бойовому change (VMS `align-unavailable-cameras-admin-ui`, kit v0.10.0, 9 сесій Cursor) непридатний: persist краде пізній Cursor-stop попередньої сесії, leftover не перераховує totals, archive пише нульову тривалість і після move втрачає stop, карти моделей дублюють family id, `--model` перемагає product id з hook. Виправляємо атрибуцію сесій, поки споживачі рахують spend по цьому журналу.

Design: none

## What Changes

- **Вікно persist цієї сесії** стає `[pending.startedAt, endedAt]`. Нижня межа більше НЕ є `last.endedAt`. Подія між `last.endedAt` і `next.pending.startedAt` належить попередній сесії через leftover, не наступному persist.
- **Leftover (sessionEnd + persist/archive backfill)** чіпає події після `last.endedAt` до `pending.startedAt` (якщо pending є) або до `last.endedAt + 120s` (якщо pending немає). Dedup за `source.id`. Після attach totals останньої сесії SHALL перераховуватись із **усіх** її sources, якщо немає числового (не-placeholder) самозвіту чи прапорців.
- **Archive:** якщо `pending` null — записати `pending.startedAt = now` на старті; leftover на останню не-Archiver сесію з кінцем = цей `pending.startedAt`; collect Archiver у `[pending.startedAt, finalize now]`; `durationMs` = дельта, не `null`. Після move `sessionEnd` MUST бачити найсвіжіший `openspec/changes/archive/*-<name>/metrics.json`.
- **Модель:** коли `sources` мають model — `session.model` і `phases.*.models` беруть adapter product id (primary = max `totalTokens`). `--model` / `## Metrics` / `AOK_MODEL` лише коли в sources немає model. Family `cursor-grok-4.6` MUST NOT стояти в `spendByModel` поруч із `cursor-grok-4.6-low`.
- **Агрегати:** якщо `sources.length > 0` — карти й phase spend лише з sources (сума всіх). Session-level поля йдуть у карти лише коли sources порожні.
- **Placeholder самозвіт** (`unknown` / `none` + `spend_source: self-report`) більше не заморожує totals. Leftover MAY resync; `spendSource` стає `adapter`.
- **startedAt без restore:** earliest `source.at` цієї сесії, інакше `null`. Два persist лишаються двома записами.
- **Канонічна роль:** `session.role` / `phases.*.agents` = токен `Explorer|Architect|Spec Reviewer|Implementer|Archiver|Design Intake`. Речення після `—` не пишеться в metrics. `phaseForRole` матчить Architect/propose **до** review.
- **conversationId:** Cursor-адаптер фільтрує за `CURSOR_CONVERSATION_ID` / `pending.threadId`, коли id є; чужі рядки skip. Restore пише Cursor conversation id у `pending.threadId`.
- Протокол Session Exit: не ставити family як єдину модель, коли hook дає product id; не ставити `spend_source: self-report`, коли токени `unknown`.
- Немає live HTTP, нових npm-залежностей, бекфілу вже заархівованих consumer `metrics.json`.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `change-metrics`: вікно persist/leftover/archive, resync totals з sources, карти лише з sources, product id з адаптера, канонічна роль, Cursor `conversationId`, startedAt без restore, placeholder самозвіт не override.
- `session-handoff`: `## Metrics` / `--model` — product id, не family; `unknown` токени не маркуються `spend_source: self-report`; Closed role у metrics — канонічний токен.
- `lean-archive`: один рядок-вказівник — Archiver `durationMs` більше не `null` (семантика лишається в `change-metrics`).

## Impact

- `bin/agent-orchestrator.js` — `phaseForRole`, `collectWindowStart`, `resolveSessionSpend`, `applyCollectedSessionFields`, `metricsBackfillLastSession` / `keepReportedTotals`, `recomputeSpendMaps`, `recomputeMetricsAggregates`, `metricsRecordSessionEnd`, `metricsFinalizeArchive`.
- `bin/spend-collect.js` — вікно Cursor + фільтр `conversationId`.
- `bin/session-client.js` — restore пише `CURSOR_CONVERSATION_ID` у `pending.threadId`.
- `scripts/cursor-spend-collect.cjs` і `templates/scripts/cursor-spend-collect.cjs` — leftoverWindowEnd, looksOverridden / syncAdapterSessionTotals, не скіпати `archive/` наосліп. Поведінка байт-синхронна.
- `test/spend-collect.test.js`, `test/smoke.test.js`, `test/session-client.test.js` — інверсія steal-тестів, leftover resync, archive duration, conversationId, канонічна роль.
- `README.md`, `CHANGELOG.md` `[Unreleased]` — вікно і model rules для споживачів.
- `templates/.agents/rules/session-handoff.mdc` і дзеркала (skill, субагент) — протокол product id / placeholder spend_source.
- Main specs мержаться на archive, не в apply. Уже заархівовані consumer `metrics.json` не чіпаємо.

## Non-goals

- Нормалізація Amp timestamp / плейсхолдер `amp-default` (вже є).
- Live HTTP, Cursor SDK, нові npm-залежності.
- Зміна grok cost table / змішування `costUsd` з estimate.
- Factory Control Plane UI.
- Код застосунку VMS.
- Політика `archive_after_merge`.
- Окремий баг `openspec new change`, коли explore вже зробив mkdir.
- Перепис історичних архівів у цьому репо (`openspec/changes/archive/2026-08-31-*`) і бекфіл consumer ledger.

## Acceptance criteria

Кожен критерій відповідає бойовому багу. Спостережувана поведінка CLI / `metrics.json`.

1. **Немає cross-session steal.** Persist A закритий. Cursor-stop з `at` = `endedAt_A + 20s` (до restore B). Persist B з `--collect` НЕ має цього id у `sessions[B].sources`. Leftover (sessionEnd або persist/archive backfill) додає id до `sessions[A].sources`. `sessions[B]` не краде токени A.
2. **Leftover resync totals.** Сесія має `spendSource: self-report`, усі числа `unknown`/null, і два leftover sources (наприклад 954984 і 508064). Після leftover `session.inputTokens` = сума всіх sources, `spendSource: adapter`. Phase spend цієї фази = сума всіх sources фази, не заморожене перше source.
3. **Archive duration + leftover після move.** На старті archive без pending з’являється `pending.startedAt`. Archiver має `startedAt` = цей pending, `endedAt` = finalize, `durationMs > 0`. Hook між `lastNonArchiver.endedAt` і archive-pending йде в leftover попередньої сесії, не в Archiver. Після move `sessionEnd` дописує пізній stop (+5s) у найсвіжіший `openspec/changes/archive/*-<name>/metrics.json`.
4. **Карти лише з sources.** `--model cursor-grok-4.6` і sources з `cursor-grok-4.6-low`: `spendByModel` містить `cursor-grok-4.6-low` і НЕ містить окремого рядка family `cursor-grok-4.6`. `phases.*.spend` = сума sources фази.
5. **Product id, не family.** Коли sources мають model, `session.model` і `phases.*.models` = adapter product id (primary = max `totalTokens`), навіть якщо `--model` / `## Metrics` були family.
6. **startedAt без restore.** Persist без pending і без `--started-at`, але з sources: `startedAt` = earliest `source.at`, `durationMs` = дельта. Без sources — `startedAt` і `durationMs` лишаються `null`. Два послідовні persist без restore лишаються двома записами.
7. **Канонічна роль.** Closed role `Architect — propose complete, ready for Spec Reviewer` → `session.role === "Architect"`, `phase === "spec"`, не `review`. `phases.spec.agents` містить `Architect`, не повне речення.
8. **conversationId.** Hook з `conversationId: X` пропускається, коли `pending.threadId` або `CURSOR_CONVERSATION_ID` є `Y`. Restore з `CURSOR_CONVERSATION_ID` пише це значення в `pending.threadId`. Без id на pending/env — time-only collect як раніше (рядки не відкидаються лише через відсутній id).
9. **Placeholder не override.** `## Metrics` усі `unknown` + `spend_source: self-report` + два leftover sources → session totals = сума sources, `spendSource: adapter`. Числовий самозвіт і `--input-tokens` як і раніше перемагають.
10. **Контракт без регресій.** Схема `version: 1`; `costUsd` і `costUsdEstimated` не змішуються; немає HTTP і нових npm-залежностей; persist fail-open; `--collect` = усі адаптери; без `--collect` = locked client. `npx openspec validate fix-metrics-session-attribution --strict --type change` проходить.
