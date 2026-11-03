# Decisions — apply-test-run-discipline

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-11-03 apply-test-run-discipline: slice 1 is text-only (no CLI, no gate); fixtures, CI coverage threshold and `gate-check --apply` go to a separate follow-up change.
- 2026-11-03 apply-test-run-discipline: a pre-existing red test blocks the last tick until the user decides; the way out is `tests: N-1/N (accepted by user: <name>)`.
- 2026-11-03 apply-test-run-discipline: Part B proposed as a new `checkpoint <name>` command over a `handoff` flag, storage `checkpoint.json` in the change dir (git-tracked, atomic write); the 9-row conflict table in design.md is PROPOSED, nothing earlier was rewritten.
- 2026-11-03 2026-11-03 apply-test-run-discipline: the recovery briefing matches task `Files:` entries against raw git paths and normalizes with `oneLine` only when rendering, so paths containing a tab are still matched.
