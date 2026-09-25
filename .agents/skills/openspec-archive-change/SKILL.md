---
name: openspec-archive-change
description: Archive a completed change in the experimental workflow. Use when the user wants to finalize and archive a change after implementation is complete.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.4.1"
---

Archive a completed change. The phase is fully deterministic — one CLI call, no phase subagents.

**Input**: Optionally specify a change name. If omitted or ambiguous, run `npx openspec list --json` and use the **AskUserQuestion tool** to let the user pick an active change. Never guess or auto-select.

**Steps**

1. **Resolve the change name** (see Input above).

2. **Decide on delta-spec sync.** If the change has delta specs, ask the user: merge them into main specs (`--sync`, recommended) or archive without merging (`--no-sync --force`).

3. **Run the CLI:**

   ```bash
   npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]
   ```

   The CLI checks gates (review APPROVE when `require_spec_review: true`, all tasks `[x]`, no existing target archive), merges delta specs on `--sync` (ADDED append, MODIFIED replace, REMOVED delete), moves the change to `openspec/changes/archive/YYYY-MM-DD-<name>`, runs `npx openspec validate --all --strict` with full rollback on failure, and writes the final `handoff.md` (`next_command: none`) plus memory upsert.

4. **Show the CLI stdout as-is.** On exit ≠ 0, report the failed gate from stderr and stop.

**Guardrails**
- Do NOT merge main specs, move the change, or edit anything manually — the CLI owns the whole operation.
- Spawn `spec-archiver` ONLY as a fallback when the `agent-orchestrator-kit archive` CLI is unavailable or failed for environmental reasons (not for unmet gates).
- On a sync conflict reported by the CLI, use the `openspec-sync-specs` skill to resolve it, then re-run `archive`.
- The pipeline ends here: no next-thread prompt is required after a successful archive.
