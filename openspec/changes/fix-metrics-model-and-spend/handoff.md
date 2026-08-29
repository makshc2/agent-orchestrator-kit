# Session Handoff

## Closed role
Implementer

## Change
- name: fix-metrics-model-and-spend
- status: applying
- tasks: 14/14
- review: APPROVE
- last_role: Implementer

## Done
- Conductor honored `/opsx:apply fix-metrics-model-and-spend` as parent-driven Implementer (lean apply: no whole-change implementer spawn). `npx agent-orchestrator-kit status` showed one active change (0/14 at start, review APPROVE). `handoff --restore` exit 0 from `handoff.md` + `decisions.md`. Memory MCP tools not in this session catalog; CLI warned Memory JSON empty; briefing complete — restore spawn skipped.
- Review gate: `review.md` Verdict APPROVE. Schema spec-driven, `openspec instructions apply` state ready, 14 pending tasks.
- Implemented all 14 tasks from Files/Do/Done-when + `apply-notes.md`:
  - `resolveModel` / `resolvePlatform` on persist and archive; invalid `--platform` fails before persist/move; `CURSOR_AGENT` ignored.
  - Human `metrics` table columns `roles` + `models`; by-platform and by-model tables; summary `cost` is `spend.costUsd` only.
  - `metricsFinalizeArchive` always creates/updates the file, appends one Archiver session, collect window from last prior `session.endedAt` or `createdAt` (computed before append), `console.error` when `spend.costUsd === null` and when final `session.model` is null.
  - Session Exit protocol in `session-handoff.mdc`, orchestration SKILL, and `session-handoff` subagent: required `--model <llm-product-id>`, role/subagent ban, auto-collect, flags override totals only, no Cursor SDK / Claude `/cost` / Amp billing as a required step.
  - `opsx-archive.md` mentions `metrics.json` finalize + collect; 1090 bytes (≤1536); no spec-archiver spawn.
  - `bin/spend-collect.js`: Claude JSONL (`/` and `.` → `-`, window `timestamp`, `cache_*` in input, cwd match); Amp `trees[].uri` after `file://` (no trees → skip, no `meta.cwd`, no ledger → `ampCredits: null`); Cursor snapshot vscdb + system sqlite3, empty+note without db/sqlite/token columns.
  - Persist/archive call collect unless `--no-collect`; no spend flags → session totals from sources; any spend flag overrides the four session fields only; `session.models` when >1 model; recompute session-USD else source-USD; `phases.*.models` unions `session.model` and `session.models`.
- `npm test`: 124/124 pass. `npx openspec validate fix-metrics-model-and-spend --strict` pass. No `lint` or `build` script in package.json (Node CLI kit). Did not start `/opsx:archive`.

## Decisions
- apply-complete: all 14 tasks implemented and checked; `npm test` 124/124; `openspec validate --strict` pass; no package.json lint/build scripts; ready for PR, then `/opsx:archive` after merge + CI green

## Blocked
none

## Next command
`/opsx:archive fix-metrics-model-and-spend`

## Next role
Archiver

## Attach
- `openspec/changes/fix-metrics-model-and-spend/tasks.md` (14/14)
- `openspec/changes/fix-metrics-model-and-spend/apply-notes.md`
- `openspec/changes/fix-metrics-model-and-spend/review.md` (APPROVE)
- `bin/agent-orchestrator.js`
- `bin/spend-collect.js`
- `test/spend-collect.test.js`
- `test/smoke.test.js`
- `templates/.agents/rules/session-handoff.mdc`
- `templates/.agents/commands/opsx-archive.md`
- `README.md`
- `CHANGELOG.md`

## Subagents to spawn
- none — archive is one CLI call (`npx agent-orchestrator-kit archive <name> [--sync]`); phase subagents forbidden
- `session-handoff` — fallback only if persist/restore CLI fails (Amp: isolated `subagent-session-handoff`)

## Constraints
- language: en
- do not mix phases
- Do not start archive until the PR is merged and CI is green
- Archive is CLI-only: `npx agent-orchestrator-kit archive fix-metrics-model-and-spend [--sync | --no-sync --force]`; no spec-archiver spawn
- `decisions.md` is append-only; do not rewrite history
- Non-goals unchanged: no unified bill, no Cursor SDK/server CSV, no npm sqlite, no pricing table, no archive backfill, no Phase 4 dashboard, no new pipeline roles, metrics never a persist/archive/`gate-check` gate
- Pass `--model <llm-product-id>` on persist (never a Closed role or subagent name)
- Ask the user for `--sync` vs `--no-sync --force` when delta specs exist

## Runtime
- runtime: local
- agent_id: none

## Prompt

