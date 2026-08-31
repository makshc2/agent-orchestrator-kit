# Apply notes — fix-metrics-session-attribution

- Persist leftoverEnd = `pending.startedAt` if pending exists, else `last.endedAt + 120s`. Never pass `now`. Leftover helper is separate from `metrics --collect` (`[last.startedAt, now]` + `source.id` dedup). Inclusive start at `last.endedAt`; exclusive at `pending.startedAt`; inclusive at `endedAt+120s`.
- Archive: write `pending.startedAt` first, leftover previous session, then Archiver collect `[pending.startedAt, now]`. `durationMs` is a delta, never artificial `null`. `sessionEnd` must read the newest `openspec/changes/archive/*-<name>/metrics.json`.
- Placeholder `unknown` + `spend_source: self-report` is not a freeze. Numeric self-report and `--input-tokens` still win. Sources with a model beat `--model` / family.
- Invert steal tests in `test/smoke.test.js`; do not keep “late hook belongs to next persist / Archiver”.
- Keep `scripts/cursor-spend-collect.cjs` and `templates/scripts/cursor-spend-collect.cjs` byte-sync on leftover/archive/resync. Do not treat current uncommitted spend-collect WIP as the spec.
- Do not touch Amp timestamp, HTTP spend, grok cost table, VMS app, or historical archive ledgers.
- Export `canonicalRole` and `phaseForRole` next to `formatMetricsCostLine` / `resolveSessionSpend`.
- Verify (after explicit test permission): `node --test test/smoke.test.js test/spend-collect.test.js test/session-client.test.js`.
