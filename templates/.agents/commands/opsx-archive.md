---
name: /opsx-archive
id: opsx-archive
category: Workflow
description: Archive a completed change via the agent-orchestrator-kit CLI
---

Session Start / Exit: `.agents/rules/session-handoff.mdc`. Announce Archiver.

Archive is one CLI call, no phase subagents.

**Steps**

1. **Resolve the name.** After `/opsx:archive`, or `npx openspec list --json` + AskUserQuestion. Never guess.

2. **Sync decision.** If delta specs exist, ask: merge (`--sync`) or skip (`--no-sync --force`).

3. **Run the CLI:**

   ```bash
   npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]
   ```

   Gates, optional `--sync`, move to `archive/YYYY-MM-DD-<name>`, validate+rollback, final `handoff.md` (`next_command: none`) + memory. A successful `archive` always creates or updates `metrics.json` (`archivedAt`, Archiver session) and prints the change-wide metrics summary. Collect runs only with `--collect`; if `spend.costUsd` is `null` — stderr warning, not a gate.

4. **Show stdout as-is.** On exit ≠ 0, report the gate from stderr and stop — no manual merge/move.

No next-thread prompt after a successful archive.
