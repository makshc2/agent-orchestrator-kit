# Session Handoff

## Closed role
Implementer — apply complete; 16/16 tasks; tests 191/191

## Change
- name: fix-metrics-amp-cost-lock-leftover
- status: apply-complete; tasks 16/16
- review.md: APPROVE (2026-09-04); apply-notes.md present

## Done
- Isolated `code-writer` wave 1: tasks 1.1, 1.2, 2.1, 3.1 on disjoint files
- Isolated `code-writer` wave 2: tasks 3.2, 3.3, 4.1–4.4 in `bin/agent-orchestrator.js`
- Isolated `test-writer`: tasks 2.2, 5.1–5.4
- Isolated `code-writer`: task 6.1 README + CHANGELOG `[Unreleased]`
- Conductor verified Done-when (Cost `12.69` / `25.92`, `amp-session-last`, leftover `T-apply` excludes env `T-archive`, freeze, token resync `1176546` / Cost `12.69`, usageModels Luna once)
- `cmp scripts/cursor-spend-collect.cjs templates/scripts/cursor-spend-collect.cjs` empty
- `npx openspec validate fix-metrics-amp-cost-lock-leftover --strict --type change` exit 0
- `node --test --test-concurrency=1` on the four test files: **191 passed, 0 failed**
- `tasks.md` 16/16 `[x]`; no edits to `proposal.md`, `design.md`, delta spec, or `review.md`
- Parent-amp-without-tty `amp-threads-list` preserved; Amp-env still wins; 120s grace and exclusive leftover end unchanged

## Decisions
- Implementer 2026-09-04: leftover without `--collect` passes `listRecentAmpThreads: false` and never `ampThreadIdFromEnv`; Amp leftover without threadId/prefix skips collect
- Implementer 2026-09-04: `sessionSpendIsFrozen` is only `flag` or numeric `self-report`; leftover resync keeps billed Cost and `spendSource: amp-usage`
- Implementer 2026-09-04: exported `recomputeMetricsAggregates`, `sessionSpendIsFrozen`, `attachLeftoverSources`, `runCollectSpend` for acceptance tests; scripts remain `cmp`-identical

## Blocked
none — do not archive until the PR is merged and CI is green. No commit/push unless the user asks.

## Next command
`/opsx:archive fix-metrics-amp-cost-lock-leftover`

## Next role
Archiver — deferred until the CI-green PR merge

## Attach
- `openspec/changes/fix-metrics-amp-cost-lock-leftover/tasks.md` (16/16)
- `bin/agent-orchestrator.js` (`recomputeSpendMaps`, `recomputeMetricsAggregates`, `attachLeftoverSources`, `sessionSpendIsFrozen`, `applyCollectedSessionFields`)
- `bin/session-client.js` (`amp-session-last` / `amp-session-list`)
- `bin/spend-collect.js` (`listRecentAmpThreads`)
- `scripts/cursor-spend-collect.cjs` + `templates/scripts/cursor-spend-collect.cjs`
- `test/metrics-readable.test.js`, `test/session-client.test.js`, `test/spend-collect.test.js`, `test/smoke.test.js`
- `README.md`, `CHANGELOG.md`

## Subagents to spawn
none — `/opsx:archive` is a CLI call (`npx agent-orchestrator-kit archive <name>`). Do not spawn spec-architect, spec-reviewer, or apply specialists. `spec-archiver` only if the archive CLI fails.

## Constraints
Do not start archive in a new chat until the PR is merged and CI is green. Do not edit `proposal.md`, `design.md`, delta spec, or `review.md`. Keep `scripts/cursor-spend-collect.cjs` byte-identical to the template. No commit/push unless the user asks. HARD STOP after persist; next role is a new chat.

## Runtime
- runtime: local
- agent_id: none

## Metrics
- platform: cursor
- model: cursor-grok-4.6-xhigh-fast
- input_tokens: unknown
- output_tokens: unknown
- cost_usd: unknown
- amp_credits: unknown
- spend_source: unreported

## Prompt

