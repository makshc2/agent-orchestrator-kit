---
name: /opsx-review
id: opsx-review
category: Workflow
description: Read-only spec review of an OpenSpec change — approve or request changes before apply
---

## Session Start

Follow the canonical Session Start protocol in `.agents/rules/session-handoff.mdc`, then announce the Spec Reviewer role.

Review an OpenSpec change. Read artifacts, validate structure, output Approve or Request Changes.

**IMPORTANT: This is a read-only mode. You must NEVER edit any file in `src/` or any source code. You may not mark tasks `[x]`. Your only output is a structured review verdict.**

**Input**: Optionally specify a change name (e.g., `/opsx:review add-auth`). If omitted, auto-select if one active change exists, otherwise list and ask.

**Review is two-tiered:** Tier 1 is a deterministic script (`gate-check --review`) run by the parent **before** any artifact is read by an LLM. Tier 2 is the `spec-reviewer` subagent with a shortened, LLM-only checklist. Spawning `spec-reviewer` is mandatory only when Tier 1 passes. The parent MUST NOT review artifacts or write `review.md` itself when Tier 2 runs. Never substitute `code-reviewer`.

---

## Steps

### 1. Select the change

If name provided — use it. Otherwise:
- Run `npx openspec list --json` to list active changes.
- Auto-select if only one exists.
- Ask the user with AskUserQuestion if ambiguous.

Announce: "Reviewing change: **<name>**"

### 2. Tier 1 — deterministic gate-check

```bash
npx agent-orchestrator-kit gate-check --review <name>
```

The script runs `openspec validate --strict --type change`, the task-contract lint (Files/Do/Done-when), the `Non-goals` / `Acceptance criteria` proposal sections check, the non-empty ADDED/MODIFIED/REMOVED/RENAMED delta-spec sections check, and the delta-heading check against main specs (every MODIFIED/REMOVED/RENAMED `### Requirement:` heading byte-matches `openspec/specs/<capability>/spec.md`; no ADDED heading already exists there — the same check `archive --sync` runs). Add `--json` for a `{pass, errors[]}` report.

**If Tier 1 fails (exit ≠ 0):** do NOT spawn `spec-reviewer` and do NOT read the artifacts. Write `openspec/changes/<name>/review.md` with `Verdict: REQUEST CHANGES` listing the gate-check errors. The T1 file MUST include this exact line:

**Source:** gate-check

The T1 `review.md` has no `## Checklist` section. This parent-written T1 `review.md` is an **accepted exception** to pipeline-subagents «parent MUST NOT write the verdict». Output the Request Changes verdict in chat. After an accepted RC one line MUST contain `Verdict: REQUEST CHANGES` and `/opsx:propose`. Go straight to Session Exit.

### 3. Tier 2 — spawn the specialist

Only after Tier 1 passes: spawn `spec-reviewer` with the complete change paths, project constraints, and the shortened checklist below. The parent MUST paste the full Tier 2 checklist from this file into the `spec-reviewer` prompt, including the Vue 3 items when `project.stack: vue3`. Before spawn, the parent MUST record whether `openspec/changes/<name>/review.md` already existed, and pass that fact plus the path in the spawn prompt. Require `## Subagent report: spec-reviewer`. Do not perform the review in the parent session.

### 4. Review checklist (Tier 2 — LLM-only)

Required Before Apply contains blockers only: a task that cannot be executed; a conflict with main specs or proposal Non-goals; a material contradiction between proposal, design, tasks and delta specs (including an executable task that prescribes the opposite of its delta requirement); or design behavior with no delta or task coverage. Major/Minor that the apply executor can fix within an unambiguous approved Files/Do/Done-when contract go to optional `## Fix During Apply` (non-empty when present, allowed on REQUEST CHANGES too) and do not require a new propose. When no blockers remain, the verdict is APPROVE; briefly repeat those items in `apply-notes.md` (≤ 20 lines, reviewer prioritises).

The reviewer MUST write a `## Task verdicts` block in `review.md`, one line per task `<id> | ✓/✗ | reason`, and list ALL blockers found in one pass. Authoring this block is mandatory; only script enforcement is optional: `gate-check --review-md` does not require the block, for backward compatibility.

Re-review order: first verify each Previous finding (resolved/unresolved with evidence), then run the FULL existing Tier 2 checklist, then additionally rescan the SAME defect classes of previous findings (LLM-only). No new checklist classes. The same-class restriction applies only to the extra rescan, never to the full checklist or Tier 1 classes; Tier 1 classes NEVER enter the extra rescan.



Do NOT re-check what Tier 1 already covered (strict validation, contract field presence, proposal sections, delta-spec section structure, byte-exact MODIFIED/REMOVED/RENAMED headings present in main specs and ADDED headings absent from them). Evaluate each item. Mark ✓ or ✗:

**Consistency**
- [ ] proposal ↔ design ↔ tasks tell the same story — no contradictions or drift
- [ ] Delta specs cover all changed/added behavior described in design

**Main specs**
- [ ] No conflicts with existing `openspec/specs/` requirements

**Scope**
- [ ] No scope creep vs proposal Non-goals

