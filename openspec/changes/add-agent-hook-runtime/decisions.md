# Decisions — add-agent-hook-runtime

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-11-16 Planning scope: two proposals, explicitly requested by the user; execution is sequential, with this runtime merged and archived before dependent workflow apply.
- 2026-11-16 Runtime API: EventV1, PolicyV1, dispatch, scoped store transactions/audit and a static policy registry; no dynamic plugin loader.
- 2026-11-16 Compatibility: default observe mode, explicit platform capabilities and manual fallback; confirmed current full-content delivery is audited as injected, separately from file reads.
- 2026-11-16 Progress ownership: technical snapshots preserve the existing semantic checkpoint and do not duplicate metrics-session restoration.
- 2026-11-16 Review verdict REQUEST CHANGES: four Major items must be fixed in proposal artifacts before apply (apply-skill twin + delta, bind identity hand-off, ownership manifest, store scope levels).
- 2026-11-16 Re-propose fixes: one byte-identical parent block in both apply twins; bind identity from echoed native ids plus a short-lived binding token with null+manual fallback; git-tracked .agents/hooks/ownership.json with adopt-after-digest-verification and byte-identical conflicts; store scope levels worktree/change/session/agent with ctx.storeFor re-scoping and quarantined unresolved writes.
- 2026-11-16 Re-review verdict REQUEST CHANGES: M1–M3 resolved, M4 unresolved as N1 (null-identity store semantics and change-vs-session level ordering) — must be fixed in design.md:102-109, tasks 1.1/1.2 and the delta scenario before apply.
- 2026-11-16 N1 store contract: change level is an orthogonal namespace attribute (hierarchy worktree→session→agent); null-session default writes quarantine per event id; `storeFor('worktree')` shared by all writers incl. null-session (lease mutual exclusion), `storeFor('change')` iff bound, finer levels with null required ids quarantine with diagnostic; worktree level never quarantines.
- 2026-11-16 Re-review verdict APPROVE: N1 resolved; change ready for apply. Two non-blocking minors carried into apply-notes.md: (1) a null-session event has no defined way to bind a changeId (`hooks bind` requires `--session`) — treat change as null unless an explicit binding resolves it, never infer by recency; (2) `ctx.storeFor` is described in task 1.1 but implemented in 1.2 — test 1.1 against a fake store, wire the real store in 1.2.
