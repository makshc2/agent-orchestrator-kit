# Apply Notes

- Apply `session.costUsd` fallback once per qualifying session via `addNullable`; never gate it on an aggregate still being null.
- Keep billed `costUsd` separate from estimates and never copy Amp Cost onto message sources.
- In leftover mode with `listRecentAmpThreads: false`, an explicit `ampThreadId` is the only Amp id: do not append env ids or list recent threads.
- Preserve Amp-parent-without-tty behavior (`amp-threads-list`) and Amp-env precedence.
- Keep leftover platform/thread scoped, the 120s grace, and the existing exclusive end boundary.
- Preserve billed Amp Cost while resyncing tokens from all sources.
- Keep `scripts/cursor-spend-collect.cjs` byte-identical to its template copy.
- Do not touch archived consumer metrics, billing/HTTP behavior, Cursor rates, dependencies, or session-handoff protocol.
- Verify: `cmp scripts/cursor-spend-collect.cjs templates/scripts/cursor-spend-collect.cjs`
- Verify: `npm test`
- Verify: `npx openspec validate fix-metrics-amp-cost-lock-leftover --strict --type change`
