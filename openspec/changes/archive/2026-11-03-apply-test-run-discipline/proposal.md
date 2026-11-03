## Why

`/opsx:apply` never tells the implementer to run the project's tests: the shipped apply command and skill mention build/lint only, and `verifier.test_command` is read by nothing but the `test-writer` subagent. Archived handoffs rarely record a test result, so a change can be declared done with an unknown test state. Part A of this change is slice 1 of R5-lite from `docs/improvement-plan-2026-10-01.md`: the smallest coherent unit, text-only, with no hard gate. Part B (below) is a code-bearing addition ordered by the owner on the same change. [edited: conflict rows 1 and 2 in design.md]

Part B problem: in v0.20.1 `handoff --restore` detects an unpersisted or stale session and prints `UNPERSISTED SESSION`, but restores no state. When the agent skips Session Exit or the session breaks off, the decisions and progress made since the last `handoff.md` are lost. Git history and the artifacts hold hints, but nothing assembles them, and nothing saves state in the middle of a session.

## What Changes

Part A (text-only, unchanged scope):

- `/opsx:apply` (command and skill twin) runs `verifier.test_command` once, after the last pending task is implemented and before its box is ticked. One outcome table fixes the last box, the Done `tests:` form and `## Blocked` for every case: green and narrowed-green tick; an empty command is skipped with a warning and ticks; a red run stops with the box unticked and `tests: red (see Blocked)`; a pre-existing failure waits for the user and, when accepted, ticks with `tests: N-1/N (accepted by user: <name>)` and leaves `## Blocked` empty; nothing runnable leaves the box unticked; a session that pauses earlier writes `tests: not run (paused: <k> tasks pending)`. [edited, review R1]
- The Session Exit Done section carries the `tests:` line. `/opsx:quick` inherits it.
- `spec-architect`, `/opsx:propose`, the propose skill and the config example gain a text guideline: for `fix-*` changes the first implementation task is a regression test that fails before the fix. No lint is added.
- README Role 4 exit gate mentions the test command.

Part B (new CLI code, no transcript reading, no LLM):

- New command `checkpoint [change-name]` (chosen over a `handoff` flag, see design.md) saves progress, blockers, next step and decisions to the git-tracked `openspec/changes/<name>/checkpoint.json` (temp file plus atomic rename, integrity digest, idempotent, each call a complete snapshot). It never closes the session, starts a phase, or writes `handoff.md`, `decisions.md`, Memory JSON or `metrics.json`. Decisions stay verbatim in `checkpoint.json` until Session Exit lists them under `## Decisions` and persist records them, so the existing exclusive `decisions.md` write path is untouched (design Decision 11, review R2). [edited]
- `handoff --restore` prints a compact deterministic recovery briefing (at most 40 lines and 4096 UTF-8 bytes, tag-preserving) after an `UNPERSISTED SESSION` warning. It is built from the checkpoint, `handoff.md`, `decisions.md`, `tasks.md`, `review.md` and git, and separates facts, unknowns, contradictions, gaps and questions, each with its source. A superseded checkpoint feeds only its reported decisions. Review currency is a content-hash comparison with the last commit that touched `review.md`, else unknown. Unreadable `handoff.md` or `decisions.md` no longer aborts restore. [edited, review R3 to R8]
- Command and skill text tells the implementer when to checkpoint (apply, quick). Always-apply rules and `templates/AGENTS.md` are not touched.
- New capability `session-checkpoint`; ADDED requirements in `session-handoff` for the recovery briefing; one ADDED requirement in `task-contract`; new capability `apply-test-discipline`. No existing requirement is modified.

## Capabilities

### New Capabilities
- `apply-test-discipline`: the apply test step, its outcome table (skip, red, accepted, narrowed, not run, paused), the `tests:` Done line, and the explicit absence of a hard gate.
- `session-checkpoint`: the `checkpoint` command, decisions kept in `checkpoint.json`, complete-snapshot semantics, idempotence, atomic write, corruption handling, metrics neutrality, storage, input bounds and the agent guidance rule.

