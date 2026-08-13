---
name: /opsx-review
id: opsx-review
category: Workflow
description: Read-only spec review of an OpenSpec change — approve or request changes before apply
---

## Session Start (Before Any Work)

Honor the pasted command and announce the Spec Reviewer role. Run `npx agent-orchestrator-kit status` or `npx openspec list --json`, then `npx agent-orchestrator-kit handoff --restore` (or `handoff <name> --restore`). Read Memory `Change:<name>`, `Handoff:<name>`, and `Decision:*` when MCP works. If restore CLI fails and Memory is empty, read `openspec/changes/<name>/handoff.md`; this fallback is not a blocker. Spawn `session-handoff` in restore mode when context is incomplete (Amp: isolated `subagent-session-handoff`). For free-form “continue” / “next” with one active change, execute its `Handoff.next_command` instead of asking for the phase. Only then spawn the routed phase specialist (Amp: isolated `subagent-<name>`, never the main thread). Follow `.agents/rules/session-handoff.mdc`.

Review an OpenSpec change. Read artifacts, validate structure, output Approve or Request Changes.

**IMPORTANT: This is a read-only mode. You must NEVER edit any file in `src/` or any source code. You may not mark tasks `[x]`. Your only output is a structured review verdict.**

**Input**: Optionally specify a change name (e.g., `/opsx:review add-auth`). If omitted, auto-select if one active change exists, otherwise list and ask.

**Conductor delegation is mandatory:** after selecting the change, spawn `spec-reviewer` with the complete change paths and project constraints. The parent MUST NOT review artifacts or write `review.md`; it only verifies the structured report and that `review.md` contains the reported verdict. Never substitute `code-reviewer`.

---

## Steps

### 1. Select the change

If name provided — use it. Otherwise:
- Run `npx openspec list --json` to list active changes.
- Auto-select if only one exists.
- Ask the user with AskUserQuestion if ambiguous.

Announce: "Reviewing change: **<name>**"

### 2. Spawn the specialist

Spawn `spec-reviewer` and delegate steps 3–6 below. Require `## Subagent report: spec-reviewer`. Do not perform the review in the parent session.

### 3. Validate structure

```bash
npx openspec validate <name> --strict --type change
```

If ✗ — list each error and immediately output **Request Changes** with the validation errors. Stop here.

### 4. Read all artifacts

```bash
npx openspec status --change "<name>" --json
```

Read every file from `artifactPaths`:
- `proposal.md`
- `design.md`
- `tasks.md`
- all `specs/<domain>/spec.md` files

Also read related `openspec/specs/` domain files to check consistency.

### 5. Review checklist

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

### 6. Write and report the verdict

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

The conductor verifies the subagent's `Status: done`, checks that `review.md` exists with the reported verdict, and relays the result without editing it.

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

## Session Exit (HARD STOP)

You have NOT finished until every step succeeds. Do not say done/готово, do not start apply, and do not omit the fenced next-thread prompt.

1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn fails, persist in the parent — never skip.
2. Write `openspec/changes/<name>/handoff.md` with: Closed role, Change, Done, Decisions, Blocked, Next command, Next role, Attach, Subagents to spawn, Constraints.
3. Run `npx agent-orchestrator-kit handoff <name>` and require exit 0. The CLI upserts Memory JSON (absolute path) and prints the expanded self-contained prompt on stdout.
4. If Memory MCP tools work, also update `Change:<name>`, `Handoff:<name>`, and new `Decision:*`.
5. Paste CLI stdout into chat as one fenced block beginning with the next `/opsx:*` command (`/opsx:apply <name>` only after APPROVE). Keep it complete. No banner.
6. Stop. Do not start the next phase in this chat.

## Guardrails

- **Never** edit source code, `src/`, or `tasks.md` checkboxes
- **May write only** `openspec/changes/<name>/review.md` (verdict record for apply gate)
- **Never** run apply commands
- Ask for clarification only if a critical artifact is missing or unreadable
- If proposal is ambiguous on scope, flag as ✗ — do not assume intent
