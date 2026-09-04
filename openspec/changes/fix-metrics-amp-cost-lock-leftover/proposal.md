## Why

На kit після live watch 2026-09-04 (registration-log-fe, `issue-card-sticky-new-visitor`, 7 сесій, `archivedAt` 2026-09-04T13:11:20.920Z) Amp billed Cost:$N уже потрапляє в `session.costUsd` ($4.42 + $8.81 + $12.69 = $25.92), але `recomputeSpendMaps` сумує лише `sources[].costUsd` і пропускає session billed — фінальні `spend.costUsd` і `spendByPlatform.amp.costUsd` лишаються `null`, а `spend.costUsdEstimated` = $8.48 лише з Cursor. Restore Amp-агента без `AMP_*` / tty пише `pending.platform/threadId: null`; leftover без `platforms` і з `threadId: null` підхоплює чужі Amp threads і Cursor hook. Виправляємо rollup, lock, leftover і stale tokens, поки споживачі читають цей журнал як рахунок change-у.

Design: none

## What Changes

- **AMP-COST-DROP.** Коли `sources.length > 0`, але сума `sources[].costUsd` **цієї сесії** є `null`, агрегати MUST додати `session.costUsd` один раз **на кожну кваліфікуючу сесію** (через `addNullable`) у `spend.costUsd`, `spendByPlatform.amp.costUsd` і `phases.<phase>.costUsd`. Наявне значення агрегату MUST NOT блокувати наступну сесію (`$4.42 + $8.81 + $12.69` = `$25.92`). MUST NOT копіювати той самий Cost на кожен message source (не $N × N). `costUsd` і `costUsdEstimated` лишаються окремими.
- **RESTORE-NO-LOCK.** Якщо Amp-env / Cursor-env / Claude-env не перемогли і батько **не** є `amp`, а `~/.local/share/amp/session.json` має свіжий `lastThreadId` (вікно ≤ 2h, як tty-hint; свіжість з `updatedAt` або mtime файла), restore SHALL залочити `platform: amp`, `threadId: lastThreadId`, `clientSource: amp-session-last`. Amp-env і далі б’є Cursor-env. Батько `amp` без tty і далі бере id з `amp threads list`, MUST NOT з `lastThreadId`.
- **LEFTOVER-CROSS-SESSION.** Leftover collect MUST бути scoped до `last.platform` (не всі адаптери). Amp leftover MUST причіплювати лише sources, чий thread id дорівнює `last.threadId`, або — якщо `threadId` є `null` — префікс `T-…` до `:` з наявних `sources[].id`. Якщо немає ні id, ні префікса — Amp leftover MUST NOT викликати `listRecentAmpThreadIds`. У leftover-режимі з явним `ampThreadId` `collectAmpCli` MUST зібрати лише цей id і MUST NOT додавати `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` з env (явний `T-apply` + env `T-archive` не експортує чужий thread). Cursor leftover на Amp-сесії MUST NOT причіплюватись без `--collect`. ExclusiveEnd (`at` ≥ `pending.startedAt` наступної сесії) лишається.
- **SESSION-TOKEN-STALE.** `sessionSpendIsFrozen` SHALL заморожувати лише `flag` і **числовий** `self-report`. `amp-usage`, `adapter`, `unreported` і placeholder self-report MUST після leftover перерахувати session-токени з усіх sources. `session.costUsd` з Amp Cost MUST лишатись, якщо usage його ще віддає; не дропати billed лише тому, що sources без per-message `costUsd`. Токени з sources; `spendSource` лишається `amp-usage`, якщо cost прийшов з usage.
- **USAGE-MODELS-DUP.** `usageModels` SHALL містити моделі **лише цього session thread**, унікальні за іменем моделі (залишити рядок з більшим totalTokens; при рівності — останній). Чужі threads і дублікати Luna/Fable/Sol MUST NOT мержитись.
- **ROLE-NOT-CANONICAL.** `pending.role` SHALL бути канонічним токеном (`Archiver`), не реченням Closed/next role. `handoff.md` MAY лишати речення після `—`.
- Немає live HTTP, Amp billing API, Cursor SDK, нових npm-залежностей, бекфілу вже заархівованих consumer `metrics.json`. Grace leftover лишається 120s.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `change-metrics`: Amp Cost:$N у `spend` / `spendByPlatform.amp` / `phases.*.costUsd` після recompute, коли sources без `costUsd`; restore `amp-session-last` без Amp parent; leftover scoped до `last.platform` і thread id; leftover resync токенів після `amp-usage`; `usageModels` лише цього thread без дублікатів; `pending.role` — канонічний токен.

## Impact

