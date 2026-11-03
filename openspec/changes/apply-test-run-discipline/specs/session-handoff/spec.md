## ADDED Requirements

### Requirement: Restore prints a recovery briefing for an unpersisted session

When `handoff <name> --restore` prints at least one `UNPERSISTED SESSION` warning, it SHALL then print a recovery briefing built from `checkpoint.json`, `handoff.md`, `decisions.md`, `tasks.md`, `review.md` and git. The existing lines, their order and the exit code MUST NOT change; without such a warning no briefing is printed. The briefing starts with the line `RECOVERY BRIEFING`.

#### Scenario: Interrupted session with a checkpoint
- **GIVEN** `pending` is open and a valid checkpoint reports progress `finished 2.1` and next step `start 2.2`
- **WHEN** restore runs
- **THEN** the output keeps every pre-existing line, then the `UNPERSISTED SESSION` warning, then `RECOVERY BRIEFING`
- **AND** a FACTS line names `finished 2.1` with the source `[checkpoint.json]` and the exit code is 0

#### Scenario: Stale handoff
- **GIVEN** `handoff.md` is 60 seconds older than `tasks.md` and no checkpoint exists
- **WHEN** restore runs
- **THEN** the briefing has an UNKNOWN line saying `handoff.md` predates the edits and its Done and Next command may be outdated

#### Scenario: Artifacts without handoff.md
- **GIVEN** the change has `proposal.md` and no `handoff.md`
- **WHEN** restore runs
- **THEN** the briefing is printed before the existing error line, and the exit code stays 1

#### Scenario: Clean state
- **GIVEN** `handoff.md` is newest and `pending` is empty
- **WHEN** restore runs
- **THEN** the output contains neither `UNPERSISTED SESSION` nor `RECOVERY BRIEFING`

### Requirement: Recovery briefing separates facts, unknowns, contradictions and gaps

The briefing SHALL contain, in this order, the headings `FACTS`, `UNKNOWN`, `CONTRADICTIONS`, `GAPS` and `QUESTIONS FOR THE USER`, each followed by items or `- none`. Every item except `- none` ends with its sources in brackets; omission rows end with `[DETAILS]`. Per field the authority is: `decisions.md` for recorded decisions, `tasks.md` for boxes, `review.md` for the verdict, git for changes.

#### Scenario: Sources are tagged
- **WHEN** a briefing is printed
- **THEN** every item under every heading, QUESTIONS and omission rows included, ends with a bracketed source such as `[tasks.md]`, `[git]` or `[DETAILS]`, except `- none`

#### Scenario: Contradicting sources
- **GIVEN** `tasks.md` has 2 ticked boxes while a usable checkpoint reported 4
- **WHEN** the briefing is printed
- **THEN** CONTRADICTIONS names both values and both sources, and QUESTIONS asks which is right

#### Scenario: Reported decision not yet recorded
- **GIVEN** a checkpoint reported the decision `cache: use sha256` and `decisions.md` does not contain it
- **WHEN** the briefing is printed
- **THEN** UNKNOWN lists the decision verbatim with `[checkpoint.json, decisions.md]` and says it is recorded when Session Exit persists `## Decisions`
- **AND** `decisions.md` is not changed

### Requirement: A superseded checkpoint is used for reported decisions only

A valid checkpoint is usable only while its recorded SHA-256 of `handoff.md` equals the current one (both absent counts as equal). A checkpoint superseded by a later `handoff.md` SHALL be used only to list its reported decisions that `decisions.md` lacks, labelled as superseded; its tasks count, role, blocker, next step and git HEAD MUST NOT feed any FACT, contradiction, question or git reference.

#### Scenario: Handoff newer than checkpoint
- **GIVEN** a valid checkpoint whose recorded handoff digest equals the current `handoff.md`
- **WHEN** blocker and next step are shown
- **THEN** the checkpoint values are shown as reported and newer than `handoff.md`, and `handoff.md` is not listed as contradicting

#### Scenario: Handoff rewritten after the checkpoint
- **GIVEN** `handoff.md` was rewritten after the checkpoint and the checkpoint reported 4 ticked boxes while `tasks.md` has 6
- **WHEN** the briefing is printed
- **THEN** GAPS says the checkpoint is superseded, the handoff values are used, and no contradiction or question is built from the checkpoint count

