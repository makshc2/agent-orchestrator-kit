# Decisions — add-agent-workflow-automation

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-11-16 Dependency: apply only after add-agent-hook-runtime has been merged and archived; review the shared contract with that proposal.
- 2026-11-16 Verification: bind command results to relevant working-tree inputs and execution stability; checkbox and handoff progress alone do not invalidate test evidence.
- 2026-11-16 Enforcement: explicit opt-in, bounded follow-ups and cancellation handling; preserve the default nonblocking test-discipline behavior.
- 2026-11-16 Sync: use explicit ownership for automated update/sync; preserve foreign files and existing legacy sync behavior.
- 2026-11-16 Delivery scope: reuse existing opt-in CI archive; no automatic approvals, task completion, commits, npm publishing or fleet updates.
- 2026-11-16 Namespace placement (architect assumption): jobs lease, owned-sync manifest and bindings at worktree level; evidence and completion intent at change level; follow-up budget at default session/agent store. Reviewer should confirm.
- 2026-11-16 hooks.policies.<id>.options is policy-owned; dispatch reads only enabled and mode.
- 2026-11-16 Out of scope: auto-approve, auto-commit, publishing, fleet rollout, Phase 4, any rename of the frozen v1 contract.
- 2026-11-16 Namespace placement (worktree: jobs lease, manifest, bindings; change: evidence, completion intent; session/agent: follow-up budget) is viable but must be stated in tasks.
- 2026-11-16 Non-blocking Major/Minor notes are in review.md (task 5.1 mirrors ambiguity, task 4.1 service API, design-only items without spec/task, evidence namespace, Claude Stop mapping).
- 2026-11-16 Task 1.2 creates bin/hooks/policies/workflow.js; later tasks list it without new file prefix on purpose.
- 2026-11-16 Missing approval is unapproved when pipeline.require_spec_review is true and skipped when false.
- 2026-11-16 Open for reviewer: confirm the 13-task size and that pipeline.require_spec_review is the right review-disabled switch; user-message provenance per client depends on host fixtures (task 2.2).
- 2026-11-16 Review gate remains REQUEST CHANGES: return to Architect to address all seven Required Before Apply items before another review.
- 2026-11-16 Corrected task count: 15 tasks, none completed; earlier 13-task briefing was inaccurate.
- 2026-11-16 pipeline.require_spec_review is the correct review-disabled switch; its real file-backed reader/default must be specified.
- 2026-11-16 Policy options use documented single-line JSON-flow syntax; unsupported multiline options fail visibly. File-backed pipeline.require_spec_review defaults true.
- 2026-11-16 Full verification requires explicit hooks verify; writes invalidate verification evidence and may schedule explicitly configured scoped work.
- 2026-11-16 Completion uses explicit --confirm-handoff receipt production and fresh input validation; asynchronous validation conservatively reports pending. Hosts without observed authorization fixtures retain manual provenance.
- 2026-11-16 Fresh semantic review remains REQUEST CHANGES: resolve F20, F19 and F21 together in Architect, then run a new isolated review.
- 2026-11-16 F16 remains partially unresolved because per-intent and per-epoch completion follow-up limits conflict; other prior required mechanisms are resolved.
- 2026-11-16 Conductor progress-write allowance relies on distinguishing direct parent bindings from token-linked ones; implementer confirms at apply time.
- 2026-11-16 gate-check --tasks warn-mode path warnings (7) are new files created by earlier tasks; left unchanged.
- 2026-11-16 Progress-write role identity: the enforced allowance and the parent bind must name the same role — Architect chooses either a direct `implementer` allowance or retargeting both apply twins (and the docs example if it would teach a denied role) to `conductor` or `implementation`; token-linked children, other artifacts, and non-checkbox `tasks.md` edits stay denied.
- 2026-11-16 F20 resolved by option (a): the progress allowance is granted to a direct (via explicit) bind with role implementer, conductor or implementation; apply twins and docs/agent-hooks.md keep `--role implementer` unchanged. Children stay denied by token link or child role.
- 2026-11-16 F19 and F21 stay closed: this review resolved them; the next propose addresses F20 only and does not reopen them unless a new defect of that class appears.
- 2026-11-16 Non-blocking review notes stay out of Required Before Apply: the "one follow-up" shorthand, the "task ticks" abbreviation, and the dispatcher `{action, reason}` object note do not by themselves require another artifact edit.
- 2026-11-16 F20 resolved via a direct `implementer` allowance rather than retargeting the apply twins; the `via: 'explicit'` and no-token distinction is tested through dispatch in task 3.1 and confirmed again at apply time.
- 2026-11-16 F19 and F21 remain closed; non-blocking review notes remain out of scope.
- 2026-11-16 Spec review APPROVE: F20 is closed by a direct `via: 'explicit'` allowance for implementer, conductor, or implementation, matching the apply twins' `--role implementer`. F19 and F21 stay closed.
- 2026-11-16 Non-blocking review notes stay out of Required Before Apply: the "one follow-up" shorthand, the "task ticks" abbreviation, the dispatcher `{action, reason}` object, and task 3.1's done-when sampling a subset of the deny paths.
- 2026-11-16 A completion receipt is written only with `--confirm-handoff`. Verification outcomes advance the sequence that invalidates it; completion outcomes do not, so persisting validation does not immediately stale the receipt.
- 2026-11-16 The follow-up budget is one store record per intent: one claim per work epoch and two claims total. `user_cancelled` is a stop bypass and cancels pending completion work.
- 2026-11-16 Owned sync compares staged bytes and never calls the legacy live-tree sync. Conflicts stay on disk and the CLI exits nonzero.
- 2026-11-16 No lifecycle fixture or config switch enables user authorization. Unverified payloads keep deny and follow-up downgraded.
- 2026-11-16 Policy `options` stay a single-line JSON object. Invalid options disable that policy.
