---
name: /opsx-propose
id: opsx-propose
category: Workflow
description: Propose a new change - create it and generate all artifacts in one step
---

## Session Start

Follow the canonical Session Start protocol in `.agents/rules/session-handoff.mdc`, then announce the Architect role.

Propose a new change - create the change and generate all artifacts in one step.

I'll create a change with artifacts:
- proposal.md (what & why)
- design.md (how)
- tasks.md (implementation steps)

When ready to implement, run /opsx:apply

---

**Input**: The argument after `/opsx:propose` is the change name (kebab-case), OR a description of what the user wants to build.

**Conductor delegation is mandatory:** spawn `spec-architect` with the resolved name, decision brief, design brief if present, and artifact instructions. The parent MUST NOT create or edit proposal/design/specs/tasks; after the structured report it may only verify files, run status, run strict validation, run the Tier 1 pre-gate `npx agent-orchestrator-kit gate-check --review <name>`, and re-spawn `spec-architect` once with the gate-check errors. Only for fast-fix, the allowlist additionally permits reading `pipeline.review_fast_fix`, checking the accepted review with `--review-md`, asking for explicit approval, and the ONE shell-call verdict write/validation/rollback below.

**Thin conductor (cost-lean protocol):** the parent MUST NOT research the repo — no grep/cat/sed over `bin/`, `src/`, specs, or other changes, before or after the spawn. It reads only the decision brief (by path), the kit `status`, and `handoff --restore`, plus `review.md` on a re-propose after Verdict REQUEST CHANGES (its path, verdict and Required Before Apply list go into the spawn prompt, per the re-propose rule below), and spawns `spec-architect` within at most 5 tool calls, passing the brief PATH (the user's description verbatim when no brief file exists) and the change name, never a digest of its own research. After the report the parent makes at most 3 tool calls (one shell call that runs `openspec status`, lists the reported artifact paths and runs `gate-check --review <name>`; then the session-exit persist) and, on a green gate, MUST NOT re-read the artifacts; a red gate adds only the one re-spawn and one more `gate-check --review`. Only in fast-fix, extend the call budget by exactly those protocol steps: the config-key read and eligibility `--review-md` check, explicit approval request, and ONE shell call for verdict write/validation/rollback; no repo research or artifact re-reads are added.

**Spec descriptions:** pass the 500-character requirement-description guidance in `.agents/rules/openspec-workflow.mdc` to `spec-architect`. The limit excludes headings and scenarios. Preserve existing MODIFIED behavior and scenarios; do not authorize an unrelated migration or truncation merely to make a gate green.

**Task contract (mandatory tasks.md format):** every task must carry indented `Files:`, `Do:`, `Done-when:` fields:

```markdown
- [ ] 2.1 Short title
  Files: src/router/index.js, new file: src/stores/auth.js
  Do: concrete change in 1–3 lines — no vague wording ("as needed", "if necessary", "as appropriate")
  Done-when: verifiable condition or command
```

Each task must be self-contained for a blind implementer — executable without reading design.md. `Files:` paths must exist unless prefixed with `new file:`. Lint: `npx agent-orchestrator-kit gate-check --tasks <name>` (mode via `pipeline.task_contract: warn|strict|off`).

**Done-when quality:** Done-when checks that the new state is present, not only that the old state is gone. A quantitative `Done-when:` check (`grep -c`, "exactly N lines") must be consistent with the code or text that `Do:` of the same task prescribes. Do not hardcode volatile repo values (current version number, dates, "top entry"); describe them as the current value plus a rule evaluated at apply time. Prefer behavioral conditions (a test run or observable behavior); `grep` only for non-numeric presence/absence. "exactly N" counts are forbidden unless the task states why the exact count is guaranteed. Bad: `Do:` wraps all three `journalRows.value` assignments in `applyOverlay`, while `Done-when:` requires an empty `grep -v applyOverlay` and exactly two `applyOverlay` points. Good: `Done-when:` runs `node --test test/<file>` that asserts all three assignments.

**Self-check:** after any edit of a task's `Do:`, re-read `Done-when:` of that task and of dependent tasks; verify every claim "X exists / is absent / is at line N" about code by reading the file and write its source `path:line` next to the claim; run every grep condition in `Done-when:` against current code and ensure the expected result is reachable.

**Size hint:** more than 8 tasks or 4 or more delta specs → propose splitting into two changes under `**Risks:**`; do not block.

**Fix changes:** when the change name starts with `fix-` or the brief describes a bug fix, the first implementation task adds a regression test that fails on the unfixed code, and its `Done-when:` names the test and states that it fails before the fix and passes after. When no automated test can reproduce the bug, `design.md` says why and the first task records the manual reproduction steps. This is guidance for the architect, not a lint.

On re-propose after `review.md` Verdict REQUEST CHANGES, the conductor MUST pass `review.md` (path + verdict + Required Before Apply list) in the `spec-architect` spawn prompt and verify the report addresses every item; the parent MUST NOT itself edit proposal/design/specs/tasks. Exception: the structure-only propose trigger is the exact line

**Source:** gate-check

plus the absence of `## Checklist`; then fix only those gate-check errors.

**Fast-fix lifecycle:** the conductor passes the fast-fix instruction only when (a) `.agents/orchestrator.yaml` has `pipeline.review_fast_fix: on` (the conductor may read that key), (b) `review.md` has Verdict REQUEST CHANGES, `gate-check --review-md <name>` exits 0, Checklist is present and it is NOT a Tier 1 record (`**Source:** gate-check` without `## Checklist`), and (c) Required Before Apply names 1-2 tasks. Pass the accepted review and these conditions in the spawn prompt; the architect decides whether design/delta changes make it ineligible.

After the report, require the conductor's `gate-check --review <name>` exit 0 and `**Fast-fix:** eligible`, then ask the user for explicit approval. On approval, in ONE shell call: copy `review.md` to a temporary file, set the single `Verdict:` line to `APPROVE (fast-fix, approved by user)`, append `## Fast-fix` with the date of the write, repaired task ids, `gate-check --review exit 0` and “Tier 2 skipped, no independent check”, then run `gate-check --review-md <name>`; on exit ≠ 0 restore the copy. Keep the backup until validation succeeds or restoration completes. This is an accepted exception to “parent MUST NOT write the verdict”.

Success: Output and Session Exit give next command `/opsx:apply <name>` in a fresh session and record `fast-fix` in handoff Decisions. Declined approval, `ineligible`, or a failed `--review-md` check: `review.md` stays REQUEST CHANGES unchanged (restore the copy on failure), and next command is `/opsx:review <name>` in a fresh session. A red `gate-check --review` after the one re-spawn keeps the existing `## Blocked` + `/opsx:propose <name>` path. When the key is off or missing nothing changes.

**Steps**

1. **If no input provided, ask what they want to build**

   Use the **AskUserQuestion tool** (open-ended, no preset options) to ask:
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Spawn the specialist**

   Spawn `spec-architect` with a self-contained prompt and require `## Subagent report: spec-architect`. The specialist runs the artifact build loop from its own file (`spec-architect.md`); the parent does not create artifacts.

3. **Verify the report, run the Tier 1 pre-gate, and show final status**

   The conductor verifies `Status: done`, the `**Gate:**` line (informational only: whatever it says, including `not run` or nothing, the conductor's own run below decides), and each reported artifact path, then runs:
   ```bash
   npx openspec status --change "<name>"
   npx agent-orchestrator-kit gate-check --review <name>
   ```
   Tier 1 pre-gate (first propose, re-propose, and structure-only re-propose alike): the conductor MUST run `gate-check --review` itself; the architect's `**Gate:**` line does not replace it, and Tier 1 already includes `openspec validate --strict`. If it exits ≠ 0, re-spawn `spec-architect` once with the full list of gate-check errors (targeted fix), then run it again. If it still exits ≠ 0, close the session with `## Blocked` listing the remaining gate-check errors and next command `/opsx:propose <name>`. Handoff to `/opsx:review` without `gate-check --review` exit 0 is forbidden. A printed `artifact budget` warning does not change the exit code: relay it verbatim in the final summary and recommend splitting the change into slices that each fit the budget.

**Output**

After completing all artifacts, summarize:
- Change name and location
- List of artifacts created with brief descriptions
- What's ready: "All artifacts created, validated, and Tier 1 pre-gate passed! Ready for spec review."
- Prompt: by default "Run `/opsx:review <name>` in a fresh session." only after `gate-check --review` exit 0; only after successful fast-fix use "Run `/opsx:apply <name>` in a fresh session." and state that explicit approval skipped independent Tier 2 review. If the pre-gate still fails after the one re-spawn, report `## Blocked` with the remaining gate-check errors and next command `/opsx:propose <name>` instead of this prompt and the What's ready line.

## Session Exit (HARD STOP)

Close via the canonical Session Exit protocol in `.agents/rules/session-handoff.mdc`. First line of the pasted prompt is by default `/opsx:review <name>` only after `gate-check --review` exit 0; only after successful fast-fix it is `/opsx:apply <name>` and handoff Decisions records `fast-fix`; if the pre-gate still fails after the one re-spawn, it is `/opsx:propose <name>` and `handoff.md` has `## Blocked`. Do not start review in this chat.

**Guardrails**
- Create ALL artifacts needed for implementation (as defined by schema's `apply.requires`)
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user - but prefer making reasonable decisions to keep momentum
- If a change with that name already exists, ask if user wants to continue it or create a new one
- Verify each artifact file exists after writing before proceeding to next
