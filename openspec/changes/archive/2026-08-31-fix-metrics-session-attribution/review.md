# Spec Review

**Change:** fix-metrics-session-attribution
**Date:** 2026-08-31
**Verdict:** APPROVE

## Checklist summary
- Proposal: ✓
- Design: ✓
- Tasks: ✓
- Delta specs: ✓

## Re-verified blocking findings (previous REQUEST CHANGES)

All three are fixed in the current artifacts.

1. **leftoverEnd-never-now.** Task 2.2 persist leftoverEnd is `pending.startedAt` if pending exists, else `last.endedAt + 120s`. MUST NOT pass `now`. Leftover is a separate helper (start inclusive at `last.endedAt`; end exclusive at `pending.startedAt`; inclusive at `endedAt+120s`). `metrics --collect` stays attach-to-last-session `[last.startedAt, now]` + `source.id` dedup. Leftover resync (task 3.1) still applies after attach. Task 9.1 copies the same bounds (`leftoverWindowEnd` MUST NOT be `now`).

2. **collect-flag-archiver-window.** Delta `change-metrics` MODIFIES the exact live header `Прапорець `--collect` вмикає локальні адаптери`. Archiver `--collect` window is `[pending.startedAt, now]`. Archive `--collect` is split: leftover vs Archiver. `[last session.endedAt, now]` is no longer the Archiver collect window. The live main-spec title exists, so archive/sync will replace it.

3. **spend-source-title-exact.** Delta `change-metrics` MODIFY header is the exact live title `Джерело spend — прапорці, потім самозвіт, потім опційні адаптери`. «Числовий» / placeholder-not-override lives in the body only. Merge will replace the freeze SHALL.

## LLM-only checklist

**Consistency**
- proposal ↔ design (D1–D9) ↔ tasks ↔ deltas tell the same P0+P1 story — ✓
- Delta specs cover persist/leftover windows, archive duration + post-move `sessionEnd`, sources-only maps, product id, placeholder self-report, `conversationId`, canonical role, protocol — ✓

**Main specs**
- Steal / leftover / `--collect` / spend-source conflicts are resolved by MODIFY of the matching live titles (including `Вікно collect, cwd-match і dedup` and `Archive завжди фіналізує metrics.json після успішного move`). Unmodified requirements (adapters, `## Metrics` parse, platform resolve, Amp timestamp, Cursor estimate) do not re-encode steal — ✓

**Scope**
- No Amp-timestamp, no HTTP spend, no VMS app, no archive backfill — ✓

**Task self-sufficiency**
- Files / Do / Done-when are enough without design.md. Named functions exist (`phaseForRole`, `collectWindowStart`, `metricsBackfillFile`, `resolveSessionSpend`, `leftoverWindowEnd`, …). Task 1.1 exports `canonicalRole` / `phaseForRole`. Task 10.3 includes AC6 (`startedAt` = earliest `source.at` when no pending). Referenced paths exist — ✓

## Notes

Proposal, design D1–D9, `decisions.md`, and AC1–AC10 stay aligned. Design: none is honored. Do not treat the current uncommitted spend-collect WIP as this change — implement from tasks against committed files. Do not backfill `openspec/changes/archive/2026-08-31-*` or consumer ledgers.

Non-blocking: delta «Вікно collect» states leftover as `at < leftoverEnd` and then «+120s (інклюзивно)». Implement the inclusive +120s bound from tasks 2.2 / 9.1, not from that sentence alone.
