# Spec Review

**Change:** fix-metrics-model-and-spend
**Date:** 2026-08-29
**Verdict:** APPROVE
**Tier:** 2 (LLM review). Tier 1 `gate-check --review fix-metrics-model-and-spend` passed before this review; strict validation, contract field presence, proposal sections and delta-spec section structure were not re-checked.

## Checklist summary
- Proposal ↔ design ↔ tasks: ✓
- Conflicts with `openspec/specs/`: ✓ (additive only)
- Scope vs Non-goals: ✓
- Task self-sufficiency: ✓ (pitfalls captured in `apply-notes.md`)

Proposal, design, deltas, and tasks now tell one story: LLM product id, per-platform auto-collect, no unified bill, archive always finalizes, metrics never a gate. Main specs `session-handoff` and `lean-archive` are ADDED-only. No main `change-metrics` spec exists (new capability). Claimed paths exist (`bin/agent-orchestrator.js` metrics + `metricsFinalizeArchive` early-return, `resolveMetricsFile` already finds `archive/*-<name>`, `phaseForRole`, `--no-metrics` → `opts.metrics`, `log.warn`/`log.err` write stdout, smoke ~1311/1664, README `### Change metrics` ~800, `opsx-archive.md` 1403 bytes, ESM `import` OK). `gate-check` does not read `metrics.json`. Vue skipped (Node CLI kit).

Older `decisions.md` lines (`spend-null-honest` never-scrape; first `archive-always-finalize`) are append-only history. Later `adapters are allowed` / `usd-archive-warn` / specs / tasks are the live rule.

## Prior must-fixes (re-check)

### 1. Archive warning = `spend.costUsd === null` via `console.error` — closed

Proposal acceptance, D4, `change-metrics` archive requirement, `lean-archive`, task 2.1 / 3.2, and `usd-archive-warn` all warn when `spend.costUsd === null` through `console.error`. Amp credits and filled tokens do not cancel. `sessions.length === 0` and `METRICS_SPEND_KEYS` are explicitly dropped. D4 no longer says `log.warn`.

### 2. Amp match = `env.initial.trees[].uri` after strip `file://` — closed

D9/D11, `change-metrics` (adapter + window + skip-without-trees scenario), and tasks 5.2 / 5.6 match `collectSpend` `cwd` to `trees[].uri` after strip `file://` (`file:///home/...` → `/home/...`). Multi-root any-tree; no trees → skip; no `meta.cwd`. `ledger.jsonl` optional; absent → `ampCredits: null`.

### 3. Claude encode `/` and `.` → `-`; window `timestamp`; `cache_*` in input — closed

D9, `change-metrics`, and tasks 5.1 / 5.6 encode both `/` and `.`, filter window on line `timestamp`, add `cache_*` to `inputTokens`, and compare row `cwd` to the `collectSpend({ cwd })` argument (tmp tests not tied to the kit repo path).

### 4. Task 5.4 session totals + `session.models` + recompute — closed

Task 5.4 Do/Done-when: no flags → session totals = source aggregate; any spend flag overrides those four fields and must not clear maps/`sources`/`session.models`; write `session.models` when unique source models > 1; `recomputeMetricsAggregates` takes `spend.costUsd` from session USD else source USD (no double-count). Smoke in 5.4 Done-when and 5.6: Claude fixture without `--cost-usd` fills `sessions[0].totalTokens` from sources. `change-metrics` scenario “Без spend-прапорців totals сесії з sources” matches.

## Suggestions (non-blocking)

- **Archiver window:** compute `[last prior session.endedAt || createdAt, now]` *before* appending Archiver. If 2.1 pushes Archiver first and 5.4 then uses “last session”, the window collapses to `[now, now]`.
- **`opsx-archive.md`:** 1403 bytes now; the required 3.2 sentence overflows 1536 unless step 3 is shortened. Constraint is already in the task.
- **D2 model-null warning on archive:** persist is covered (1.1 / 5.4). Task 2.1 does not warn when Archiver `model` stays null. Spec still says warn on any null-model write — emit the same `console.error` on finalize if final model is null.
- **`phases.*.models`:** spec unions `session.model` and `session.models`; task 5.4 only changes spend recompute. Merge `session.models` when touching `recomputeMetricsAggregates`.
- **Cursor success path** remains best-effort (unknown vscdb schema). Done-when is the empty/skip path; do not invent tokens from `text.length`.
- **`--cost-usd` alone:** 5.4 “any flag → session totals from flags” nulls session token fields; file `spend.*Tokens` still come from sources via the session-else-source rule. Do not treat that as wiping maps.

## Verdict

**APPROVE.** `apply-notes.md` written. Do not start `/opsx:apply` in this session.
