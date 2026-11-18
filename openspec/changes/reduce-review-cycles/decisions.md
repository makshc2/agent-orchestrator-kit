# Decisions — reduce-review-cycles

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-11-18 2026-11-18 Без Tier 1-евристики для Done-when: суперечність Do/Done-when семантична, лишається текстовий чекліст самоперевірки; вимога «no new lint» у task-contract зберігається.
- 2026-11-18 2026-11-18 Major/Minor без блокерів дають APPROVE з необов'язковою секцією `## Fix During Apply` (+ короткий дубль у apply-notes ≤ 20 рядків); `checkReviewMd` відхиляє порожню секцію.
- 2026-11-18 2026-11-18 Пороги розміру зміни: більше 8 тасків або ≥ 4 delta-специ дають м'яке попередження в `**Risks:**`, без блокування.
- 2026-11-18 2026-11-18 Fast-fix `pipeline.review_fast_fix: off|on` (за замовчуванням off): conductor після явного схвалення користувача переписує Verdict-рядок на `APPROVE (fast-fix, approved by user)` і додає `## Fast-fix`; новий виняток з «parent MUST NOT write the verdict».
- 2026-11-18 2026-11-18 Спосіб: повноцінний OpenSpec change у корені кіта; реліз 0.24.0 (bump, тег, публікація) лишається за користувачем.
- 2026-11-18 Review routing: REQUEST CHANGES returns to Architect in a fresh /opsx:propose session; resolve the complete Required Before Apply list before another review.
- 2026-11-18 Artifacts remain in Ukrainian to match existing proposal, design, tasks and main specs; new template/instruction wording prescribed by tasks is English.
- 2026-11-18 Change size now exceeds the soft threshold (10 tasks, 2 delta specs); optional split: slice A (CLI, config, reviewer/apply/architect rules), slice B (fast-fix lifecycle).
- 2026-11-18 Preserve the independent APPROVE verdict while treating approval acceptance as blocked until the existing apply-notes.md prerequisite passes.
- 2026-11-18 Route the missing planning artifact to a fresh Architect session because this review session was explicitly restricted to review.md; this routing does not change ordinary reviewer ownership or the proposed fast-fix ownership contract.
