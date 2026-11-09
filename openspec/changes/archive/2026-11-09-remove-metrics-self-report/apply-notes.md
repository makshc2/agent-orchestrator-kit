# Apply notes — remove-metrics-self-report

Critical constraints
- Do NOT edit `scripts/cursor-spend-collect.cjs` or `templates/scripts/cursor-spend-collect.cjs` (byte-identical; their `sessionSpendFrozen` keeps a numeric legacy `self-report` session frozen in the hook leftover; accepted in design D4).
- Do not touch `CHANGELOG.md`, `package.json`, `docs/`, `test/fixtures/`, `openspec/specs/`, `HANDOFF_REQUIRED_SECTIONS`, adapters, flags or the `metrics.json` schema.
- Order: group 1 (new tests, red) -> 2 (text) -> 3 (bin) -> 4 (converted tests) -> 5. Groups 2 and 3 are independent.
- Copy the root rule with `cp templates/.agents/rules/session-handoff.mdc .agents/rules/session-handoff.mdc`; never `init --force`.

Pitfalls
- `buildHandoffMarkdown`: `prompt` already starts with `\n\n## Prompt`, so the replacement line is `- agent_id: ${agentId}${prompt}`.
- Task 3.4 makes the old-signature test in `test/metrics-readable.test.js` fail until task 4.5; record `# tests` (15 today) BEFORE editing in 4.5, final = 16 tests, 16 pass, 0 fail.
- Frozen branch of `metricsBackfillFile` passes the session's own totals as `opts` (flags); `ampCredits` is included.
- Keep `lastNonArchiverSession`, `hasSpendOverride`, `firstNonNull`, `warnMissingModel`, `warnMissingUsd`; keep the skill heading `## Metrics (health check per change)`.
- Untouched on purpose: smoke test "metrics treats legacy sessions without spendSource as unreported", the `## Metrics` extra section in `test/restore-recovery-briefing.test.js`.

Verification
- Per-task Done-when commands; then `npm test`, `npx openspec validate --all --strict`, `node bin/agent-orchestrator.js gate-check --review remove-metrics-self-report` (all exit 0).
- `git diff --quiet -- CHANGELOG.md package.json docs test/fixtures openspec/specs` exits 0; `grep -rn -E '## Metrics|spend_source|amp_credits' templates/.agents templates/AGENTS.md templates/CLAUDE.md .agents/rules` prints one line (the skill health-check heading).