```text
/opsx:archive fix-metrics-model-and-spend

You are the conductor for the next role session of change `fix-metrics-model-and-spend`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive fix-metrics-model-and-spend`
- Next role / phase subagent: `session-handoff`
- Amp: spawn isolated skill `subagent-session-handoff` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/session-handoff.md` / `.claude/agents/session-handoff.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive fix-metrics-model-and-spend` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff fix-metrics-model-and-spend --restore`
4. Read Memory MCP: `Change:fix-metrics-model-and-spend`, `Handoff:fix-metrics-model-and-spend`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/fix-metrics-model-and-spend/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Implementer
- Change: - name: fix-metrics-model-and-spend
- status: applying
- tasks: 14/14
- review: APPROVE
- last_role: Implementer
- Done:
- Conductor honored `/opsx:apply fix-metrics-model-and-spend` as parent-driven Implementer (lean apply: no whole-change implementer spawn). `npx agent-orchestrator-kit status` showed one active change (0/14 at start, review APPROVE). `handoff --restore` exit 0 from `handoff.md` + `decisions.md`. Memory MCP tools not in this session catalog; CLI warned Memory JSON empty; briefing complete — restore spawn skipped.
- Review gate: `review.md` Verdict APPROVE. Schema spec-driven, `openspec instructions apply` state ready, 14 pending tasks.
- Implemented all 14 tasks from Files/Do/Done-when + `apply-notes.md`:
  - `resolveModel` / `resolvePlatform` on persist and archive; invalid `--platform` fails before persist/move; `CURSOR_AGENT` ignored.
  - Human `metrics` table columns `roles` + `models`; by-platform and by-model tables; summary `cost` is `spend.costUsd` only.
  - `metricsFinalizeArchive` always creates/updates the file, appends one Archiver session, collect window from last prior `session.endedAt` or `createdAt` (computed before append), `console.error` when `spend.costUsd === null` and when final `session.model` is null.
  - Session Exit protocol in `session-handoff.mdc`, orchestration SKILL, and `session-handoff` subagent: required `--model <llm-product-id>`, role/subagent ban, auto-collect, flags override totals only, no Cursor SDK / Claude `/cost` / Amp billing as a required step.
  - `opsx-archive.md` mentions `metrics.json` finalize + collect; 1090 bytes (≤1536); no spec-archiver spawn.
  - `bin/spend-collect.js`: Claude JSONL (`/` and `.` → `-`, window `timestamp`, `cache_*` in input, cwd match); Amp `trees[].uri` after `file://` (no trees → skip, no `meta.cwd`, no ledger → `ampCredits: null`); Cursor snapshot vscdb + system sqlite3, empty+note without db/sqlite/token columns.
  - Persist/archive call collect unless `--no-collect`; no spend flags → session totals from sources; any spend flag overrides the four session fields only; `session.models` when >1 model; recompute session-USD else source-USD; `phases.*.models` unions `session.model` and `session.models`.
- `npm test`: 124/124 pass. `npx openspec validate fix-metrics-model-and-spend --strict` pass. No `lint` or `build` script in package.json (Node CLI kit). Did not start `/opsx:archive`.
- Decisions:
- apply-complete: all 14 tasks implemented and checked; `npm test` 124/124; `openspec validate --strict` pass; no package.json lint/build scripts; ready for PR, then `/opsx:archive` after merge + CI green
- Blocked:
none
- Attach:
- `openspec/changes/fix-metrics-model-and-spend/tasks.md` (14/14)
- `openspec/changes/fix-metrics-model-and-spend/apply-notes.md`
- `openspec/changes/fix-metrics-model-and-spend/review.md` (APPROVE)
- `bin/agent-orchestrator.js`
- `bin/spend-collect.js`
- `test/spend-collect.test.js`
- `test/smoke.test.js`
- `templates/.agents/rules/session-handoff.mdc`
- `templates/.agents/commands/opsx-archive.md`
- `README.md`
- `CHANGELOG.md`
- Subagents for this session:
- none — archive is one CLI call (`npx agent-orchestrator-kit archive <name> [--sync]`); phase subagents forbidden
- `session-handoff` — fallback only if persist/restore CLI fails (Amp: isolated `subagent-session-handoff`)
- Constraints:
- language: en
- do not mix phases
- Do not start archive until the PR is merged and CI is green
- Archive is CLI-only: `npx agent-orchestrator-kit archive fix-metrics-model-and-spend [--sync | --no-sync --force]`; no spec-archiver spawn
- `decisions.md` is append-only; do not rewrite history
- Non-goals unchanged: no unified bill, no Cursor SDK/server CSV, no npm sqlite, no pricing table, no archive backfill, no Phase 4 dashboard, no new pipeline roles, metrics never a persist/archive/`gate-check` gate
- Pass `--model <llm-product-id>` on persist (never a Closed role or subagent name)
- Ask the user for `--sync` vs `--no-sync --force` when delta specs exist
- status: spec-approved
- tasks: 14/14
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/fix-metrics-model-and-spend/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff fix-metrics-model-and-spend` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:fix-metrics-model-and-spend`, `Handoff:fix-metrics-model-and-spend`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
