# Session Handoff

## Closed role
Implementer — apply tasks 1.1–3.3 (parent conductor; isolated `code-writer` as implementer; isolated `code-reviewer` after verify)

## Change
- name: exhaustive-review-findings
- status: apply complete; 7/7 tasks; code-reviewer Ready for MR
- tasks: 7/7
- review: APPROVE
- last_role: implementer

## Done
Honored `/opsx:apply exhaustive-review-findings`. `npx agent-orchestrator-kit status` — one active change, review APPROVE, 0/7. `npx agent-orchestrator-kit handoff exhaustive-review-findings --restore` exit 0; Memory JSON empty/missing, `handoff.md` + `decisions.md` used as brief; no `session-handoff` restore spawn. Review gate satisfied (`**Verdict:** APPROVE` in `review.md`). `.cursor/agents/implementer.md` is not in this repo; spawned isolated `code-writer` as implementer with tasks 1.1–3.3 + `apply-notes.md`. Specialist reported done and did not mark `tasks.md`. Parent verified every Done-when `rg` (all four 1.1 anchors, Verdict+`/opsx:propose` one-line, recovery trio, T1 keep phrases, 1.2 four phrases + first-cycle + apply-notes + tasks.md ban, 2.1 conductor/architect/T1-marker/`Done-when` kept, 2.2 two branches + single APPROVE→apply + empty `says APPROVE` + old rule gone, 3.1 colon/no-colon metric + anti-pattern, 3.2 new test after vue3 with required asserts and no new `gate-check`/`findings.length`, 3.3 Unreleased Changed). Parent then marked 1.1–3.3 `[x]`. Verify: `node --test test/smoke.test.js` 153/153 (ok 35 vue3 kept, ok 36 punch-list); `npx agent-orchestrator-kit gate-check --tasks exhaustive-review-findings` pass; `npx openspec validate exhaustive-review-findings --strict --type change` valid. Spawned isolated `code-reviewer` on the implementation diff (not `spec-reviewer`): Spec compliance Compliant; Verdict Ready for MR. No edits to `bin/`, `src/`, main specs, generated `.agents/`, `package.json` version, `review.md`, or `apply-notes.md`.

## Decisions
- Apply executed via isolated `code-writer` (no `implementer.md` in this repo); parent verified Done-when and is the only writer of `tasks.md` checkboxes (7/7).
- Templates-only implementation plus `test/smoke.test.js` (one new test after the vue3 test) and `CHANGELOG.md` `## [Unreleased]`; `package.json` version left at 0.14.0.
- Post-apply `code-reviewer` verdict: Compliant / Ready for MR; no required follow-up edits.

## Blocked
none

## Next command
`/opsx:archive exhaustive-review-findings`

## Next role
Archiver (`npx agent-orchestrator-kit archive exhaustive-review-findings`; no phase subagent)

## Attach
- `openspec/changes/exhaustive-review-findings/tasks.md`
- `openspec/changes/exhaustive-review-findings/apply-notes.md`
- `openspec/changes/exhaustive-review-findings/review.md`
- `openspec/changes/exhaustive-review-findings/proposal.md`
- `templates/.agents/commands/opsx-review.md`
- `templates/.agents/subagents/spec-reviewer.md`
- `templates/.agents/commands/opsx-propose.md`
- `templates/.agents/skills/openspec-propose/SKILL.md`
- `templates/.agents/subagents/spec-architect.md`
- `templates/.agents/subagents/openspec-guide.md`
- `templates/.agents/skills/agent-orchestration/SKILL.md`
- `templates/AGENTS.md`
- `test/smoke.test.js`
- `CHANGELOG.md`

## Subagents to spawn
- none — archive is a CLI call (`npx agent-orchestrator-kit archive exhaustive-review-findings`); do not spawn `spec-archiver` unless the CLI is unavailable

## Constraints
- One active change. Do not mix archive with apply or a new propose.
- Do not start archive in the closed apply chat; new chat only.
- Do not rewrite `review.md` or `apply-notes.md`.
- Archive merges delta specs into `openspec/specs/`; do not hand-edit main specs before archive.
- Implementation already landed in `templates/.agents/**`, `templates/AGENTS.md`, `test/smoke.test.js`, `CHANGELOG.md` `[Unreleased]`.
- Archived `openspec/changes/archive/**/metrics.json` churn from session restore is unrelated to this change’s code.

## Runtime
- runtime: local
- agent_id: none

## Metrics
- platform: cursor
- model: cursor-grok-4.6-xhigh-fast
- input_tokens: unknown
- output_tokens: unknown
- cost_usd: unknown
- amp_credits: unknown
- spend_source: unreported

## Prompt

