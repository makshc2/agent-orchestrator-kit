## Why

Session Exit makes the parent fill a `## Metrics` section in `handoff.md` (`platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`, `spend_source`), while the CLI collects the same data into `metrics.json` on its own. The section is dead weight: 17 of the 18 archived `handoff.md` files that have it hold only `unknown` values (the 18th copies an Amp usage cost); no session has `spendSource: self-report` (0 of 61 sessions on 2026-10-01, 0 of 94 sessions in the 19 archived ledgers when this change was proposed); `ampCredits` is `null` everywhere. It costs about 7 output lines and 1 to 2 minutes per session and breeds a class of rules (`unknown` vs `0`, "do not set self-report when numbers are unknown", the self-report freeze, the archive double-count guard) that produced fixes across 0.9 to 0.15.

This is item 5 (R2b) of `docs/improvement-plan-2026-10-01.md`. R2a (parent-driven Session Start/Exit without a Memory read) already shipped, so it is not repeated here. The decision `metrics-writeback-self-report-only` (2026-08-30, `openspec/changes/archive/2026-08-30-prompt-session-metrics/decisions.md`) rules out writing adapter numbers back into `handoff.md`, because `handoff.md` is written before `metricsRecordSessionEnd`; this change therefore removes the section instead of adding a post-resolution rewrite.

## What Changes

- **A. `handoff.md` loses `## Metrics`.** `buildHandoffMarkdown` stops rendering it and `fieldsFromSections` stops parsing it. A legacy section (13-section handoffs from older kits) stays harmless: persist and archive ignore it, print nothing about it and drop it when they rewrite the file. `HANDOFF_REQUIRED_SECTIONS` is unchanged.
- **B. Shorter resolution chains.** Model: adapter sources, then `--model`, then `AOK_MODEL`, then `null`. Platform: `--platform`, `AOK_PLATFORM`, `pending.platform`, host env, adapter sources, `null`. Spend: flags, then Amp usage, then adapter sources, then `null`. `spendSource` becomes `flag`, `amp-usage`, `adapter` or `unreported`; the CLI never writes `self-report`. The `fill ## Metrics` warnings (persist and archive) and the `or fill ## Metrics` restore hint go away. `--model`, `--platform` and the spend flags stay as the manual fallback for Cursor gaps.
- **C. No self-report freeze, no archive stale-copy guard.** `sessionSpendIsFrozen` is true only for `spendSource: flag`; `dropStaleArchiveSelfReport` and the `reported` plumbing through `resolveSessionSpend` / `applyCollectedSessionFields` are deleted. In the CLI leftover (`attachLeftoverSources`, `metrics --collect`) a stored legacy `self-report` session is no longer frozen against resync (accepted; see design D4); the Cursor hook script keeps its own rule.
- **D. Text mirrors.** `session-handoff.mdc` (and its root copy), the skill `agent-orchestration`, the subagents `session-handoff` and `spec-archiver`, `templates/AGENTS.md`, `templates/CLAUDE.md` and the reference part of `README.md` lose the self-report step, the `## Metrics` template block and the `unknown` / `self-report` rules; the persist rules that still apply stay.
- **E. One adjacent fix.** `canonicalRole()` maps a bare `Reviewer` to `Spec Reviewer`, as it already maps `Code Writer` to `Implementer`. A bare `Reviewer` closed two review sessions with a non-canonical role and made `release:check` fail on `test/metrics-ledger-integrity.test.js` before 0.21.0; the archived `metrics.json` had to be edited by hand.
- **F. Tests.** Test edits outweigh production code: a new `test/remove-metrics-self-report.test.js`, converted sites in `test/smoke.test.js` (the `handoffWithMetrics` helper and the tests built on it), `test/metrics-readable.test.js` and `test/metrics-ledger-integrity.test.js`.
- **BREAKING for consumers of the old protocol only:** a `handoff.md` that still carries `## Metrics` no longer contributes numbers; no migration is needed because the section is ignored.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `change-metrics`: 14 requirements MODIFIED (persist and restore chains, session model and platform, collect window, archive, spend source, `spendSource`, leftover freeze, archive summary, canonical Closed role, the wording of one `metrics` command scenario), 2 REMOVED (the `## Metrics` section; the missing-self-report warning), 1 RENAMED (the spend-source requirement), 2 ADDED (legacy section ignored; restore hint for an unknown client).
- `session-handoff`: 2 MODIFIED (Session Exit persist order; handoff file template), 1 REMOVED (Session Exit self-report), 2 ADDED (no self-report step; model, persist-once and decisions rules kept).
- `lean-archive`: 1 MODIFIED (archive gates do not depend on `metrics.json` or on a Metrics section).