### Modified Capabilities
- `task-contract`: one ADDED requirement (fix changes start with a failing regression test). No existing requirement is modified.
- `session-handoff`: nine ADDED requirements for the recovery briefing printed by restore (sources and tags, superseded checkpoints, review currency, no inference, gaps and unreadable sources, questions, byte-bounded compactness, read-only). No existing requirement, including «Restore попереджає про пропущений Session Exit» and the Session Exit `## Metrics` requirement, is modified.

## Impact

- Templates (Part A and Part B guidance): `templates/.agents/commands/opsx-apply.md`, `templates/.agents/skills/openspec-apply-change/SKILL.md`, `templates/.agents/commands/opsx-quick.md`, `templates/.agents/subagents/spec-architect.md`, `templates/.agents/commands/opsx-propose.md`, `templates/.agents/skills/openspec-propose/SKILL.md`, `templates/openspec-config.yaml.example`, `README.md`.
- Part B code: `bin/agent-orchestrator.js` (new `checkpoint` command, guarded restore reads, restore wiring, neutral file list; persist code is not edited) and three new modules `bin/session-checkpoint.js`, `bin/recovery-sources.js`, `bin/session-recovery.js`. [edited: Part A still changes nothing in `bin/`]
- Tests: `test/apply-test-run-discipline.test.js` (Part A) and new `test/session-checkpoint.test.js`, `test/restore-recovery-briefing.test.js`, `test/checkpoint-guidance.test.js`.
- No change to `templates/AGENTS.md`, always-apply rule files, `.agents/rules/ask-before-heavy-ops.mdc`, CI, or the `buildNextSessionPrompt` text. `metrics.json` code paths are untouched: restore still records the session start exactly as before, and `checkpoint` never touches the file.
- Slice 2 (follow-up, a separate change): recorded-capture fixtures, a kit-CI branch-coverage threshold, and the advisory `gate-check --apply <name>`. Part B adds no requirement to `orchestrator-cli-controls` or `kit-ci-verify`, so slice 2 is not affected.

## Conflicts and open points

`design.md` section "Conflicts with accepted decisions" lists every place where Part B contradicts or stretches an accepted decision (text-only slice 1, change purpose and name, "no MODIFIED blocks", advisory restore, parent-writes rules and the exclusive `decisions.md` write path, size budgets, tasks 3.2 and 3.3, the `tests:` line rule, review and explore guardrails). Each row has a PROPOSED resolution; the owner decides, and PROPOSED is not approval. `decisions.md` is not rewritten.

## Non-goals

- A hard gate on test results: no archive Gate 4, no dependence of `handoff`, `archive` or any `gate-check` mode on test output or on `metrics.json`.
- A regex lint of Done-when, or any new `gate-check --tasks` / `--review` rule.
- Inferring a test command (`auto = npm test`), or editing `verifier.test_command` in existing installs.
- Removing or rewording the owner-local `.agents/rules/ask-before-heavy-ops.mdc`; growing always-apply rule files or `templates/AGENTS.md`.
- Slice 2 scope (fixtures, coverage threshold, `gate-check --apply`), release prep, CHANGELOG, version bump.
- Part B: reading a chat transcript, or extracting decisions with an LLM (a possible later stage).
- Part B: a new pipeline role or phase, a new archive or `gate-check` gate, or any hard gate on checkpoints.
- Part B: metrics accounting by `checkpoint`, or any write to `metrics.json` by it.
- Part B: writing `decisions.md` from `checkpoint`, or any edit of the persist path (`appendDecisionsFromHandoff`, `parseDecisionItems`), including an atomic `decisions.md` write.
- Part B: starting the next phase from `checkpoint` or from the recovery briefing; the briefing is advice, the conductor decides.
- Part B: writing recovered facts or guesses into `handoff.md`, `decisions.md` or any canonical file during restore.
- Part B: checkpoint instructions in explore, design, propose and review commands (see conflict row 8), and review-currency evidence from checkpoints or mtimes.

## Acceptance criteria

