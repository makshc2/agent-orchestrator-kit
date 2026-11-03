## Context

Brief: `docs/improvement-plan-2026-10-01.md`, item 4 (R5-lite), written at v0.16.0. The repo has since shipped later releases, including the terminal-first archive line, which already sits in both apply twins. Current state of the apply surface:

- `templates/.agents/commands/opsx-apply.md` and `templates/.agents/skills/openspec-apply-change/SKILL.md` contain no test step and no `npm test` (0 occurrences each). Session Exit says "Include task and build/lint status in Done".
- `verifier.test_command` exists in `templates/orchestrator.yaml` (shipped empty) and in all four profiles; `init` rewrites it through `patchOrchestratorVerifier` to the detected package-manager command. Only `templates/.agents/subagents/test-writer.md` reads it. The CLI parses no `verifier:` keys.
- Existing tests pin: the exact green-apply sentence and `Never start archive in this apply chat.` in `opsx-apply.md`, exactly 3 literal archive lines in that file and 2 in the skill (`test/archive-from-terminal.test.js`), and the task-contract phrases in the propose files and `spec-architect.md` (`test/smoke.test.js`, `test/conductor-protocol-templates.test.js`).

## Stale claims in the plan (re-verified at the current version)

- Version and counts: the plan is from v0.16.0; the repo is now at the current release. `npm test` runs 408 tests, all passing here (the plan said 217).
- "1 test fails in containers without rsync": `test/` no longer mentions rsync (the scripts/templates sync test reads files with `fs`). Not reproducible; the no-hard-gate decision stays because it is about policy, not about this test.
- Size budgets: always-apply rule files total 11 976 of 12 000 characters (plan: 11 912), so there is room for about 24 characters; `templates/AGENTS.md` is 3 249 of 4 000 (plan: 3 180). Consequence: no edit to any rule file or `AGENTS.md`.
- Coverage (measured now, product code only, tests and `templates/` excluded): overall branch 67.11% (plan: 61.6%); `scripts/cursor-spend-collect.cjs` 46.58% (plan: 48.7%); `scripts/cursor-spend-hook.cjs` 35.71% (same); `bin/amp-usage.js` 56.67% (same). Without the exclusions the report also counts `test/` and the byte-identical `templates/scripts/` copies, which inflates the total to 74.72%. This matters for slice 2.
- Line references (`opsx-apply.md` steps 6/7 and `:143`, `SKILL.md:16`, `patchOrchestratorVerifier` at bin `:3570-3589`) have moved; `patchOrchestratorVerifier` is now near `:4136`. This design uses text anchors, not line numbers.
- "0 occurrences of `npm test`" in both apply twins: still true. "3 of 21 archived handoffs record tests": 24 archived handoffs now; the claim was not re-counted precisely and is not relied on.
- `kit-ci-verify` main spec says Node 20 and `setup-node@v4`, while `.github/workflows/agent-verify.yml` runs Node 22 and `@v5`. Irrelevant for slice 1, relevant for slice 2 (coverage flags need Node 22.8 or newer).

## Slicing decision

The change-artifact size budget is not the constraint (limits are in `bin/agent-orchestrator.js`: 60 000 B for `tasks.md`, 150 000 B total). The split is about coherence and verifiability.

- Slice 1 (this change, Part A): the apply test step, the `tests:` Done line, the no-hard-gate rule, and the fix-change text guideline. Text and one template test only; no `bin/` change in Part A; deliverable and testable in one apply session. [edited, conflict row 1: Part B below adds `bin/` code to this change]
- Slice 2 (follow-up, to be proposed after slice 1 is archived): recorded-capture fixtures in `test/fixtures/` driven through `collectSpend` and the leftover-window code; a kit-CI branch-coverage threshold (kit CI only, never the consumer templates); the advisory `gate-check --apply <name>` (runs `test_command`, prints a 20-line tail, non-zero exit on failure, persists nothing, does not gate archive). Slice 2 needs a MODIFIED or RENAMED of the Node 20 requirement in `kit-ci-verify` and a new requirement in `orchestrator-cli-controls`; it must not MODIFY the long `CLI команда gate-check` requirement (add a new requirement instead).

Slice 1 stands alone: the step tells the agent to run the configured command and show a 20-line tail without a CLI helper.

## Decisions

1. Placement: a new step 6.5 in the apply command and skill, with a body that is byte-identical in both twins (pinned by a parity test). Rule files and `AGENTS.md` are not touched (size budgets above).
2. "Once, before the last box": the last pending task is ticked only after the run is green; earlier tasks are ticked as today. A green run of the same command earlier in the session with no edit since counts, so a task that already ran the tests does not force a second run.
3. Empty command: skip with a warning and the Done line `tests: skipped (no test_command)`, then tick the last box (see decision 5). No inference of `npm test`. `init` already writes the detected command into new installs; older installs with an empty value simply skip.
4. Resource limits: the project's own resource rule or a busy machine narrows the run (specs for changed files, `--maxWorkers=1`) and the narrowing is recorded. Templates do not name the owner-local `.agents/rules/ask-before-heavy-ops.mdc`, which stays untouched and out of `templates/`.
5. Outcomes of the last-task test step (one table, used by BLOCK-A, the delta scenarios and the template test; [edited in re-propose, review R1]):

