---
name: /opsx-archive
id: opsx-archive
category: Workflow
description: Archive a completed change via the agent-orchestrator-kit CLI
---

Session Start / Session Exit: follow the protocol in `.agents/rules/session-handoff.mdc`. Announce the Archiver role.

Archive is fully deterministic — one CLI call, no phase subagents.

**Steps**

1. **Resolve the change name.** Use the name after `/opsx:archive`. If omitted or ambiguous, run `npx openspec list --json` and use the **AskUserQuestion tool** to let the user pick an active change. Never guess.

2. **Decide on delta-spec sync.** If the change has delta specs, ask the user: merge them into main specs (`--sync`, recommended) or archive without merging (`--no-sync --force`).

3. **Run the CLI:**

   ```bash
   npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]
   ```

   The CLI checks gates (review APPROVE, all tasks `[x]`, no existing target), merges delta specs on `--sync`, moves the change to `openspec/changes/archive/YYYY-MM-DD-<name>`, runs `npx openspec validate --all --strict` with full rollback on failure, and writes the final `handoff.md` (`next_command: none`) plus memory upsert.

4. **Show the CLI stdout as-is.** On exit ≠ 0, report the failed gate from stderr and stop — do not merge or move anything manually.

The pipeline ends here: no next-thread prompt is required after a successful archive.
