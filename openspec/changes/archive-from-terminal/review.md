# Spec Review

**Change:** archive-from-terminal
**Date:** 2026-10-01
**Verdict:** APPROVE

## Checklist summary
- Proposal: ✓ — scope, Non-goals and acceptance criteria match design and tasks; the evidence numbers re-derive exactly from the archived `metrics.json` files (9 changes, 61 sessions, 12 Archiver sessions, 11.52 min, 7 405 683 input tokens; the four `fix-metrics-session-attribution` Archiver rows 61.9 / 41.4 / 46.2 / 1.4 s).
- Design: ✓ — D1–D12 and Risks each map to a delta requirement or a verbatim task block; every cited function, flag, path, test name and heading exists as described (at HEAD Gate 2 passes a change without `tasks.md` and `archive_after_merge` is unread in `bin/`; after the verbatim blocks `status` and `archive --if-ready` call one `archiveReadinessBlockers`).
- Tasks: ✓ — 21 tasks, no `Do:` needs design.md; all 100 labelled blocks apply to a fresh HEAD copy with every anchor unique; the five prose-described test tasks are executable blind (see Notes).
- Delta specs: ✓ — MODIFIED bodies diffed against main specs and the pending R2a delta; sync dry-run after the four pending archives gives 0 conflicts and no duplicate headings.

Tier 2 items:
- Consistency (proposal ↔ design ↔ tasks): ✓ — no contradiction; counts, budgets and test groups agree across all three.
- Delta specs cover all changed or added behaviour in design: ✓ — D1 to D5, D6/D7, D9 and the README scenario each have a requirement or scenario; D8 wording edits are pinned by the `templates:` tests.
- No conflicts with main specs: ✓ — the lean-archive carve-out is a coherent, narrow Gate 0 exception; residual literal-wording overlaps are listed as Minor notes 4 and 5.
- No scope creep vs Non-goals: ✓ — no metrics code, `buildNextSessionPrompt`, `--restore`, version, init/update path or opsx-quick change.
- Task self-sufficiency: ✓ — 27 tests written from Files/Do/Done-when prose plus the verbatim TH1–TH3 helpers all pass against the verbatim implementation.

## Notes
Independent verification (scratch copies only; the repo was not modified):
- Baseline `node --test` on HEAD: 262/262. Applying all verbatim blocks (plus the `cp` of the root rule) and my own 27 tests: 289/289. Group counts match the Done-when and acceptance criteria exactly: config 4, status 2, gate0 3, if-ready 4, terminal 1, green-apply 7, templates 4, ci 2.
- Ran the Done-when commands of tasks 1.1 to 6.2: every printed number matches, including README `--if-ready` 6 and `Gate 0` 4, AGENTS.md `terminal` 4, and the claim that four tests of the gate-check config file fail without the five `archiveAfterMerge: true` edits. `gate-check --review`, `gate-check --tasks` (also with `task_contract: strict`) and `openspec validate --strict --type change` pass, also after the four pending changes are archived.
- Budgets hold: always-apply 11 734 to 11 912 of 12 000 (+178, 88 headroom); `templates/AGENTS.md` 2 904 to 3 180 of 4 000; `opsx-archive.md` 1 210 to 979 B; the `buildNextSessionPrompt` body is byte-identical to HEAD; the root `session-handoff.mdc` equals its template after the `cp`.
- Archive-order simulation: plan order gives 0 conflicts, 4 spec files synced, `openspec validate --all --strict` 18/18, and the new "Apply exit" scenario survives. Reversed order also exits 0 with validate green, but the old scenario silently returns (the design risk is real and has no mechanical guard).
- Real-openspec e2e of `archive --if-ready` (not the stub): an explore-only folder with just `handoff.md` yields `skip: not ready — tasks incomplete; no review.md`; a ready change archives. Static review of the CI templates: both YAML files parse; a fork or PR event never matches the job condition, and a skip or an unchanged tree ends at "nothing archived" without a push; no recursion (`[skip ci]`, and `github.token` pushes do not start runs).
- Mutation check of `isGreenApplyExit`: all five single-condition mutations are killed by the unit test of task 3.2 (6); the integration test (2) kills three of five (see Minor 1).

