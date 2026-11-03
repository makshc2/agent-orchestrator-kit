## Purpose

Requirements for session-checkpoint, introduced by change apply-test-run-discipline. This specification defines the supported behavior and acceptance scenarios.

## Requirements

### Requirement: Checkpoint command saves session progress without closing the session

`npx agent-orchestrator-kit checkpoint [change-name]` SHALL write `openspec/changes/<name>/checkpoint.json` holding the agent-supplied progress, blocker, next step and decisions plus a CLI-computed snapshot (task counts, review verdict, git HEAD, SHA-256 of `handoff.md`). It MUST NOT write `handoff.md`, `decisions.md`, Memory JSON or `metrics.json`, print a next-session prompt, or start a phase. It exits 0 on success.

#### Scenario: Checkpoint after a finished task
- **GIVEN** a change whose `tasks.md` has 3 of 9 boxes ticked and no `checkpoint.json`
- **WHEN** `checkpoint <name> --task 2.1 --done "finished 2.1" --next "start 2.2"` runs
- **THEN** it exits 0 and `checkpoint.json` is valid JSON with `seq` 1, `task` `2.1` and `snapshot.tasks` 3 of 9
- **AND** `handoff.md`, `decisions.md` and the Memory JSON file are neither created nor changed
- **AND** stdout contains no line that starts with `/opsx:`

#### Scenario: Checkpoint after a review verdict
- **GIVEN** `review.md` contains `Verdict: APPROVE`
- **WHEN** `checkpoint <name> --done "review APPROVE"` runs
- **THEN** `snapshot.review` is `APPROVE`

#### Scenario: Unknown or ambiguous change
- **WHEN** the change directory does not exist, or no name is given and several changes are active
- **THEN** the command exits 1, prints the reason and writes no file

### Requirement: Checkpoint decisions stay in checkpoint.json and never reach decisions.md

`checkpoint` SHALL keep each `--decision <text>` verbatim (trimmed, leading list markers and case kept) in the `decisions` array of `checkpoint.json` and MUST NOT create or modify `decisions.md`: the existing rule that `decisions.md` is written only from `## Decisions` by `handoff <name>` persist stays unchanged and exclusive. The literal `none` (also `- none`) MUST be rejected as reserved by persist.

#### Scenario: decisions.md is untouched
- **GIVEN** a change with a `decisions.md` of known bytes and mtime
- **WHEN** `checkpoint <name> --decision "- retry: retain history"` runs
- **THEN** the stored decision is exactly `- retry: retain history` and `decisions.md` bytes and mtime are unchanged; without the file it is not created

#### Scenario: Reserved literal
- **WHEN** `--decision none` or `--decision "- None"` is passed
- **THEN** the command exits 1, names the reserved value, and writes nothing

#### Scenario: Persist is the only writer
- **GIVEN** a checkpoint holds `cache: use sha256` and `handoff.md ## Decisions` lists the same text
- **WHEN** `handoff <name>` persists
- **THEN** `decisions.md` has exactly one entry with that text, as without the checkpoint

### Requirement: Checkpoint decisions accumulate until persist records them

The `decisions` array SHALL carry the previous valid checkpoint's decisions plus the new ones, deduplicated by the persist normalization (list marker stripped, whitespace collapsed), and SHALL omit every decision whose normalized text is already in `decisions.md`. A result of more than 30 decisions MUST exit 1 and write nothing.

#### Scenario: Earlier decision survives a later call
- **GIVEN** call 1 passed `--decision "a: x"` and call 2 passes only `--done "y"`
- **WHEN** call 2 completes
- **THEN** `decisions` still holds `a: x`

#### Scenario: Persisted decision is dropped
- **GIVEN** the checkpoint holds `a: x` and a persist wrote `a: x` into `decisions.md`
- **WHEN** the next checkpoint runs
- **THEN** `decisions` no longer holds `a: x`

### Requirement: Each checkpoint is a complete snapshot of the supplied fields

