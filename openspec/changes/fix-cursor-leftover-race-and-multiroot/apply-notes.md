# Apply notes

- Leftover window stays 120s inclusive (`leftoverWindowEnd` / `leftoverEndExclusive`). No third window, no second persist, no `durationMs` stretch when `at > endedAt`.
- After successful `appendFileSync`, hook `stop` / `afterAgentResponse` MUST call exported leftover (`require` neighbor collect). Register stdin only when `require.main === module`. Fail-open, no stdout. Keep idempotent `sessionEnd`. Skip leftover when no token row (`subagentStop` unchanged).
- Filter leftover by `last.threadId` when non-empty; `threadId: null` is time-only. Do not regress persist `cursorConversationId: last.threadId` / `collectCursor`.
- One ranking `resolveBaseDir` (not first `.agents` / first `openspec`). Collect leftover every candidate with `openspec/changes`, each reading its own jsonl.
- `roundUsd4` after sums only — never inside `addNullable`. Tokens and `costUsd` unchanged.
- Phase clock: `startedAt` / `endedAt` / `leadTimeMs` from that phase’s sessions (epoch ms). `durationMs` stays work-time sum — never `totals.leadTimeMs` or `endedAt − startedAt`. Collect `recompute` must write the same keys.
- Keep the existing +5s leftover test (jsonl first). Add a separate live-order +35s test. Do not add a non-null `threadId` to the +5s fixture without `conversationId` on the row.
- Do not edit `session-handoff`. Do not backfill FE/consumer archives. No HTTP, Cursor SDK, or new npm deps.
- Keep `scripts/*` byte-identical to `templates/scripts/*` (`cmp`).
- Verify (after load/RAM check): `node --test test/smoke.test.js test/spend-collect.test.js`