Non-blocking findings (Minor):
1. Task 3.2 test (2), sub-cases 4 and 5 (`tasks.md` without checkboxes, `tasks.md` removed) are vacuous as the prose orders them: the earlier sub-case persisted `## Blocked` = `waiting for CI on the PR`, and a persist without `--blocked` keeps the section from `handoff.md`, so the result is non-green regardless of `progress`. Dropping `progress.total > 0` or the null-progress check survives that integration test; only the pure-function test (6) catches it. Passing `blocked: 'none'` in those two sub-cases removes the weakness.
2. Skip output is title banner plus one line: `log.title` prints a blank line and `agent-orchestrator archive <name>` to stdout before the gates, so "рівно один рядок stdout" (proposal C, lean-archive requirement) is true only for lines starting with `skip:`. The prescribed test counts `/^skip: /gm` and passes; CI scripts must not assume stdout equals the skip line.
3. Empty `## Blocked`: the delta list is `none`, `none.`, `-`, `—`, `n/a`, `немає`, but `isBlockedEmpty` also accepts `''`, and `fieldsFromSections` already maps an absent or empty section to `none`, so a handoff without `## Blocked` is green. Test 3.2 (6) asserts `''` as true. D7's "агент пише `## Blocked` = `none` обов'язково" is stronger than the code needs. Harmless; the spec is just silent on the absent-section case.
4. Literal-wording overlaps with the new behaviour that are not in a MODIFIED set: main "CLI persist is the durable Memory writer" scenario ("stdout починається з `/opsx:`", unconditional GIVEN), "Handoff file template" (Prompt "мовою `agent_language`"), and the retained "archive — новий чат" sentence in the MODIFIED "Session Exit…" requirement. They stay consistent only through the ADDED requirement's "єдиний виняток" sentence. A one-line touch-up when this change is archived would remove the ambiguity.
5. Archive order: the copied "Next-session prompt follows agent_language" block equals the pending R2a delta except the Apply-exit scenario (diffed). Any edit to that pending requirement before its archive would be overwritten when this change is archived afterwards; nothing detects a wrong order. Follow the plan order from the tasks Constraints.
6. First-ever `openspec` run on a machine (no config in HOME) prints a telemetry note to stdout, which breaks `archive`'s `JSON.parse` ("could not resolve change … Unexpected token 'N'"; seen in my fresh-HOME simulation). Pre-existing, auto-disabled when `CI=true`, but terminal-first makes "archive is the first openspec call" more plausible; `OPENSPEC_TELEMETRY=0` avoids it, a README line would help.
7. CI hardening and docs (opt-in path, no defect): checkout persists the possibly bypass-capable token in `.git/config` while `npm ci` lifecycle scripts run (`persist-credentials: false` plus an explicit push URL would narrow that); a failing change aborts the loop under `set -e` and drops the in-workspace archives of earlier changes (loud by design); with CI opted in, the terminal hint printed by `handoff` would double-archive if the human also runs it; GitLab `needs` on a same-stage job is rejected by older self-managed GitLab (before 14.2, as I recall); the job sets no `stage:`.
8. Wording and leftovers: the delta scenario keeps "≤ 1.5 KB" for `opsx-archive.md` while tasks and tests enforce 1 024 B (stricter, fine); tasks 2.3, 3.2, 4.6, 5.3 carry `Files: new file:` for a file created in 1.4 (their `Do:` says "розширити"); `opsx-quick.md`, `openspec-howto` and `spec-workflow-openspec` still show `/opsx:archive` as the normal path (declared Non-goals; the command stays valid as a fallback).

On the ~100 KB `tasks.md`: not a defect. No kit rule caps artifact size (the plan rejected R10 caps), anchors are unique at HEAD and stay unique in task order, there are no line-number references, and cross-task dependencies are explicit (1.2 before 1.4, 2.1 before 2.2 for C10-old, one shared test file across 1.4/2.3/3.2/4.6/5.3). The cost is context size per apply session; `apply-notes.md` carries the distilled constraints.

## Previous findings
none — first review cycle
