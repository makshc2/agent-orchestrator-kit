# Decisions — artifact-mutation-evals

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-10-29 Use CLI subprocesses, keep runTier1Review private; task_contract strict, artifact_budget off.
- 2026-10-29 Use the real local OpenSpec validator through an offline launcher, no success stub or LLM.
- 2026-10-29 Freeze synthetic and archived tier1 fixtures; 14 mutations include Done-when semantics and cross-change MODIFIED collision as known gaps.
- 2026-10-29 Keep spec-verify-conformance-report as the next separate change; address head -200 and source line numbering there.
- 2026-10-29 2026-10-29 Pin implementation parameters the artifacts lacked: validator timeout 60000 ms, output buffer 1 MiB, fixture names synthetic-change, sample-capability, neighbor-change, archived fixture tier1-delta-heading-check; S06 leaves an empty `## ADDED Requirements`. Confirmed against OpenSpec 1.4.1 with throwaway prototypes.
- 2026-10-29 artifact-mutation-evals: review cycle 2 is RC on M1 only (unsatisfiable `git status --porcelain` scope checks in tasks 2.1, 2.2, 4.1); the six cycle-1 items are resolved and a fix is an artifact edit in tasks.md, not a design change.
- 2026-10-29 artifact-mutation-evals: re-propose fixed M1 by replacing `git status` scope checks with explicit pathspecs and `:(exclude)` lists in tasks 2.1, 2.2, 4.1; design intent unchanged.
- 2026-10-29 artifact-mutation-evals: review cycle 3 is APPROVE (M1 and Minor m1-m5 resolved, rescan clean); tasks.md stays Ukrainian, `grep -c` exit 1 on zero is accepted in the tmpdir check.
- 2026-10-29 artifact-mutation-evals: apply green (8/8, targeted eval 43/43, npm test 355/355, scope checks empty); corpus measures 12/14 caught in strict, S10/S11 known-gap missed; matchers resolved per-run from pristine tasks.md via `matchers(ctx)`.
