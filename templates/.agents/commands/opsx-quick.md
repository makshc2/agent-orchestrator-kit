---
name: /opsx-quick
id: opsx-quick
category: Workflow
description: Fast path for MVP/demo — propose artifacts and apply in one session (skips review gate)
---

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

**Steps**

1. **Check orchestrator config**

   Read `.agents/orchestrator.yaml`:
   - If `pipeline.require_spec_review: true` → warn user and ask to confirm skip OR use full pipeline (`/opsx:propose` → `/opsx:review` → `/opsx:apply`)
   - If `false` or `profile: mvp` → proceed

2. **Create change (minimal artifacts)**

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
   - Implement 1–3 tasks per pass
   - Mark `[x]`
   - Run build/lint from `orchestrator.yaml` verifier commands

5. **Exit**

   - If demo done and no merge planned → optionally skip archive
   - If merging → run `/opsx:archive` after CI green

---

**Guardrails**
- Max ~3 hours of work — if bigger, switch to full pipeline
- Still run build/lint before declaring done
- Do not skip OpenSpec entirely — at minimum proposal + tasks
- For vue3: use vue-core, vue-pinia skills during implementation