1. The apply command and the apply skill both contain the same test-step wording: read `verifier.test_command`, run once before the last box is ticked, red run stops, empty command is skipped with a warning, narrow run when resources are limited.
2. Both name the Done line `tests: <passed>/<total>` and the forms for skipped (box ticked), narrowed, red (box unticked, `tests: red (see Blocked)`), user-accepted (box ticked, `## Blocked` empty), not-run (box unticked) and paused (`tests: not run (paused: <k> tasks pending)`), matching the outcome table in design.md Decision 5.
3. The literal archive line count in each apply twin and the pinned green-apply sentence are unchanged, so the existing template tests stay green.
4. `spec-architect.md`, `opsx-propose.md`, the propose skill and `templates/openspec-config.yaml.example` carry the fix-change guideline; `gate-check --tasks` and `--review` behave exactly as before.
5. `npx openspec validate apply-test-run-discipline --strict --type change` and `gate-check --review apply-test-run-discipline` exit 0; the always-apply rule size test and the `templates/AGENTS.md` size test stay green.
6. The full suite passes serially including all new test files, or, when the machine's resource rule forbids the full run, the narrowed list of task 3.2 passes and the narrowing is recorded in Done.
7. Normal checkpoint: after a finished task, an important decision and a review verdict, `checkpoint <name>` exits 0, writes a valid `checkpoint.json` (progress, blocker, next step, decisions, task, review and handoff-digest snapshot), prints no next-session prompt, and leaves `handoff.md`, `decisions.md`, Memory JSON and `metrics.json` untouched. Input beyond the bounds (500 characters, one line, 10 decisions per call, canonical role, task id like `2.1`, reserved `none`) exits 1 and writes nothing.
8. Complete snapshot and no-op: an omitted `--done`, `--blocked`, `--next`, `--task` or `--role` clears the old value; an unchanged state prints `checkpoint unchanged (seq n)`, keeps bytes, mtime and `seq`, and removes a leftover `.tmp`; a changed state adds 1 to `seq` and also removes it. Decisions accumulate across calls, are dropped once `decisions.md` holds them, and persist after a checkpoint adds exactly one entry.
9. Interrupted session: restore after a session without Session Exit prints the existing lines, then `UNPERSISTED SESSION`, then a `RECOVERY BRIEFING` with checkpoint facts and sources; exit code unchanged.
10. Stale handoff: a `handoff.md` older than the artifacts is reported as stale in UNKNOWN; a checkpoint whose handoff digest differs from the current `handoff.md` is superseded and feeds only its reported decisions.
11. Missing checkpoint: the briefing is built from the other sources and GAPS says `no checkpoint.json`.
12. Corrupt or torn checkpoint: a truncated, edited or leftover-`.tmp` state never changes the last valid checkpoint (a rename that fails leaves it byte-identical and exits 1), is reported in GAPS with a reason, and the next checkpoint replaces a corrupt file.
13. Contradicting sources: stale APPROVE, fewer ticked boxes than a usable checkpoint reported, and a next command that precedes apply while boxes are ticked each appear under CONTRADICTIONS with both sources; a reported decision absent from `decisions.md` is an UNKNOWN item; a changed file is never reported as a finished task, a ticked box never as a passed test.
14. Review currency: an APPROVE is current only when planning artifacts (union of old and new paths, `tasks.md` with checkbox marks normalized) have the same content hashes as at the last commit of `review.md`; a checkpoint after an edit does not make it current, a re-review commit does, deleted artifacts and task edits make it stale, and no git or an uncommitted `review.md` gives unknown.
15. Git paths and unreadable sources: untracked-directory files, non-ASCII or escaped names and renames match task `Files:` entries through NUL-delimited status output; a directory in place of `handoff.md` or `decisions.md` degrades to a warning and a GAPS item without aborting restore.
16. No double metrics accounting: `metrics.json` is byte-identical across `checkpoint` calls, restore records one `pending` as before, and one persist after checkpoints adds exactly one session. Old changes behave as before: `handoff` persist, `archive`, `status` and `gate-check` neither read nor create `checkpoint.json`; a change in a clean state gets byte-identical restore output.
17. Compactness: the briefing never exceeds 40 lines, 4096 UTF-8 bytes or 200 characters per line, even for multibyte text and long paths, keeps every item's bracketed source (omission rows end with `[DETAILS]`), and keeps headings, protected sections and the `DETAILS:` line when trimmed.
18. Verification: tasks 3.2 and 3.3 run the full suite (or the recorded narrowed list), the size budgets, `openspec validate --strict` and the Tier 1 gate.
