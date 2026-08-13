---
name: /opsx-archive
id: opsx-archive
category: Workflow
description: Archive a completed change in the experimental workflow
---

## Session Start (Before Any Work)

Honor the pasted command and announce the Archiver role. Run `npx agent-orchestrator-kit status` or `npx openspec list --json`, then read Memory `Change:<name>`, `Handoff:<name>`, and `Decision:*`. If Memory is unavailable or empty, read `openspec/changes/<name>/handoff.md`; this fallback is not a blocker. For free-form “continue” / “next” with one active change, execute its `Handoff.next_command` instead of asking for the phase. Only then continue and spawn specialists.

Archive a completed change in the experimental workflow.

**Input**: Optionally specify a change name after `/opsx:archive` (e.g., `/opsx:archive add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Conductor delegation is mandatory:** after resolving the change and confirming archive gates, spawn `spec-archiver` with a self-contained prompt. The parent MUST NOT merge main specs or move the change itself; it only verifies the structured report, archive path, and validation result.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `npx openspec list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.

   Show only active changes (not already archived).
   Include the schema used for each change if available.

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

2. **Check artifact completion status**

   Run `npx openspec status --change "<name>" --json` to check artifact completion.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - `planningHome`, `changeRoot`, `artifactPaths`, and `actionContext`: path and scope context
   - `artifacts`: List of artifacts with their status (`done` or other)

   If status reports `actionContext.mode: "workspace-planning"`, explain that workspace archive is not supported in this slice and STOP. Do not move workspace changes into repo-local archives or edit linked repos.

   **If any artifacts are not `done`:**
   - Display warning listing incomplete artifacts
   - Prompt user for confirmation to continue
   - Proceed if user confirms

3. **Check task completion status**

   Read the tasks file (typically `tasks.md`) to check for incomplete tasks.

   Count tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete).

   **If incomplete tasks found:**
   - Display warning showing count of incomplete tasks
   - Prompt user for confirmation to continue
   - Proceed if user confirms

   **If no tasks file exists:** Proceed without task-related warning.

4. **Assess delta spec sync state**

   Use `artifactPaths.specs.existingOutputPaths` from status JSON to identify delta specs. Pass these paths and the user's sync preference to `spec-archiver`; the parent MUST NOT compare or merge specs itself.

   **If delta specs exist:**
   - Ask whether main specs should be synced before archive
   - Include the delta and main spec paths in the `spec-archiver` prompt
   - Have `spec-archiver` return the combined sync summary in its report

   **Prompt options:**
   - If changes needed: "Sync now (recommended)", "Archive without syncing"
   - If already synced: "Archive now", "Sync anyway", "Cancel"

   The `spec-archiver` performs any requested comparison and sync as part of its isolated work; do not spawn a generic sync agent.

5. **Spawn the specialist and perform the archive**

   Spawn `spec-archiver`, require `## Subagent report: spec-archiver`, and delegate the sync/archive operations below. Do not run them in the parent session.

   Create an `archive` directory under `planningHome.changesDir` if it doesn't exist:
   ```bash
   mkdir -p "<planningHome.changesDir>/archive"
   ```

   Generate target name using current date: `YYYY-MM-DD-<change-name>`

   **Check if target already exists:**
   - If yes: Fail with error, suggest renaming existing archive or using different date
   - If no: Move `changeRoot` to the archive directory

   ```bash
   mv "<changeRoot>" "<planningHome.changesDir>/archive/YYYY-MM-DD-<name>"
   ```

6. **Verify the report and display summary**

   The conductor verifies `Status: done`, the reported archive path, and modified main specs before reporting completion.

   Show archive completion summary including:
   - Change name
   - Schema that was used
   - Archive location
   - Spec sync status (synced / sync skipped / no delta specs)
   - Note about any warnings (incomplete artifacts/tasks)

**Output On Success**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** the archive path derived from `planningHome.changesDir`/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs

All artifacts complete. All tasks complete.
```

**Output On Success (No Delta Specs)**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** the archive path derived from `planningHome.changesDir`/YYYY-MM-DD-<name>/
**Specs:** No delta specs

All artifacts complete. All tasks complete.
```

**Output On Success With Warnings**

```
## Archive Complete (with warnings)

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** the archive path derived from `planningHome.changesDir`/YYYY-MM-DD-<name>/
**Specs:** Sync skipped (user chose to skip)

**Warnings:**
- Archived with 2 incomplete artifacts
- Archived with 3 incomplete tasks
- Delta spec sync was skipped (user chose to skip)

Review the archive if this was not intentional.
```

**Output On Error (Archive Exists)**

```
## Archive Failed

**Change:** <change-name>
**Target:** the archive path derived from `planningHome.changesDir`/YYYY-MM-DD-<name>/

Target archive directory already exists.

**Options:**
1. Rename the existing archive
2. Delete the existing archive if it's a duplicate
3. Wait until a different date to archive
```

## Session Exit (Mandatory Order)

Before closing archive: (1) attempt to update Memory `Change:<name>`, `Handoff:<name>`, and new `Decision:*`; (2) write the final handoff state at the archived change path using the orchestration skill template even if Memory fails; (3) when another role is required, print one fenced `/opsx:*` prompt using `project.agent_language`, Memory keys, and the file fallback, without a banner label or duplicated summary. Do not start another phase in this chat.

**Guardrails**
- Always prompt for change selection if not provided
- Use artifact graph (openspec status --json) for completion checking
- Don't block archive on warnings - just inform and confirm
- Preserve .openspec.yaml when moving to archive (it moves with the directory)
- Show clear summary of what happened
- If sync is requested, use the Skill tool to invoke `openspec-sync-specs` (agent-driven)
- If delta specs exist, always run the sync assessment and show the combined summary before prompting
