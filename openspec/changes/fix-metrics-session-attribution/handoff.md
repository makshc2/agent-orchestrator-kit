# Session Handoff

## Closed role
Archiver — gate blocked; did not run archive CLI

## Change
- name: fix-metrics-session-attribution
- status: in-progress
- tasks: 19/19
- review: APPROVE
- last_role: Archiver

## Done
Announced Archiver (conductor). `npx agent-orchestrator-kit status`: tasks 19/19, review APPROVE, ready-to-archive flag. `handoff --restore` exit 0; briefing from `handoff.md` + `decisions.md`. Memory JSON empty/missing; Memory MCP tools unavailable. Restore complete — did not spawn `session-handoff`.

Did not spawn `spec-archiver`. Did not run `npx agent-orchestrator-kit archive … --sync`. Constraints require tests pass, PR merged, and CI green first.

Re-verified this session: HEAD `a889d98` (`agent factory metric`) on `main` tracking `origin/main`. Working tree dirty: `.agents/rules/ask-before-heavy-ops.mdc`, `openspec/changes/fix-metrics-session-attribution/handoff.md`, `metrics.json`. No open PR (`gh` unavailable / no PR). User policy forbids agent `npm test`. CI not confirmed green.

## Decisions
- archive-blocked-until-merge: do not archive until local tests pass, a PR is merged, and CI is green; archive remains `npx agent-orchestrator-kit archive fix-metrics-session-attribution --sync` (no `spec-archiver` unless that CLI fails).

## Blocked
tests not executed (user forbids agent test runs); no PR; not merged; CI not green. Suggested after permission: `node --test test/smoke.test.js test/spend-collect.test.js test/session-client.test.js`. Do not backfill archived consumer `metrics.json`.

## Next command
`/opsx:archive fix-metrics-session-attribution`

## Next role
Archiver

## Attach
- `openspec/changes/fix-metrics-session-attribution/apply-notes.md`
- `openspec/changes/fix-metrics-session-attribution/review.md`
- `openspec/changes/fix-metrics-session-attribution/proposal.md`
- `openspec/changes/fix-metrics-session-attribution/design.md`
- `openspec/changes/fix-metrics-session-attribution/tasks.md`
- `openspec/changes/fix-metrics-session-attribution/decisions.md`
- `openspec/changes/fix-metrics-session-attribution/specs/change-metrics/spec.md`
- `openspec/changes/fix-metrics-session-attribution/specs/session-handoff/spec.md`
- `openspec/changes/fix-metrics-session-attribution/specs/lean-archive/spec.md`
- `bin/agent-orchestrator.js`
- `bin/session-client.js`
- `bin/spend-collect.js`
- `scripts/cursor-spend-collect.cjs`
- `templates/scripts/cursor-spend-collect.cjs`
- `test/smoke.test.js`
- `test/spend-collect.test.js`
- `test/session-client.test.js`
- `README.md`
- `CHANGELOG.md`

## Subagents to spawn
- Archive is a CLI call: `npx agent-orchestrator-kit archive fix-metrics-session-attribution --sync`. Do not spawn `spec-archiver` unless that CLI fails. Do not spawn `spec-reviewer`. Do not spawn `spec-architect`.
- `session-handoff` — restore/persist fallback only.

## Constraints
- language: en
- do not mix phases
- do not start archive until tests pass, PR is merged, and CI is green
- no `npm test` without user permission; suggested command after permission: `node --test test/smoke.test.js test/spend-collect.test.js test/session-client.test.js`
- Design: none
- do not backfill archived consumer metrics.json
- do not treat leftover uncommitted spend-hook WIP as this change
- persist leftoverEnd MUST NOT be `now`
- Archiver `--collect` window is `[pending.startedAt, now]`

## Runtime
- runtime: local
- agent_id: none

## Metrics
- platform: cursor
- model: cursor-grok-4.6
- input_tokens: unknown
- output_tokens: unknown
- cost_usd: unknown
- amp_credits: unknown
- spend_source: unknown

## Prompt

