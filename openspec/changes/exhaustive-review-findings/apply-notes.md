# Apply notes — exhaustive-review-findings

- Source of truth is `templates/.agents/` (+ `templates/AGENTS.md`, `test/smoke.test.js`, `CHANGELOG.md`). Do NOT edit `bin/`, `src/`, `gate-check --review` / `runTier1Review`, main specs under `openspec/specs/`, or `.agents/` generated copies.
- Task 1.1: on the Tier 1 fail branch keep "do NOT spawn `spec-reviewer`" and "do NOT read the artifacts"; replace `(source: gate-check)` with the exact line `**Source:** gate-check` and state the T1 file has no `## Checklist`. Remove "Fix the above, then re-run `/opsx:review <name>`" — after an accepted RC the next command line must contain `Verdict: REQUEST CHANGES` and `/opsx:propose` on ONE line.
- Recovery wording must include the literal anchors `accepted exception`, `re-spawn \`spec-reviewer\` once`, `MUST NOT rewrite`, `paste the full Tier 2 checklist`, `MUST NOT stop at the first blocking`, `none — first review cycle`.
- Task 1.2: specialist-only sentences (no parent heading check, no Session Exit); keep read-only limits and apply-notes-on-APPROVE; literal "read the existing `review.md` before overwriting it".
- Task 2.1: conductor files get "path + verdict + Required Before Apply" (spawn + verify, parent does not edit); spec-architect.md gets "fix every Required Before Apply" + LLM-only rescan; all three name `**Source:** gate-check` + no `## Checklist` as the structure-only trigger. Keep existing "The parent MUST NOT create or edit proposal/design/specs/tasks".
- Task 2.2: replace ONLY openspec-guide.md line 18 with two branches; line 19 stays the single APPROVE→apply rule reworded to `Verdict: APPROVE`; `rg "says APPROVE"` must be empty afterwards.
- Task 3.1: skill metric is `Spec review discovery loops: ≤ 2` (WITH colon); AGENTS.md form is without colon. Smoke regex (3.2) must match the colon form only.
- Task 3.2: add one new `test(...)` after line 628 test; no `gate-check` call, no `findings.length` assert; keep the existing vue3 test.
- Task 3.3: `## [Unreleased]` entry only; do not bump `package.json` version.
- Verify: `node --test test/smoke.test.js` (or `npm test`), `npx agent-orchestrator-kit gate-check --tasks exhaustive-review-findings`, `npx openspec validate exhaustive-review-findings --strict --type change`, plus each task's `rg` Done-when command.