```text
/opsx:archive fix-metrics-amp-cost-lock-leftover

You are the conductor for the next role session of change `fix-metrics-amp-cost-lock-leftover`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive fix-metrics-amp-cost-lock-leftover`
- Next role / phase subagent: `spec-archiver`
- Amp: spawn isolated skill `subagent-spec-archiver` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/spec-archiver.md` / `.claude/agents/spec-archiver.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive fix-metrics-amp-cost-lock-leftover` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff fix-metrics-amp-cost-lock-leftover --restore`
4. Read Memory MCP: `Change:fix-metrics-amp-cost-lock-leftover`, `Handoff:fix-metrics-amp-cost-lock-leftover`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/fix-metrics-amp-cost-lock-leftover/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Implementer — apply complete; 16/16 tasks; tests 191/191
- Change: - name: fix-metrics-amp-cost-lock-leftover
- status: apply-complete; tasks 16/16
- review.md: APPROVE (2026-09-04); apply-notes.md present
- Done:
- Isolated `code-writer` wave 1: tasks 1.1, 1.2, 2.1, 3.1 on disjoint files
- Isolated `code-writer` wave 2: tasks 3.2, 3.3, 4.1–4.4 in `bin/agent-orchestrator.js`
- Isolated `test-writer`: tasks 2.2, 5.1–5.4
- Isolated `code-writer`: task 6.1 README + CHANGELOG `[Unreleased]`
- Conductor verified Done-when (Cost `12.69` / `25.92`, `amp-session-last`, leftover `T-apply` excludes env `T-archive`, freeze, token resync `1176546` / Cost `12.69`, usageModels Luna once)
- `cmp scripts/cursor-spend-collect.cjs templates/scripts/cursor-spend-collect.cjs` empty
- `npx openspec validate fix-metrics-amp-cost-lock-leftover --strict --type change` exit 0
- `node --test --test-concurrency=1` on the four test files: **191 passed, 0 failed**
- `tasks.md` 16/16 `[x]`; no edits to `proposal.md`, `design.md`, delta spec, or `review.md`
- Parent-amp-without-tty `amp-threads-list` preserved; Amp-env still wins; 120s grace and exclusive leftover end unchanged
- Decisions:
- Implementer 2026-09-04: leftover without `--collect` passes `listRecentAmpThreads: false` and never `ampThreadIdFromEnv`; Amp leftover without threadId/prefix skips collect
- Implementer 2026-09-04: `sessionSpendIsFrozen` is only `flag` or numeric `self-report`; leftover resync keeps billed Cost and `spendSource: amp-usage`
- Implementer 2026-09-04: exported `recomputeMetricsAggregates`, `sessionSpendIsFrozen`, `attachLeftoverSources`, `runCollectSpend` for acceptance tests; scripts remain `cmp`-identical
- Blocked:
none — do not archive until the PR is merged and CI is green. No commit/push unless the user asks.
- Attach:
- `openspec/changes/fix-metrics-amp-cost-lock-leftover/tasks.md` (16/16)
- `bin/agent-orchestrator.js` (`recomputeSpendMaps`, `recomputeMetricsAggregates`, `attachLeftoverSources`, `sessionSpendIsFrozen`, `applyCollectedSessionFields`)
- `bin/session-client.js` (`amp-session-last` / `amp-session-list`)
- `bin/spend-collect.js` (`listRecentAmpThreads`)
- `scripts/cursor-spend-collect.cjs` + `templates/scripts/cursor-spend-collect.cjs`
- `test/metrics-readable.test.js`, `test/session-client.test.js`, `test/spend-collect.test.js`, `test/smoke.test.js`
- `README.md`, `CHANGELOG.md`
- Subagents for this session:
none — `/opsx:archive` is a CLI call (`npx agent-orchestrator-kit archive <name>`). Do not spawn spec-architect, spec-reviewer, or apply specialists. `spec-archiver` only if the archive CLI fails.
- Constraints:
Do not start archive in a new chat until the PR is merged and CI is green. Do not edit `proposal.md`, `design.md`, delta spec, or `review.md`. Keep `scripts/cursor-spend-collect.cjs` byte-identical to the template. No commit/push unless the user asks. HARD STOP after persist; next role is a new chat.
- status: spec-approved
- tasks: 16/16
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/fix-metrics-amp-cost-lock-leftover/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff fix-metrics-amp-cost-lock-leftover` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:fix-metrics-amp-cost-lock-leftover`, `Handoff:fix-metrics-amp-cost-lock-leftover`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
