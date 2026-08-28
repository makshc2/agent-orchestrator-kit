# Spec Review

**Change:** add-cloud-agent-handoff
**Date:** 2026-08-27
**Verdict:** APPROVE

**Tier:** 2 (LLM review). Tier 1 `gate-check --review add-cloud-agent-handoff` passed before this review; strict validation, task-contract fields, proposal sections and delta-spec section structure were not re-checked.

## Checklist summary

- Proposal ↔ design ↔ tasks consistency: ✓ (one non-blocking drift, see N1)
- Delta specs cover design behavior; nothing unbacked by the proposal: ✓
- No conflicts with existing `openspec/specs/`; MODIFIED delta applicable: ✓
- No scope creep vs Non-goals: ✓
- Task self-sufficiency (Files/Do/Done-when without design.md): ✓
- Cross-IDE parity (Cursor / Claude / Amp): ✓
- Prior-session decisions honored (`cloud-check-verdict`, `runtime-detection`, `cloud-check-not-in-persist`): ✓
- Repository references in tasks/design exist: ✓
- Vue 3 block: skipped — project stack is a Node CLI

## Verification performed

- `MODIFIED` delta header `### Requirement: Handoff file template` matches the current main spec `openspec/specs/session-handoff/spec.md` verbatim; the delta restates both existing scenarios (`Init documents the template`, `Handoff file is inside the change`) and adds two, so the replace-on-sync semantics lose nothing.
- No requirement in `openspec/specs/` currently mentions runtime, cloud, or `AOK_*`, so the new `cloud-agent-handoff` capability adds behavior without contradicting an existing one. The roadmap spec (`agentic-factory-roadmap`, scenario "Phase 3 не дозволяє артефакти поза git") is satisfied by delta requirements 2 and 3, and the roadmap parity requirement is satisfied by the CLI + markdown-only approach.
- Every path named in `tasks.md` exists: `bin/agent-orchestrator.js`, `templates/.agents/rules/session-handoff.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`, `test/smoke.test.js`, `README.md`, `CHANGELOG.md`.
- Every symbol named in tasks/design exists in `bin/agent-orchestrator.js`: `HANDOFF_SECTIONS` (line 143), `parseHandoffMarkdown` (809), `buildHandoffMarkdown` (839), `fieldsFromSections` (875), `missingHandoffFields` (897), `readHandoffFields` (1157), `log.ok/warn/err` (157–163), the `handoff [change-name]` command (2615) and the `archive` final-handoff block (2408–2427). `CLOUD_ENV_MARKERS`, `resolveRuntime`, `resolveAgentId`, `--runtime`, `--agent-id`, `--cloud-check` are new, as the tasks state.
- Cross-IDE parity is real, not asserted: the handoff section list and Session Exit protocol exist in exactly three source files (`templates/.agents/rules/session-handoff.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`) — all three are in task 3.1. No `templates/.agents/commands/opsx-*.md` duplicates the protocol, and `.cursor/`, `.claude/`, and the Amp `subagent-session-handoff` wrapper are generated from those sources by `init`/`update`/`sync`.
- Prior-session decisions are encoded as testable requirements: differentiated verdict in `cloud-agent-handoff` requirement 2 (four scenarios covering cloud-dirty, cloud-unpushed, cloud-clean, local-dirty); detection priority in requirement 1 and task 1.2; cloud-check as a branch outside persist in requirement 2 vs requirement 3 (persist only prints steps to stderr) and tasks 2.1/2.2.

## Findings

No blocking findings.

### Non-blocking notes

**N1 — `proposal.md` states a shorter detection chain than design/specs/tasks.**
`proposal.md` "What Changes" says `--runtime` → `AOK_RUNTIME` → env markers → `local` and `--agent-id` → `AOK_AGENT_ID` → `none`, omitting the "existing `## Runtime` section of `handoff.md`" step that `design.md` D1, `decisions.md` (`runtime-detection`), the delta requirement, and task 1.2 all include. The authoritative chain is unambiguous in the three places that drive implementation, so this is documentation drift, not an implementation risk. Same omission appears in the proposal's first acceptance criterion.

**N2 — Scenario `Дефолт local без прапорця, env і маркерів` under-specifies its GIVEN.**
In `specs/cloud-agent-handoff/spec.md`, the scenario asserts `runtime: local` given no flag, env, or marker, but the requirement's own chain would return `cloud` if the existing `handoff.md` already carried `runtime: cloud`. The requirement text is correct and wins; the scenario should read as "and `handoff.md` has no existing Runtime value". Task 4.1(a) tests the default on a fresh file, so this does not mislead the implementer — worth tightening the next time this spec is edited.

**N3 — `HANDOFF_SECTIONS` is currently an unused constant.**
It has no reader anywhere in the repo; `buildHandoffMarkdown` renders the section list literally. Task 1.1 correctly requires both edits, so the Done-when is achievable, but the implementer should not expect adding `'Runtime'` to the constant to change any output. `design.md` Context ("Секції файлу зафіксовані константою `HANDOFF_SECTIONS`") is slightly inaccurate on this point.

**N4 — Task 1.3 says "наявний файл" for archive, but archive renames the change directory first.**
`archive` performs `renameSync(changeRoot, targetDir)` before building the final handoff fields, so `openspec/changes/<name>/handoff.md` no longer exists at that moment; the previous runtime value, if it is to be honored, must be read from the archive target directory. The task's Done-when (final handoff contains a valid `## Runtime`) is satisfiable either way because the chain falls back to env/markers/`local`, so this is a precision note, not a gap.

**N5 — `log.err` / `log.warn` / `log.ok` write to stdout.**
Task 2.1 asks for cloud-check findings through those helpers (fine — that branch has no stdout contract), while task 2.2 requires the persist cloud block on stderr with stdout left as the pure prompt. An implementer who reuses `log.*` in persist would break the stdout contract asserted by task 2.2's Done-when. Recorded in `apply-notes.md`.

**N6 — The kit's own dogfood copy `.agents/rules/session-handoff.mdc` stays out of scope.**
It is already stale relative to `templates/.agents/rules/session-handoff.mdc` (Phase 2 updated templates only), so leaving it untouched matches the existing repository convention rather than introducing new drift.

**Ready for implementation.** Run `/opsx:apply add-cloud-agent-handoff`.