| Situation | Last box | `tests:` line in Done | `## Blocked` | Green apply |
|---|---|---|---|---|
| green run | ticked | `tests: <p>/<t>` or `tests: green (exit 0)` | untouched | possible |
| narrowed green run | ticked | `tests: <p>/<t> (narrowed: <what>)` | untouched | possible |
| empty or missing command | ticked (Done-when holds) | `tests: skipped (no test_command)` | untouched | possible |
| nothing can run (resources) | unticked | `tests: not run (<reason>)` | the reason | no |
| red, cause in the tasks' `Files:` | ticked only after the fix and a green re-run | as the green rows | untouched | possible |
| red, other cause (escape valve) | unticked | `tests: red (see Blocked)` | failing command and tail; next `/opsx:propose <name>` | no |
| red, failure predates the change, user not yet decided or rejected | unticked | `tests: red (see Blocked)` | the test name | no |
| red, failure predates the change, user accepted | ticked | `tests: <p>/<t> (accepted by user: <name>)` | untouched (`none`) | possible |
| session ends with more than one task pending | n/a | `tests: not run (paused: <k> tasks pending)` | untouched | no (tasks pending) |

The accepted row is the way out recorded in `decisions.md`: the red test blocks the last tick only until the user decides. The CLI is unchanged: the green-apply condition (all boxes ticked, `## Blocked` empty) is evaluated from `tasks.md` and `handoff.md` as before.
6. No hard gate: `handoff`, `archive`, `gate-check` and `metrics.json` do not read the `tests:` line. The line is a convention for reviewers and for later metrics work, not a machine-enforced field.
7. Fix-change guideline: the same sentence in `spec-architect.md`, `opsx-propose.md`, the propose skill and the `rules.tasks` list of the config example (the places that already carry the Done-when quality rules). It is guidance for the architect; `runTasksLint` is untouched, as the task-contract spec requires.
8. Spec homes: apply has no main spec, and the green-apply requirement in `session-handoff` is long, so the apply rules go into a new capability and nothing is MODIFIED. The `task-contract` addition is an ADDED requirement. No pending or archived change modifies a requirement that this change touches (there are no other active changes). [extended to Part B: ADDED only, conflict row 3]

## Risks / Trade-offs

- A red run caused by a pre-existing failure blocks the last tick until the user decides; acceptance ticks it and records the name, which keeps agents from skipping silently.
- Agents may report a `tests:` line without running anything. This is accepted: the change adds a visible record, not enforcement, by design.
- Test runtime adds about a minute to an apply session in this repo (the plan estimated 51-58 s at 217 tests; the suite is now larger, so the cost is higher, about 90 s in a measured run).
- Output tails of 20 lines may hide the failing test name in verbose runners; the agent re-runs a narrow spec to read details.

# Part B: session checkpoint and recovery briefing

Added by the owner on this change. Part A above is unchanged apart from the edits marked `[edited ...]` and listed after the conflict table. Part B is separable: its tasks are groups 4 to 7, its specs are `session-checkpoint` and `session-handoff`, its tests are three new files.

## Part B research (v0.20.1, text anchors)