```text
/opsx:archive fix-metrics-session-attribution

You are the conductor for the next role session of change `fix-metrics-session-attribution`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive fix-metrics-session-attribution`
- Next role / phase subagent: `spec-archiver`
- Amp: spawn isolated skill `subagent-spec-archiver` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/spec-archiver.md` / `.claude/agents/spec-archiver.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive fix-metrics-session-attribution` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff fix-metrics-session-attribution --restore`
4. Read Memory MCP: `Change:fix-metrics-session-attribution`, `Handoff:fix-metrics-session-attribution`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/fix-metrics-session-attribution/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Archiver — gate blocked; did not run archive CLI
- Change: - name: fix-metrics-session-attribution
- status: in-progress
- tasks: 19/19
- review: APPROVE
- last_role: Archiver
- Done:
Announced Archiver (conductor). `npx agent-orchestrator-kit status`: tasks 19/19, review APPROVE, ready-to-archive flag. `handoff --restore` exit 0; briefing from `handoff.md` + `decisions.md`. Memory JSON empty/missing; Memory MCP tools unavailable. Restore complete — did not spawn `session-handoff`.

Did not spawn `spec-archiver`. Did not run `npx agent-orchestrator-kit archive … --sync`. Constraints require tests pass, PR merged, and CI green first.

Re-verified this session: HEAD `a889d98` (`agent factory metric`) on `main` tracking `origin/main`. Working tree dirty: `.agents/rules/ask-before-heavy-ops.mdc`, `openspec/changes/fix-metrics-session-attribution/handoff.md`, `metrics.json`. No open PR (`gh` unavailable / no PR). User policy forbids agent `npm test`. CI not confirmed green.
- Decisions:
- archive-blocked-until-merge: do not archive until local tests pass, a PR is merged, and CI is green; archive remains `npx agent-orchestrator-kit archive fix-metrics-session-attribution --sync` (no `spec-archiver` unless that CLI fails).
- Blocked:
tests not executed (user forbids agent test runs); no PR; not merged; CI not green. Suggested after permission: `node --test test/smoke.test.js test/spend-collect.test.js test/session-client.test.js`. Do not backfill archived consumer `metrics.json`.
- Attach:
- `openspec/changes/fix-metrics-session-attribution/apply-notes.md`
- `openspec/changes/fix-metrics-session-attribution/review.md`
- `openspec/changes/fix-metrics-session-attribution/proposal.md`
- `openspec/changes/fix-metrics-session-attribution/design.md`
- `openspec/changes/fix-metrics-session-attribution/tasks.md`
- `openspec/changes/fix-metrics-session-attribution/decisions.md`
- `openspec/changes/fix-metrics-session-attribution/specs/change-metrics/spec.md`
- `openspec/changes/fix-metrics-session-attribution/specs/session-handoff/spec.md`
- `openspec/changes/fix-metrics-session-attribution/specs/lean-archive/spec.md`
- `bin/agent-orchestrator.js`
- `bin/session-client.js`
- `bin/spend-collect.js`
- `scripts/cursor-spend-collect.cjs`
- `templates/scripts/cursor-spend-collect.cjs`
- `test/smoke.test.js`
- `test/spend-collect.test.js`
- `test/session-client.test.js`
- `README.md`
- `CHANGELOG.md`
- Subagents for this session:
- Archive is a CLI call: `npx agent-orchestrator-kit archive fix-metrics-session-attribution --sync`. Do not spawn `spec-archiver` unless that CLI fails. Do not spawn `spec-reviewer`. Do not spawn `spec-architect`.
- `session-handoff` — restore/persist fallback only.
- Constraints:
- language: en
- do not mix phases
- do not start archive until tests pass, PR is merged, and CI is green
- no `npm test` without user permission; suggested command after permission: `node --test test/smoke.test.js test/spend-collect.test.js test/session-client.test.js`
- Design: none
- do not backfill archived consumer metrics.json
- do not treat leftover uncommitted spend-hook WIP as this change
- persist leftoverEnd MUST NOT be `now`
- Archiver `--collect` window is `[pending.startedAt, now]`
- status: spec-approved
- tasks: 19/19
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/fix-metrics-session-attribution/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff fix-metrics-session-attribution` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:fix-metrics-session-attribution`, `Handoff:fix-metrics-session-attribution`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
