---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change. Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.4.1"
---

Implement tasks from an OpenSpec change.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Parent-driven apply:** the parent reads `tasks.md` + `apply-notes.md` (open `design.md`/`proposal.md` only when a task explicitly references them or a contract field is incomplete) and writes code and tests itself, task by task, checking its own `tasks.md` checkboxes. Subagents are optional: spawn `code-writer`/`test-writer` for ≥ 2 independent tasks with no shared files (parallelization) or on explicit user request. `design-implementer` remains mandatory for tasks with a design-brief/Figma signal.

**Escape valve (STOP — improvisation is forbidden):** if a task requires information beyond its Files/Do/Done-when + `apply-notes.md` + artifacts it explicitly references, STOP: record the gap in `handoff.md`, set the next command to `/opsx:propose <name>` (plan amendment), and end the session. Do not guess.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `npx openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx:apply <other>`).

2. **Check status to understand the schema**
   ```bash
   npx openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - `planningHome`, `changeRoot`, and `actionContext`: planning scope and edit constraints
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Get apply instructions**

   ```bash
   npx openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - `contextFiles`: artifact ID -> array of concrete file paths (varies by schema - could be proposal/specs/design/tasks or spec/tests/implementation/docs)
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using openspec-continue-change
   - If `state: "all_done"`: congratulate, suggest archive
   - Otherwise: proceed to implementation

   **Workspace guard:** If status JSON reports `actionContext.mode: "workspace-planning"` and `allowedEditRoots` is empty, explain that full workspace apply is not supported in this slice. Treat linked repos and folders as read-only context, ask the user to select an affected area through an explicit implementation workflow, and STOP before editing files.

4. **Read the working set**

   Read `tasks.md` and `apply-notes.md` — they are the primary input for apply. Open `design.md`, `proposal.md`, or delta specs only when a task explicitly references them or a contract field is incomplete. For non-spec-driven schemas, follow `contextFiles` from the CLI output.

5. **Show current progress**

   Display:
   - Schema being used
   - Progress: "N/M tasks complete"
   - Remaining tasks overview
   - Dynamic instruction from CLI

6. **Implement tasks (loop until done or blocked)**

   For each pending task:
   - Show which task is being worked on
   - Implement it in the parent session from its Files/Do/Done-when contract (spawn `code-writer`/`test-writer` only for ≥ 2 independent tasks with no shared files, or on explicit user request; `design-implementer` for design-brief/Figma tasks)
   - Verify the task's Done-when condition actually holds
   - Mark the task complete in the tasks file: `- [ ]` → `- [x]`
   - Continue to next task

   **STOP (escape valve) if:**
   - The task requires information beyond its contract + `apply-notes.md` + referenced artifacts → record the gap in `handoff.md`, next command `/opsx:propose <name>` — never improvise
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

7. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! Ready to archive this change.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**
- Keep going through tasks until done or blocked
- Always read `tasks.md` + `apply-notes.md` before starting
- If a task contract is insufficient, STOP via the escape valve — don't guess or improvise
- Keep code changes minimal and scoped to each task's `Files:` list
- Never let a spawned specialist update `tasks.md`; the parent checks a box only after verifying Done-when
- Pause on errors and blockers

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
