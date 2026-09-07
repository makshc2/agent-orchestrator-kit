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

The script runs `openspec validate --strict --type change`, the task-contract lint (Files/Do/Done-when), the `Non-goals` / `Acceptance criteria` proposal sections check, and non-empty ADDED/MODIFIED/REMOVED delta-spec sections check. Add `--json` for a `{pass, errors[]}` report.

**If Tier 1 fails (exit ≠ 0):** do NOT spawn `spec-reviewer` and do NOT read the artifacts. Write `openspec/changes/<name>/review.md` with `Verdict: REQUEST CHANGES` listing the gate-check errors. The T1 file MUST include this exact line:

**Source:** gate-check

The T1 `review.md` has no `## Checklist` section. This parent-written T1 `review.md` is an **accepted exception** to pipeline-subagents «parent MUST NOT write the verdict». Output the Request Changes verdict in chat. After an accepted RC one line MUST contain `Verdict: REQUEST CHANGES` and `/opsx:propose`. Go straight to Session Exit.

### 3. Tier 2 — spawn the specialist

Only after Tier 1 passes: spawn `spec-reviewer` with the complete change paths, project constraints, and the shortened checklist below. The parent MUST paste the full Tier 2 checklist from this file into the `spec-reviewer` prompt, including the Vue 3 items when `project.stack: vue3`. Before spawn, the parent MUST record whether `openspec/changes/<name>/review.md` already existed, and pass that fact plus the path in the spawn prompt. Require `## Subagent report: spec-reviewer`. Do not perform the review in the parent session.

### 4. Review checklist (Tier 2 — LLM-only)

Do NOT re-check what Tier 1 already covered (strict validation, contract field presence, proposal sections, delta-spec section structure). Evaluate each item. Mark ✓ or ✗:

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

MUST NOT stop at the first blocking finding. Finish the full LLM checklist and a complete scan of proposal.md, design.md, tasks.md, all delta specs, and referenced main specs/repo paths before writing the verdict. One ✗ still means REQUEST CHANGES, but list every blocking issue of that pass.

Re-review MUST scan the same defect class — LLM-only only (another task whose `Do:` is not executable without design.md; another design behaviour with no delta requirement; another proposal↔tasks drift; another referenced heading/path that does not exist). Tier 1 classes NEVER enter this rescan. MUST NOT emit a one-item RC that names only the first leftover.

### 5. Write and report the verdict

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

On **APPROVE**, `spec-reviewer` also writes `openspec/changes/<name>/apply-notes.md` (≤ 20 lines): critical constraints, pitfalls, what NOT to touch, verification commands. It is the distilled input for `/opsx:apply` and the **second allowed file** next to `review.md`.

For **REQUEST CHANGES**, write only `review.md` with `Verdict: REQUEST CHANGES` and the required sections: Checklist (each T2 item ✓/✗), Findings (Blocker / Major / Minor; empty buckets allowed), Required Before Apply (blocking only), Previous findings. Cosmetics stay out of Required Before Apply.

The `Previous findings` heading is ALWAYS present after any Tier 2 pass. If no prior `review.md` existed, the body is the literal line `none — first review cycle`. If a prior file existed, each prior Required Before Apply item → `resolved` | `unresolved` plus one-line evidence.

`review.md` (always) and `apply-notes.md` (on APPROVE) are the **only files** you may write during review (not `src/`, not `tasks.md` checkboxes).

The conductor verifies the subagent's `Status: done`, checks that `review.md` exists with the reported verdict (and `apply-notes.md` on APPROVE), and relays the result without editing them.

After Tier 2, the conductor MUST reject an RC `review.md` that lacks those headings or has an empty Checklist and MUST NOT rewrite the file; then re-spawn `spec-reviewer` once with the rejection reason and required headings; if the second file is still non-conforming, close with `## Blocked` naming the missing headings and next command `/opsx:review <name>` (a rejected file is not an accepted verdict). NEXT-AFTER-RC applies only to an accepted (schema-conforming) RC.

#### If any ✗:

```
## Spec Review: REQUEST CHANGES ✗

**Change:** <name>

### Checklist
- proposal ↔ design ↔ tasks: ✓ or ✗
- Delta specs cover design: ✓ or ✗
- No conflicts with main specs: ✓ or ✗
- No scope creep vs Non-goals: ✓ or ✗
- Task self-sufficiency: ✓ or ✗
- Vue 3 items (when `project.stack: vue3`): ✓ or ✗ each

### Findings

#### Blocker
- <or empty>

#### Major
- <or empty>

#### Minor
- <or empty>

### Required Before Apply
- <blocking only>

### Previous findings
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
