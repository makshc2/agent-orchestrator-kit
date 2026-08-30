# Apply notes — prompt-session-metrics

Baseline: the uncommitted working-tree edits in `bin/`, `test/`, `scripts/`, `openspec/specs/change-metrics/spec.md`, README, CHANGELOG, `.gitignore` belong to the PREVIOUS change. Do not revert them.

Traps, in the order you will hit them:

1. `HANDOFF_SECTIONS` (`bin/agent-orchestrator.js:153`) has **no reader** — adding `'Metrics'` there changes no output. The rendering edit in `buildHandoffMarkdown` (1141) is what produces the section. Do both, as task 1.1 says. `missingHandoffFields` (1208) must NOT be extended.
2. **Archive wipes the self-report unless you carry it.** `archive` rewrites `handoff.md` at 3258 from a `fields` object built at 3239 that has no `metrics` key. Read `## Metrics` from `join(targetDir, 'handoff.md')` via the existing `priorFields` load at 3235 — **before** line 3258 — and put it into `fields.metrics`. If you read after 3258 you get an all-`unknown` skeleton and the Archiver session silently resolves to `null`.
3. `metricsFinalizeArchive` passes `{}` as the opts argument to `applyCollectedSessionFields` (1914), so archive spend flags never reach the session today. Replace both call sites (1875 and 1914) when you rewrite the helper; the archive session literal (1897) also needs `spendSource` and `ampCredits`.
4. `parseMetricsSection` returns a `warnings` array that nothing prints. The spec requires unparsable numbers to warn on **stderr** — wire the array to `console.error` in persist. The invalid-platform warning already has a site at 3620 via `resolvePlatform`; do not print it twice.
5. Passing `collect: opts.collect === true` is enough for the archive path: the internal `opts.collect === false` checks at 1855, 1881, 1893, 1921 already short-circuit correctly. Do not invert them blindly.
6. Persist writes `handoff.md` exactly once (3625, before `metricsRecordSessionEnd` at 3637). Keep it that way — no second write after the metrics write. `handoff.md` stays the self-report; `metrics.json` is the source of truth. Divergence under `--input-tokens` or an invalid platform is intended.
7. `metrics <name>` also calls `ensureCursorSpendHook` (3663) — task 3.3 removes it there too, not only in persist and restore.

Do not touch: `test/spend-collect.test.js` (task 6.4 freezes it), `openspec/specs/` (sync happens at archive), adapter logic in `bin/spend-collect.js` (status changes, code does not).

Verify: `npm test`, `npx openspec validate --all --strict`, and manually `handoff <name> --help` / `archive --help` show `--collect` and not `--no-collect`. Exactly one `--no-collect` call may remain in `test/smoke.test.js` — the one asserting non-zero on an unknown flag.