### Requirement: Review currency compares content hashes with the review commit

For a verdict starting with `APPROVE` the briefing SHALL compare SHA-256 digests of the planning artifacts (`proposal.md`, `design.md`, `design-brief.md`, `tasks.md` with checkbox marks normalized, `specs/**/*.md`) in the working tree with the last commit that touched `review.md`, over the union of both path sets. Any difference, addition or deletion makes the review stale. Without a clean committed `review.md` or git the state is unknown; checkpoint time and mtime MUST NOT prove currency.

#### Scenario: Edit after review is stale
- **GIVEN** a committed `review.md` with APPROVE and a later edit to `design.md`
- **WHEN** the briefing is printed
- **THEN** CONTRADICTIONS says the verdict does not cover the current artifacts, names `design.md` and `[review.md, git]`

#### Scenario: Checkpoint after the edit does not bless the review
- **GIVEN** APPROVE committed, then `design.md` edited, then a checkpoint taken
- **WHEN** the briefing is printed
- **THEN** the review is still reported stale

#### Scenario: Re-review with the same verdict
- **GIVEN** `design.md` edited after an APPROVE and `review.md` rewritten with APPROVE and committed afterwards
- **WHEN** the briefing is printed
- **THEN** the review is reported current

#### Scenario: Deleted artifact and substantive task edit
- **GIVEN** an APPROVE commit, then `design-brief.md` deleted, or a `Do:` line of `tasks.md` edited
- **WHEN** the briefing is printed
- **THEN** the review is reported stale and names the deleted file or `tasks.md`

#### Scenario: Ticking boxes does not stale a review
- **GIVEN** an APPROVE commit and only `tasks.md` checkbox marks changed since
- **WHEN** the briefing is printed
- **THEN** the review is reported current

#### Scenario: No evidence
- **GIVEN** `review.md` is untracked or modified, or the project is not a git repository
- **WHEN** the briefing is printed
- **THEN** UNKNOWN says the review currency is unknown and no line calls the verdict current

### Requirement: Recovery briefing never infers completion, test results or motives

The briefing MUST NOT treat a modified file as a finished task or a ticked box as a passed test, and MUST NOT state or invent a reason for any decision. It MUST NOT write or overwrite any canonical file. A path is modified when the NUL-delimited output of `git status --porcelain=v1 -z --untracked-files=all` lists it (both paths of a rename), matched exactly against the task `Files:` entries, an entry ending in `/` matching by prefix.

#### Scenario: Changed file is not a finished task
- **GIVEN** task 2.2 is unticked and lists `src/a.js` in `Files:`, and git shows `src/a.js` modified
- **WHEN** the briefing is printed
- **THEN** UNKNOWN says task 2.2 lists a modified path and its completion is not confirmed

#### Scenario: Untracked directory and unusual names
- **GIVEN** unticked tasks list `src/new/a.js`, `src/файл.js` and a path with a tab, a backslash and a quote, all untracked inside new directories
- **WHEN** the briefing is printed
- **THEN** each task gets its UNKNOWN item and no spurious question about an uncovered path is asked

#### Scenario: Ticked box is not a test result
- **GIVEN** 5 of 9 boxes are ticked
- **WHEN** the briefing is printed
- **THEN** UNKNOWN says a ticked box does not confirm that tests passed and no line claims tests passed

#### Scenario: No motive invented
- **GIVEN** a decision recorded without a reason
- **WHEN** the briefing is printed
- **THEN** the decision text appears verbatim, no reason is added, and no canonical file changed

### Requirement: Recovery briefing recovers the available part and reports gaps

When a source is missing, unreadable or corrupt, restore SHALL continue and the briefing SHALL still print everything the other sources support, with one GAPS item per failing source and its reason. A failing source, including a directory in place of `handoff.md` or `decisions.md`, MUST NOT abort restore or change the exit code, which stays 0 except in the existing early return. A briefing without any checkpoint SHALL state `no checkpoint.json` in GAPS.

#### Scenario: Missing checkpoint
- **GIVEN** `pending` is open, no `checkpoint.json` exists, and the change has `tasks.md`, a `decisions.md` entry and a git commit
- **WHEN** restore runs
- **THEN** GAPS says `no checkpoint.json`, and FACTS still report `tasks.md`, `decisions.md` and git state

