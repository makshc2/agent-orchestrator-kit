# Session Handoff

## Closed role
Implementer — 12/12 tasks, Ready for MR

## Change
- name: fix-cursor-leftover-race-and-multiroot
- status: apply-complete
- tasks: 12/12
- review: APPROVE
- last_role: Implementer

## Done
Apply closed. Isolated [code-writer](93d43aea-f84f-47d1-9291-c80a15200d0e) implemented tasks 1.1–7.2. Conductor verified the report against `tasks.md` / `apply-notes.md` / delta spec, then marked all 12 checkboxes.

Verify: `cmp` empty for both script/template pairs; `node -e "require('./scripts/cursor-spend-collect.cjs'); console.log('ok')"` prints `ok`; `node --check` on collect, hook, and `bin/agent-orchestrator.js` passed; `node --test test/smoke.test.js test/spend-collect.test.js` 161/161 exit 0 (independent re-run). Isolated [code-reviewer](2be039c8-e902-4c3b-a3eb-b9b0e11d2e5d) verdict: Ready for MR. No lint script in this repo. Memory MCP tools unavailable this session; Memory JSON was empty at restore.

Apply files: `scripts/cursor-spend-collect.cjs`, `templates/scripts/cursor-spend-collect.cjs`, `scripts/cursor-spend-hook.cjs`, `templates/scripts/cursor-spend-hook.cjs`, `bin/agent-orchestrator.js`, `test/smoke.test.js`, `test/spend-collect.test.js`, `README.md`, `CHANGELOG.md`. `bin/spend-collect.js` unchanged (`cursorConversationId: last.threadId` already present). Pre-existing dirty files are not this apply: `.agents/rules/ask-before-heavy-ops.mdc`, `openspec/changes/archive/2026-08-31-fix-metrics-session-attribution/metrics.json`.

## Decisions
none

## Blocked
none

## Next command
`/opsx:archive fix-cursor-leftover-race-and-multiroot`

## Next role
Archiver

## Attach
- `openspec/changes/fix-cursor-leftover-race-and-multiroot/tasks.md`
- `openspec/changes/fix-cursor-leftover-race-and-multiroot/apply-notes.md`
- `openspec/changes/fix-cursor-leftover-race-and-multiroot/specs/change-metrics/spec.md`
- `openspec/specs/change-metrics/spec.md`
- `scripts/cursor-spend-collect.cjs`
- `scripts/cursor-spend-hook.cjs`
- `bin/agent-orchestrator.js`
- `README.md`
- `CHANGELOG.md`

## Subagents to spawn
none

## Constraints
- language: en
- do not mix phases
- one active change
- archive only after commit, PR merge, and CI green
- archive is CLI: `npx agent-orchestrator-kit archive fix-cursor-leftover-race-and-multiroot` — do not spawn spec-archiver unless that CLI fails
- merge `phases.*.startedAt` / `endedAt` / `leadTimeMs` into the main-spec schema list at archive
- do not backfill FE/consumer archives
- leftover window stays 120s; no second persist
- keep scripts/* byte-identical to templates/scripts/* (`cmp`)
- status: apply-complete
- tasks: 12/12
- review: APPROVE

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
/opsx:archive fix-cursor-leftover-race-and-multiroot

You are the conductor for the next role session of change `fix-cursor-leftover-race-and-multiroot`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive fix-cursor-leftover-race-and-multiroot`
- Next role / phase subagent: `none`
- Amp: spawn isolated skill `subagent-none` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/none.md` / `.claude/agents/none.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive fix-cursor-leftover-race-and-multiroot` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff fix-cursor-leftover-race-and-multiroot --restore`
4. Read Memory MCP: `Change:fix-cursor-leftover-race-and-multiroot`, `Handoff:fix-cursor-leftover-race-and-multiroot`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/fix-cursor-leftover-race-and-multiroot/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Implementer — 12/12 tasks, Ready for MR
- Change: - name: fix-cursor-leftover-race-and-multiroot
- status: apply-complete
- tasks: 12/12
- review: APPROVE
- last_role: Implementer
- Done:
Apply closed. Isolated [code-writer](93d43aea-f84f-47d1-9291-c80a15200d0e) implemented tasks 1.1–7.2. Conductor verified the report against `tasks.md` / `apply-notes.md` / delta spec, then marked all 12 checkboxes.

Verify: `cmp` empty for both script/template pairs; `node -e "require('./scripts/cursor-spend-collect.cjs'); console.log('ok')"` prints `ok`; `node --check` on collect, hook, and `bin/agent-orchestrator.js` passed; `node --test test/smoke.test.js test/spend-collect.test.js` 161/161 exit 0 (independent re-run). Isolated [code-reviewer](2be039c8-e902-4c3b-a3eb-b9b0e11d2e5d) verdict: Ready for MR. No lint script in this repo. Memory MCP tools unavailable this session; Memory JSON was empty at restore.

Apply files: `scripts/cursor-spend-collect.cjs`, `templates/scripts/cursor-spend-collect.cjs`, `scripts/cursor-spend-hook.cjs`, `templates/scripts/cursor-spend-hook.cjs`, `bin/agent-orchestrator.js`, `test/smoke.test.js`, `test/spend-collect.test.js`, `README.md`, `CHANGELOG.md`. `bin/spend-collect.js` unchanged (`cursorConversationId: last.threadId` already present). Pre-existing dirty files are not this apply: `.agents/rules/ask-before-heavy-ops.mdc`, `openspec/changes/archive/2026-08-31-fix-metrics-session-attribution/metrics.json`.
- Decisions:
none
- Blocked:
none
- Attach:
- `openspec/changes/fix-cursor-leftover-race-and-multiroot/tasks.md`
- `openspec/changes/fix-cursor-leftover-race-and-multiroot/apply-notes.md`
- `openspec/changes/fix-cursor-leftover-race-and-multiroot/specs/change-metrics/spec.md`
- `openspec/specs/change-metrics/spec.md`
- `scripts/cursor-spend-collect.cjs`
- `scripts/cursor-spend-hook.cjs`
- `bin/agent-orchestrator.js`
- `README.md`
- `CHANGELOG.md`
- Subagents for this session:
none
- Constraints:
- language: en
- do not mix phases
- one active change
- archive only after commit, PR merge, and CI green
- archive is CLI: `npx agent-orchestrator-kit archive fix-cursor-leftover-race-and-multiroot` — do not spawn spec-archiver unless that CLI fails
- merge `phases.*.startedAt` / `endedAt` / `leadTimeMs` into the main-spec schema list at archive
- do not backfill FE/consumer archives
- leftover window stays 120s; no second persist
- keep scripts/* byte-identical to templates/scripts/* (`cmp`)
- status: apply-complete
- tasks: 12/12
- review: APPROVE
- status: spec-approved
- tasks: 12/12
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/fix-cursor-leftover-race-and-multiroot/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff fix-cursor-leftover-race-and-multiroot` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:fix-cursor-leftover-race-and-multiroot`, `Handoff:fix-cursor-leftover-race-and-multiroot`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
