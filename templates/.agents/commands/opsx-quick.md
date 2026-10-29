---
name: /opsx-quick
id: opsx-quick
category: Workflow
description: Fast path for small changes — propose, light review (when required) and apply in one session
---

## Session Start

Follow the canonical Session Start protocol in `.agents/rules/session-handoff.mdc`, then announce the Quick conductor role.

Quick mode for **small changes, demos, and hypothesis testing** where a full review cycle is not worth it. One session runs propose → light review (only when `require_spec_review: true`) → apply.

**Use when:**
- Spike / proof-of-concept / demo UI / small fix
- 1–3 files, clear scope, one behaviour

**Do NOT use when:**
- Multi-file refactor, API contract changes, large production features — use `/opsx:propose` → `/opsx:review` → `/opsx:apply`

---

**Input**: Change name (kebab-case) or description. Example: `/opsx:quick add-export-button`

**Conductor delegation:** spawn `spec-architect` for the artifacts and, when review is required, `spec-reviewer` for the light review. The parent MUST NOT write proposal/design/specs/tasks or `review.md` itself. Apply is parent-driven exactly as in `/opsx:apply`. Do not emit a next-session prompt anywhere inside the session.

**Steps**

1. **Read the review policy**

   Read `pipeline.require_spec_review` in `.agents/orchestrator.yaml` (missing file or key = `true`).
   - `false` (mvp) → no review step; skip step 4.
   - `true` → step 4 is mandatory: the CI gate and `archive` Gate 1 accept the change only with a `review.md` whose verdict is APPROVE. Never skip it, never write `review.md` yourself.

2. **Create minimal artifacts**

   Spawn `spec-architect` with the quick-mode scope (say `/opsx:quick` in the prompt) and require its structured report:
   - `proposal.md` — `## Why`, `## What Changes`, `## Non-goals`, `## Acceptance criteria` (short)
   - `tasks.md` — 1–7 tasks in the Files/Do/Done-when contract
   - `specs/<capability>/spec.md` — a minimal delta: one `## ADDED Requirements` (or `## MODIFIED Requirements` for an existing requirement, heading copied byte-exact) with one requirement and one `#### Scenario:`. `openspec validate --strict` rejects a change without a delta.
   - `design.md` — optional, skip if trivial

3. **Validate**

   ```bash
   npx openspec validate <name> --strict --type change
   ```

   Exit ≠ 0 → re-spawn `spec-architect` once with the errors; still failing → step 6 with `## Blocked`.

4. **Light review** (only when `require_spec_review: true`)

   - Tier 1: run `npx agent-orchestrator-kit gate-check --review <name>`. Exit ≠ 0 → re-spawn `spec-architect` once with every error and re-run; still failing → step 6 with `## Blocked`.
   - Tier 2: spawn `spec-reviewer` in quick mode (say `/opsx:quick` in the prompt and pass whether `review.md` already exists). It writes a real `review.md` and, on APPROVE, `apply-notes.md`.
   - Run `npx agent-orchestrator-kit gate-check --review-md <name>` (exit 0 required).
   - REQUEST CHANGES → re-spawn `spec-architect` once with the Required Before Apply list, then `spec-reviewer` once more. Still REQUEST CHANGES → step 6 with `## Blocked` and next command `/opsx:propose <name>` (the change moves to the full pipeline).

5. **Apply**

   Follow `/opsx:apply` for the same change: parent-driven from `tasks.md` (+ `apply-notes.md` when written), conductor marks `[x]`, `design-implementer` for design-brief tasks, build/lint from `orchestrator.yaml` verifier commands.

6. **Exit**

   See Session Exit below.

---

## Session Exit (HARD STOP)

Close via the canonical Session Exit protocol in `.agents/rules/session-handoff.mdc` once, at the end of the whole quick session. Write `## Closed role` as `Implementer — quick` (the canonical token keeps metrics and the green-apply line correct). Include review verdict (or `not required`), task and build/lint status in Done.

**Green quick** (every task `[x]`, build/lint green): `## Blocked` `none`, `## Next command` the literal line `npx agent-orchestrator-kit archive <name> --sync`, `## Next role` `none`. `handoff <name>` then prints only that line — paste it as the one fenced block; it runs in a terminal after the PR is merged (for a throw-away demo it may be skipped). Otherwise record the blocker and use `/opsx:propose <name>` (artifacts or review failed) or `/opsx:apply <name>` (tasks remain). Do not start archive in this chat.

**Guardrails**
- Max ~3 hours of work — if bigger, switch to the full pipeline
- Still run build/lint before declaring done
- Do not skip OpenSpec — proposal, tasks and a minimal delta are always written
- Never emit or request paste of a next-session prompt between propose, review and apply; emit exactly one only at final exit
