## Why

The Session Start / Session Exit protocol and the phase routing table are written by hand in several places: `templates/.agents/rules/session-handoff.mdc` and `agent-orchestration.mdc` are canonical, and `templates/.agents/skills/agent-orchestration/SKILL.md` repeats them in three separate passages (Conductor Routing, Session Rules, "Mandatory Memory and Handoff Protocol"). The copies already drifted: the skill's Session Exit step 3 lacks the sentence that an Amp **mode** (`low`, `medium`, `high`, `ultra`) is never a `--model`, and its Session Start step 2 lacks "Restore also locks the session client". Nothing catches the next drift. For Claude Code and Amp the skill is the only detailed carrier of the protocol (only `.cursor/rules` receives the `.mdc` files), so the copies cannot simply be deleted.

Other instruction texts say things the data contradicts or that the code no longer does:

- `templates/.agents/subagents/code-reviewer.md` says "ALWAYS use during /opsx:apply" and starts without checking that a diff exists; both recorded Code Reviewer runs in the dedup window had no diff.
- `templates/.agents/commands/opsx-quick.md` guardrail "Max ~3 hours of work" is an unmeasurable rule (its apply is already parent-driven, so the plan's other quick findings are already fixed).
- `agent-orchestration/SKILL.md` anti-pattern "All tasks in one apply session | Context overload" and `README.md` "One session = 1–3 tasks" contradict the data: 8 of 8 recorded apply sessions finished 7–28 tasks in one session without rework, and the rule would turn them into about 40 sessions.
- `README.md` and the skill name Amp modes `rush`/`smart`/`deep`; the modes the kit and `session-handoff.mdc` use are `low`/`medium`/`high`/`ultra`.
- `opsx-propose.md` / `openspec-propose/SKILL.md` carry the artifact build steps (`openspec new change`, `status --json`, `instructions`) in the command, while the specialist that executes them (`spec-architect.md`) lacks them; `opsx-design.md` does the same for `design-intake.md`.

Source: item 6 (R9-lite) of `docs/improvement-plan-2026-10-01.md`, re-verified against HEAD. Already satisfied and therefore out of scope: parent-driven apply and no mandatory implementation spawns in `/opsx:quick`, the `## Metrics` removal, apply step 6.5 (0.21.0), and the `.mdc` files already carry the Amp-mode and "locks the session client" sentences.

## What Changes

- **A. Generated mirror blocks in the skill.** A new module `bin/instruction-mirrors.js` rewrites three marker-delimited blocks in `agent-orchestration/SKILL.md` from the canonical rules: `session-start` and `session-exit` from `session-handoff.mdc`, `routing` (conductor paragraph plus table) from `agent-orchestration.mdc`. It runs in `init`, `update` and `sync`. The hand-written duplicates in the skill (Conductor Routing paragraph and table, Session Rules start/end steps, the two paragraphs of "Mandatory Memory and Handoff Protocol") are replaced by the blocks plus one short paragraph that keeps the statements the two rule sections do not contain and the main specs require the skill to carry: session artifacts only in git-tracked paths, and the Closed role rule (a sentence after `—` is allowed, metrics stores the canonical token). The `.mdc` files and the copies in `subagents/session-handoff.md` and `spec-archiver.md` are not edited.
- **B. Drift smoke test.** A new test fails when any block in the kit templates differs from its source, and proves the generator is idempotent and is applied by `init` and `sync`.
- **C. Specialists own their steps.** The artifact build loop moves from `opsx-propose.md` and `openspec-propose/SKILL.md` into `spec-architect.md`; the source ladder, capture, brief template and confidence markers move from `opsx-design.md` into `design-intake.md`, and the `design-intake` main spec (which places them in the command) is updated to point at the specialist. The commands keep a one-line pointer. The quick branch and `**Gate:** not run (/opsx:quick)` in `spec-architect.md` stay.
- **D. `code-reviewer`.** The trigger becomes "on request or before a PR/MR" (the negative trigger stays), step 1 requires a non-empty source diff (`git diff HEAD --stat`, the commits against the target branch, untracked files) or returns `Status: blocked` "no implementation diff", and the input is `apply-notes.md` plus `tasks.md` instead of proposal, design and all specs. The description keeps its `Do NOT use for` clause; the `pipeline-subagents` routing requirement is reworded so that fallback and optional agents (`session-handoff`, `spec-archiver`, `code-reviewer`) may use a plain `Use ...` trigger.
- **E. Contradicting rules removed.** `opsx-quick.md` loses the 3-hour guardrail; the skill anti-pattern row and the README "1–3 tasks" sentence are removed; `rush`/`smart`/`deep` become `low`/`medium`/`high`/`ultra` in the skill and README, with review on the same level as propose.
- **F. Spec text.** `session-handoff` requirement «Спільні Session Start/Exit блоки живуть в одному rule» allows the generated skill mirror; new capability `instruction-mirrors`; `pipeline-subagents` gains requirements for specialist-owned steps, the `code-reviewer` trigger and the quick time-box, and its requirement "Exclusive routing table in always-apply and commands" is modified for fallback and optional agents; `design-intake` requirements «Команда design-intake у шаблонах» and «Структура design brief» are modified so that the source ladder and the brief structure live in `design-intake.md`.

## Capabilities

### New Capabilities
- `instruction-mirrors`: generated mirror blocks in the skill, their regeneration in `init`/`update`/`sync`, the drift test, and the rule that instruction texts do not contradict recorded data.

### Modified Capabilities
- `session-handoff`: the canonical Session Start/Exit text stays in `session-handoff.mdc`; generated byte-identical mirrors in the skill are allowed.
- `pipeline-subagents`: specialist-owned build steps, `code-reviewer` trigger and precondition, no time-box in `/opsx:quick`, trigger wording for fallback and optional agents.
- `design-intake`: the source ladder, the capture rules and the brief structure are documented in the specialist `design-intake.md`, not in the command.

## Impact

- Code: new `bin/instruction-mirrors.js`; three call sites in `bin/agent-orchestrator.js` (`init`, `update`, `sync`) with a warning that names `update` as the remedy when a skill has no mirror markers or a rule lacks the source section. `scripts/sync-local-agent-skills.sh` only copies files and does not regenerate blocks; the README says so.
- Templates: `agent-orchestration/SKILL.md`, `openspec-propose/SKILL.md`, `spec-architect.md`, `design-intake.md`, `code-reviewer.md`, `opsx-propose.md`, `opsx-design.md`, `opsx-quick.md`; `README.md`.
- Tests: new `test/instruction-mirrors.test.js` and `test/instruction-text-consistency.test.js`; five existing assertions whose pins counted lines or phrases of the hand-written skill copies are updated: in `fix-next-session-prompt.test.js` the `Done, Decisions, Blocked` match (scoped to the skill text outside the mirror blocks, because the generated session-exit block copies `session-handoff.mdc` line "Closed role, Change, Done, Decisions, Blocked, ..."), the `no separate Memory MCP read step` count and the numbered Session Start step count, and in `archive-from-terminal.test.js` the two green-apply phrases. The SKILL pins in `smoke.test.js` and `remove-metrics-self-report.test.js` stay unchanged and must still pass.
- Always-on budget: no `.mdc` file is edited, so the Cursor always-on total stays at the current value (11,792 characters at proposal time, test limit 12,000).
- After an upstream `openspec update` reinstalls the full `openspec-*` skills, the `openspec-propose/SKILL.md` edit applies only after the next kit `sync`/`update`.

## Non-goals

- Generating or removing the copies in `subagents/session-handoff.md` and `spec-archiver.md` (the `pipeline-subagents` and `session-handoff` specs require them, and their persist steps are written in the subagent's voice). Follow-up: `instruction-mirror-subagents`.
- `memory-mcp-autosetup.mdc` to `alwaysApply: false`: the main spec `session-checkpoint` forbids editing always-apply rule files outside its own change, and the budget has no pressure (see Impact). Follow-up: `always-on-rules-budget`.
- `@`-including the two `.mdc` files in `CLAUDE.md` (+7.5 KB in every Claude turn is a product decision to be measured separately). Follow-up: `claude-md-protocol-include`.
- Moving `openspec-howto` and `spec-workflow-openspec` to `docs/` and the `skills.kit` list changes. Follow-up: `skills-kit-docs-move`.
- Turning `openspec-explore` or `openspec-archive-change` into pointers, deleting any mirror copy, and removing `Sessions: 4–8` from the skill.
- Changing `opsx-review.md` (its Tier 2 checklist stays) or `session-handoff.mdc` / `agent-orchestration.mdc` text.
- Claiming an effect on review-cycle counts (post-fix n=1).

## Acceptance criteria

- `syncInstructionMirrors` run on `templates/` is a no-op: the three blocks in `agent-orchestration/SKILL.md` are byte-identical to the sections of `session-handoff.mdc` and `agent-orchestration.mdc` they are generated from.
- Editing a source section in a temporary project and running `sync` rewrites the block; running it twice changes nothing the second time; a skill without markers is left untouched.
- The skill's Session Exit mirror contains the sentences about an Amp mode and "locks the session client"; the skill text outside the mirror blocks still contains the sentences "Write session artifacts only to git-tracked paths (never `/tmp`, never gitignored caches)" and "Closed role MAY have a sentence after `—`; metrics stores the canonical token".
- `spec-architect.md` contains the `openspec instructions` build loop, the quick branch and `**Gate:** not run (/opsx:quick)`; `opsx-propose.md` and `openspec-propose/SKILL.md` contain no `openspec instructions` command and no "Delegate steps 3–5"; their Thin conductor paragraphs stay byte-identical.
- `design-intake.md` contains the source ladder, the `design-brief.md` template and confidence markers; `opsx-design.md` no longer contains them; the delta `specs/design-intake/spec.md` modifies the two requirements that placed them in the command.
- `code-reviewer.md` description says "on request or before a PR/MR", step 1 runs `git diff HEAD --stat` and names the empty-diff `Status: blocked`, and the input is `apply-notes.md`; the `pipeline-subagents` delta says how the positive-trigger requirement is read for fallback and optional agents.
- No template or README contains "Max ~3 hours", "1–3 tasks", "All tasks in one apply session" or an Amp-mode `rush`/`smart`/`deep` hint; the pinned strings of the SKILL files are still present.
- `npm test` and `node bin/agent-orchestrator.js gate-check --review instruction-mirror-consistency` exit 0 (at the kit root the `node bin/...` form runs HEAD; `npx agent-orchestrator-kit` would run the published package).
