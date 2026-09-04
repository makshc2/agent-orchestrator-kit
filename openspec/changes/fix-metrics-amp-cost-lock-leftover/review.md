# Tier 2 Spec Review

Date: 2026-09-04

## Checklist

- Proposal, design, delta spec, decisions, and tasks are semantically consistent.
- No conflict was found with the current `change-metrics` main spec.
- Tasks remain within the proposal Non-goals and name existing repository files/functions.
- Each task's Files / Do / Done-when contract is sufficient for implementation without consulting `design.md`.
- Previous Major 1 is resolved: tasks 1.1, 1.2, and 5.1 now require per-session `addNullable` accumulation, including the three-session `$25.92` case, consistently with D1 and the delta requirement/scenario.
- Previous Major 2 is resolved: tasks 3.1, 3.3, and 5.3 now prohibit appending/exporting the env thread in leftover mode with an explicit thread, consistently with D3 and the `T-apply` / `T-archive` scenario.
- `npx openspec validate fix-metrics-amp-cost-lock-leftover --strict --type change` passes.

## Major

None.

## Minor

None.

## Nit

None.

## Verdict: APPROVE
