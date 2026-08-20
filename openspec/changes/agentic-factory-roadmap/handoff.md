# Session Handoff

## Closed role
Archiver

## Change
- name: agentic-factory-roadmap
- status: archive-blocked

## Done
Conductor ran `/opsx:archive agentic-factory-roadmap`. `npx agent-orchestrator-kit status`: 7/7 tasks, APPROVE, ready to archive. `handoff --restore` succeeded from `handoff.md` (Memory JSON entities present; Memory MCP tools unavailable in this Cursor session). Phase specialist is `none` (archive is CLI-only; `.cursor/agents/none.md` absent by design — no `spec-archiver`). Merge-gate re-check failed unchanged: working tree has uncommitted `README.md`, `CHANGELOG.md`, and untracked `openspec/changes/agentic-factory-roadmap/`; branch `main` tracks `origin/main`; `gh` not installed / no PR for this change. Did **not** run `npx agent-orchestrator-kit archive agentic-factory-roadmap --sync`.

## Decisions
- R1 (Minor): delta-spec THEN clause still omits README.md/CHANGELOG.md; clarify on archive/sync or in Phase 1.
- R2 (Minor): IDE-parity scenario mixes live `.mcp.json` with committed `.agents/mcp.json.example`; Phase 1 details it.
- R3 (Info): cosmetic task/design nits left untouched.
- A1: README Roadmap is seven lines before Changelog; CHANGELOG has one `### Added` bullet under `[Unreleased]`.
- A2: session-start `memory-setup` side-effects were reverted before apply task 1.3.
- A3: `pipeline.archive_after_merge: true` blocks archive until commit + PR merge + CI green; resume with the same `/opsx:archive` command after that.
- A4: conductor confirmed merge gate still open; archive CLI intentionally skipped.
- A5 (this session): merge gate re-confirmed on `main...origin/main` with same dirty tree; no archive CLI.

## Blocked
Change not committed; no PR; CI not green. Cannot archive until merge gate is satisfied (`pipeline.archive_after_merge: true`).

## Next command
`/opsx:archive agentic-factory-roadmap`

## Next role
none

## Attach
- `openspec/changes/agentic-factory-roadmap/tasks.md`
- `README.md`
- `CHANGELOG.md`
- `openspec/changes/agentic-factory-roadmap/specs/agentic-factory-roadmap/spec.md`

## Subagents to spawn
none

## Constraints
- Archive is CLI-only: `npx agent-orchestrator-kit archive agentic-factory-roadmap --sync` (delta spec must merge into `openspec/specs/`). Do not spawn `spec-archiver` unless that CLI fails.
- Do not archive until this change is committed, the PR is merged, and CI is green (`pipeline.archive_after_merge: true`).
- Pass `--sync` (do not use `--no-sync`).
- Do not edit `bin/`, `templates/`, `profiles/`, `scripts/`, or `test/` in the archive session except via the archive CLI moving the change folder.
- Reviewer findings R1–R3 remain for archive/sync or Phase 1; do not rewrite apply docs unless archive/sync requires it.
- Before archive CLI: commit apply artifacts, open PR, merge with green CI, then re-run `/opsx:archive agentic-factory-roadmap` in a new chat.

## Prompt

```text
/opsx:archive agentic-factory-roadmap

You are the conductor for the next role session of change `agentic-factory-roadmap`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive agentic-factory-roadmap`
- Next role / phase subagent: `none`
- Amp: spawn isolated skill `subagent-none` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/none.md` / `.claude/agents/none.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive agentic-factory-roadmap` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff agentic-factory-roadmap --restore`
4. Read Memory MCP: `Change:agentic-factory-roadmap`, `Handoff:agentic-factory-roadmap`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/agentic-factory-roadmap/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Archiver
- Change: - name: agentic-factory-roadmap
- status: archive-blocked
- Done:
Conductor ran `/opsx:archive agentic-factory-roadmap`. `npx agent-orchestrator-kit status`: 7/7 tasks, APPROVE, ready to archive. `handoff --restore` succeeded from `handoff.md` (Memory JSON entities present; Memory MCP tools unavailable in this Cursor session). Phase specialist is `none` (archive is CLI-only; `.cursor/agents/none.md` absent by design — no `spec-archiver`). Merge-gate re-check failed unchanged: working tree has uncommitted `README.md`, `CHANGELOG.md`, and untracked `openspec/changes/agentic-factory-roadmap/`; branch `main` tracks `origin/main`; `gh` not installed / no PR for this change. Did **not** run `npx agent-orchestrator-kit archive agentic-factory-roadmap --sync`.
- Decisions:
- R1 (Minor): delta-spec THEN clause still omits README.md/CHANGELOG.md; clarify on archive/sync or in Phase 1.
- R2 (Minor): IDE-parity scenario mixes live `.mcp.json` with committed `.agents/mcp.json.example`; Phase 1 details it.
- R3 (Info): cosmetic task/design nits left untouched.
- A1: README Roadmap is seven lines before Changelog; CHANGELOG has one `### Added` bullet under `[Unreleased]`.
- A2: session-start `memory-setup` side-effects were reverted before apply task 1.3.
- A3: `pipeline.archive_after_merge: true` blocks archive until commit + PR merge + CI green; resume with the same `/opsx:archive` command after that.
- A4: conductor confirmed merge gate still open; archive CLI intentionally skipped.
- A5 (this session): merge gate re-confirmed on `main...origin/main` with same dirty tree; no archive CLI.
- Blocked:
Change not committed; no PR; CI not green. Cannot archive until merge gate is satisfied (`pipeline.archive_after_merge: true`).
- Attach:
- `openspec/changes/agentic-factory-roadmap/tasks.md`
- `README.md`
- `CHANGELOG.md`
- `openspec/changes/agentic-factory-roadmap/specs/agentic-factory-roadmap/spec.md`
- Subagents for this session:
none
- Constraints:
- Archive is CLI-only: `npx agent-orchestrator-kit archive agentic-factory-roadmap --sync` (delta spec must merge into `openspec/specs/`). Do not spawn `spec-archiver` unless that CLI fails.
- Do not archive until this change is committed, the PR is merged, and CI is green (`pipeline.archive_after_merge: true`).
- Pass `--sync` (do not use `--no-sync`).
- Do not edit `bin/`, `templates/`, `profiles/`, `scripts/`, or `test/` in the archive session except via the archive CLI moving the change folder.
- Reviewer findings R1–R3 remain for archive/sync or Phase 1; do not rewrite apply docs unless archive/sync requires it.
- Before archive CLI: commit apply artifacts, open PR, merge with green CI, then re-run `/opsx:archive agentic-factory-roadmap` in a new chat.
- status: spec-approved
- tasks: 7/7
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/agentic-factory-roadmap/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff agentic-factory-roadmap` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:agentic-factory-roadmap`, `Handoff:agentic-factory-roadmap`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