#### Scenario: Corrupt checkpoint
- **GIVEN** a truncated `checkpoint.json`
- **WHEN** restore runs
- **THEN** GAPS says `checkpoint.json unreadable (invalid JSON): ignored` and no value from it appears

#### Scenario: Interrupted checkpoint write
- **GIVEN** a valid `checkpoint.json` and a leftover `checkpoint.json.tmp`
- **WHEN** restore runs
- **THEN** the valid checkpoint is used and GAPS notes the leftover temporary file

#### Scenario: No git
- **GIVEN** the project directory is not a git repository
- **WHEN** restore runs
- **THEN** GAPS says git is unavailable, the other sources are reported, and the exit code is unchanged

#### Scenario: Unreadable handoff.md or decisions.md
- **GIVEN** `pending` is open and `handoff.md` (or `decisions.md`) is a directory
- **WHEN** restore runs
- **THEN** restore prints a warning naming the file, still prints the remaining lines and the briefing with a GAPS item `<file> unreadable`, and the exit code is 0 (1 only when no handoff.md data and no Memory entity exist)

### Requirement: Recovery briefing asks the user only about material ambiguity

QUESTIONS FOR THE USER SHALL list at most 3 questions, only for these cases: modified paths that no task's `Files:` covers while the handoff next command is not `/opsx:apply`; fewer ticked boxes than a usable checkpoint reported; no usable role value (no non-empty `pending.role`, handoff next role or usable checkpoint role). The CLI MUST NOT prompt interactively; the conductor asks the listed questions and nothing else.

#### Scenario: Ambiguity the sources cannot settle
- **GIVEN** 3 modified paths match no task `Files:` and `handoff.md` next command is `/opsx:review x`
- **WHEN** the briefing is printed
- **THEN** QUESTIONS has one item asking whether those paths belong to this change

#### Scenario: Role missing in a present handoff
- **GIVEN** `handoff.md` exists but has no next role, there is no `pending.role` and no usable checkpoint role
- **WHEN** the briefing is printed
- **THEN** QUESTIONS asks which role was running

#### Scenario: Settled by sources
- **GIVEN** a stale APPROVE and a handoff whose next role is `Reviewer`
- **WHEN** the briefing is printed
- **THEN** QUESTIONS is `- none` and CONTRADICTIONS carries the stale verdict

### Requirement: Recovery briefing is compact and byte-bounded

The briefing SHALL NOT exceed 40 lines or 4096 UTF-8 bytes, every line at most 200 characters, even for multibyte text, long paths and long sources. Shortening MUST cut item text on code points, add `…` and keep the bracketed sources; when content does not fit, FACTS and UNKNOWN items are dropped first into one `(<k> more omitted; see the files below) [DETAILS]` line, and the headings, CONTRADICTIONS, GAPS, QUESTIONS and `DETAILS:` are kept.

#### Scenario: Briefing is capped
- **GIVEN** 60 modified paths, 30 decisions and very long task titles
- **WHEN** restore runs
- **THEN** the briefing has at most 40 lines and 4096 bytes, an omission line, and the `DETAILS:` line

#### Scenario: Long and multibyte items
- **GIVEN** 20 gaps and contradictions made of 4-byte characters, and a 400-character path in a decision
- **WHEN** the briefing is printed
- **THEN** it has at most 4096 bytes, every kept item still ends with its bracketed source, and no line splits a character

### Requirement: Recovery briefing is read-only, local and metrics-neutral

Building the briefing SHALL use only local files and read-only git commands with fixed arguments, no network, no LLM and no client detection, so the same files and git state give the same briefing in Cursor, Claude Code and Amp. It MUST NOT write any file or call a metrics function; the session-start record of restore stays exactly as before, once per restore.

#### Scenario: No double metrics accounting
- **GIVEN** an unpersisted change
- **WHEN** restore runs with the briefing and then `handoff <name>` persists
- **THEN** `metrics.json` has `pending` set once by restore, then one new session and `pending` null, as without the briefing

#### Scenario: Read-only
- **WHEN** restore runs with `--no-metrics` on an unpersisted change
- **THEN** no file under the project changes
