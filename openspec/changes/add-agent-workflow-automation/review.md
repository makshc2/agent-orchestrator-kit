# Spec Review

**Change:** add-agent-workflow-automation
**Date:** 2026-11-16
**Verdict:** APPROVE

## Checklist summary
- Proposal: ✓
- Design: ✓
- Tasks: ✓
- Delta specs: ✓

## Notes
- Risks still says "one follow-up" and Non-Goals still says "task ticks". Section 3, the retry delta, and task 2.3 are the rule: one follow-up per work epoch, two per intent; the parent performs checkbox edits, and the hook does not tick tasks.
- Dispatch applies `{action, reason}` objects. The frozen doc line quoted in design abbreviates that as `allow|deny|followup|null`. Task 1.2's deny stub has to use the object; the dispatcher stays unchanged.
- Task 3.1's done-when samples proposal/design/specs/review. The Do also denies `design-brief.md`, `decisions.md`, and direct binds for `test-writer`, `code-writer`, `design-implementer`, and `testing`.

## Previous findings
- F20: resolved — design section 4, the delta requirement "Conductor progress writes are narrowly authorized", proposal acceptance 3, and task 3.1 grant the allowance to a direct `via: 'explicit'` bind with role `implementer` (also `conductor` and `implementation`); both apply twins and `docs/agent-hooks.md` still teach `--role implementer`, and `bindSession` stores that bind as `via: 'explicit'` while `linkChild` stores `via: 'token'`.
- F19: resolved — "Completion checks are explicit and bounded" still defers to one follow-up per work epoch and two per intent; "Completion retries cannot reset through automation" and task 2.3 still refuse a third follow-up and do not reset the budget from commands, fingerprints, progress writes, or unknown origin.
- F21: resolved — task 3.1 done-when still runs `node --test test/restore-recovery-briefing.test.js test/hooks-recovery.test.js`, and both files exist.
