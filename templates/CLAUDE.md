# {{PROJECT_NAME}} — Claude Code Context

> agent-orchestrator-kit v{{KIT_VERSION}} | OpenSpec pipeline

See `AGENTS.md` and `.agents/rules/` for routing, HARD STOP, and CLI (`npx` only). Config: `.agents/orchestrator.yaml`.

```
/opsx:explore · /opsx:design · /opsx:propose · /opsx:review · /opsx:apply · /opsx:archive
```

Conductor session: restore with `npx agent-orchestrator-kit handoff --restore`, spawn the phase specialist, do not do specialist work here. Spawn `session-handoff` restore only if CLI restore failed.

Exit: persist → `handoff.md` → `npx agent-orchestrator-kit handoff <name>` (exit 0) → paste the CLI prompt. Do not start the next phase in this chat.

One active change. No `src/` in explore/design/review. After apply: build/lint. Skills: `.claude/skills/` (synced from `.agents/skills/`).