```text
/opsx:archive exhaustive-review-findings

You are the conductor for the next role session of change `exhaustive-review-findings`.
Reply language: English (`project.agent_language: en`).
Do not mix phases. Do not start the following role in this chat until this phase is closed via HARD STOP.

## Who you are and what to do
- This session command: `/opsx:archive exhaustive-review-findings`
- Next role / phase subagent: `spec-archiver`
- Amp: spawn isolated skill `subagent-spec-archiver` with fresh context. Running the specialist body in Amp's main thread is a protocol violation.
- Cursor / Claude: spawn `.cursor/agents/spec-archiver.md` / `.claude/agents/spec-archiver.md`.
- The parent session is conductor-only: verify the report, do not do the specialist's work.

## Mandatory start (before any specialist work)
1. Honor the pasted `/opsx:archive exhaustive-review-findings` command and announce the role.
2. `npx agent-orchestrator-kit status`
3. `npx agent-orchestrator-kit handoff exhaustive-review-findings --restore`
4. Read Memory MCP: `Change:exhaustive-review-findings`, `Handoff:exhaustive-review-findings`, `Decision:*`.
5. If Memory is empty or MCP is down, read `openspec/changes/exhaustive-review-findings/handoff.md`. Missing Memory does not block the session when the file exists.
6. Spawn `session-handoff` in restore mode if the briefing is incomplete (Amp: isolated `subagent-session-handoff`).
7. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change means `Handoff.next_command`.

## Full previous-session context (self-contained — do not rely on Memory alone)
- Closed role: Implementer — apply tasks 1.1–3.3 (parent conductor; isolated `code-writer` as implementer; isolated `code-reviewer` after verify)
- Change: - name: exhaustive-review-findings
- status: apply complete; 7/7 tasks; code-reviewer Ready for MR
- tasks: 7/7
- review: APPROVE
- last_role: implementer
- Done:
Honored `/opsx:apply exhaustive-review-findings`. `npx agent-orchestrator-kit status` — one active change, review APPROVE, 0/7. `npx agent-orchestrator-kit handoff exhaustive-review-findings --restore` exit 0; Memory JSON empty/missing, `handoff.md` + `decisions.md` used as brief; no `session-handoff` restore spawn. Review gate satisfied (`**Verdict:** APPROVE` in `review.md`). `.cursor/agents/implementer.md` is not in this repo; spawned isolated `code-writer` as implementer with tasks 1.1–3.3 + `apply-notes.md`. Specialist reported done and did not mark `tasks.md`. Parent verified every Done-when `rg` (all four 1.1 anchors, Verdict+`/opsx:propose` one-line, recovery trio, T1 keep phrases, 1.2 four phrases + first-cycle + apply-notes + tasks.md ban, 2.1 conductor/architect/T1-marker/`Done-when` kept, 2.2 two branches + single APPROVE→apply + empty `says APPROVE` + old rule gone, 3.1 colon/no-colon metric + anti-pattern, 3.2 new test after vue3 with required asserts and no new `gate-check`/`findings.length`, 3.3 Unreleased Changed). Parent then marked 1.1–3.3 `[x]`. Verify: `node --test test/smoke.test.js` 153/153 (ok 35 vue3 kept, ok 36 punch-list); `npx agent-orchestrator-kit gate-check --tasks exhaustive-review-findings` pass; `npx openspec validate exhaustive-review-findings --strict --type change` valid. Spawned isolated `code-reviewer` on the implementation diff (not `spec-reviewer`): Spec compliance Compliant; Verdict Ready for MR. No edits to `bin/`, `src/`, main specs, generated `.agents/`, `package.json` version, `review.md`, or `apply-notes.md`.
- Decisions:
- Apply executed via isolated `code-writer` (no `implementer.md` in this repo); parent verified Done-when and is the only writer of `tasks.md` checkboxes (7/7).
- Templates-only implementation plus `test/smoke.test.js` (one new test after the vue3 test) and `CHANGELOG.md` `## [Unreleased]`; `package.json` version left at 0.14.0.
- Post-apply `code-reviewer` verdict: Compliant / Ready for MR; no required follow-up edits.
- Blocked:
none
- Attach:
- `openspec/changes/exhaustive-review-findings/tasks.md`
- `openspec/changes/exhaustive-review-findings/apply-notes.md`
- `openspec/changes/exhaustive-review-findings/review.md`
- `openspec/changes/exhaustive-review-findings/proposal.md`
- `templates/.agents/commands/opsx-review.md`
- `templates/.agents/subagents/spec-reviewer.md`
- `templates/.agents/commands/opsx-propose.md`
- `templates/.agents/skills/openspec-propose/SKILL.md`
- `templates/.agents/subagents/spec-architect.md`
- `templates/.agents/subagents/openspec-guide.md`
- `templates/.agents/skills/agent-orchestration/SKILL.md`
- `templates/AGENTS.md`
- `test/smoke.test.js`
- `CHANGELOG.md`
- Subagents for this session:
- none — archive is a CLI call (`npx agent-orchestrator-kit archive exhaustive-review-findings`); do not spawn `spec-archiver` unless the CLI is unavailable
- Constraints:
- One active change. Do not mix archive with apply or a new propose.
- Do not start archive in the closed apply chat; new chat only.
- Do not rewrite `review.md` or `apply-notes.md`.
- Archive merges delta specs into `openspec/specs/`; do not hand-edit main specs before archive.
- Implementation already landed in `templates/.agents/**`, `templates/AGENTS.md`, `test/smoke.test.js`, `CHANGELOG.md` `[Unreleased]`.
- Archived `openspec/changes/archive/**/metrics.json` churn from session restore is unrelated to this change’s code.
- status: spec-approved
- tasks: 7/7
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn is unavailable, persist yourself — never skip.
2. Write `openspec/changes/exhaustive-review-findings/handoff.md` with every template section.
3. `npx agent-orchestrator-kit handoff exhaustive-review-findings` — exit 0 is required. The CLI upserts Memory JSON with an absolute path and prints the expanded prompt on stdout.
4. If Memory MCP tools work, also update `Change:exhaustive-review-findings`, `Handoff:exhaustive-review-findings`, `Decision:*` to match the file.
5. Paste CLI stdout into chat as one fenced block. Do not shorten it. No service banner. First line is `/opsx:…`.
6. Stop. The next role starts in a NEW chat with that prompt.

OpenSpec files are the source of truth for requirements and tasks. Memory and handoff.md index the phase. This prompt is the next thread's full operating brief even if Amp ignores Memory MCP.
```
