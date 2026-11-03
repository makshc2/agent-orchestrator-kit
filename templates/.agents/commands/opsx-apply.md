---
name: /opsx-apply
id: opsx-apply
category: Workflow
description: Implement tasks from an OpenSpec change (Experimental)
---

## Session Start

Follow the canonical Session Start protocol in `.agents/rules/session-handoff.mdc`, then announce the Implementer role.

Implement tasks from an OpenSpec change.

**Input**: Optionally specify a change name (e.g., `/opsx:apply add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Parent-driven apply:** the parent reads `tasks.md` + `apply-notes.md` (open `design.md`/`proposal.md` only when a task explicitly references them or a contract field is incomplete) and writes code and tests itself, task by task, checking its own `tasks.md` checkboxes. Subagents are optional: spawn `code-writer`/`test-writer` for ≥ 2 independent tasks with no shared files (parallelization) or on explicit user request. `design-implementer` remains mandatory for tasks with a design-brief/Figma signal.

**Escape valve (STOP — improvisation is forbidden):** if a task requires information beyond its Files/Do/Done-when + `apply-notes.md` + artifacts it explicitly references, STOP: record the gap in `handoff.md`, set the next command to `/opsx:propose <name>` (plan amendment), and end the session. Do not guess.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `npx openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx:apply <other>`).

1.5. **Check review gate**

   Read `.agents/orchestrator.yaml` → `pipeline.require_spec_review`. If `true` (default for generic/vue3/node), require one of: `review.md` with `Verdict: APPROVE`, a pasted **APPROVE ✓** verdict from `/opsx:review <name>`, or Memory `Change:<name>` with `status: spec-approved`. If none found → **STOP** and tell the user to run `/opsx:review <name>` in a separate read-only session first. If `false` (mvp profile) or quick/demo mode is confirmed → proceed.

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
   - `contextFiles`: artifact ID -> array of concrete file paths (varies by schema)
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using `/opsx:continue`
   - If `state: "all_done"`: congratulate and give the archive command line (see Session Exit)
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
   - Implement it in the parent session from its Files/Do/Done-when contract (subagent rules: see "Parent-driven apply" above)
   - Verify the task's Done-when condition actually holds
   - Mark the task complete in the tasks file: `- [ ]` → `- [x]` (the last pending task only after step 6.5)
   - After each ticked box, each important decision and each `code-reviewer` verdict, save progress with `npx agent-orchestrator-kit checkpoint <name> --task <id> --done "<what finished>" --next "<next step>"`; add `--blocked "<blocker>"` or `--decision "<topic>: <text>"` when they apply (a decision is kept in `checkpoint.json` only: also list it under `## Decisions` at Session Exit). A failed checkpoint is reported and never blocks the session.
   - Continue to next task

   **STOP if:** the escape valve triggers (see above), an error or blocker is encountered (report and wait), or the user interrupts.

6.5. **Run the tests once (before the last box)**

   When one task is left pending and its Done-when holds, do not tick it yet. Read `.agents/orchestrator.yaml` → `verifier.test_command` and run it once from the project root; show only the last 20 lines of its output and keep the exit code of the command itself (not of `tail`). A green run of the same command earlier in this session with no edit since counts, so do not run it twice.
   - **Empty or missing command** (or no `orchestrator.yaml`): skip, warn "verifier.test_command is empty — tests not run", write `tests: skipped (no test_command)` in `## Done`, then tick the last box (its Done-when holds); `## Blocked` is not changed for it. Never guess a command such as `npm test`.
   - **Resource limits** (a project rule or a busy machine): narrow the run — the specs of the changed files, or `--maxWorkers=1` — and write `tests: <passed>/<total> (narrowed: <what>)`; a green narrowed run ticks the last box. If nothing can run, write `tests: not run (<reason>)` in `## Done`, repeat the reason in `## Blocked`, leave the last box unticked and stop. Never skip a run without a record.
   - **Red run** (exit ≠ 0): STOP and leave the last box unticked, with `tests: red (see Blocked)` in `## Done`. Fix it in this session when the cause is inside the tasks' `Files:` and run again; otherwise end through the escape valve (the failing command and its last lines in `## Blocked`, next command `/opsx:propose <name>`). A failure that already existed before this change (the same test fails on the unchanged code) needs an explicit user decision: name the test in `## Blocked` and wait. When the user accepts it, tick the last box, write `tests: 216/217 (accepted by user: <test name>)` in `## Done` and leave `## Blocked` empty for it; when the user does not accept it, the box stays unticked.
   - **Green run** (exit 0): tick the last box and write `tests: <passed>/<total>` in `## Done` (`tests: green (exit 0)` when the output has no counts).
   - **Session ends earlier** (more than one task still pending): write `tests: not run (paused: <k> tasks pending)` in `## Done`; this is not a blocker.

7. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: show the archive command line `npx agent-orchestrator-kit archive <name> --sync` (terminal, after merge)
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
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

All tasks complete! After the PR is merged, archive from a terminal: `npx agent-orchestrator-kit archive <name> --sync`.
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

## Session Exit (HARD STOP)

Close via the canonical Session Exit protocol in `.agents/rules/session-handoff.mdc`. Include task, build/lint and test status in Done (the `tests:` line from step 6.5). Never start archive in this apply chat.

**Green apply** (every task `[x]`, build/lint green): write `## Blocked` as `none`, `## Next command` as the literal line `npx agent-orchestrator-kit archive <name> --sync` and `## Next role` as `none`. `handoff <name>` then prints only that line instead of a prompt — paste it as the one fenced block; it is run in a terminal after the PR is merged, so no new chat is needed. Otherwise keep `/opsx:apply <name>` (tasks remain) or `/opsx:propose <name>` (escape valve — record the gap in `## Blocked`).

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