- `bin/spend-collect.js` — `collectAmpCli` не викликає `listRecentAmpThreadIds`, коли leftover має відомий thread або не має thread id взагалі; leftover з явним `ampThreadId` не додає env-thread (`AMP_CURRENT_THREAD` / `AMP_THREAD_ID`) у `ids`; incoming Amp leftover фільтрується за thread prefix; Cost лишається на `ampThreads[].costUsd`, не копіюється на кожен source.
- `bin/agent-orchestrator.js` — `recomputeSpendMaps` / `recomputeMetricsAggregates`: якщо сума `sources[].costUsd` є `null`, додати `session.costUsd` один раз у spend, platform amp і фазу; leftover передає `platforms: [last.platform]` і thread filter; `sessionSpendIsFrozen` лише `flag` + числовий `self-report`; `usageModels` дедуп цього thread; `metricsRecordSessionStart` пише `pending.role` через `canonicalRole`.
- `bin/session-client.js` — `detectSessionClient`: після провалу env і коли батько не `amp`, свіжий `session.json.lastThreadId` → `amp` / `amp-session-last`. Регресія: Amp parent без tty лишає `amp-threads-list`.
- `scripts/cursor-spend-collect.cjs` і `templates/scripts/cursor-spend-collect.cjs` — той самий Cost-once fallback у `recompute`, щоб leftover rewrite після archive не зрізав `spend.costUsd`. `cmp` scripts↔templates порожній.
- `test/spend-collect.test.js`, `test/session-client.test.js`, `test/smoke.test.js` (або `test/metrics-readable.test.js`) — сім acceptance-кейсів нижче. Наявний асерт `ampThreads[0].costUsd` лишається; додати `spend.costUsd` і `spendByPlatform.amp.costUsd` після persist/recompute.
- `README.md`, `CHANGELOG.md` `[Unreleased]` — споживачі бачать Amp billed у rollup, `amp-session-last`, leftover thread-scope, leftover token resync. Пише implementer в apply.
- Main spec `openspec/specs/change-metrics/spec.md` мержиться на archive, не в apply. Уже заархівовані consumer `metrics.json` (включно з FE-архівом `2026-09-04-issue-card-sticky-new-visitor`) не чіпаємо.

## Non-goals

- Бекфіл FE/VMS архівів
- Amp credits parser, disk thread files, hook duplicate events
- Ширше leftover вікно, HTTP, нові npm-залежності
- Зміна Cursor estimate table / змішування billed і estimate
- Протокол агентського тексту `session-handoff` окрім канону `pending.role` якщо він уже в change-metrics

## Acceptance criteria

Кожен критерій відповідає бойовому багу. Спостережувана поведінка CLI / `metrics.json`.

1. **Amp Cost у rollup, не ×N.** Фікстура Amp-сесії з 3+ sources, усі `sources[].costUsd` null, `session.costUsd` 12.69 з Cost:$N → після recompute `spend.costUsd === 12.69`, `spendByPlatform.amp.costUsd === 12.69`, `phases.apply.costUsd === 12.69`. Не 3×12.69. Три такі сесії з `4.42`, `8.81`, `12.69` → `spend.costUsd === 25.92` і `spendByPlatform.amp.costUsd === 25.92` (не зупиняється після першого внеску).
2. **Restore amp-session-last.** Немає `AMP_*` / `CURSOR_*` / Amp parent / usable tty, але `session.json` має свіжий `lastThreadId=T-lock` → `pending.platform === amp`, `pending.threadId === T-lock`, `clientSource` містить `amp-session-last`. Persist без `--collect` все одно збирає цей thread.
3. **Amp parent без tty не регресує.** Батько `amp` + немає tty → `amp threads list`, не `lastThreadId`.
4. **Leftover не чіпає чужий thread.** Закритий Implementer `threadId: null` з source ids `T-apply:8`… MUST NOT причепити `T-archive:2` і MUST NOT причепити Cursor hook-рядки. Те саме, коли `threadId` є `T-apply`. Явний leftover `ampThreadId: T-apply` плюс env `AMP_CURRENT_THREAD=T-archive` MUST NOT експортувати / зібрати `T-archive`.
5. **amp-usage leftover resync токенів.** Після leftover сесія з `spendSource: amp-usage`, stale 495184 токенів і новими sources на ~1.18M → `session.inputTokens` = сума sources; `session.costUsd` лишається з Cost, якщо usage його віддав; `spendSource` лишається `amp-usage`.
6. **usageModels унікальні й цього thread.** Після leftover кожна модель щонайбільше один раз і лише з session thread.
7. **pending.role канонічний.** Restore з Closed/next role `Archiver — deferred until the CI-green…` → `pending.role === Archiver`.