- **Restore path.** `.command('handoff [change-name]')` in `bin/agent-orchestrator.js`, branch `if (opts.restore)`: prints the `handoff.md` fields (`next_command`, `next_role`, `closed_role`, Done, `attach:`), the last 10 `decisions.md` entries (`RESTORE_DECISIONS_LIMIT`), the Memory count, then `printUnpersistedWarnings(unpersisted)`, then `metricsRecordSessionStart` (skipped with `--no-metrics`). The early return `if (!fields && memoryItems.length === 0)` prints the warnings, `No handoff.md or Memory entities`, and sets exit code 1. The measured restore of this change is 20 lines and 2 239 B.
- **Detection.** `collectUnpersistedSessionWarnings(changeDir)`: (1) `metrics.json` has `pending.startedAt`; (2) artifacts exist but no `handoff.md`; (3) newest artifact mtime is more than `UNPERSISTED_MTIME_SLACK_MS` (2 000 ms) newer than `handoff.md`. `newestArtifactMtimeMs` skips the top-level `HANDOFF_NEUTRAL_FILES` (`handoff.md`, `metrics.json`, `decisions.md`, `.openspec.yaml`) and recurses into other directories. The whole check sits in a try/catch. Trigger (3) is mtime-based, so a fresh clone (all mtimes equal) cannot raise it.
- **Pending is overwritten on every restore.** `metricsRecordSessionStart` sets `pending` to now each time. Two restores without a persist therefore raise trigger (1) on the second one (the first test in `test/restore-unpersisted-warning.test.js` pins this). The recovery builder must run before that call and must not call it.
- **Persist path.** `readHandoffFields` uses `parseHandoffMarkdown` (split on `^## `) and `fieldsFromSections`; `missingHandoffFields` requires Closed role, Done and Next command. The CLI writes `handoff.md`, then `appendDecisionsFromHandoff` (`parseDecisionItems` strips bullets and drops `none`; dedupe by `normalizeDecisionText` against `parseDecisionsFileEntries`; line `- <localIsoDate> <text>`), then `persistMemoryFromHandoff`, then `metricsRecordSessionEnd` (closes `pending`, adds a session). `appendDecisionsFromHandoff` returns nothing and rewrites the whole file with `writeFileSync`.
- **No atomic helper exists.** `renameSync` is used only to move a change directory in `archive`. `saveMetricsFile`, `saveMemoryItems`, the `handoff.md` write and the `decisions.md` write are plain `writeFileSync`, so a crash mid-write can truncate `decisions.md`, the canonical record. `loadMetricsFile` silently returns defaults for unparseable JSON.
- **Pinned by tests.** `test/restore-unpersisted-warning.test.js` (four restore cases, exit codes 0 and 1); `test/smoke.test.js` (decisions persist and restore, always-apply budget under 12 000 chars, `templates/AGENTS.md` under 4 000); `test/fix-next-session-prompt.test.js` (EN prompt at most 1 536 B); `test/archive-from-terminal.test.js` (literal archive lines, green-apply sentence); `opsx-archive.md` at most 1 536 B (smoke).
- **Specs.** `session-handoff`: «Рішення change-у накопичуються в git-tracked decisions.md» (append-only, normalized dedupe, only the CLI writes it), «Session Exit вимагає самозвіт метрик…» (`decisions.md` only through `## Decisions` and persist), «Restore briefing prints Attach and the last decisions», «Restore попереджає про пропущений Session Exit» (0.20.1: four neutral files, the warning "не змінює exit code і не блокує restore"). Also `change-metrics` (restore records the start, persist the end), `lean-archive` (gates do not depend on `metrics.json`), roadmap (git-tracked session artifacts; one phase, one change).
- **Storage constraints.** `.gitignore` ignores `.cursor/`, `.claude`, `.amp/settings.json`, `.agents/spend/`, `*.log`, `node_modules/`; the Memory JSON is a mirror in the ignored `.cursor/memory.json`. `openspec/changes/<name>/checkpoint.json` and its `.tmp` are not ignored, `archive` moves the whole directory with `renameSync`, `gate-check` reads only named files, and the artifact budget counts only proposal, design, tasks and delta specs.
- **Stale or surprising.** `setup-doctor.md` mentions `.agents/cache/checkpoints` (an older design, unrelated; not reused). Budgets: minimal EN `buildNextSessionPrompt` 1 530 of 1 536 B, always-apply rules 11 976 of 12 000 chars, `templates/AGENTS.md` 3 249 of 4 000, `opsx-archive.md` 979 of 1 536 B, so none of that text can grow.

## Decision 9: a new command `checkpoint <name>` (option A) over a `handoff` flag (option B)

| Factor | A: `checkpoint <name>` | B: `handoff <name> --checkpoint` |
|---|---|---|
| Reuse of parsers and helpers | Imports the same module-level functions (`parseTasksProgress`, `parseReviewVerdict`, `resolveHandoffChange`); no shared action body | Shares the action, but the persist body needs Closed role, Done and Next command (`missingHandoffFields`), which a mid-session call does not have |
| Risk to the metrics path | None by construction: the new action imports no `metricsRecord*` | One more early-return branch in an action whose other branch calls `metricsRecordSessionEnd`; a wrong branch condition double-counts a session |
| Discoverability for agents | Own line in `--help`; the apply text names one command, same `npx agent-orchestrator-kit checkpoint <name>` in Cursor, Claude Code and Amp | Hidden among 25 handoff options, easy to confuse with persist |
| Size of always-on text | Zero: guidance is in apply and quick files | Zero as well |
| Semantics | A saved state, not a handoff: no prompt, no next role | A flag that disables most of the command |

Choice: A. Cost: one more entry in the command list (the README CLI reference gains an entry).


## Decision 10: storage is `openspec/changes/<name>/checkpoint.json`, written by temp file and atomic rename

| Option | Atomicity and torn write | Idempotence | Last good state | Fit |
|---|---|---|---|---|
| `checkpoint.json`, temp + fsync + rename | Rename is atomic on POSIX and NTFS: readers see the old or the new file, never a mix | `contentDigest` compare, no rewrite | The old file stays until the rename | Bounded size; one file to read |
| `checkpoint.jsonl`, append-only | A torn last line is detectable, earlier lines are intact | `contentDigest` of the last valid line | All earlier lines | Grows per call, compaction needed, a torn append can fuse with the next line unless guarded |
| `checkpoint.md` (sections) | Same as JSON but no cheap integrity check | Text compare | Same as JSON | Reuses `parseHandoffMarkdown`, but a half-written section still parses |

Choice: `checkpoint.json`. The path is git-tracked, change-local and follows the change into the archive (a small historical record; archive code is untouched). Not `.cursor/`, not `$HOME`, not `.agents/cache`.