**Task self-sufficiency**
- [ ] A blind implementer can execute each task from Files/Do/Done-when alone, without reading design.md

**Vue 3** (when `project.stack: vue3` in `.agents/orchestrator.yaml`)
- [ ] Components use `<script setup>` + Composition API (no Options API)
- [ ] State via Pinia setup stores (`defineStore` + composable style)
- [ ] HTTP via Axios service/composable patterns (not raw fetch scattered)
- [ ] Tasks reference concrete component/store paths under `src/`
- [ ] No scope creep into unrelated UI refactors

MUST NOT stop at the first blocking finding. Finish the full LLM checklist and a complete scan of proposal.md, design.md, tasks.md, all delta specs, and referenced main specs/repo paths before writing the verdict. Any blocker means REQUEST CHANGES; list every blocking issue of that pass and write Task verdicts for every task.

Re-review MUST scan the same defect class — LLM-only only (another task whose `Do:` is not executable without design.md; another design behaviour with no delta requirement; another proposal↔tasks drift; another referenced heading/path that does not exist). Tier 1 classes NEVER enter this rescan. MUST NOT emit a one-item RC that names only the first leftover.

### 5. Write and report the verdict

Write the mandatory `## Task verdicts` block and apply the blocker-only Required Before Apply and optional non-empty `## Fix During Apply` rules above. With no blockers, APPROVE and distil Fix During Apply into `apply-notes.md` (≤ 20 lines).

#### If no blockers remain:

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

## Task verdicts
<id> | ✓ | <reason>

## Checklist summary
- Proposal: ✓
- Design: ✓
- Tasks: ✓
- Delta specs: ✓

## Notes
<optional notes>

## Previous findings
none — first review cycle
```

On **APPROVE**, `spec-reviewer` also writes `openspec/changes/<name>/apply-notes.md` (≤ 20 lines): critical constraints, pitfalls, what NOT to touch, verification commands. It is the distilled input for `/opsx:apply` and the **second allowed file** next to `review.md`.

For **REQUEST CHANGES**, write only `review.md` with `Verdict: REQUEST CHANGES` and the required sections: Checklist (each T2 item ✓/✗), Findings (Blocker / Major / Minor; empty buckets allowed), Required Before Apply (blocking only), Previous findings. Cosmetics stay out of Required Before Apply.

The `Previous findings` heading is ALWAYS present after any Tier 2 pass. If no prior `review.md` existed, the body is the literal line `none — first review cycle`. If a prior file existed, each prior Required Before Apply item → `resolved` | `unresolved` plus one-line evidence.

`review.md` (always) and `apply-notes.md` (on APPROVE) are the **only files** you may write during review (not `src/`, not `tasks.md` checkboxes).

The conductor verifies the subagent's `Status: done` and that the `Verdict:` line of `review.md` matches the reported verdict, then MUST run `npx agent-orchestrator-kit gate-check --review-md <name>` on the Tier 2 files (add `--json` for a `{pass, errors[]}` report): the script checks the single `Verdict:` line, the schema headings above and, on APPROVE, `apply-notes.md` (≤ 20 lines), so the conductor does not read the files to check headings. On exit ≠ 0 the conductor MUST treat the file as rejected and MUST NOT rewrite it; re-spawn `spec-reviewer` once with the script's error list and the required headings listed above; if the second file still fails the script, close with `## Blocked` naming the script errors and next command `/opsx:review <name>` (a rejected file is not an accepted verdict). The parent-written Tier 1 record is not checked. NEXT-AFTER-RC applies only to an accepted (schema-conforming) RC.

#### If any ✗:

```markdown
# Spec Review

**Change:** <name>
**Verdict:** REQUEST CHANGES

## Checklist
- proposal ↔ design ↔ tasks: ✗ — <material contradiction>
- Delta specs cover design: ✓
- No conflicts with main specs: ✓
- No scope creep vs Non-goals: ✓
- Task self-sufficiency: ✓
- Vue 3 items (when applicable): ✓ — <evidence or not applicable>

## Findings (Blocker / Major / Minor)

### Blocker
- <task id and material contradiction with evidence>

### Major
none

### Minor
- <item fixable within the approved task contract>

## Required Before Apply
- <task id and blocking repair>

## Task verdicts
<id> | ✗ | <blocker reason>

## Fix During Apply
- <non-blocking item and affected task id; omit this optional section when there are no items>

## Previous findings
none — first review cycle
```

---

## Session Exit (HARD STOP)

Close via the canonical Session Exit protocol in `.agents/rules/session-handoff.mdc`. After an accepted REQUEST CHANGES one line contains `Verdict: REQUEST CHANGES` and `/opsx:propose`; after APPROVE `/opsx:apply <name>`. NEXT-AFTER-RC applies only to an accepted (schema-conforming) RC. Do not start the next phase in this chat.

## Guardrails

- **Never** edit source code, `src/`, or `tasks.md` checkboxes
- **May write only** `openspec/changes/<name>/review.md` (verdict record for apply gate) and, on APPROVE, `openspec/changes/<name>/apply-notes.md`
- **Never** run apply commands
- Ask for clarification only if a critical artifact is missing or unreadable
- If proposal is ambiguous on scope, flag as ✗ — do not assume intent
