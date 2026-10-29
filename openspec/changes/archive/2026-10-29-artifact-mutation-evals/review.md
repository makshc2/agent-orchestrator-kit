# Spec review — artifact-mutation-evals

**Change:** artifact-mutation-evals
**Date:** 2026-10-29
**Review cycle:** 3 (re-review after re-propose of cycle 2)
**Verdict:** APPROVE

## Checklist

- ✓ Proposal ↔ design ↔ tasks consistency: counts (11 synthetic + 3 real = 14 mutations; 12 structural subtests in 3.1; 2 known-gap in 3.2; 10 classifier subtests in 2.2), fixture and change names, S/R IDs, timeout 60000 ms, buffer 1 MiB, S06 empty `## ADDED Requirements`, report columns and the no-score-when-incomplete rule agree across proposal, design D1–D6, tasks and decisions.md. The +578 bytes of cycle 3 (pathspec checks, `<KIT_ROOT>`, CommonJS launcher, tmpdir check, 3.1 Do additions) introduce no new contradiction.
- ✓ Delta specs cover design: the five requirements still cover the design's observable behaviour. The two behaviours newly made explicit in 3.1 `Do:` (pristine copy on repeated runs; mutator with zero or two targets throws invalid setup) are already required by the delta (scenarios "Мутації не накопичуються" and "Mutator більше не знаходить ціль"; D4 "ціль знайдено рівно один раз"). No design behaviour without a requirement.
- ✓ No conflicts with main specs: `task-contract` read in full (Files/`new file:` semantics, the Done-when no-new-lint rule is preserved: S10/S11 are measured gaps, no detector is added); headings of all other main specs listed; `tiered-review`, `orchestrator-cli-controls` (gate-check), `lean-archive`, `kit-ci-verify` stay compatible; production gate, verdict schema and JSON output are untouched. No main spec for `artifact-mutation-evals` exists, so the ADDED capability does not collide.
- ✓ No scope creep vs Non-goals: no new lint, LLM call, detector, export, npm script or workflow; `spec-verify-conformance-report` stays separate; env scrubbing, launcher and classifier subtests are test hygiene inside the declared files.
- ✓ Task self-sufficiency: all eight `Do:` are executable from Files/Do/Done-when without design.md (design is cited only as context); every Done-when is satisfiable on a correct implementation in this repository (see Findings and Previous findings).
- ✓ Vue 3 items: not applicable (no UI work).

## Findings

### Blocker

None.

### Major

None.

### Minor

- `tasks.md:18` (2.1 Done-when): `ls "$(node -p "os.tmpdir()")" | grep -c '^aok-mutation-eval-'` prints `0` but exits 1 on zero matches; fine as a "prints 0" check, but it would fail inside an `&&` chain or `set -e`. It also fails on leftovers of a crashed or concurrent run (a true positive for the cleanup contract, not a defect). The `Do:` demands `mkdtemp` roots and `finally` cleanup "for each baseline and case" but does not say that subtest (a) (launcher accept/reject), which also needs a root, must clean up too; the implementer will infer it from the Done-when.
- `tasks.md:35` (3.2 Done-when) uses `git diff --stat bin package.json` while 2.1/2.2/4.1 use the pathspec `git status` check. Both are correct here (tracked files); the inconsistency is cosmetic.
- `tasks.md:5` and `:6` (1.1): the delta `grep -c` checks omit the file path (`specs/sample-capability/spec.md` under `openspec/changes/synthetic-change/`); obviously that file.
- `tasks.md` language: all of tasks.md (and proposal, design, delta, archived changes) is Ukrainian. `project.agent_language` is not readable here (the kit root has no `.agents/orchestrator.yaml`, `openspec/config.yaml` has no language rule) and no main spec or config rule requires English change artifacts; the `agent_language` requirement in `session-handoff` covers the next-session prompt only. All archived kit changes (for example `2026-10-02-tier1-delta-heading-check`) are Ukrainian. Not a violation; non-blocking.
- `decisions.md`: doubled date on one line is written by the handoff CLI; leave it.

## Required Before Apply

None.