### Format (`version` 1)

Keys in this order: `version` (1), `change`, `seq` (starts at 1), `savedAt` (UTC ISO), `role` (canonical token or null), `done`, `blocked`, `next` (strings, at most 500 chars, one line; `blocked` `none` is stored as `""`), `task` (id like `2.1` or null), `decisions` (array of strings, see Decision 11), `snapshot`, `contentDigest`, `digest`.

`snapshot` (all computed by the CLI): `tasks` (`{done, total}` from `parseTasksProgress`, or null), `review` (verdict text from `parseReviewVerdict` or null), `head` (`git rev-parse HEAD` or null), `handoffSha256` (SHA-256 of the `handoff.md` bytes or null). Artifact digests are deliberately not stored: a checkpoint cannot prove what a review covered (Decision 13).

`contentDigest` is the SHA-256 of `JSON.stringify` of `{version, change, role, done, blocked, next, task, decisions, snapshot}`; `digest` is the SHA-256 of `JSON.stringify` of the whole record without `digest`.

Each call is a complete snapshot of `done`, `blocked`, `next`, `task` and `role`: an omitted option is stored empty or null and never inherits the old value, because a carried-forward blocker is worse than a lost one. `decisions` is the one cumulative field (Decision 11), otherwise a decision from an earlier call would vanish before any writer recorded it.

### Write path, idempotence, corruption (single durable file)

1. Validate the input; on error exit 1 before any write, including the temp-file cleanup.
2. Read `decisions.md` read-only to get the keys already recorded (a read failure gives an empty set and a stderr warning).
3. `readCheckpoint`: `valid`, `missing` or `corrupt` (reasons `invalid JSON`, `unsupported version`, `wrong change`, `missing field <f>`, `digest mismatch`).
4. Merge decisions (Decision 11); an over-limit result exits 1 with nothing written. Only then remove a stale `checkpoint.json.tmp`, in every remaining path.
5. Build the record. If the previous file is valid and its `contentDigest` equals the new one: print `checkpoint unchanged (seq <n>)`, keep bytes, mtime and `seq` (cleanup-only: the temp file is already gone), exit 0. Otherwise `seq` is the valid previous `seq` plus 1 (1 after a missing or corrupt file, with a stderr warning for corrupt); write the temp file, fsync, rename.
6. A write error prints `checkpoint not saved: <message>`, exits 1 and leaves the previous `checkpoint.json` byte-identical. `checkpoint.json` is the only file `checkpoint` writes, so there is no partial success: after a failure nothing new is durable, and the message says so.

A single writer is assumed (parent-driven apply); two concurrent writers still each produce a valid file, the last rename wins. `checkpoint` imports no metrics function and never opens `metrics.json`, writes `handoff.md`, `decisions.md` or the Memory file.

## Decision 11: `checkpoint` does not write `decisions.md` (reconciles review R2)

The main requirement «Session Exit вимагає самозвіт метрик у `## Metrics`» says `decisions.md` is edited only through `## Decisions` and persist. The first draft of this change had `checkpoint --decision` call `appendDecisionsFromHandoff`, a second writer path that an ADDED-only delta cannot legally open. Options:

| Option | Result |
|---|---|
| A: `checkpoint` writes only `checkpoint.json`; decisions are kept there and recorded by persist | The main requirement stays true as written; no MODIFIED, no migration of a long requirement; the persist path and its bytes are untouched |
| B: a MODIFIED of that requirement (it is far over 500 chars) | Needs the full text copied and a scoped migration; touches a metrics-protocol requirement for a side feature; overwrite risk on archive |
| C: ADDED requirement that overrides the exclusivity | Two specs that contradict each other; rejected by the review |

Choice: A. Consequences. Decisions made in an interrupted session survive in `checkpoint.json` and are shown by the briefing as reported and not yet recorded (UNKNOWN); the next Session Exit lists them under `## Decisions` and persist records them. `decisions` is stored verbatim (trimmed; leading `-` or `*` and the case kept): the persist parser (`parseDecisionItems`) is not reused, which also removes the problem that it strips markers and drops `none`. Because persist drops the literal `none`, `--decision none` and `--decision "- none"` are rejected as reserved. Accumulation: the new array is the previous valid array plus the given items, deduplicated by `decisionKey` (marker stripped, whitespace collapsed, the persist normalization), minus every key already in `decisions.md`, at most 30 (over the limit exits 1). Atomic writing of `decisions.md` and a return value for `appendDecisionsFromHandoff` were part of the first draft and are dropped: persist is not edited. The existing risk that a crash can truncate `decisions.md` stays as it is today.

## Recovery briefing

Printed by `handoff --restore` right after `printUnpersistedWarnings`, only when `unpersisted.length > 0`, and also on the early-return path before the `No handoff.md or Memory entities` error (exit 1 unchanged). Output goes through `console.log`. Built before `metricsRecordSessionStart`; it reads `pending` with a plain JSON parse, never `loadMetricsFile`.

