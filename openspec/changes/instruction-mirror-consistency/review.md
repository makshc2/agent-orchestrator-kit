# Spec Review

**Change:** instruction-mirror-consistency
**Date:** 2026-11-09
**Review cycle:** 2

Verdict: APPROVE

Method: Tier 1 passed (exit 0). Tier 2 read the full change directory (proposal, design, tasks, decisions, four delta specs), the full main specs `session-handoff`-relevant requirements, `pipeline-subagents`, `design-intake`, and the requirements of `cloud-agent-handoff`, `tiered-review`, `task-contract`, `session-checkpoint` that mention the edited files. The tasks were applied literally (Files/Do/Done-when only) in a scratch clone: at HEAD the suite is 479/479; after tasks 1.1-4.2 it is 488/488 (479 + four mirror tests + five consistency tests); every Done-when command printed the stated output; `openspec validate --strict`, `gate-check --tasks` and `gate-check --review` exit 0 in the clone; no `.mdc` file and no file under `openspec/specs/` changed; `always-apply rules stay within a context budget` passes (rules total unchanged, 13,468 bytes on disk, Cursor always-on 11,792 of 12,000). A legacy project (skill without markers) prints `mirror blocks skipped ... run update` on `sync`, `update` reinstalls the markers, and the next `sync` is quiet.

## Checklist

- ✓ proposal ↔ design ↔ tasks tell the same story: five assertions in proposal Impact (proposal.md:37 area), design D4 and tasks 1.4/4.3 agree; the two kept sentences agree across proposal acceptance, design D4/D9, tasks 1.2(d)/4.2(5); `node bin/...` form agrees in proposal acceptance and task 4.3.
- ✓ Delta specs cover all changed/added behavior described in design (mirrors, regeneration, drift test, specialist-owned steps, design-intake move, code-reviewer probes, quick time-box, routing exception, data-contradicting rules).
- ✓ No conflicts with existing `openspec/specs/` requirements: `design-intake` is modified by its own delta (WHEN/THEN now point at `design-intake.md`, matches the moved text); `cloud-agent-handoff:77` and `session-handoff` "Handoff file template" are still satisfied by the kept paragraph; the routing requirement is read for fallback/optional agents by the MODIFIED delta, and the three descriptions satisfy its scenario.
- ✓ No scope creep vs proposal Non-goals: no `.mdc`, `opsx-review.md`, `subagents/session-handoff.md` or `spec-archiver.md` edit; no extra bullet in `opsx-quick.md`.
- ✓ Task self-sufficiency: all 12 tasks were executable from Files/Do/Done-when alone, with no design.md lookup and no guessing beyond cosmetics (Minor 1-2).

## Findings

### Blocker

none

### Major

none

### Minor

1. Task 2.3 says the four sections are "copied" into `Capture details:` but does not say how to render their `### N.` titles; the scratch run kept them as plain title lines. Cosmetic, Done-when does not depend on it.
2. Design D4/D9 list the hand-written text dropped on purpose but omit two small lines that the 1.2(d) replacement also drops: "Amp spawns any needed subagent as an isolated `subagent-*` skill" (the mirror still says "Amp: isolated `subagent-session-handoff`", the wrapper preamble is generated) and "Do not emit a thin 'read Memory' stub" (the rule's "Self-contained" wording covers it). No main spec or test requires either; mention only.
3. The loop paragraph in `spec-architect.md` is labelled `(first propose)`; a `/opsx:quick` spawn is not named explicitly. The quick conductor never had build steps in its own file, so this is not a regression.
4. The 1.2(d) paragraph also keeps the `--model`, Memory-MCP and `decisions.md` sentences, which the session-handoff delta does not list next to the two named sentences; consistent, just broader than the delta wording.
5. Task 2.2 Done-when lists three `grep -c` commands without a file argument (it says "for both files"); read in context, they are unambiguous.

## Required Before Apply

none

## Previous findings

Cycle 1 Required Before Apply items:

1. resolved: Task 1.4 now edits `doesNotMatch(skill, /Done, Decisions, Blocked/)` via `skillOutsideMirrors` and the two count assertions (tasks.md:20), design D4 lists five assertions, proposal Impact lists five, and task 4.3 allows exactly those five (tasks.md:66). Verified in the clone: the suite is 488/488.
2. resolved: task 1.2(d) keeps both sentences in one paragraph (tasks.md:10), pins them with `awk | grep -cF` in Done-when (tasks.md:11) and test 4.2(5) (tasks.md:61); design D4 and the Risks line no longer claim an unchanged protocol (design.md D4, Risks). Clone check: each sentence appears once outside the blocks.
3. resolved: new `specs/design-intake/spec.md:1-30` MODIFIES "Команда design-intake у шаблонах" and "Структура design brief" with all scenarios kept, WHEN/THEN pointing at `design-intake.md`, descriptions 333 and 395 characters; the moved text exists in `design-intake.md` after task 2.3.
4. resolved: re-scan of tasks 2.1-4.1 against `openspec/specs/**`, `test/**`, README and templates found no further removed-but-required text. Sub-items: 4a routing exception in `specs/pipeline-subagents/spec.md` (MODIFIED "Exclusive routing table ..."), 4b `git diff HEAD --stat` plus branch and untracked probes (tasks.md:49 and the "Staged changes count as a diff" scenario), 4c `node bin/agent-orchestrator.js gate-check` in tasks.md:66 and proposal acceptance.

Cycle 1 Minor items: 1 resolved (`instruction` field and the blocked branch in tasks.md:27); 2 resolved (KIT_ROOT pointer, tasks.md:20); 3 resolved (README anchor `### Sync to local IDEs` and explicit assertions, tasks.md:61); 4 resolved (README sentence says CLI only, warning names `update`, tasks.md:15 and :61); 5 resolved (no extra bullet in tasks.md:44); 6 resolved (design D10 records the mapping).

Open risks weighed (all non-blocking notes):

- (a) README review `high`/`ultra` (tasks.md:57): a recorded product choice (design D10, plan item asks for review on propose's level) that raises the allowed review cost versus today's `smart`; downgrading reviewers stays plan item R11. Note.
- (b) Legacy project prints the warning on every `sync` until `update`: verified, the warning names `update` and is quiet afterwards. Note.
- (c) `git ls-files --others` in the code-reviewer probe: already in proposal What Changes D and the delta requirement ("list untracked source files"), so it is not scope creep. Note.