## Previous findings

Cycle-2 Required Before Apply:

1. **M1 / tasks 2.1, 2.2, 4.1 (unsatisfiable `git status --porcelain` scope checks): resolved.** `tasks.md:18`, `:23`, `:46` now use `git status --porcelain -- bin package.json package-lock.json templates profiles .github`; all six paths exist, and on the current tree (dirty with `?? docs/course-derived-plan-2026-10-29.md` and the untracked change dir) it prints nothing, rc 0. Task 4.1 no longer relies on `git diff`: its second command `git status --porcelain --untracked-files=all -- . ':(exclude)openspec/changes/artifact-mutation-evals' ':(exclude)docs' ':(exclude).idea' ':(exclude)test/artifact-mutation-evals.test.js' ':(exclude)test/fixtures/mutations'` also prints nothing on the current tree. Both would pass on a correct implementation: in a scratch clone with the untracked docs file and change dir, `npm test` (312 pass) left the tree unchanged; what apply legitimately touches is excluded or ignored (change dir for tasks.md ticks, handoff.md, decisions.md, metrics.json; `.cursor/memory.json`, `.agents/spend/`, `.claude/`, `node_modules/`, `.idea/` are gitignored; `package-lock.json` is not modified by `npm test`). A new stray file outside the allowed paths would be listed (`--untracked-files=all`), so the check is also meaningful.

Cycle-2 Minor items:

- m1 `new file:` prefix on existing files: resolved by an explicit design choice. The prefix stays in `Files:` of 2.2/3.1/3.2/3.3/4.1 (the lint's path-exists check would otherwise warn or fail before apply), and each `Do:` now states the file already exists from an earlier task ("Файл з 2.1: доповнювати", "Тест (2.1) і README (1.2) існують: доповнювати"). Unambiguous.
- m2 `<KIT_ROOT>`: resolved; defined in 1.1 and 1.2 Done-when ("Нехай KIT_ROOT — корінь репозиторію").
- m3 launcher.js module format: resolved; `tasks.md:17` states CommonJS via `require` (temp root has no package.json; the test itself is ESM).
- m4 "shows" wording: resolved in 3.1; in 3.2 the only residue is the parenthetical "(missed показує звіт 3.3)", which is explanatory, not a check.
- m5 `npx openspec validate`: resolved; `tasks.md:46` uses `npx openspec validate artifact-mutation-evals --strict --type change`, which prints "Change 'artifact-mutation-evals' is valid", exit 0.

Cycle-1 items (all resolved, unchanged since cycle 2): 1.1 fixture preconditions and S10 premise; 1.2 real fixture provenance (commit, paths, removed `lean-archive` block); 3.1 S01–S09/R01–R03 mapping with inline mutations, matchers and oracles; 2.1 offline launcher contract; 2.2/3.2 truth table and matcher identity; 3.3 report columns and incomplete rule. The cycle-3 edits did not touch them.

Same-class rescan across all eight tasks (LLM-only): no Done-when that cannot pass in this repo state (all runnable commands executed: three `git status` checks, tmpdir check, `openspec validate`, `gate-check --tasks` exit 0, `gate-check --review` exit 0); no referenced path or heading that does not exist (`bin.openspec` is `./bin/openspec.js`, `VAGUE_DO_PATTERNS` first pattern is `as needed`, `bin/agent-orchestrator.js` runs `npx openspec validate <name> --strict --type change` through `execSync`, which the PATH shim intercepts); no `Do:` that needs design.md; no design behaviour without a delta requirement; no proposal↔tasks drift.

## Coverage and validation

Read in full: all change artifacts, `openspec/specs/task-contract/spec.md`, `openspec/config.yaml`, headings of all other main specs (and the `session-handoff` language requirement), the spec-reviewer and opsx-review templates. Executed read-only: pathspec checks, tmpdir check, `npx openspec validate`, `gate-check --tasks` and `--review`; `npm test` and the status checks ran in a scratch clone under `/tmp` (removed). Nothing in the repository changed besides this file and `apply-notes.md`. Tier 1 classes were not re-reviewed.