`done`, `blocked`, `next`, `task` and `role` SHALL be replaced by every successful call: an omitted option is stored as empty (`task` and `role` as null) and MUST NOT inherit the previous value, so an old blocker is never carried forward. `blocked` equal to `none` (any case) is stored as empty.

#### Scenario: Omitted fields clear earlier values
- **GIVEN** a checkpoint with `blocked` `waiting for CI`, `next` `start 2.2` and `task` `2.1`
- **WHEN** `checkpoint <name> --done "z"` runs
- **THEN** the new record has `blocked` `""`, `next` `""` and `task` null, and `seq` is 2

### Requirement: Repeated checkpoint with an unchanged state is a no-op

A call whose `contentDigest` (agent-supplied fields, decisions and snapshot, excluding `seq` and `savedAt`) equals the last valid checkpoint SHALL NOT rewrite `checkpoint.json`: bytes and mtime stay unchanged, `seq` stays, the command prints `checkpoint unchanged (seq <n>)` and exits 0. A call with a different digest SHALL save `seq` plus 1. Both paths remove a leftover `checkpoint.json.tmp`.

#### Scenario: Same call twice
- **WHEN** the same `checkpoint <name> --done "x" --next "y"` runs twice with no change between
- **THEN** the second run prints `checkpoint unchanged (seq 1)` and the file bytes and mtime equal those after the first run

#### Scenario: State moved on
- **GIVEN** a checkpoint with `seq` 1
- **WHEN** a task box is ticked and the same command runs again
- **THEN** `checkpoint.json` has `seq` 2 and `snapshot.tasks` reflects the new count

### Requirement: Checkpoint writes are atomic and keep the last good state

The CLI SHALL write `checkpoint.json` through `checkpoint.json.tmp` in the same directory: write, fsync, then rename over the target. A write interrupted before the rename MUST leave the previous `checkpoint.json` byte-identical, and a failed save MUST report `checkpoint not saved: <message>`, exit 1 and leave no other file changed. A stale temporary file MUST be removed by the next checkpoint and MUST NOT be read as a checkpoint.

#### Scenario: Rename fails
- **GIVEN** a valid `checkpoint.json` with `seq` 1
- **WHEN** the rename step throws during a save
- **THEN** `checkpoint.json` is byte-identical to before, the temporary file is gone, and the call reports the error with exit 1

#### Scenario: Leftover temporary file with a changed state
- **GIVEN** a valid `checkpoint.json` with `seq` 1 and a half-written `checkpoint.json.tmp`
- **WHEN** the next checkpoint has a different state and succeeds
- **THEN** `checkpoint.json.tmp` no longer exists and `seq` is 2

#### Scenario: Leftover temporary file with an unchanged state
- **GIVEN** a valid `checkpoint.json` with `seq` 1 and a half-written `checkpoint.json.tmp`
- **WHEN** the same checkpoint runs again
- **THEN** `checkpoint.json.tmp` no longer exists, `seq` stays 1, and the bytes and mtime of `checkpoint.json` are unchanged

### Requirement: A corrupt checkpoint is detected, ignored and replaceable

A `checkpoint.json` is valid only when it parses as JSON, has `version` 1, names the same change, has every required field with the right type, and its `digest` equals the SHA-256 of the record without `digest`. An invalid file MUST be ignored by readers with a stated reason and MUST NOT make any command fail. The next checkpoint SHALL replace it with `seq` 1 and print a stderr warning.

#### Scenario: Torn or edited file
- **GIVEN** `checkpoint.json` is truncated, or a field was edited so the digest no longer matches
- **WHEN** the file is read
- **THEN** it is reported as corrupt with the reason `invalid JSON` or `digest mismatch` and no data from it is used

#### Scenario: Replacement after corruption
- **GIVEN** a corrupt `checkpoint.json`
- **WHEN** `checkpoint <name>` runs
- **THEN** a valid file with `seq` 1 replaces it and stderr says the previous file was unreadable

### Requirement: Checkpoint never accounts metrics

The `checkpoint` command MUST NOT call a metrics function, read `metrics.json`, or write it: the file's bytes and mtime stay identical, and a missing `metrics.json` stays missing. A checkpoint MUST NOT add a session or change `pending`. Restore and persist after any number of checkpoints SHALL record exactly the sessions they would record without them.

