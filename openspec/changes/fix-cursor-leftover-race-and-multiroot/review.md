# Spec Review

**Change:** fix-cursor-leftover-race-and-multiroot
**Date:** 2026-09-02
**Verdict:** APPROVE

## Checklist summary
- Proposal: ✓
- Design: ✓
- Tasks: ✓
- Delta specs: ✓

## LLM-only checklist
- Consistency (proposal ↔ design ↔ tasks, no drift): ✓
- Delta specs cover all changed/added behavior in design: ✓
- No conflicts with existing `openspec/specs/` requirements: ✓
- No scope creep vs proposal Non-goals: ✓
- Task self-sufficiency (Files/Do/Done-when without design.md): ✓

## Findings

None blocking.

### Notes (non-blocking)

1. **Live-order test vs current collect.** Task 5.1 Done-when says the +35s case fails on current collect. `incomingCursorSources` already attaches a row that exists at collect time inside the 120s window. The race fix is hook leftover immediately after append (3.1 / 5.2), not a new collect window. Keep 5.1 as a live-order regression (jsonl after empty archive, then collect). Do not invent a third window or a second persist.

2. **Existing +5s leftover fixture.** `sessionEnd leftover after archive…` writes a row with no `conversationId`. Archive in that test uses `CURSOR_AGENT=1` and stripped `CURSOR_CONVERSATION_ID`, so `Archiver.threadId` is `null` and leftover stays time-only. Do not give that fixture a non-null `threadId` without putting the matching `conversationId` on the jsonl row.

3. **Phase bound comparison.** Design D8 requires epoch ms (`parseFlexibleIso` / `Date.parse`), not string ISO compare. Task 7.1 does not spell this. Collect `recompute` today uses string min/max — when adding `startedAt` / `endedAt` / `leadTimeMs`, reuse `earlierTimestamp` / `laterTimestamp` (or `Date.parse`) so leftover rewrite does not drop or mis-order bounds.

4. **Schema paragraph.** Main spec `Файл metrics.json` does not list `phases.*.startedAt` / `endedAt` / `leadTimeMs`. The ADDED requirement plus the MODIFIED aggregates requirement cover the fields. Merge those keys into the schema list at archive; do not treat the old key list as closed.

5. **`decisions.md` vs D8.** Git `decisions.md` lists D1–D7 only. D8 is in design, proposal, tasks, delta, and `handoff.md`. No implementer gap.

6. **D2 stdin/export** is an implementation constraint in design + tasks 1.2 / 3.1, not a separate SHALL in the delta. Observable leftover behavior is specified. Fine.

## Repository check

Referenced paths exist and match the named APIs: `scripts/cursor-spend-hook.cjs` / `templates/scripts/cursor-spend-hook.cjs` (`resolveBaseDir` = first `.agents`), `scripts/cursor-spend-collect.cjs` / `templates/scripts/cursor-spend-collect.cjs` (`resolveBaseDir` = first `openspec/changes`, `incomingCursorSources`, `leftoverWindowEnd`, `leftoverEndExclusive`, stdin on load), `bin/agent-orchestrator.js` (`attachLeftoverSources` already passes `cursorConversationId: session.threadId` for cursor; `addNullable` / `recomputeSpendMaps` / `recomputeMetricsAggregates` / `renderMetricsSummary`), `bin/spend-collect.js` (`collectCursor` filter), `test/smoke.test.js` (`makeArchiveFixture`, existing +5s leftover), `test/spend-collect.test.js` (`CURSOR_CONVERSATION_ID=Y`), `README.md` Change metrics, `CHANGELOG.md` `[Unreleased]`.

D1–D8 match proposal What Changes, ACs 1–7, tasks 1–7, and the delta ADDED/MODIFIED requirements. Non-goals hold: no `session-handoff`, no FE-archive backfill, no HTTP / SDK / new deps, no grok-table change, no per-phase `git log`.

## Verdict

APPROVE
