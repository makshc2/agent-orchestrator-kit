# Decisions — add-agent-workflow-automation

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-11-16 Dependency: apply only after add-agent-hook-runtime has been merged and archived; review the shared contract with that proposal.
- 2026-11-16 Verification: bind command results to relevant working-tree inputs and execution stability; checkbox and handoff progress alone do not invalidate test evidence.
- 2026-11-16 Enforcement: explicit opt-in, bounded follow-ups and cancellation handling; preserve the default nonblocking test-discipline behavior.
- 2026-11-16 Sync: use explicit ownership for automated update/sync; preserve foreign files and existing legacy sync behavior.
- 2026-11-16 Delivery scope: reuse existing opt-in CI archive; no automatic approvals, task completion, commits, npm publishing or fleet updates.
