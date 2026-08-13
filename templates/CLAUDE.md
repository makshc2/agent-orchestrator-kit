# {{PROJECT_NAME}} — Claude Code Context

> agent-orchestrator-kit v{{KIT_VERSION}} | Spec-driven pipeline with OpenSpec

## Project

See `AGENTS.md` for the full orchestration pipeline, roles, and hard rules.
See `openspec/config.yaml` for stack context and agent language.

## Skills

Project skills live in `.claude/skills/` (synced from `.agents/skills/`).
Use `/skill-name` or let Claude auto-load based on context.

| Skill | Command | When |
|-------|---------|------|
| Agent Orchestration | `/agent-orchestration` | Role selection, pipeline, handoff decisions |
| OpenSpec Howto | `/openspec-howto` | CLI, cycle, naming |
| OpenSpec Propose | `/openspec-propose` | Creating change artifacts |
| OpenSpec Apply | `/openspec-apply-change` | Implementing tasks |
| OpenSpec Archive | `/openspec-archive-change` | Archiving after merge |

## Pipeline Commands

```
/opsx:explore   — think through ideas (read-only, no code)
/opsx:design    — capture design into design-brief.md + assets/ (optional)
/opsx:propose   — create change artifacts
/opsx:review    — spec review (read-only, no code)
/opsx:apply     — implement tasks
/opsx:archive   — archive after merge
```

The parent command session is a conductor. It MUST spawn the phase specialist and MUST NOT perform specialist work itself:

| Signal | Subagent |
|--------|----------|
| Status / next command | `openspec-guide` |
| Kit / MCP / sync failure | `setup-doctor` |
| Explore research | `codebase-explorer` |
| Design intake | `design-intake` |
| Propose | `spec-architect` |
| Spec review | `spec-reviewer` |
| Apply UI / ordinary task / tests / pre-PR review | `design-implementer` / `code-writer` / `test-writer` / `code-reviewer` |
| Archive | `spec-archiver` |

## Key Rules for This Session

- Check `.agents/orchestrator.yaml` for project-specific pipeline config.
- One active change at a time — run `npx openspec list` / `npx agent-orchestrator-kit status` to confirm.
- No code edits in explore, design, or review mode.
- Design Intake writes only `design-brief.md` and `assets/` — never `src/`.
- After completing apply: run build/lint before declaring done.
- Only the conductor marks `tasks.md`, after a specialist reports `Status: done` and its files are verified.
- Use `npx openspec validate --all --strict` or `npx openspec validate <name> --strict --type change`.
- Never bare `openspec` / `agent-orchestrator-kit` without `npx` (Amp PATH → exit 127). See `.agents/rules/cli-via-npm.mdc`.

## Session Handoff

Before work, read Memory `Change:<name>`, `Handoff:<name>`, `Decision:*`; if unavailable or empty, read `openspec/changes/<name>/handoff.md`. At exit: Memory → `handoff.md` → one fenced `/opsx:*` prompt localized to `project.agent_language`, with no banner or duplicated summary. Do not begin the next phase in the same chat.

OpenSpec files are the requirements/tasks source of truth. Memory and `handoff.md` only index phase state, decisions, blockers, and the next command.

## File Locations

| What | Where |
|------|-------|
| Active changes | `openspec/changes/` |
| Design brief | `openspec/changes/<name>/design-brief.md` + `assets/` |
| Session handoff index | `openspec/changes/<name>/handoff.md` |
| Specs (source of truth) | `openspec/specs/` |
| Project config | `openspec/config.yaml` |
| Orchestration config | `.agents/orchestrator.yaml` |
| Skills | `.claude/skills/` |