**What changes in restore output:** one new block after the warnings, guarded reads of `handoff.md` and `decisions.md` (below), and `checkpoint.json` plus `checkpoint.json.tmp` join `HANDOFF_NEUTRAL_FILES`. **What stays:** every existing line and its order for readable files, the three warning triggers and texts, the exit codes (0, or 1 in the early return), the metrics session start, and the byte-exact output for a change in a clean state.

### Guarded reads (review R4)

In the current restore branch `readHandoffFields` and the `decisions.md` read run before any recovery code and can throw (a directory at the path, an I/O error). The restore branch wraps both: a failed `handoff.md` read gives `fields = null` and `log.warn('handoff.md unreadable (<first 80 chars>) — using Memory JSON only')`; a failed `decisions.md` read prints `log.warn('decisions.md unreadable (<first 80 chars>)')` instead of the entries. Restore then continues; the exit code is 1 only in the existing early return (no handoff data and no Memory entity), otherwise 0. The briefing, when printed, lists the same failure as a GAPS item `<file> unreadable: <reason>`. Metrics semantics are unchanged.

### Sources and precedence

| Question | Authority | Fallback |
|---|---|---|
| Which decisions are recorded | `decisions.md` | checkpoint decisions not in it are shown as UNKNOWN (reported), never copied |
| Which boxes are ticked | `tasks.md` | a usable checkpoint's count is labelled "reported" |
| Review verdict and currency | `review.md` plus git content hashes (Decision 13) | none: unknown |
| Blocker and next step | a usable checkpoint (newer than `handoff.md`), else `handoff.md` | the other record is not shown as current |
| What changed in the repo | git (`status --porcelain=v1 -z --untracked-files=all`, `log`, `diff --shortstat`) | none |
| Which session was open | `pending` of `metrics.json` | none |

**One rule for superseded checkpoints (review R7).** A valid checkpoint is *usable* when its `snapshot.handoffSha256` equals the SHA-256 of the current `handoff.md` (both absent counts as equal); otherwise it is *superseded*. A superseded checkpoint contributes exactly one thing: its reported decisions that `decisions.md` lacks (UNKNOWN items, labelled superseded) and a GAPS item. Its tasks count, role, blocker, next step and git HEAD feed no fact, contradiction, question or git reference. Only a usable checkpoint may feed the reported task/done/blocker/next facts, the "fewer ticked than reported" contradiction and question, the role, and the git reference. A role is *named* when `pending.role` is non-empty, or the handoff's next role is non-empty, or a usable checkpoint has a non-null role; the missing-role question tests these values, not whether `handoff.md` exists.

Git reference `ref`: a usable checkpoint's `snapshot.head` when that commit exists, else the last commit that touched `handoff.md`, else none (then the last 5 commits are listed as "unscoped"). All git calls use `execFileSync('git', [...])` with a fixed argument list and validated hashes, never a shell string.

### Git paths (review R8)

`git status --porcelain=v1 -z --untracked-files=all` is read as NUL-separated records `XY <path>`; for a rename or copy (`R` or `C` in X or Y) the record is followed by one more record holding the original path, and both paths count as changed. `-z` output is unquoted, so non-ASCII names and names with tabs, quotes or backslashes need no unescaping, and `--untracked-files=all` lists the files inside new directories. Paths are repository-root relative; `git rev-parse --show-prefix` gives the project prefix, which is stripped (paths outside it are dropped), and paths under `openspec/changes/<name>/` are excluded. Task `Files:` entries are comma-split, stripped of backticks, quotes, a leading `./` and a `new file:` prefix, and compared by exact string equality; an entry ending in `/` matches every changed path with that prefix. No glob support.

### Rules (deterministic)

1. **Changed file is not a finished task.** A changed path matching an unticked task's `Files:` yields an UNKNOWN item "task <id> lists <path>, which is modified; completion is not confirmed". At most 4 such items, then a count.
2. **Ticked box is not a passed test.** One UNKNOWN item: "<n> boxes ticked; a ticked box does not confirm that tests passed; no test result is evaluated". The briefing never parses the `tests:` line (conflict row 7).
3. **Old APPROVE is not a current review.** See Decision 13.
4. **No invented motives.** Decisions are printed as recorded; the briefing adds no reason and writes no file.
5. **Contradictions** (each with both sources): stale review; `tasks.md` ticked count lower than a usable checkpoint's reported count; `handoff.md` next command before apply (`/opsx:explore`, `/opsx:design`, `/opsx:propose`, `/opsx:review`) while at least one box is ticked. A reported decision missing from `decisions.md` is expected until Session Exit and is an UNKNOWN item, not a contradiction.
6. **Stale handoff.** Trigger (3) is an UNKNOWN item ("handoff.md predates the edits"). A superseded checkpoint is a GAPS item.
7. **Gaps** (one item per failing source, with the reason): no `checkpoint.json`; `checkpoint.json unreadable (<reason>): ignored`; leftover `checkpoint.json.tmp`; superseded checkpoint; `handoff.md` missing, unreadable or missing required sections; `decisions.md`, `tasks.md` or `review.md` missing or unreadable; git unavailable. Each source is read in its own try/catch; a failure becomes a gap and never an exception or a changed exit code.
8. **Questions for the user**, at most 3, only: changed paths that no task `Files:` covers while the handoff next command is not `/opsx:apply`; a usable checkpoint reported more ticked boxes than `tasks.md` shows; no role named (see above). A stale APPROVE is not a question. The CLI never prompts.

