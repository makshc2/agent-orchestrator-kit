# Session Handoff

## Closed role
Implementer

## Change
- name: fix-metrics-dedup-window-compact-schema
- status: apply complete; local verification green
- tasks: 18/18
- review: APPROVE
- last_role: Implementer

## Done
Implemented compact metrics schema v2 and representation-only v1 migration, bounded/deduplicated collection windows, Claude and Amp estimates, authoritative Amp usage resync, thread-aware dedup, Cursor leftover backfill, safe spawn-name parsing, `metrics --migrate`, and `metrics --summary-json`. Updated session-exit guidance, README, CHANGELOG, and package version to 0.14.0. All 18 tasks are complete. `npm test` passes 198/198; `npm run release:check`, strict OpenSpec validation, task gate, syntax checks, diff check, and both script/template byte-parity checks pass.

## Decisions
- Preserve compact persisted sessions (`sourceIds`, `sourceTotals`, `byModel`) and keep per-event `sources` transient only.
- Preserve existing billed Amp Cost unless fresh leftover usage supplies Cost; do not bill an already-recorded thread again in a new session.
- Keep schema-only migration numerically invariant and free of recompute.

## Blocked
None in apply. CI/merge verification remains external and archive must run only after the normal merge gate.

## Next command
`/opsx:archive fix-metrics-dedup-window-compact-schema`

## Next role
Verifier / code reviewer in a NEW chat. Review the implementation diff and rerun required checks; do not archive before CI is green and the change is merged.

## Attach
`openspec/changes/fix-metrics-dedup-window-compact-schema/tasks.md`, `review.md`, `apply-notes.md`, implementation diff, `test/`, `README.md`, and `CHANGELOG.md`.

## Subagents to spawn
None mandatory. Use a code reviewer only for an isolated post-implementation review.

## Constraints
Do not modify approved specs during verification. Do not commit, push, merge, publish, or archive without the owner's explicit request and the required gate state. Keep `scripts/cursor-spend-collect.cjs` byte-identical to its template, and likewise for the hook pair.

## Runtime
- runtime: local
- agent_id: none

## Metrics
- platform: amp
- model: unknown
- input_tokens: unknown
- output_tokens: unknown
- cost_usd: unknown
- amp_credits: unknown
- spend_source: unknown

## Prompt

```text
/opsx:archive fix-metrics-dedup-window-compact-schema

You are the conductor for the next role session of change `fix-metrics-dedup-window-compact-schema`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive fix-metrics-dedup-window-compact-schema`
- Next role / phase subagent: `Verifier / code reviewer in a NEW chat. Review the implementation diff and rerun required checks; do not archive before CI is green and the change is merged.`
- Amp: spawn isolated skill `subagent-<phase-specialist>` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/<name>.md` / `.claude/agents/<name>.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive fix-metrics-dedup-window-compact-schema` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff fix-metrics-dedup-window-compact-schema --restore`
4. Read Memory MCP: `Change:fix-metrics-dedup-window-compact-schema`, `Handoff:fix-metrics-dedup-window-compact-schema`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/fix-metrics-dedup-window-compact-schema/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Implementer
- Change: - name: fix-metrics-dedup-window-compact-schema
- status: apply complete; local verification green
- tasks: 18/18
- review: APPROVE
- last_role: Implementer
- Done:
Implemented compact metrics schema v2 and representation-only v1 migration, bounded/deduplicated collection windows, Claude and Amp estimates, authoritative Amp usage resync, thread-aware dedup, Cursor leftover backfill, safe spawn-name parsing, `metrics --migrate`, and `metrics --summary-json`. Updated session-exit guidance, README, CHANGELOG, and package version to 0.14.0. All 18 tasks are complete. `npm test` passes 198/198; `npm run release:check`, strict OpenSpec validation, task gate, syntax checks, diff check, and both script/template byte-parity checks pass.
- Decisions:
- Preserve compact persisted sessions (`sourceIds`, `sourceTotals`, `byModel`) and keep per-event `sources` transient only.
- Preserve existing billed Amp Cost unless fresh leftover usage supplies Cost; do not bill an already-recorded thread again in a new session.
- Keep schema-only migration numerically invariant and free of recompute.
- Blocked:
None in apply. CI/merge verification remains external and archive must run only after the normal merge gate.
- Attach:
`openspec/changes/fix-metrics-dedup-window-compact-schema/tasks.md`, `review.md`, `apply-notes.md`, implementation diff, `test/`, `README.md`, and `CHANGELOG.md`.
- Subagents for this session:
None mandatory. Use a code reviewer only for an isolated post-implementation review.
- Constraints:
Do not modify approved specs during verification. Do not commit, push, merge, publish, or archive without the owner's explicit request and the required gate state. Keep `scripts/cursor-spend-collect.cjs` byte-identical to its template, and likewise for the hook pair.
- status: spec-approved
- tasks: 18/18
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/fix-metrics-dedup-window-compact-schema/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff fix-metrics-dedup-window-compact-schema` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:fix-metrics-dedup-window-compact-schema`, `Handoff:fix-metrics-dedup-window-compact-schema`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
