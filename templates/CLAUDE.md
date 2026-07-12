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

## Key Rules for This Session

- Check `.agents/orchestrator.yaml` for project-specific pipeline config.
- One active change at a time — run `openspec list` to confirm.
- No code edits in explore, design, or review mode.
- Design Intake writes only `design-brief.md` and `assets/` — never `src/`.
- After completing apply: run build/lint before declaring done.
- Use `openspec validate --all --strict` to verify change artifacts.

## File Locations

| What | Where |
|------|-------|
| Active changes | `openspec/changes/` |
| Design brief | `openspec/changes/<name>/design-brief.md` + `assets/` |
| Specs (source of truth) | `openspec/specs/` |
| Project config | `openspec/config.yaml` |
| Orchestration config | `.agents/orchestrator.yaml` |
| Skills | `.claude/skills/` |
