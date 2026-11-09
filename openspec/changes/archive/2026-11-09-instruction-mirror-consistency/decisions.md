# Decisions — instruction-mirror-consistency

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-11-09 Slice 1 of R9-lite only; follow-ups named in proposal Non-goals: instruction-mirror-subagents, always-on-rules-budget, claude-md-protocol-include, skills-kit-docs-move.
- 2026-11-09 Dropped as already done at HEAD: opsx-quick parent-driven apply, ## Metrics removal, apply step 6.5, Amp-mode and restore-locks-client sentences in the .mdc files.
- 2026-11-09 No .mdc file is edited by this change (Cursor always-on total 11,792 of 12,000).
- 2026-11-09 instruction-mirror-consistency review cycle 1: REQUEST CHANGES (3 Blocker, 3 Major); the design-intake conflict needs the Architect's pick between a MODIFIED delta for design-intake and keeping the ladder/template in opsx-design.md.
- 2026-11-09 instruction-mirror-consistency re-propose (cycle 1 fixes): design-intake conflict resolved with option A — new MODIFIED delta `specs/design-intake/spec.md` ("Команда design-intake у шаблонах", "Структура design brief"), ladder and brief template move to `design-intake.md`; design D7.
- 2026-11-09 instruction-mirror-consistency re-propose: the two statements the skill must keep ("git-tracked paths only, never /tmp"; "Closed role MAY have a sentence after —; metrics stores the canonical token") stay in the 1.2(d) skill paragraph and are pinned outside the generated mirror blocks; task 1.4 edits five assertions across two test files and task 4.3 allows exactly those five.
- 2026-11-09 instruction-mirror-consistency re-propose: pipeline-subagents routing requirement is read so that fallback/optional agents (`session-handoff`, `spec-archiver`, `code-reviewer`) may use a plain `Use ...` trigger with a condition instead of `ALWAYS use for`/`Use proactively`; code-reviewer precondition is `git diff HEAD --stat` plus branch commits plus untracked files.
- 2026-11-09 instruction-mirror-consistency review cycle 2: APPROVE (0 Blocker, 0 Major, 5 cosmetic Minor); literal scratch apply 479 → 488 tests green; `apply-notes.md` (14 lines) is the distilled input for apply.
- 2026-11-09 instruction-mirror-consistency apply: `Capture details:` renders the former `### 3.`–`### 6.` titles as bold inline labels — heading style was free per apply-notes; bold labels avoid a second-level heading inside a subagent body.
