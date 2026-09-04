# Decisions — fix-metrics-amp-cost-lock-leftover

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-09-04 Cost:$N один раз у `spend` / `spendByPlatform.amp` / `phases.*.costUsd`, ніколи на кожен source
- 2026-09-04 Restore без Amp parent: свіжий `session.json lastThreadId` → `amp-session-last`; Amp parent без tty лишає `amp-threads-list`
- 2026-09-04 Leftover без `--collect` лише `last.platform` + Amp thread id / префікс `T-…`; без id не кликати `listRecentAmpThreadIds`
- 2026-09-04 Freeze лише `flag` і числовий `self-report`; leftover `amp-usage` resync токени, billed лишається
- 2026-09-04 `usageModels` унікальні й лише цього thread
- 2026-09-04 `pending.role` через `canonicalRole`; kebab `spec-reviewer` не мапити
- 2026-09-04 Немає дельти `session-handoff`; бекфіл FE-архіву 2026-09-04 поза scope
- 2026-09-04 Review 2026-09-04: REQUEST CHANGES — task 1.2 must accumulate `session.costUsd` fallback once for every qualifying session regardless of aggregate already being non-null
- 2026-09-04 Review 2026-09-04: REQUEST CHANGES — leftover mode with explicit `ampThreadId` collects only that id; `collectAmpCli` must not append env thread id; add test `T-apply` explicit + env `T-archive` not exported
- 2026-09-04 Architect 2026-09-04: Cost fallback accumulates via `addNullable` once per qualifying session regardless of aggregate already billed; three Amp sessions `4.42 + 8.81 + 12.69` → `25.92` (tasks 1.1/1.2/5.1, D1, delta scenario)
- 2026-09-04 Architect 2026-09-04: leftover with explicit `ampThreadId` collects only that id; `collectAmpCli` MUST NOT `push(ampCurrentThreadId(env))` when `listRecentAmpThreads === false`; test `T-apply` + env `T-archive` not exported (tasks 3.1/3.3/5.3, D3)
- 2026-09-04 Spec Reviewer 2026-09-04: APPROVE — Major 1 (per-session Cost fallback via `addNullable`, `$25.92` rollup) and Major 2 (explicit leftover `ampThreadId` excludes env `T-archive`) verified resolved in tasks.md, design.md, delta spec; apply may start
- 2026-09-04 Spec Reviewer 2026-09-04: implementer must keep `scripts/cursor-spend-collect.cjs` byte-identical to `templates/scripts/cursor-spend-collect.cjs` (`cmp` empty) and verify with `npm test`
- 2026-09-04 Implementer 2026-09-04: leftover without `--collect` passes `listRecentAmpThreads: false` and never `ampThreadIdFromEnv`; Amp leftover without threadId/prefix skips collect
- 2026-09-04 Implementer 2026-09-04: `sessionSpendIsFrozen` is only `flag` or numeric `self-report`; leftover resync keeps billed Cost and `spendSource: amp-usage`
- 2026-09-04 Implementer 2026-09-04: exported `recomputeMetricsAggregates`, `sessionSpendIsFrozen`, `attachLeftoverSources`, `runCollectSpend` for acceptance tests; scripts remain `cmp`-identical
