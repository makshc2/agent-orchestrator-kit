# Spec Review

**Change:** propose-review-pregate
**Date:** 2026-09-25
**Verdict:** APPROVE

Tier 1: `npx agent-orchestrator-kit gate-check --review propose-review-pregate` → exit 0 (`{"pass": true, "errors": []}`).

## Checklist

**Consistency**
- ✓ proposal ↔ design ↔ tasks tell the same story. Every behaviour in proposal What Changes, AC1–AC8 and design A1–A8, B1–B3, C1–C3 and D1–D5 maps to a task (1.1–3.2). No task edits a file that proposal Impact leaves out. The drift that remains is in wording and rationale only (Minor F1, F2, F3, F7, F17, F28) and does not change what the tasks produce.
- ✓ Delta specs cover all changed and added behaviour described in design. Mapping:
  - A1–A3 and A7 → tiered-review ADDED R1.
  - A8 → tiered-review ADDED R2.
  - A5 → pipeline-subagents MODIFIED «openspec-guide…».
  - A6 → MODIFIED «Conductor must delegate…».
  - C3 → MODIFIED «Повторний propose…».
  - B1, B2 and B2a → task-contract ADDED R1.
  - C1 and C2 → task-contract ADDED R2.
  - D1, D3 and D4 → task-contract ADDED R3.

**Main specs**
- ✓ No conflicts with existing `openspec/specs/` requirements.
  - The 3 MODIFIED blocks, diffed against `openspec/specs/pipeline-subagents/spec.md` (7–27, 108–127, 129–154), change only the lines named in design A5, A6 and C3.
  - The ADDED requirements keep «Скриптовий Tier 1 перед LLM-review», «Метрика discovery loops не більше двох» and «Next command після REQUEST CHANGES є propose».
  - Some scenario and spec wording is loose (Minor F6, F4, F19). F5 and F16 are pre-existing and were not reintroduced; see Notes.

**Scope**
- ✓ No scope creep against proposal Non-goals.
  - No task touches `bin/`, `package.json`, `profiles/`, `opsx-review.md`, `spec-reviewer.md`, `opsx-quick.md`, the Tier 1 regex or the `Spec review discovery loops: ≤ 2 (...)` line. Task 3.2's guard enforces this.
  - The one mismatch is the Non-goal wording about `/opsx:quick` (Minor F1). The quick-visible changes are deliberate and disclosed in proposal:10, B2a, decisions.md and the task-contract delta.
  - See the Out-of-brief scope assessment below.

**Task self-sufficiency**
- ✓ A blind implementer can execute each task from Files/Do/Done-when alone.
  - Independent check: I applied all 13 tasks literally in a scratch clone of HEAD 44a20e5, pasting the blocks verbatim with the 2-space indent stripped. Every anchor matched exactly once.
  - Every Done-when passed after apply: 1.1 → 4/–/1/1/BLANK-OK/0; 1.2 → both diffs empty; 1.3 → 2; 1.4 → 2/1/BEFORE-OK+AFTER-OK; 2.1 → RULES-OK; 3.1 → `# pass 4` / `# fail 0`.
  - `npm test` gave 217/217. The 3.2 guard exited 0. `openspec validate --all --strict` gave 19/19.
  - Some Done-when checks are weaker than their Do (Minor F11 cluster, F9, F10, F21). The Do text is exact, so the implementer never has to guess.

**Vue 3** — N/A (`project.stack` is not `vue3`; `openspec/config.yaml` declares no vue3 stack).

## Findings

### Blocker

none

### Major

none

### Minor

- **F6 — The ADDED Blocked scenario says the guide always routes to propose. In the plan-amendment state the guide routes to apply.**
  - Evidence: `specs/tiered-review/spec.md:17-24`. The GIVEN has no condition on `review.md`, and line 24 says «`openspec-guide` … теж називає next command `/opsx:propose <name>`». But the MODIFIED guide requirement at `specs/pipeline-subagents/spec.md:52-53` maps `Verdict: APPROVE` + open `- [ ]` → `/opsx:apply`. The apply escape valve (`spec.md:11`, `templates/.agents/commands/opsx-apply.md:18`) re-proposes while an APPROVE `review.md` exists, and the P3 pre-gate is unconditional, so that session can close `## Blocked`.
  - Impact: the archived scenario is false in a flow the main specs require. The requirement body at `:5` is correctly scoped. Apply is unaffected.
  - Fix: add «AND `review.md` відсутній або містить `Verdict: REQUEST CHANGES`» to the GIVEN.
