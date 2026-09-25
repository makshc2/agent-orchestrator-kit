---
name: /opsx-quick
id: opsx-quick
category: Workflow
description: Fast path for MVP/demo — propose artifacts and apply in one session (skips review gate)
---

## Session Start

Follow the canonical Session Start protocol in `.agents/rules/session-handoff.mdc`, then announce the Quick conductor role.

Quick mode for **small changes, demos, and hypothesis testing**. Combines propose + apply in one session.

**Use when:**
- Spike / proof-of-concept / demo UI
- 1–3 files, clear scope
- `pipeline.require_spec_review: false` in `.agents/orchestrator.yaml` (mvp profile)

**Do NOT use when:**
- Multi-file refactor, API contract changes, production features
- Team requires spec review (`require_spec_review: true`)

---

**Input**: Change name (kebab-case) or description. Example: `/opsx:quick add-export-button`

**Conductor delegation is mandatory inside this one session:** spawn `spec-architect` for minimal artifacts, then `design-implementer` or `code-writer` per implementation task, `test-writer` for tests, and `code-reviewer` before merge. The parent MUST NOT write specialist artifacts/code/tests itself. Specialists never edit `tasks.md`; the conductor verifies each `Status: done` report and marks checkboxes. Do not emit a next-session prompt between propose and apply.

**Steps**

1. **Check orchestrator config**

   Read `.agents/orchestrator.yaml`:
   - If `pipeline.require_spec_review: true` → warn user and ask to confirm skip OR use full pipeline (`/opsx:propose` → `/opsx:review` → `/opsx:apply`)
   - If `false` or `profile: mvp` → proceed

2. **Create change (minimal artifacts)**

   Spawn `spec-architect` with the quick-mode scope and require its structured report. Do not create the artifacts in the parent session.

   ```bash
   npx openspec new change "<name>"
   ```

   Create **lightweight** artifacts (no delta specs unless user asks):
   - `proposal.md` — problem, scope, non-goals (5–10 lines)
   - `tasks.md` — 3–7 atomic tasks with checkboxes
   - `design.md` — optional, skip if trivial

   Skip `specs/` delta for MVP unless behavior must be documented.

3. **Validate**

   ```bash
   npx openspec validate <name> --strict --type change
   ```

4. **Apply immediately**

   Follow `/opsx:apply` steps for the same change:
   - Read tasks.md
   - Spawn `design-implementer` for design-led work, otherwise `code-writer`, one task per prompt
   - Spawn `test-writer` for required tests
   - Verify each structured report and reported file, then let only the conductor mark `[x]`
   - Run build/lint from `orchestrator.yaml` verifier commands

   Continue directly from propose to apply in this session. Do not print or ask the user to paste a mid-session handoff prompt.

5. **Exit**

   - If demo done and no merge planned → optionally skip archive
   - If merging → run `/opsx:archive` after CI green

---

## Session Exit (HARD STOP)

Close via the canonical Session Exit protocol in `.agents/rules/session-handoff.mdc` at the end of the whole quick session only — no mid-session prompt between propose and apply. Include task and build/lint status in Done. Paste exactly one fenced prompt (verify/archive). Do not start archive in this chat.

**Guardrails**
- Max ~3 hours of work — if bigger, switch to full pipeline
- Still run build/lint before declaring done
- Do not skip OpenSpec entirely — at minimum proposal + tasks
- For vue3: use vue-core, vue-pinia skills during implementation
- Never emit or request paste of a next-session prompt between quick propose and apply; emit exactly one only at final exit
