---
name: /opsx-review
id: opsx-review
category: Workflow
description: Read-only spec review of an OpenSpec change — approve or request changes before apply
---

Review an OpenSpec change. Read artifacts, validate structure, output Approve or Request Changes.

**IMPORTANT: This is a read-only mode. You must NEVER edit any file in `src/` or any source code. You may not mark tasks `[x]`. Your only output is a structured review verdict.**

**Input**: Optionally specify a change name (e.g., `/opsx:review add-auth`). If omitted, auto-select if one active change exists, otherwise list and ask.

---

## Steps

### 1. Select the change

If name provided — use it. Otherwise:
- Run `openspec list --json` to list active changes.
- Auto-select if only one exists.
- Ask the user with AskUserQuestion if ambiguous.

Announce: "Reviewing change: **<name>**"

### 2. Validate structure

```bash
openspec validate <name> --strict --type change
```

If ✗ — list each error and immediately output **Request Changes** with the validation errors. Stop here.

### 3. Read all artifacts

```bash
openspec status --change "<name>" --json
```

Read every file from `artifactPaths`:
- `proposal.md`
- `design.md`
- `tasks.md`
- all `specs/<domain>/spec.md` files

Also read related `openspec/specs/` domain files to check consistency.

### 4. Review checklist

Evaluate each item. Mark ✓ or ✗:

**Proposal**
- [ ] Problem statement is clear and specific (not vague)
- [ ] Non-goals are listed
- [ ] Acceptance criteria are present and testable (not "should work" — must be verifiable)
- [ ] Scope matches a ~1–3 day change

**Design**
- [ ] Approach is concrete (not "we will handle this")
- [ ] Trade-offs or alternatives mentioned
- [ ] Does not contradict existing `openspec/specs/` domain specs
- [ ] No scope creep vs proposal Non-goals

**Tasks**
- [ ] Each task is ≤ ~2 hours of work
- [ ] Each task has a clear done condition
- [ ] Tasks are in logical implementation order
- [ ] No task requires information not in design/spec
- [ ] No task says "update X as needed" (must be specific)

**Delta Specs**
- [ ] Cover all changed/added behavior
- [ ] ADDED/MODIFIED/REMOVED sections used correctly
- [ ] No conflicts with main `openspec/specs/`

**Vue 3** (when `project.stack: vue3` in `.agents/orchestrator.yaml`)
- [ ] Components use `<script setup>` + Composition API (no Options API)
- [ ] State via Pinia setup stores (`defineStore` + composable style)
- [ ] HTTP via Axios service/composable patterns (not raw fetch scattered)
- [ ] Tasks reference concrete component/store paths under `src/`
- [ ] No scope creep into unrelated UI refactors

### 5. Output verdict

#### If all ✓ (or only minor notes):

```
## Spec Review: APPROVE ✓

**Change:** <name>
**Reviewed:** proposal.md, design.md, tasks.md, specs/*

### Summary
<2–3 sentences on what this change does and why it is well-scoped>

### Notes (optional)
- <minor note if any, not blocking>

**Ready for implementation.** Run `/opsx:apply <name>` to proceed.
```

Also **write review record** (gates apply when `require_spec_review: true`):

Create or update `openspec/changes/<name>/review.md`:

```markdown
# Spec Review

**Change:** <name>
**Date:** <ISO date>
**Verdict:** APPROVE

## Checklist summary
- Proposal: ✓
- Design: ✓
- Tasks: ✓
- Delta specs: ✓

## Notes
<optional notes>
```

For **REQUEST CHANGES**, write the same file with `Verdict: REQUEST CHANGES` and issues list.

This is the **only file** you may write during review (not `src/`, not `tasks.md` checkboxes).

#### If any ✗:

```
## Spec Review: REQUEST CHANGES ✗

**Change:** <name>

### Issues Found

#### Proposal
- ✗ <issue description> — suggestion: <how to fix>

#### Tasks
- ✗ Task 3 is too vague: "Update the component" — specify which component and what exact change

### Required Before Apply
<list only what must be fixed, not cosmetic>

Fix the above, then re-run `/opsx:review <name>`.
```

---

## Guardrails

- **Never** edit source code, `src/`, or `tasks.md` checkboxes
- **May write only** `openspec/changes/<name>/review.md` (verdict record for apply gate)
- **Never** run apply commands
- Ask for clarification only if a critical artifact is missing or unreadable
- If proposal is ambiguous on scope, flag as ✗ — do not assume intent
