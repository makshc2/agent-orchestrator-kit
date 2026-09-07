# Spec Review

**Change:** fix-metrics-dedup-window-compact-schema
**Date:** 2026-09-07
**Verdict:** APPROVE

## Checklist summary
- Proposal: ✓
- Design: ✓
- Tasks: ✓
- Delta specs: ✓

## Findings (ordered by severity: Blocker / Major / Minor / Nit)

No blocker, major, minor, or nit findings remain.

### N2 verification — resolved
- `design.md:25` says: `windowStart = (startedAt взято з --started-at || pending.startedAt) ? startedAt − 120s : startedAt`.
- `tasks.md:37` says: `windowStart = (startedAt взято з --started-at || pending.startedAt) ? startedAt − 120000 : startedAt`.
- Both key grace on start provenance: explicit `--started-at` wins and receives grace even without pending; pending start receives grace; `last.endedAt` and `metrics.createdAt` do not. This matches `specs/change-metrics/spec.md:335,339`. The obsolete `pending ? startedAt` formula has zero hits.

### N1 verification — intact
- `specs/change-metrics/spec.md:550,608,972,1016-1024` consistently require the Archiver window `[pending.startedAt − 120s, now]`, leftover-first with `leftoverEnd = pending.startedAt`, deduplication against all session `sourceIds`, and exclusion before the grace bound.
- This agrees with `proposal.md:13` and task 2.1 (`tasks.md:37-38`).

## Notes
- Every `120` occurrence was inspected. Duration literals unrelated to timing appear only as fixture token values (`spec.md:77,433,435`). All timing occurrences consistently describe either the provenance-based collect grace, the Archiver grace window, or the null-thread leftover cap.
- The 18 task contracts identify executable files, behavior, and completion checks. Existing referenced files/functions are present; `bin/claude-cost-estimate.js` is explicitly marked new.
- The existing main requirements affected by persisted `sources`, collection windows, Amp usage, archive behavior, and session exit are represented by modified delta requirements; no uncovered conflict or scope creep was found.
- The two required cursor script/template `.cjs` pairs are byte-identical. The current always-apply template rules total 11,607 characters (`wc -m`) and 12,028 bytes (`wc -c`); the specified budget is characters.
