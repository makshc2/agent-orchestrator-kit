# Spec Review

**Change:** surface-estimated-spend
**Date:** 2026-08-31
**Verdict:** APPROVE

Role: `spec-reviewer` (Tier 2). Apply is already landed (11/11 `[x]`); this review is the archive gate, not a license to re-implement. Tier 1 `gate-check --review` is not re-litigated.

Scope: `proposal.md`, `design.md`, `tasks.md`, `decisions.md`, delta `specs/change-metrics/spec.md`, `openspec/config.yaml`, main `openspec/specs/` (all 18 capabilities; spend/estimate hits only in `change-metrics` plus compatible `session-handoff` / `lean-archive` pointers), and referenced paths `bin/cursor-cost-estimate.js`, `bin/spend-collect.js`, `bin/amp-usage.js`, `bin/agent-orchestrator.js`, `test/metrics-readable.test.js`, `test/spend-collect.test.js`, `README.md`, `CHANGELOG.md`.

## LLM-only checklist

**Consistency**
- [x] proposal ↔ design ↔ tasks tell the same story — no contradictions or drift
- [x] Delta specs cover all changed/added behavior described in design

**Main specs**
- [x] No conflicts with existing `openspec/specs/` requirements

**Scope**
- [x] No scope creep vs proposal Non-goals

**Task self-sufficiency**
- [x] A blind implementer can execute each task from Files/Do/Done-when alone, without reading design.md

## Verdict rationale

Locked decisions, proposal What Changes / Acceptance criteria (11), design D1–D5, tasks 1.1–5.2, and the six MODIFIED `change-metrics` requirements describe one contract: `costUsdEstimated` is first-class and never mixed into billed `costUsd`; Cursor always estimates when tokens exist (grok = `api-estimate`, else versioned `$3/$15` or `$3.50/1M` total with `api-estimate-fallback`); Amp billed only from `Cost: $N` (else `null`); Claude unchanged; no live HTTP; no archive backfill; Factory Control Plane out of scope.

All six delta `### Requirement:` headers are byte-identical to main `openspec/specs/change-metrics/spec.md`. After `archive --sync` the grok-only MAY and the blanket “MUST NOT compute USD from tokens” sentences are replaced, not left as survivors. No other capability mandates grok-only estimate, live prices, or credits→USD.

Every Files path exists. Named symbols exist (`ratesForModel`, `estimateCursorCostUsd`, `describeCursorCostEstimate`, `collectCursor`, `parseAmpUsageDetails`, `METRICS_SPEND_KEYS`, `emptySpendTotals`, `formatMetricsCostLine`, `resolveSessionSpend`, `sourceEstimatedUsd`, `isDirectCliRun`). Tasks 1.1–1.3, 2.1–2.2, 4.2–4.3, 5.1–5.2 give numeric Done-when values that match AC2–AC4 and AC8. Lock-in tasks 3.1 and 4.1 name the files and the invariants to preserve.

## Findings

No blocking or medium findings.

### Low (non-blocking)

**L1 — `totalTokens`-only estimate is estimator-scoped, not collect.** Design D2 / delta point 3 / AC3 specify `$3.50/1M` when both input and output are null but `totalTokens` is set. Task 2.1 keeps the existing collect skip (`inputTokens` and `outputTokens` both null) and does not pass `totalTokens` into `describeCursorCostEstimate`. The hook schema has no `totalTokens` field; the delta scenario names `bin/cursor-cost-estimate.js`. Grok+`totalTokens`-only therefore stays `null` on the grok early-return (task 1.1), which matches AC3’s non-grok grouping. Do not “fix” collect skip during archive.

**L2 — Amp `costSource: "amp-usage"` is in design/delta/AC4, not a task Do line.** Task 3.1 locks fail-open `parseAmpUsageDetails` and forbids tokens→USD. Existing `collectAmp` already sets `costSource` only when `usage.costUsd != null`. Do not infer Amp USD from the Models table when `Cost:` is missing (design D3).

**L3 — Archive human summary column list is unchanged.** Unmodified `Archive друкує людську зводку` still parenthesizes tables as `costUsd` / `ampCredits` without `costUsdEstimated`, but it already requires the same renderer as `metrics` (MODIFIED to `formatMetricsCostLine` + estimate columns). Shared rendering aligns them. Do not add a second archive formatter or a Factory UI.

**L4 — AC7 mixed-session aggregate has no dedicated test task.** Task 4.1 is lock-in of `addSpendNums` / `recomputeSpendMaps` / `emptySpendTotals`. The delta scenario specifies cursor `1.25` est + claude `0.42` billed. Sufficient to implement; coverage is a verify/code-review concern. This change’s live `metrics.json` is not a schema fixture — do not backfill archives to “fix” it.

## Checks that passed

- Non-goals vs tasks: no HTTP, no credits→USD, no Claude table, no billed mixing, no Factory board, no agent-invented Cursor invoice, no archived-file rewrite.
- `session-handoff` still forbids invented `cost_usd`; this change only keeps self-report in `costUsd` and out of `costUsdEstimated`.
- `lean-archive` still defers metrics finalize to `change-metrics`; no extra delta needed.
- Proposal AC11 / tasks 5.1–5.2 document the consumer field without promising live prices.
