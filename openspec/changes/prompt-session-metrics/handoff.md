# Session Handoff

## Closed role
Implementer

## Change
- name: prompt-session-metrics
- status: applying
- tasks: 28/28
- review: APPROVE
- last_role: Implementer

## Done
Implementer phase closed. All 28 `tasks.md` checkboxes are `[x]`. Apply is parent-driven from `tasks.md` + `apply-notes.md`; no specialist subagent was spawned (`next_subagent: none`). Archive was not started in this chat.

This conductor thread started as `/opsx:apply`. Mandatory start:
- `npx agent-orchestrator-kit status` — change active, 0/28 tasks, `review: APPROVE`, MCP memory ok.
- `npx agent-orchestrator-kit handoff prompt-session-metrics --restore` — briefing restored from Spec Reviewer `handoff.md` + `decisions.md`. Memory MCP tools remain unavailable (`GetDynamicTools` on `memory|create_entities|search_nodes|open_nodes` — 0 matches) and `.cursor/memory.json` is empty; per protocol this does not block because the file exists.
- Briefing was complete — `session-handoff` restore was not spawned.
- Apply is parent-driven; `.cursor/agents/none.md` does not exist. Implementation ran in the parent from the task contract.

Implemented:
- Parser + `## Metrics` render (`HANDOFF_SECTIONS`, `buildHandoffMarkdown`, `parseMetricsSection`, `fieldsFromSections`). Persist writes `handoff.md` once before `metricsRecordSessionEnd`. Flags do not rewrite the section.
- Resolve chains: `--model` / `--platform` → self-report → env / host → `--collect` sources. `resolveSessionSpend` owns `totalTokens` sum and `spendSource`. `applyCollectedSessionFields` no longer inverts model/totals from sources over flags or self-report.
- `--no-collect` removed; `handoff` and `archive` take opt-in `--collect`. `ensureCursorSpendHook` removed from restore, persist, and `metrics`; remains in `init` / `update` / `sync` / `mcp-setup`.
- Archive carries `priorFields.metrics` into the post-move `handoff.md` rewrite (M-A) and resolves the Archiver session from that section. `parseMetricsSection` warnings print on stderr (M-B).
- `recomputeSpendMaps` adds session-level self-report without double-counting matching sources. `renderMetricsSummary` is shared by `metrics` and `archive` stdout; unreported count is a display-layer default.
- Protocol templates updated (`session-handoff.mdc`, session-handoff / spec-archiver subagents, agent-orchestration skill, `AGENTS.md`, `CLAUDE.md`).
- Smoke tests rewritten and extended. Kit version `0.7.0`. CHANGELOG marks `--no-collect` BREAKING.

Verify (this session):
- `npm test` — **137/137 pass, exit 0**.
- `npx openspec validate --all --strict` — **19 passed, exit 0**.
- `handoff --help` / `archive --help` show `--collect` and not `--no-collect`. Exactly one `--no-collect` CLI call remains in `test/smoke.test.js` (unknown-flag assertion).

Not touched: `openspec/specs/` (sync at archive), `test/spend-collect.test.js`, adapter logic in `bin/spend-collect.js`. Previous-change working-tree baseline in `bin/` / `test/` / `scripts/` was not reverted.

## Decisions
- apply-complete-28-28: all 28 tasks implemented and checked; local verify is green
- apply-archive-metrics-carried: archive writes `fields.metrics` from `priorFields` before the post-move `handoff.md` rewrite so the Archiver session can resolve the self-report
- apply-collect-opt-in: persist and archive call collect/backfill only when `opts.collect === true`

## Blocked
none

## Next command
`/opsx:archive prompt-session-metrics`

## Next role
none

## Attach
- `openspec/changes/prompt-session-metrics/tasks.md`
- `openspec/changes/prompt-session-metrics/apply-notes.md`
- `bin/agent-orchestrator.js`
- `test/smoke.test.js`
- `README.md`
- `CHANGELOG.md`
- `package.json`

## Subagents to spawn
none — archive is a CLI (`npx agent-orchestrator-kit archive prompt-session-metrics --sync`); phase subagent is forbidden

## Constraints
- Do not start archive in the apply chat. Next thread runs `/opsx:archive` after the user is ready (typically PR + CI green).
- Do not edit `openspec/specs/` until `archive --sync`.
- Do not revert the previous-change working-tree baseline that this apply built on.
- Memory MCP tools are unavailable; source of truth is `handoff.md` + `decisions.md`.
- `--collect` is optional. Do not guess tokens on persist.

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
- spend_source: unreported

## Prompt