### Layout, tags and cap (review R5)

```
RECOVERY BRIEFING — <name> (local files and git only; read-only; canonical files unchanged)
FACTS
- <item> [source]
UNKNOWN
CONTRADICTIONS
GAPS
QUESTIONS FOR THE USER (the CLI never prompts; the conductor asks only these)
DETAILS: <paths of the sources that exist> · git log <ref>..HEAD
```

Empty sections print `- none` (the only untagged item). Every other item ends with a bracketed source: facts, unknowns, contradictions and gaps as before, QUESTIONS items carry the sources they derive from (`[git, tasks.md]`, `[tasks.md, checkpoint.json]`, `[metrics.json, handoff.md, checkpoint.json]`), omission rows end with `[DETAILS]`. Item caps: FACTS 12, UNKNOWN 7, CONTRADICTIONS 5, GAPS 5, QUESTIONS 3, so 7 fixed lines plus 32 items plus one omission line is 40. Interpolated values are made single-line (CR, LF and tabs become spaces). The name in the title is cut to 60 bytes.

Rendering is an algorithm with a guaranteed bound; all cuts use code points (never split a surrogate pair) and add `…`:

1. Fit every item to 200 characters by shortening only the text part, never the bracketed tag (tags are fixed names, at most 48 bytes).
2. If the output is over 4096 UTF-8 bytes, fit FACTS and UNKNOWN items to 120 characters.
3. If still over, drop UNKNOWN items from the end, then FACTS items from the end, into one `(<k> more omitted; see the files below) [DETAILS]` line.
4. If still over (only protected items are left), re-fit CONTRADICTIONS, GAPS and QUESTIONS items to byte budgets 400, 200, 120 and 64 per line, in this order, stopping at the first budget that fits. The text part is cut by code points until the whole line fits the budget, tag kept.

Termination and bound: each step runs once over a finite list; the last step's worst case is the 7 fixed lines (title at most about 200 B, five fixed headings about 100 B, `DETAILS:` at most 200 B) plus 13 protected items at 64 B and one 60 B omission line, about 1.4 KB, below 4096. Overflow in the protected sections keeps the first cap-1 items plus `- (<k> more omitted; see the files below) [DETAILS]`. Headings, protected items and `DETAILS:` are never dropped. Number choice: the existing restore of this change is 20 lines and 2 239 B, decisions are already capped at 10 entries; at most 40 lines and 4 096 B roughly doubles a worst-case briefing and stays near 1 000 tokens, a typical block is 15 to 25 lines.

### Compatibility

Persist (`handoff <name>`), `archive`, `status` and `gate-check` neither read nor create `checkpoint.json`; only restore (`handoff <name> --restore`) reads it, only to build the briefing. Changes without a checkpoint, and changes in a clean state, behave as before. A change that is unpersisted but has no checkpoint also gets a briefing with the GAPS item `no checkpoint.json`. The builder uses no client detection, so Cursor, Claude Code and Amp print the same text for the same files. Cloud: the files are git-tracked; the CLI never commits, so a checkpoint survives a lost VM only after the agent commits it, which the existing cloud exit already covers at Session Exit. In a fresh clone the mtime-based trigger (3) is weak and the review currency needs git history; without it the review is reported unknown, not current.

## Decision 13: review currency is a content-hash comparison with the review commit (review R3)

The first draft inferred currency from the verdict string, checkpoint digests and mtimes. A checkpoint taken after an edit holds the old verdict beside the new files, so it can bless a stale APPROVE; an unchanged verdict string cannot show a re-review; the artifact enumeration missed deletions; the mtime fallback excluded `tasks.md`. A checkpoint records when the agent saved, not what the reviewer saw, so checkpoint digests and mtimes are no longer evidence.

Algorithm (only for a verdict starting with `APPROVE`, case-insensitive; other verdicts print no currency item):

1. No git, or `review.md` untracked, listed by `git status` as modified, or without a commit: state `unknown`, reason `no git` or `review.md not committed or modified`.
2. `sha = git log -1 --format=%H -- <review.md>`. The baseline path set is the planning paths from `git ls-tree -r --name-only <sha> -- <change dir>`; the current set is the planning paths in the working tree; the compared set is the union (so a deleted artifact and an added one both count). Planning paths: `proposal.md`, `design.md`, `design-brief.md`, `tasks.md` and `specs/**/*.md` under the change directory.
3. For each path compute `sha256(text)`, with every leading `- [x]` or `- [X]` replaced by `- [ ]` for `tasks.md` only, for the baseline (`git show <sha>:./<path>`) and the working tree. A path missing on one side or with different digests is changed. Any git failure for a path in the baseline set gives `unknown` (reason `git command failed`), never `current`.
4. `stale` when at least one path changed, else `current`. Substantive `tasks.md` edits change the normalized digest; ticking boxes does not.