## Impact

- `bin/agent-orchestrator.js`: `canonicalRole`, `HANDOFF_SECTIONS`, `buildHandoffMarkdown`, `fieldsFromSections`, `resolveModel`, `resolvePlatform`, `resolveSessionSpend`, `applyCollectedSessionFields`, `sessionSpendIsFrozen`, `attachLeftoverSources`, `metricsBackfillFile`, `metricsRecordSessionEnd`, `metricsFinalizeArchive`, the `archive` and `handoff` action handlers; helpers removed with their last caller.
- `templates/.agents/rules/session-handoff.mdc` and `.agents/rules/session-handoff.mdc` (byte-equal), `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`, `templates/.agents/subagents/spec-archiver.md`, `templates/AGENTS.md`, `templates/CLAUDE.md`, `README.md`.
- Tests: new `test/remove-metrics-self-report.test.js`; edits in `test/smoke.test.js`, `test/metrics-readable.test.js`, `test/metrics-ledger-integrity.test.js`.
- `openspec/specs/{change-metrics,session-handoff,lean-archive}/spec.md` through the delta specs. Generated copies in consumer installs follow `update` / `sync`.
- `CHANGELOG.md`, `package.json` and the version are release prep and stay untouched.

## Non-goals

- No write-back of adapter numbers into `handoff.md`, and no post-resolution rewrite of any section.
- No change to `HANDOFF_REQUIRED_SECTIONS`, to the `--model`, `--platform`, `--input-tokens`, `--output-tokens`, `--total-tokens`, `--cost-usd`, `--collect` and `--no-metrics` flags, to the `metrics.json` schema or version, to the aggregates, or to the adapters.
- No new warning in place of the removed ones, no `--amp-credits` flag, no migration of archived `handoff.md` or `metrics.json` files; a stored `spendSource: self-report` stays a readable historic value.
- No edit to `scripts/cursor-spend-collect.cjs` or its byte-identical copy `templates/scripts/cursor-spend-collect.cjs`: their own freeze rule (`sessionSpendFrozen`) keeps a stored legacy `self-report` session with numbers frozen in the hook leftover (design D4 and Risks).
- No edits to requirements that name `self-report` only as one of several historic provenance values (design D6 lists them), to `docs/`, to `test/fixtures/`, to `CHANGELOG.md`, `package.json` or the version.
- R9-lite (mirror generation from one source) and the other plan items are out of scope.

## Acceptance criteria

1. **Legacy section ignored.** Persist and archive on a `handoff.md` with a `## Metrics` section (values, `unknown`, or an invalid `platform`) exit 0, print no line mentioning `## Metrics`, `chatgpt` or `invalid platform`, take model, platform and spend only from flags, `AOK_MODEL`, `AOK_PLATFORM`, host env and adapters, and rewrite `handoff.md` without a `## Metrics` heading.
2. **No section is written.** A persisted `handoff.md` has the sections Closed role through Runtime, then `## Prompt`, and no `## Metrics`; two `--no-metrics` regenerations stay byte-identical.
3. **Chains.** `--model` beats `AOK_MODEL` and loses to an adapter model; `--platform` beats `AOK_PLATFORM`, which beats host env; flags win per field over adapter totals; `spendSource` is `flag`, `amp-usage`, `adapter` or `unreported`, never `self-report`; a session without spend is `unreported`, and stderr has no `## Metrics` or spend hint (the missing-model warning stays when no model is known).
4. **Freeze.** A `flag` session keeps its totals when leftover adds sources; in the CLI leftover (`attachLeftoverSources`) a stored `self-report` session is resynced to the adapter totals (the Cursor hook script is not changed); `metrics <name>` still reads a stored `self-report` value without rewriting the file.
5. **Canonical role.** `canonicalRole('Reviewer')` and `canonicalRole('Reviewer — APPROVE')` return `Spec Reviewer`; `Code Reviewer` stays raw; a persisted bare `Reviewer` gives `role: Spec Reviewer`, `phase: review` and no `metrics: warning: role` line.
6. **Text.** None of the seven mirrors contains the `## Metrics` handoff block, `spend_source`, `amp_credits` or `self-report` (the skill keeps its `## Metrics (health check per change)` section); `.agents/rules/session-handoff.mdc` is byte-equal to its template; always-apply rules stay under 12000 characters and `templates/AGENTS.md` under 4000.
7. **Repo state.** `npm test` and `npx openspec validate --all --strict` exit 0; `node bin/agent-orchestrator.js gate-check --review remove-metrics-self-report` exits 0; the artifacts stay inside the size budgets (`tasks.md` at most 60000 B; proposal, design, tasks and delta specs together at most 150000 B).
