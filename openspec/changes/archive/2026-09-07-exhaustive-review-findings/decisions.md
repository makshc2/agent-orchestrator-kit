# Decisions — exhaustive-review-findings

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-09-07 Двоциклова машина: опційний T1 structural RC, потім один вичерпний семантичний T2 RC; confirmation APPROVE не є discovery loop.
- 2026-09-07 Варіант C відхилено: падіння Tier 1 і далі без LLM-читання артефактів.
- 2026-09-07 Після будь-якого REQUEST CHANGES next command — `/opsx:propose`; після APPROVE — `/opsx:apply`.
- 2026-09-07 T1-only RC дозволяє structure-only propose; після T2 RC — увесь punch list + same-class rescan.
- 2026-09-07 Немає нового CLI і немає квоти «N findings»; повнота — prompt + схема `review.md` (Checklist / Findings / Required Before Apply / Previous findings).
- 2026-09-07 Метрика: Spec review discovery loops ≤ 2; анти-патерн one-finding review loop.
- 2026-09-07 Design: none (немає UI / Figma).
- 2026-09-07 Review cycle 1 verdict: REQUEST CHANGES; next command is `/opsx:propose exhaustive-review-findings` with the full punch list (M1–M3, m1, m2, m3/m4) — not a one-finding loop.
- 2026-09-07 `Previous findings` heading rule must be unified to one rule across proposal, design D4, tiered-review delta, tasks 1.1/1.2 (reviewer recommends: always present, "none — first review cycle" on first pass).
- 2026-09-07 Same-defect-class rescan examples must be LLM-only classes; Tier 1 classes are excluded from the Tier 2 rescan.
- 2026-09-07 Conductor recovery after a rejected `review.md` must be defined (re-spawn once, then blocked exit with next command); NEXT-AFTER-RC applies to accepted RC files only.
- 2026-09-07 Architect must run the same-class rescan across all artifacts after fixing the punch list, then re-run `/opsx:review`.
- 2026-09-07 Review cycle 1 punch list (M1–M3, m1, m2, m3/m4) fixed in one propose pass; cheap nits n1 and n3 applied; n2 and n4 left.
- 2026-09-07 `Previous findings` heading is always present after any Tier 2 pass; first-cycle body is the literal line `none — first review cycle`; if a prior file existed, each prior Required Before Apply item is `resolved` | `unresolved` plus one-line evidence.
- 2026-09-07 Same-class rescan examples are LLM-only (unenforceable `Do:`, design behaviour with no delta, proposal↔tasks drift, missing heading/path). Tier 1 classes NEVER enter the Tier 2 or propose-side rescan.
- 2026-09-07 Conductor recovery after a rejected `review.md`: re-spawn `spec-reviewer` once; second non-conforming file → `## Blocked` naming missing headings and next command `/opsx:review <name>`. NEXT-AFTER-RC applies only to an accepted schema-conforming RC.
- 2026-09-07 T1-only marker is the exact line `**Source:** gate-check` plus absence of `## Checklist`. Parent write of T1 `review.md` is the accepted exception to “parent MUST NOT write the verdict.”
- 2026-09-07 Task 2.1 subjects split: conductor files pass path + verdict + Required Before Apply in the spawn prompt and verify the report; `spec-architect.md` reads, fixes every item, and rescans. Parent does not edit artifacts.
- 2026-09-07 Task 2.2 replaces only `openspec-guide.md` line 18; line 19 stays the single APPROVE→apply branch, reworded to `Verdict: APPROVE`.
- 2026-09-07 Review cycle 2 verdict: APPROVE. All six cycle-1 Required Before Apply items (M1–M3, m1, m2, m3/m4) confirmed resolved with evidence in `review.md ## Previous findings`; no third discovery loop; metric "Spec review discovery loops ≤ 2" met (2 cycles).
- 2026-09-07 Next command is `/opsx:apply exhaustive-review-findings`; `apply-notes.md` is the distilled input for the implementer (anchors, what NOT to touch, verification commands).
- 2026-09-07 New nits n5 (task 2.1 "після існуючого абзацу task-contract" — spec-architect.md carries the contract in Workflow step 4; implementer places the block after step 4 or in Rules, Done-when is string-based) and n6 (decisions.md line 7 "any RC → propose" superseded by the later entry; append-only, later governs) are non-blocking and require no artifact change.
- 2026-09-07 Pipeline-subagents "parent MUST NOT write the verdict" requirement stays un-MODIFIED; the T1 `**Source:** gate-check` exception lives in ADDED requirements only (carried-over optional n3, accepted).
- 2026-09-07 Apply executed via isolated `code-writer` (no `implementer.md` in this repo); parent verified Done-when and is the only writer of `tasks.md` checkboxes (7/7).
- 2026-09-07 Templates-only implementation plus `test/smoke.test.js` (one new test after the vue3 test) and `CHANGELOG.md` `## [Unreleased]`; `package.json` version left at 0.14.0.
- 2026-09-07 Post-apply `code-reviewer` verdict: Compliant / Ready for MR; no required follow-up edits.
