# Spec Review

**Change:** add-agent-hook-runtime
**Date:** 2026-11-16
**Verdict:** APPROVE

## Checklist summary

- Proposal ✓ — the Why, What Changes, Capabilities, Non-goals and Acceptance criteria match design and tasks. The Modified Capabilities line for `pipeline-subagents` now names the byte-identical parent block in both apply twins (proposal.md:21).
- Design ✓ — the v1 store contract is internally consistent (design.md:62-79 comment block and the `ctx` paragraph at design.md:82):
  - hierarchy worktree→session→agent, with `change` as an orthogonal namespace attribute;
  - the default store for each identity case;
  - quarantine for a missing required id;
  - the worktree level never quarantines.
- Tasks ✓ — tasks 1.1 and 1.2 Do/Done-when restate the same store rules with fixtures for each case (tasks.md:5, 10-11). Every task is executable from Files/Do/Done-when without design.md.
- Delta specs ✓ — `agent-hook-runtime` restates the levels in "Policies share a versioned event and store contract" (spec.md:54). It adds the scenarios "Deliberately coarse worktree lease", "Unbound session keeps its own namespace" and "Null session identity writes are quarantined" (spec.md:66-81). The `pipeline-subagents` and `agentic-factory-roadmap` deltas are unchanged and consistent.

LLM-only checklist:
- ✓ proposal ↔ design ↔ tasks tell the same story
- ✓ Delta specs cover all changed/added behavior described in design
- ✓ No conflicts with existing `openspec/specs/` requirements. `ensureCursorSpendHook` stays restricted (change-metrics spec.md:913; design.md:19; task 2.1). The session-checkpoint strict reading is an accepted documented risk (design.md:122).
- ✓ No scope creep vs proposal Non-goals
- ✓ A blind implementer can execute each task from Files/Do/Done-when alone

## Notes

- Rescan of the same defect class found nothing blocking:
  - every task Do is executable without design.md;
  - every design behaviour has a delta requirement or scenario, including the store identity cases, ownership manifest, identity hand-off, binding token TTL, capability-status location, parent-apply block, snapshots and briefing;
  - there is no proposal↔tasks drift.
- Every referenced path exists:
  - `bin/instruction-mirrors.js` (`syncInstructionMirrors`), `bin/recovery-sources.js` (`collectRecoverySources`), `bin/session-recovery.js` (`buildRecoveryBriefing`);
  - `templates/scripts/sync-local-agent-skills.sh`, `templates/.agents/rules/session-handoff.mdc`;
  - `opsx-quick.md`, which says "Apply is parent-driven exactly as in `/opsx:apply`".
- Sibling consistency: `add-agent-workflow-automation` design.md:15 and :43 and its task 3.2 cite the same contract. That contract covers the default-store derivation, `ctx.storeFor('worktree')` as one shared namespace including null-session events, and lease contention by a null-session writer in the Done-when. So mutual exclusion holds, and the sibling preflight has a matching contract to compare against.
- Minor (non-blocking): design.md:88 and the delta "Identity unavailable" say change/role/task "may still be bound" for a null-session event. But `hooks bind` (task 3.4) lists `--session <id>` as required, and no task defines how a null-session event resolves a `changeId`. The store contract is still well-defined either way, because `storeFor('change')` works only when `changeId` is bound and otherwise quarantines with a diagnostic. During apply, treat such an event as unbound unless an explicit binding resolves it. Never infer it by worktree or recency.
- Minor (non-blocking): task 1.1 describes `ctx.storeFor`, while 1.2 implements `createStore` and the re-scope helper. Test 1.1 against a fake store and wire in the real one in 1.2.

## Previous findings

- N1 — resolved:
  - design.md:64-78 makes change orthogonal ("session namespace never includes changeId and binding never moves it"). Required null ids quarantine, keyed by event id, with a diagnostic. "The worktree level never quarantines".
  - design.md:82 gives the default store per case: agent (session+agent), session (session only, including unbound), and quarantine for a null session. `storeFor('worktree')` is available to all events, including null-session ones. `storeFor('change')` works only when a change is bound. Session and agent levels require their ids.
  - tasks.md:5 (1.1) and tasks.md:10-11 (1.2, with fixtures for each case) say the same.
  - The delta scenarios at agent-hook-runtime spec.md:66-81 say the same.
  - The sibling's task 3.2 (its tasks.md:34-35) holds mutual exclusion for null-session writers.
- Prior Minors n1–n7 (context):
  - n1 resolved: TTL ≤ 1h, single-use, `--token <token> [--agent <id>]` (tasks.md:44).
  - n2 resolved: capability status is kept in `aok-hooks/v1` (design.md:17, task 2.1).
  - n3 resolved: start context is authoritative and status is advisory (design.md:88, task 3.4).
  - n4 resolved: proposal.md:21.
  - n5 accepted risk: design.md:122.
  - n6 resolved: the sync script is named in task 3.4.
  - n7 resolved: the sibling design.md:15 now lists `ctx.storeFor`.