Results: stale is a CONTRADICTION naming up to 3 files and the short `sha`, sources `[review.md, git]`; current is FACT 11 `[review.md, git]`; unknown is an UNKNOWN item. Limit, stated in the briefing text: the baseline is the artifact state at the last commit that touched `review.md`; edits made after it are found, edits committed together with `review.md` after the review are not. Re-reviewing and committing `review.md` moves the baseline, so a re-review with an unchanged verdict string is recognised as current.

## When agents checkpoint, and where the guidance lives

After each ticked box, after each important decision, and after a `code-reviewer` verdict, with `--next` always passed. The text is one bullet in step 6 of `opsx-apply.md` and the apply skill (byte-identical twins, inserted before the Part A step 6.5 block, so the parity test of task 3.1 is not disturbed) and one clause in `opsx-quick.md` step 5. The bullet says decisions passed to `checkpoint` are kept in `checkpoint.json` and still go under `## Decisions` at Session Exit. It is not in `session-handoff.mdc`, `agent-orchestration.mdc`, `templates/AGENTS.md` or `buildNextSessionPrompt` (budgets, conflict row 5). Explore, design, propose and review get no instruction (conflict row 8); a spec-review verdict is already durable in `review.md`. Cost: one CLI call per task.

## Out of scope and next stage

Transcript reading and LLM extraction of decisions and reasons are not part of this change. They would write only through `checkpoint --decision`, so the storage and briefing built here stay valid.

## Decisions (Part B, continuing the numbering)

9. Command `checkpoint <name>` (table above).
10. Storage `openspec/changes/<name>/checkpoint.json`, temp file plus atomic rename, `contentDigest` idempotence (cleanup-only on an unchanged state), integrity `digest`, snapshot without artifact digests.
11. `checkpoint` never writes `decisions.md`; decisions accumulate verbatim in `checkpoint.json` until persist records them. No edit of the persist path.
12. The recovery briefing is deterministic, read-only, capped at 40 lines and 4 096 UTF-8 bytes with tag-preserving, code-point-safe shortening, guarded source reads, and built before the session start record.
13. Review currency is a content-hash comparison with the last commit of `review.md`; unknown without that evidence.
14. ADDED requirements only; no MODIFIED block (conflict rows 3 and 5).

## Verification contract (review R10)

- Acceptance: the full suite runs serially (`node --test --test-concurrency=1 test/*.test.js`). If the machine's resource rule forbids it, the narrowed list named in task 3.2 runs instead and Done records `tests: <p>/<t> (narrowed: <what>)`; either outcome satisfies acceptance, an unrecorded narrowing does not.
- Fixtures: the shared setup creates `tasks.md` with at least 2 ticked boxes and an unticked task with `Files:`, a `decisions.md` entry and a committed git repository; a test that needs a source absent says so explicitly (task 7.2 lists the setup per test).
- Seq and cleanup: a changed state gives `seq` plus 1 and removes a leftover temp file; an unchanged state removes it, keeps `seq`, bytes and mtime (Decision 10).
- The contradicting-sources fixture has exactly three contradictions (stale review, fewer ticked than reported, next command before apply).

## Conflicts with accepted decisions

Every resolution below is PROPOSED. The owner decides; `decisions.md` keeps its recorded text. The reviewer accepted the owner's order to extend this change as sufficient for rows 1 and 2; that does not turn any PROPOSED row into an approval.