```text
/opsx:archive prompt-session-metrics

You are the conductor for the next role session of change `prompt-session-metrics`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive prompt-session-metrics`
- Next role / phase subagent: `none`
- Amp: spawn isolated skill `subagent-none` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/none.md` / `.claude/agents/none.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive prompt-session-metrics` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff prompt-session-metrics --restore`
4. Read Memory MCP: `Change:prompt-session-metrics`, `Handoff:prompt-session-metrics`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/prompt-session-metrics/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Implementer
- Change: - name: prompt-session-metrics
- status: applying
- tasks: 28/28
- review: APPROVE
- last_role: Implementer
- Done:
Implementer phase closed. All 28 `tasks.md` checkboxes are `[x]`. Apply is parent-driven from `tasks.md` + `apply-notes.md`; no specialist subagent was spawned (`next_subagent: none`). Archive was not started in this chat.

This conductor thread started as `/opsx:apply`. Mandatory start:
- `npx agent-orchestrator-kit status` — change active, 0/28 tasks, `review: APPROVE`, MCP memory ok.
- `npx agent-orchestrator-kit handoff prompt-session-metrics --restore` — briefing restored from Spec Reviewer `handoff.md` + `decisions.md`. Memory MCP tools remain unavailable (`GetDynamicTools` on `memory|create_entities|search_nodes|open_nodes` — 0 matches) and `.cursor/memory.json` is empty; per protocol this does not block because the file exists.
- Briefing was complete — `session-handoff` restore was not spawned.
- Apply is parent-driven; `.cursor/agents/none.md` does not exist. Implementation ran in the parent from the task contract.

Implemented:
- Parser + `## Metrics` render (`HANDOFF_SECTIONS`, `buildHandoffMarkdown`, `parseMetricsSection`, `fieldsFromSections`). Persist writes `handoff.md` once before `metricsRecordSessionEnd`. Flags do not rewrite the section.
- Resolve chains: `--model` / `--platform` → self-report → env / host → `--collect` sources. `resolveSessionSpend` owns `totalTokens` sum and `spendSource`. `applyCollectedSessionFields` no longer inverts model/totals from sources over flags or self-report.
- `--no-collect` removed; `handoff` and `archive` take opt-in `--collect`. `ensureCursorSpendHook` removed from restore, persist, and `metrics`; remains in `init` / `update` / `sync` / `mcp-setup`.
- Archive carries `priorFields.metrics` into the post-move `handoff.md` rewrite (M-A) and resolves the Archiver session from that section. `parseMetricsSection` warnings print on stderr (M-B).
- `recomputeSpendMaps` adds session-level self-report without double-counting matching sources. `renderMetricsSummary` is shared by `metrics` and `archive` stdout; unreported count is a display-layer default.
- Protocol templates updated (`session-handoff.mdc`, session-handoff / spec-archiver subagents, agent-orchestration skill, `AGENTS.md`, `CLAUDE.md`).
- Smoke tests rewritten and extended. Kit version `0.7.0`. CHANGELOG marks `--no-collect` BREAKING.

Verify (this session):
- `npm test` — **137/137 pass, exit 0**.
- `npx openspec validate --all --strict` — **19 passed, exit 0**.
- `handoff --help` / `archive --help` show `--collect` and not `--no-collect`. Exactly one `--no-collect` CLI call remains in `test/smoke.test.js` (unknown-flag assertion).

Not touched: `openspec/specs/` (sync at archive), `test/spend-collect.test.js`, adapter logic in `bin/spend-collect.js`. Previous-change working-tree baseline in `bin/` / `test/` / `scripts/` was not reverted.
- Decisions:
- apply-complete-28-28: all 28 tasks implemented and checked; local verify is green
- apply-archive-metrics-carried: archive writes `fields.metrics` from `priorFields` before the post-move `handoff.md` rewrite so the Archiver session can resolve the self-report
- apply-collect-opt-in: persist and archive call collect/backfill only when `opts.collect === true`
- Blocked:
none
- Attach:
- `openspec/changes/prompt-session-metrics/tasks.md`
- `openspec/changes/prompt-session-metrics/apply-notes.md`
- `bin/agent-orchestrator.js`
- `test/smoke.test.js`
- `README.md`
- `CHANGELOG.md`
- `package.json`
- Subagents for this session:
none — archive is a CLI (`npx agent-orchestrator-kit archive prompt-session-metrics --sync`); phase subagent is forbidden
- Constraints:
- Do not start archive in the apply chat. Next thread runs `/opsx:archive` after the user is ready (typically PR + CI green).
- Do not edit `openspec/specs/` until `archive --sync`.
- Do not revert the previous-change working-tree baseline that this apply built on.
- Memory MCP tools are unavailable; source of truth is `handoff.md` + `decisions.md`.
- `--collect` is optional. Do not guess tokens on persist.
- status: spec-approved
- tasks: 28/28
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/prompt-session-metrics/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff prompt-session-metrics` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:prompt-session-metrics`, `Handoff:prompt-session-metrics`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