#### Scenario: metrics.json is byte-identical
- **GIVEN** a change with a `metrics.json` that has an open `pending`
- **WHEN** three different checkpoints run
- **THEN** the SHA-256 and mtime of `metrics.json` equal the values before the first call

#### Scenario: Persist after checkpoints records one session
- **GIVEN** a restore followed by two checkpoints
- **WHEN** `handoff <name>` persists
- **THEN** `metrics.json` has one new session and `pending` is null, as without checkpoints

### Requirement: Checkpoint storage is change-local, git-tracked and not an artifact

`checkpoint.json` and `checkpoint.json.tmp` SHALL live directly in `openspec/changes/<name>/`, outside every gitignored path, and MUST NOT count as change artifacts for the `UNPERSISTED SESSION` staleness comparison. The CLI MUST NOT run `git add`, `git commit` or `git push` for them. `archive` MAY move the file with the change directory. No gate SHALL read it.

#### Scenario: Not ignored
- **WHEN** `git check-ignore openspec/changes/<name>/checkpoint.json` runs in a repo using the kit `.gitignore`
- **THEN** the path is not ignored

#### Scenario: Checkpoint alone does not make handoff.md stale
- **GIVEN** `handoff.md` newer than every artifact and a later `checkpoint.json`
- **WHEN** `handoff <name> --restore --no-metrics` runs
- **THEN** the output has no `handoff.md is older than the change artifacts` warning

### Requirement: Changes without a checkpoint behave exactly as before

Only `checkpoint` SHALL create `checkpoint.json`. The persist form `handoff <name>`, `archive`, `status` and every `gate-check` mode MUST NOT read it and MUST give the same output and exit code for a change with or without it. The restore form `handoff <name> --restore` MAY read it only to build the recovery briefing; for a clean state it MUST print the same output as before this change.

#### Scenario: Persist ignores a checkpoint
- **GIVEN** two copies of a change, one with a corrupt `checkpoint.json`
- **WHEN** `handoff <name>` persists in both
- **THEN** both exit 0 with identical stdout and no `checkpoint.json` is created in the copy that had none

#### Scenario: Clean restore is unchanged
- **GIVEN** `handoff.md` is newest, `pending` is empty, and the change has a valid `checkpoint.json`
- **WHEN** `handoff <name> --restore --no-metrics` runs
- **THEN** the output equals the output without the file and has no recovery briefing and no `UNPERSISTED SESSION`

### Requirement: Checkpoint input is bounded

Each of `--done`, `--blocked`, `--next` and each `--decision` SHALL be at most 500 characters and one line; at most 10 `--decision` values per call are accepted; `--role` MUST be a canonical role token and `--task` a task id like `2.1`. Violations exit 1 with the reason and write nothing, not even a leftover-file cleanup.

#### Scenario: Oversized or multi-line input
- **WHEN** `--done` has 501 characters, or a `--decision` contains a newline
- **THEN** the command exits 1 and `checkpoint.json` is unchanged or absent

#### Scenario: Unknown role
- **WHEN** `--role Wizard` is passed
- **THEN** the command exits 1 and names the canonical tokens

### Requirement: Checkpoint timing guidance lives in command and skill files only

The apply command and the apply skill SHALL tell the implementer to run `checkpoint` after each ticked box, after each important decision and after a `code-reviewer` verdict, with identical wording in both files; `/opsx:quick` SHALL point to that step. Always-apply rule files and `templates/AGENTS.md` MUST NOT be edited, and a failed checkpoint MUST NOT block the session.

#### Scenario: Twins carry the same guidance
- **WHEN** `opsx-apply.md` and `openspec-apply-change/SKILL.md` are compared
- **THEN** the checkpoint bullet is byte-identical in both and contains `checkpoint <name>`

#### Scenario: Always-on text is untouched
- **WHEN** the always-apply rule files and `templates/AGENTS.md` are read
- **THEN** none contains the word `checkpoint` and the existing size tests pass
