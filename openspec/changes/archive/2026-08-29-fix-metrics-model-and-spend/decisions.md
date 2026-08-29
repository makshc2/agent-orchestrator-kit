# Decisions — fix-metrics-model-and-spend

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-08-29 model-vs-role: `session.model` / `phases.*.models` store the LLM product id as passed (`claude-opus-5`, `gpt-5.6-sol`, `cursor-grok-4.6`); `session.role` / JSON `phases.*.agents` stay Closed role; human `metrics` table prints `roles` + `models`, never an `agents` column that hides models
- 2026-08-29 model-resolve: `--model` → `AOK_MODEL` → `null` plus stderr warning; persist and archive never fail because model is missing; CLI does not reject `--model Architect` (protocol-only discipline)
- 2026-08-29 spend-null-honest: tokens/cost only from explicit `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`; never guess or scrape Cursor/Claude/Amp; missing stays `null`, never a persist/archive gate
- 2026-08-29 archive-always-finalize: successful `archive` always creates or updates `metrics.json`, sets `archivedAt`, appends an Archiver session (`durationMs` and spend null), warns when spend is all null; metrics is not an archive gate
- 2026-08-29 platform-flag-env: `session.platform` is `--platform` → `AOK_PLATFORM` → `null` (`cursor|claude|amp` only); invalid `--platform` fails before move; `CURSOR_AGENT` MUST NOT set platform
- 2026-08-29 no-backfill: historical archives are not migrated; `gate-check` / pre-commit MUST NOT require `metrics.json`; `--no-metrics` stays a persist/restore opt-out
- 2026-08-29 auto-collect-per-platform: persist/archive read local Claude JSONL, Amp threads, Cursor vscdb; store and display `spendByPlatform` and `spendByModel` as separate figures; never merge Amp credits into USD; never guess; flags override session totals only
- 2026-08-29 archive-always-finalize: successful `archive` always creates or updates `metrics.json`, sets `archivedAt`, appends an Archiver session, runs collect for the Archiver window, warns when USD spend is all null; metrics is not an archive gate
- 2026-08-29 no-backfill: historical archives are not migrated; `gate-check` / pre-commit MUST NOT require `metrics.json`; `--no-metrics` stays a persist/restore opt-out; `--no-collect` skips adapters only
- 2026-08-29 review-verdict: REQUEST CHANGES — must-fix (1) archive warn on USD-null not METRICS_SPEND_KEYS/empty sessions (2) Amp match `env.initial.trees[].uri` not thread/meta.cwd (3) Claude project folder encode `.` and `/` as `-` (4) task 5.4 fill session totals and `session.models` from sources when flags absent
- 2026-08-29 spend-null-honest: adapters are allowed; missing stays null; still not a gate
- 2026-08-29 usd-archive-warn: warn when `spend.costUsd === null` via `console.error`; Amp credits and filled tokens do not cancel; drop `sessions.length === 0` and `METRICS_SPEND_KEYS`
- 2026-08-29 amp-project-match: match `collectSpend` cwd to `env.initial.trees[].uri` after strip `file://`; multi-root any-tree; no trees → skip; `ledger.jsonl` optional
- 2026-08-29 claude-folder-encode: Claude project folder encodes `/` and `.` as `-`; window field is line `timestamp`; `cache_*` in `inputTokens`; filter against `collectSpend({ cwd })`
- 2026-08-29 session-spend-from-sources: no flags → aggregate source totals; flags override without clearing maps; write `session.models` when >1; recompute `spend.costUsd` from session USD else source USD
- 2026-08-29 architect-amend: closed all four review must-fixes in OpenSpec artifacts; `openspec validate --strict` and `gate-check --tasks` pass; ready for `/opsx:review`
- 2026-08-29 review-verdict: APPROVE — four prior must-fixes closed in lockstep; artifacts implementable; `apply-notes.md` written
- 2026-08-29 apply-complete: all 14 tasks implemented and checked; `npm test` 124/124; `openspec validate --strict` pass; no package.json lint/build scripts; ready for PR, then `/opsx:archive` after merge + CI green
