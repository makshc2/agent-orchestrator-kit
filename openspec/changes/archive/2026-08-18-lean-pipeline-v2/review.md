# Spec Review: lean-pipeline-v2

## Verdict: APPROVE

This is re-review round 2 following the prior REQUEST CHANGES. All three major
findings and the minor finding are resolved, strict validation passes, and the
sanity pass found no new major issues.

## Findings

### Major 1 — RESOLVED: archive rollback atomicity

- Design §1 step 3 says: “Перед merge CLI робить snapshot вмісту кожного main
  spec-файлу, який буде змінено або створено.” Step 5 requires restoring those
  snapshots, deleting newly created spec files, reverting the move, and exit 1.
- Task 1.1 Do mirrors the complete flow: snapshot all affected main specs before
  merge, then on validation failure “відновити main specs до pre-sync стану,
  видалити нові spec-файли, відкотити move”.
- `specs/lean-archive/spec.md`, scenario “Rollback при падінні валідації”, requires
  the change to return to its original path, synchronized main specs to return to
  pre-sync content, newly created spec files to be deleted, and a nonzero exit.

### Major 2 — RESOLVED: `Files:` path validation traceability

- Design §2 defines an error when `Files:` names a nonexistent path without the
  `new file:` prefix.
- Task 2.1 Do repeats that rule; Done-when requires a missing-path fixture to exit
  1 in strict mode.
- `specs/task-contract/spec.md` now has both “Неіснуючий Files-шлях падає в
  strict-режимі” and “Префікс new file дозволяє новий Files-шлях”, covering the
  strict failure and prefix exemption respectively.

### Major 3 — RESOLVED: smoke coverage

Task 6.2 now explicitly requires automated coverage for successful
`archive --sync` with ADDED/MODIFIED/REMOVED merging; validation-failure rollback
of both the change path and pre-sync main-spec content; `gate-check --tasks` warn
mode with exit 0 and a warning; and both `gate-check --review` outcomes (`pass:
true` for a valid fixture and `pass: false` when Non-goals is absent).

### Minor 1 — RESOLVED: archive sync semantics

- Design §1 contains the five-row truth table: `--sync` merges and archives with
  exit 0; delta specs without a sync flag refuse with exit 1 and demand `--sync`
  or `--no-sync --force`; `--no-sync` without force refuses with exit 1;
  `--no-sync --force` archives without merge with exit 0; and without delta specs
  sync flags are irrelevant and archive exits 0.
- Task 1.1 Do mirrors all five cases.
- `specs/lean-archive/spec.md`, scenario “Delta specs вимагають явного
  sync-рішення”, requires no-flag refusal, the explicit flag guidance, no move,
  and a nonzero exit.

### Validation

Command: `npx openspec validate lean-pipeline-v2 --strict --type change`

Exact stdout:

```text
Change 'lean-pipeline-v2' is valid
```

Exit code: **0**.

Informational `npx agent-orchestrator-kit gate-check lean-pipeline-v2 --review`
produced no stdout and exited 1; per the review instructions this is non-blocking
for the not-yet-implemented command behavior.

## Verified against repo

- Read proposal, design, tasks, prior review, handoff, and all five delta specs;
  compared the modified `pipeline-subagents` and `session-handoff` requirements
  with their main specs. The deltas consistently replace the affected behavior.
- All 16 tasks remain unchecked (`- [ ]`) and every task has `Files:`, `Do:`, and
  `Done-when:` fields.
- Every existing repository path referenced by a task exists; no task declares a
  missing current path.
- The reworked truth table, rollback flow, task Done-when statements, and delta
  scenarios introduce no contradictory behavior.
- The tiered-review spec requires `apply-notes.md` on APPROVE; it was created with
  the required implementation constraints and verification commands in no more
  than 20 lines.

`/opsx:apply lean-pipeline-v2` is explicitly unblocked.