| # | Earlier text (quote, where) | What the extension needs | Proposed resolution (PROPOSED) | Needs owner confirmation |
|---|---|---|---|---|
| 1 | `decisions.md`: "slice 1 is text-only (no CLI, no gate)". Proposal (before the edit): "text-only, with no hard gate" and Impact "No change to `bin/`". Slicing decision: "no `bin/` change". `tasks.md` header: "Do not edit `bin/`" | New CLI code in `bin/` and three new modules | PROPOSED: read the decision as scoping Part A. Part B is labelled code-bearing; "no gate" stays literally true. Edits marked `[edited, conflict row 1]`. The decision line is not rewritten | yes |
| 2 | Change name `apply-test-run-discipline`; roadmap «Кожна фаза роадмапу MUST реалізовуватись окремим OpenSpec change»; `decisions.md`: later work "goes to a separate follow-up change" | One change carries test discipline and session persistence; the letter of the roadmap rule holds (R5-lite is no factory phase), the spirit is stretched | PROPOSED: keep one change and the name (owner's order). Part B is built to be cut out. Options: (a) keep; (b) rename before apply; (c) move groups 4 to 7 and the two Part B specs into `add-session-checkpoint` | yes |
| 3 | Design Decision 8: "nothing is MODIFIED". Main spec «Restore попереджає про пропущений Session Exit» names four neutral files and says the warning "не змінює exit code і не блокує restore" | Two more neutral names (`checkpoint.json`, `checkpoint.json.tmp`) and a block after the warning | PROPOSED: ADDED only. The four-name list is not exclusive, so the added names conflict with nothing; the 0.20.1 text stays. No other change is pending, so no overwrite-on-archive risk | yes |
| 4 | 0.20.1 notes and the main requirement: the warning is advisory, "exit code and briefing unchanged" | A recovery block after the warning and guarded reads | PROPOSED: one block after the warnings, only when a warning printed; all existing lines, triggers, texts and exit codes stay for readable files; unreadable `handoff.md` or `decisions.md` degrades to a warning line instead of an abort | yes |
| 5 | `session-handoff.mdc`: "The parent writes `handoff.md`", "only the CLI writes `decisions.md`", "The parent MUST NOT guess tokens". Main requirement «Session Exit вимагає самозвіт метрик…»: `decisions.md` "лише через `## Decisions` і persist". Budgets: rule files 11 976 of 12 000 chars, `templates/AGENTS.md` 3 249 of 4 000, minimal EN prompt 1 530 of 1 536 B, `opsx-archive.md` 979 of 1 536 B | A mid-session writer and when-to-checkpoint text | PROPOSED (re-propose, R2): `checkpoint` writes only `checkpoint.json`, never `decisions.md`; persist remains the only `decisions.md` writer and is not edited; the parent still writes `handoff.md` only at Session Exit; no tokens in a checkpoint; guidance only in the apply twins and quick. No MODIFIED of the long Session Exit requirement | no (conforming) |
| 6 | Tasks 3.2 and 3.3 (full suite, budgets, Tier 1 gate); Slice 2 follow-up | New tests join verification without crossing slice 2 | PROPOSED: ids 1.1 to 3.3 kept; 3.2 and 3.3 extended; group 3 last in the file. Slice 2 untouched | no |
| 7 | Part A requirement «Test results are not a gate»: `handoff` "MUST NOT read the `tests:` line" | "Ticked box is not a passed test" in the briefing | PROPOSED: the briefing never parses `tests:`; it prints a fixed UNKNOWN sentence | no |
| 8 | `opsx-review.md` Guardrails: "May write only `review.md` and, on APPROVE, `apply-notes.md`"; 0.20.1 explore exception; propose conductor limits | The owner asked for a checkpoint after a review verdict and a decision | PROPOSED: no checkpoint instruction in explore, design, propose or review; a spec-review verdict is durable in `review.md`; "review verdict" in apply means the `code-reviewer` verdict. Disclosed limitation: no automatic checkpoints in those phases | yes |
| 9 | Part A task 3.1 and the Part A spec: the text from `6.5.` to `7.` is byte-identical in both apply twins | A new bullet in apply step 6 | PROPOSED: the bullet goes into step 6 before the 6.5 block; the compared span is untouched | no |

### Edits to existing slice-1 text (all marked `[edited ...]` in place)

1. `proposal.md` Why and Impact: Part B is code-bearing (rows 1 and 3).
2. `proposal.md` acceptance criteria 2, 6, 7 to 17: outcome table, full-or-narrowed acceptance, decisions behavior, review currency (re-propose).
3. `design.md` Slicing decision and Decision 5 (outcome table, review R1) and Decision 8 (ADDED only).
4. `tasks.md` header, BLOCK-A (outcome table), tasks 3.1 to 3.3.
5. Part A requirements of `apply-test-discipline`: the red, empty-command, resource and Done requirements now carry the outcome table (re-propose, review R1).

The `decisions.md` lines and the Part A task bodies 1.1 to 2.3 are not rewritten.

## Open points for the owner

1. Name and split (row 2): keep, rename, or cut Part B into its own change.
2. Early-return restore (row 4): the briefing is printed but the exit code stays 1. Keep 1, or make it 0?
3. Explore and review get no checkpoint text (row 8). Extend the 0.20.1 explore exception later?
4. Decisions stay in `checkpoint.json` until persist (Decision 11). A later change could add a persist-side import or a MODIFIED of the Session Exit requirement.
5. `checkpoint.json` is archived with the change. Keep, or have `archive` drop it?
6. The cap numbers 40 lines and 4 096 B.

## Risks (Part B)

- A checkpoint that the agent forgets is the failure this feature cannot remove; the briefing then degrades to tasks, git and decisions, and says so in GAPS.
- Agent-reported text (`done`, `next`, `blocked`, decisions) is not verified; the briefing labels it "reported".
- Review currency needs a committed `review.md` and git history; otherwise it is unknown, never current. Edits committed together with a later `review.md` are invisible by design.
- mtime trigger (3) is unreliable after a fresh clone; the git rules cover currency.
- A restore run twice without a persist raises the pending warning and prints the briefing twice; the cap keeps it cheap.
- A decision made in an interrupted session stays only in `checkpoint.json` until the next Session Exit records it; more than 30 unrecorded decisions block further checkpoints.
- `decisions.md` is still written non-atomically by persist (existing behavior, not changed).
- Artifact size: all artifacts together stay under the 150 000 B total and 60 000 B `tasks.md` budgets (measured in task 3.3).