- **F1 — The Non-goals say `/opsx:quick` behaviour does not change, but quick output does change.**
  - Evidence: `proposal.md:44` («поведінка quick не змінюється») and `design.md:24` contradict `proposal.md:10`, B2a (`design.md:76`), `specs/task-contract/spec.md:5,10,27-28` and tasks A1/A3 (`tasks.md:57,67`). Under these, quick spawns now need `## Non-goals` / `## Acceptance criteria` and write `**Gate:** not run (/opsx:quick)`. The guide's no-`review.md` routing now also reaches quick changes (`design.md:131`).
  - Impact: the stated scope contradicts itself. The behaviour is deliberate and consistently specified elsewhere, so the implementer is not misled.
  - Fix: narrow the Non-goal to «`opsx-quick.md` is not edited; quick gets no Tier 1 self-check or conductor pre-gate», then list the quick-visible effects.
- **F2 — Design and AC8 say smoke asserts both guide branches. Only the failure branch is asserted.**
  - Evidence: `design.md:47` («smoke асертить обидві гілки») and `proposal.md:59`. T1 (`tasks.md:222-224`) and the 1.8 Done-when (`tasks.md:103`) never check `exit 0 → \`/opsx:review <name>\``, and never check «quote the gate-check errors».
  - Impact: nothing guards the success branch of a MODIFIED scenario (`specs/pipeline-subagents/spec.md:62-67`) against regression. G1 is copied verbatim, so the result is correct today.
  - Fix: add `assert.match(guide, /exit 0 → \`\/opsx:review <name>\`/)` to T1 and `'exit 0 →'` to the 1.8 phrase loop, or reword design.md:47 and AC8.
- **C1 — A blocked `spec-architect` is not handled by the new pre-gate flow.**
  - Evidence: A3 (`tasks.md:67`) says «fix every error it reports» with no exception. `spec-architect.md:26` says «Stop as blocked … instead of inventing it». P3 (`tasks.md:22,27`) says «verifies `Status: done` … then runs» and gives no branch for `Status: blocked`. `specs/tiered-review/spec.md:5-24` covers only the done path.
  - Impact: the gap is partly pre-existing (`opsx-propose.md:108`). But the new mandatory re-spawn and the "fix every error" wording can spend the single re-spawn on gate errors, or push the architect to fill in an open product decision. The resulting `## Blocked` then names gate errors, not the decision.
  - Fix: in P3, S2 and tiered-review R1, say that on `Status: blocked` the conductor does not re-spawn for gate errors and closes `## Blocked` naming the architect's blocker. In A3, add «unless you stop as blocked per Rules».
- **C2 — The scope of the gate-error re-spawn during a Tier 2 re-propose is not stated.**
  - Evidence: MODIFIED `specs/pipeline-subagents/spec.md:28` and `opsx-propose.md:38` require every spawn in an RC re-propose to carry `review.md` and to check that the report closes each Required Before Apply item. P1/P3 (`tasks.md:10,27`) and tiered-review `:5` describe the re-spawn only as «with the full list of gate-check errors (targeted fix)».
  - Impact: both rules can be met by including both. But conductors may diverge: either they send gate errors only, which strains the MUST, or they send `review.md`, and the architect re-runs step 5 in full.
  - Fix: add one sentence to P3/S2: «the gate-check re-spawn is structure-only; in a re-propose include the `review.md` path for context; the Required Before Apply coverage check applies to the first report».
