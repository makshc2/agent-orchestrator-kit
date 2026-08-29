# Apply notes — fix-metrics-model-and-spend

- Missing adapter dirs/files/sqlite3/schema → empty sources + note, never throw; persist/archive stay exit 0.
- Amp: match `collectSpend` `cwd` to `env.initial.trees[].uri` after strip `file://` (`file:///home/...` → `/home/...`); any-tree; no trees → skip; no `meta.cwd`; no ledger → `ampCredits: null`.
- Claude: encode cwd `/` and `.` as `-`; window = JSONL line `timestamp`; add `cache_*` to `inputTokens`; row `cwd` === collect `cwd` arg.
- Archive warn iff `metrics.spend.costUsd === null` via `console.error` (not `log.warn`/`log.err`, not `METRICS_SPEND_KEYS`, not empty sessions). Tokens/Amp credits do not cancel.
- Archiver collect window = last *prior* `session.endedAt` or `createdAt` → now. Compute before appending Archiver; fill that one session (do not add a second).
- No spend flags → session totals = source aggregate. Any `--input-tokens`/`--output-tokens`/`--total-tokens`/`--cost-usd` overrides those four fields only; do not clear `sources` / maps / `session.models`. Recompute: per session, `spend.costUsd` = session USD else source USD (no double-count). Write `session.models` when >1 model.
- Model `console.error` only if *final* `session.model` is null (after sources), including Archiver. Do not reject `--model Architect`. Invalid `--platform` on archive: `return` before gates/move. Ignore `CURSOR_AGENT`.
- Tests: tmp `HOME`/`AMP_DATA_DIR`/`XDG_CONFIG_HOME`; pass explicit `cwd` into `collectSpend`. `opsx-archive.md` ≤ 1536 bytes (shorten step 3).
- Do not: unified bill; Cursor SDK/CSV/cookies; npm sqlite/`ccusage`; pricing table; Amp→USD; archive backfill; Phase 4 dashboard; new roles; `orchestrator-cli-controls`; metrics as persist/archive/`gate-check`/pre-commit gate.
- Verify: `npm test` and `npx openspec validate fix-metrics-model-and-spend --strict`.
