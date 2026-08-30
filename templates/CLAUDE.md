# {{PROJECT_NAME}} — Claude Code Context

> agent-orchestrator-kit v{{KIT_VERSION}} | OpenSpec pipeline

See `AGENTS.md` and `.agents/rules/` for routing, HARD STOP, and CLI (`npx` only). Config: `.agents/orchestrator.yaml`.

```
/opsx:explore · /opsx:design · /opsx:propose · /opsx:review · /opsx:apply · /opsx:archive
```

Lean delegation: explore/design/propose/review spawn a mandatory specialist; apply is parent-driven from `tasks.md` + `apply-notes.md` (subagents optional for independent tasks); archive runs `npx agent-orchestrator-kit archive <name> [--sync]` — no subagent. Review is two-tiered: `gate-check --review` (deterministic) before `spec-reviewer`; `gate-check --tasks` lints the Files/Do/Done-when task contract.

Session Start/Exit are parent-driven (canonical: `.agents/rules/session-handoff.mdc`): restore with `npx agent-orchestrator-kit handoff --restore`; exit — write `handoff.md` including `## Metrics` (`unknown` when missing), run `npx agent-orchestrator-kit handoff <name>` (exit 0; optional `--collect`), paste the CLI prompt. `session-handoff` subagent is a fallback only. Do not start the next phase in this chat.

One active change. No `src/` in explore/design/review. After apply: build/lint. Skills: `.claude/skills/` (synced from `.agents/skills/`).