- **F3 — The B2a safety rationale is wrong.**
  - Evidence: `design.md:76` calls a misclassification toward propose «безпечна (зайвий read-only self-check)». A3 (`tasks.md:67`) makes that spawn fix every gate error. A quick change without deltas fails `openspec validate --strict` (`bin/agent-orchestrator.js:3273-3281`), so the architect would add delta specs, which `specs/task-contract/spec.md:10` forbids.
  - Impact: the rationale only; the risk is low because `opsx-quick.md:39` passes the quick-mode scope.
  - Fix: correct the sentence, or have the propose step-2 spawn prompt name `/opsx:propose` explicitly.
- **F4 — Some wording in the delta specs is tied to this change or to a moment in time, and will become permanent main-spec text.**
  - Evidence:
    - `specs/task-contract/spec.md:90` and `:120-125` pin a warning to «`CHANGELOG.md` `[Unreleased]`», which moves under a version heading at the next release.
    - `:79` «як до цього change» has no fixed baseline after archive.
    - `:90` «тепер».
    - `specs/tiered-review/spec.md:5,38,57` and `specs/task-contract/spec.md:10,53` add «… не змінюється» freezes. This is the same class of wording that C3 (`design.md:97`) removes.
  - Impact: spec hygiene only. Similar wording already exists in main specs (e.g. `design-intake/spec.md:55`, main `pipeline-subagents/spec.md:135`).
  - Fix: prefer timeless invariants: «the release notes», a concrete expected lint result, and «`/opsx:review` MUST still run Tier 1».
- **F19 — The volatile-version scenario fixes the increment at «+ 0.001».**
  - Evidence: `specs/task-contract/spec.md:64-66` has a generic GIVEN and a specific THEN. The rule itself (`:46`, `design.md:86`, `tasks.md:62`) says «current value plus a rule».
  - Impact: after archive, a semver bump described as «current minor + 1» would literally violate the scenario.
  - Fix: «поточне значення плюс правило інкременту (напр. + 0.001 для `v: 'X.YYY'`)».
- **F18 — The volatile-value rule sits under a «Done-when quality» label, but the spec also binds `Do:`.**
  - Evidence: P2/A2 (`tasks.md:15,62`) versus `specs/task-contract/spec.md:46` («`Do:` і `Done-when:` MUST NOT хардкодити»).
  - Impact: a literal reader may still hardcode the value in `Do:`.
  - Fix: «In `Do:` and `Done-when:`, do not hardcode volatile repo values …». The anchor phrase is unchanged.
- **F27 — The YAML warning understates the multi-colon case.**
  - Evidence: R1 (`tasks.md:162`), the 2.1 Do (`tasks.md:114`), `design.md:111` and `specs/task-contract/spec.md:88` say an unquoted `: ` drops that artifact's list. I reproduced with OpenSpec 1.4.1: an unquoted item with more than one `: ` (e.g. `- Task contract: Files: a, Do: b`) gives `YAMLParseError: Nested mappings are not allowed in compact mappings`, and the whole config is lost, including the proposal rules.
  - Impact: the README that ships to consumers understates the failure. The quoting advice and the 2.1 Done-when are still correct.
  - Fix: «…drops that artifact's rules, or makes the whole config unparseable when the item has more than one `: `».
- **F17 — The design says the guide and CI already run Tier 1.**
  - Evidence: `design.md:3,44,47,129`. Guide step 5 runs `gate-check <name>`, the review gate (`openspec-guide.md:22`). CI runs `gate-check --base` (`templates/.github/workflows/agent-verify.yml:51`, `templates/.gitlab/agent-verify.yml:20`). No template runs `--review`.
  - Impact: rationale only. Tasks 1.8 and T1 specify `--review` correctly.
  - Fix: reword design.md:3 and :44.
- **F7 — The Migration Plan overstates what `update` + `sync` deliver.**
  - Evidence: `design.md:138` says consumers get all of A. The AGENTS.md and CLAUDE.md edits (tasks 1.5 and 1.6) are not in `KIT_MANAGED_PATHS` (`bin/agent-orchestrator.js:38-44`) and are copied only by `init`, which skips existing files unless `--force` is set (`:3866-3872`).
  - Impact: rollout description only. The behaviour ships through kit-managed files, and the old AGENTS.md line is stale but still true.
  - Fix: state this in Migration Plan step 2, and optionally in CHANGELOG C.
