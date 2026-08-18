# Agent Orchestration — {{PROJECT_NAME}}

> Powered by [agent-orchestrator-kit](https://github.com/makshc2/agent-orchestrator-kit) v{{KIT_VERSION}}

Spec-driven OpenSpec pipeline. Each phase is a **separate chat**. The parent `/opsx:*` session is a **conductor**: restore, spawn the specialist, verify the report — never do specialist work in-thread.

```
explore → [design] → propose → review → apply → verify → archive
```

`[design]` is optional (`/opsx:design`). Non-UI: `Design: none` in `proposal.md` when `require_design_brief: true`. MVP: `/opsx:quick` when `require_spec_review: false`.

Routing table, HARD STOP, and CLI forms: `.agents/rules/` (`agent-orchestration`, `session-handoff`, `cli-via-npm`). Config: `.agents/orchestrator.yaml`.

## Commands
| Role | Command |
|------|---------|
| Explorer | `/opsx:explore` |
| Design Intake | `/opsx:design <name>` |
| Architect | `/opsx:propose <name>` |
| Spec Reviewer | `/opsx:review <name>` |
| Implementer | `/opsx:apply <name>` |
| Quick (MVP) | `/opsx:quick <name>` |
| Archive | `/opsx:archive` |

Start: `npx agent-orchestrator-kit status` then `handoff --restore`. Spawn `session-handoff` restore only if that CLI failed. Then spawn the routed specialist (Amp: isolated `subagent-<name>`).

Exit HARD STOP: persist `session-handoff` → `handoff.md` → `npx agent-orchestrator-kit handoff <name>` (exit 0) → paste the CLI `/opsx:*` prompt. Do not start the next phase here.

## Hard rules
- One active change (unless mvp profile).
- No apply without explicit Approve when `require_spec_review: true`.
- No `src/` in explore, design, or review.
- Archive after merge. Build/lint before PR.
- Memory MCP: `node scripts/memory-mcp-launcher.cjs` (never relative `MEMORY_FILE_PATH`).

Pin only the files for the current role (`tasks.md`, the change folder, relevant `src/` subtree) — not entire `openspec/specs/`.
