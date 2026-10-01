---
name: /opsx-archive
id: opsx-archive
category: Workflow
description: Fallback — archive a completed change via the agent-orchestrator-kit CLI when a terminal or CI could not
---

Normal path: run `npx agent-orchestrator-kit archive <name> --sync` in a terminal after the PR is merged (or let the opted-in CI job do it). Use this command only when that was impossible or the CLI refused. Protocol: `.agents/rules/session-handoff.mdc` — `archive` writes its own final `handoff.md`, so there is no Session Exit here.

1. Resolve the name: the argument after `/opsx:archive`, else `npx openspec list --json` + AskUserQuestion. Never guess.
2. If delta specs exist, ask: merge (`--sync`) or skip (`--no-sync --force`).
3. Run `npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]` and show stdout as-is.
4. On exit ≠ 0, print the refusal from stderr and STOP — no manual merge/move.

No phase subagents. No next-thread prompt after a successful archive.