- **F28 — «OpenSpec does not load vue3/mvp rules» is overbroad.**
  - Evidence: `decisions.md:12`, `handoff.md:21`, `design.md:111,133`. Only lists that contain an unquoted `: ` item are dropped: vue3 proposal, tasks and specs; mvp proposal and tasks. vue3 `design` and mvp `specs` load today.
  - Impact: this could mis-scope the follow-up change. Apply is unaffected.
  - Fix: name the lists that are dropped.
- **F8 — The A4 report-contract line shows only the propose form.**
  - Evidence: `spec-architect.md:28` («Return exactly this report contract») plus A4 (`tasks.md:72`), while A3 (`tasks.md:67`) prescribes `not run (/opsx:quick)`. Other contract lines list their alternatives with `|`.
  - Fix: `**Gate:** gate-check --review exit <code> | not run (/opsx:quick)`. The 1.3 count of 2 and the T1 regexes still hold.
- **F11 / F20 / F22 / F23 / F24 — Several Done-when checks test presence, not replacement or placement.**
  - Evidence:
    - 1.1/1.2 (`tasks.md:6,48`): the old step 6, the unconditional Prompt, What's ready and the old Session Exit sentence can stay next to the new blocks and still pass (reproduced by helpers).
    - 1.3/1.4 (`tasks.md:53,78`): A4 outside the fence, the gate line outside the ```bash block, or a checklist item without `- [ ]` still pass.
    - 1.7 (`tasks.md:98`): the old bullet is a prefix of the new one.
    - 2.2 (`tasks.md:150`): the check scans the whole Role 2 section.
    - 2.1 (`tasks.md:115`): RULES-OK greps the whole JSON, not only `rules`.
  - Impact: the Do text is exact everywhere, so a careful implementer is unaffected. But the central behaviour (no unconditional `/opsx:review` handoff) has no absence guard.
  - Fix, optional:
    - absence checks, e.g. `grep -c -F 'All artifacts created and validated!'` = 0;
    - fence-scoped awk checks;
    - `grep -c -x -F -e '- \`/opsx:propose\` → потім \`status\`, \`validate\`'` = 0 (note the `-e`: the helper-suggested pattern without it fails as an option).
- **F9 — Task 3.2's Done-when already holds on the untouched tree, and its guard misses untracked and staged files.**
  - Evidence: `tasks.md:289`. At HEAD, `npm test` is 213/213 green and the guard exits 0, which contradicts `handoff.md:11` («усі Done-when падають»). `git diff --quiet` does not see an untracked `profiles/node/openspec-config.yaml.example` or a staged `bin/` edit.
  - Fix: `git status --porcelain -- <same paths>` prints nothing. Say explicitly that 3.2 is a regression gate backed by 3.1.
- **F10 — Task 3.2's `Files:` lists only `test/smoke.test.js`, but its Do allows fixes in any file of tasks 1.1–3.1.**
  - Evidence: `tasks.md:287-288`. `opsx-apply.md:149` scopes edits to `Files:`.
  - Fix: add «and, only to fix a failing test, the files of tasks 1.1–3.1».
- **F21 — The 1.2 Done-when needs 1.1 to be done.**
  - Evidence: `tasks.md:48` diffs the skill against `opsx-propose.md`. That breaks «independently verifiable» (`spec-architect.md:13`), and the apply routing table allows parallel writers for tasks with disjoint Files (`agent-orchestration/SKILL.md:59`).
  - Fix: add «Run after 1.1» to 1.2.
- **F25 (cosmetic) — P5's «`handoff.md` has `## Blocked`» is always true.**
  - Evidence: `tasks.md:37`. Every handoff has a Blocked section (`bin/agent-orchestrator.js:1363,1398`). P3 and P6 in the same file state the required content.
  - Fix: «…and `## Blocked` in `handoff.md` lists the remaining gate-check errors».

## Out-of-brief scope assessment

