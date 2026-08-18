# Agent Orchestration — {{PROJECT_NAME}}

> Powered by [agent-orchestrator-kit](https://github.com/makshc2/agent-orchestrator-kit) v{{KIT_VERSION}}

Spec-driven OpenSpec pipeline. Each phase is a **separate chat**. Delegation is differentiated (lean model): explore/design/propose/review spawn a mandatory specialist; **apply is parent-driven** — the parent implements from `tasks.md` + `apply-notes.md`, subagents are optional (≥ 2 independent tasks or explicit request; `design-implementer` for design-brief/Figma); **archive is a CLI** (`npx agent-orchestrator-kit archive <name> [--sync]`), no subagent.

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

Session Start / Exit are **parent-driven** — canonical protocol in `.agents/rules/session-handoff.mdc`. Start: `status` → `handoff --restore` → `handoff.md` fallback. Exit HARD STOP: parent writes `handoff.md` → `npx agent-orchestrator-kit handoff <name>` (exit 0) → paste the CLI `/opsx:*` prompt. `session-handoff` subagent = fallback only. Do not start the next phase here.

Quality gates: `gate-check --tasks <name>` lints the task contract (Files/Do/Done-when, `pipeline.task_contract: warn|strict|off`); `gate-check --review <name>` is deterministic Tier 1 of review — spec-reviewer (Tier 2) is spawned only after it passes and writes `apply-notes.md` on APPROVE.

## Hard rules
- One active change (unless mvp profile).
- No apply without explicit Approve when `require_spec_review: true`.
- No `src/` in explore, design, or review.
- Archive after merge. Build/lint before PR.
- Memory MCP: `node scripts/memory-mcp-launcher.cjs` (never relative `MEMORY_FILE_PATH`).

Pin only the files for the current role (`tasks.md`, the change folder, relevant `src/` subtree) — not entire `openspec/specs/`.