| Item | Verdict | Reason |
|------|---------|--------|
| `openspec-guide.md` routing (task 1.8 + MODIFIED «openspec-guide маршрутизує…») | **Justified — necessary** | After a `## Blocked` propose the change has `proposal.md` and no `review.md`. Current guide line 18 and main `pipeline-subagents/spec.md:132` would send that state to `/opsx:review`, which contradicts the new Blocked next command and brings back the wasted T1-RC session. The rewrite also replaces the stale «рядок 18/19» anchors (APPROVE→apply is now line 20). The rationale «guide already reproduces Tier 1» is inaccurate (F17), but the necessity stands without it. Scenario scope nit: F6. |
| `openspec-howto/SKILL.md` (task 1.7) | **Justified — low value, not creep** | A one-line doc-consistency edit. Otherwise line 105 would list the exit commands of propose without the new mandatory gate. |
| README Role 2 **Exit gate:** (task 2.2(2)) | **Justified — necessary** | Required by tiered-review ADDED R2 (`specs/tiered-review/spec.md:48`). README:340-343 would otherwise misstate the Architect exit gate. |
| MODIFIED «Conductor must delegate specialist work» | **Justified — necessary** | Main `pipeline-subagents/spec.md:21` «MAY лише прогнати validate» directly forbids the pre-gate and the re-spawn. The added `status` only codifies what template step 6 already does. The diff shows only the scenario line changed and one AND line was added. |
| MODIFIED «Повторний propose … повний punch list» | **Justified — necessary** | After archive, the literal «спека `task-contract` не змінюється» would contradict this change's own task-contract ADDED requirements. Only the final sentence changed (diff-verified). |
| MODIFIED «openspec-guide маршрутизує REQUEST CHANGES на propose» | **Justified — necessary** | Follows from the guide edit above. Only the no-`review.md` bullet and the line-number sentence changed, plus one AND line and one new scenario. The RC→propose and APPROVE→apply branches are verbatim. |
| `templates/openspec-config.yaml.example` | **In brief (D)** | A new file. No `profiles/` file is rewritten, and vue3/mvp keep their own files. |
| `init --force --profile node|generic` overwrites `openspec/config.yaml` | **Justified — unavoidable side effect, documented** | Comes from the existing `installOpenspecConfigExample` force branch (`bin/agent-orchestrator.js:3431-3458`) once the fallback file exists. Avoiding it would need a `bin/` change, which is a Non-goal. It matches vue3/mvp and is disclosed in R1, CHANGELOG C and `specs/task-contract/spec.md:90`. `update` never calls it (init-only call at `:3896`). Side note: `init --profile node|generic` now also creates `openspec/` on a fresh project, as vue3/mvp already do. |

## Notes

- **Verification.** Tier 1 exit 0 at review time. The full literal apply simulation is described under Task self-sufficiency. Helper lenses confirmed that every Done-when except 3.2 fails on the current tree.
- **Rejected helper findings:**
  - **F5 (guide maps every RC `review.md` to propose).** The conflict with tiered-review's review-side Blocked (`/opsx:review`) and with the post-re-propose state is pre-existing. MODIFIED must copy the RC bullet verbatim, and the change neither adds nor worsens it. Recommended as a separate follow-up: «stale RC `review.md` after a rejected T2 file or a finished re-propose».
  - **F16 («MAY лише» list omits Session Exit).** The same wording is pre-existing in main `:21`. The natural reading limits it to post-report artifact actions, and the templates already pair «may only» with a canonical Session Exit.
  - **F26.** «його асертить smoke» can refer to step 5, and step 5 is asserted through `Required Before Apply` (`test/smoke.test.js:665`). Task 1.3's Done-when keeps `**Source:** gate-check`.
  - **F29.** `[Unreleased]` is empty and this is the only active change, so there is nothing to order.
  - **F12–F15.** I agree with the refuters: coverage is either not required by any spec or AC, or is already secured by Done-when or the unchanged `bin/`.
- The Minor fixes are optional. They can go into a short re-propose before apply, or into follow-ups. None of them changes what apply produces.

## Previous findings

none — first review cycle
