# Session Handoff

## Closed role
Spec Reviewer

## Change
- name: add-agent-hook-runtime
- status: proposed
- tasks: 0/10
- review: approve
- last_role: Spec Reviewer

## Done
- Restored canonical briefing (`handoff --restore` exit 0); Tier 1 `gate-check --review add-agent-hook-runtime` exit 0 (only main-spec length INFO notices + intentional Files advisories); pre-spawn sha256 snapshot of both change folders, openspec/specs, templates, bin.
- Spawned isolated spec-reviewer (Tier 2 re-review, prior review.md existed); report Status: done, Verdict: APPROVE; all five T2 checklist items ✓.
- N1 (the only prior Required Before Apply item) reported resolved: design.md:64-78/:82 store contract, tasks.md:5/:10-11 (tasks 1.1/1.2 with per-case fixtures), delta spec.md:66-81 scenarios, sibling add-agent-workflow-automation task 3.2 + design.md:15/:43 keep the worktree jobs lease mutually exclusive incl. null-session writers. Prior minors n1–n7 resolved except n5 (accepted design risk, design.md:122).
- Same-class rescan: no further instances (task Dos self-contained, every design behaviour has a delta requirement/scenario, no proposal↔tasks drift, referenced paths/exports exist).
- Conductor verification: sha256 diff vs snapshot shows exactly review.md (rewritten) + apply-notes.md (new, 15 lines) changed; review.md has a single `**Verdict:** APPROVE` line; tasks.md 0 checked boxes; `gate-check --review-md` exit 0; `gate-check --review` exit 0; `openspec validate add-agent-hook-runtime --strict` exit 0.

## Decisions
- Re-review verdict APPROVE: N1 resolved; change ready for apply. Two non-blocking minors carried into apply-notes.md: (1) a null-session event has no defined way to bind a changeId (`hooks bind` requires `--session`) — treat change as null unless an explicit binding resolves it, never infer by recency; (2) `ctx.storeFor` is described in task 1.1 but implemented in 1.2 — test 1.1 against a fake store, wire the real store in 1.2.

## Blocked
None.

## Next command
`/opsx:apply add-agent-hook-runtime`

## Next role
Implementer

## Attach
- openspec/changes/add-agent-hook-runtime/apply-notes.md
- openspec/changes/add-agent-hook-runtime/review.md
- openspec/changes/add-agent-hook-runtime/tasks.md
- openspec/changes/add-agent-hook-runtime/design.md
- openspec/changes/add-agent-hook-runtime/specs/
- openspec/changes/add-agent-workflow-automation/tasks.md

## Subagents to spawn
- code-writer — implement one scoped task at a time from tasks.md in order (1.1 → …), following apply-notes.md constraints
- test-writer — add or update tests per task Done-when fixtures after each implementation task

## Constraints
- Kit root is not an install: no .claude/agents at the root; spawn specialists as general-purpose with the templates/.agents/subagents body and verify reports with sha256 diff against a pre-spawn snapshot.
- Execute tasks in tasks.md order; apply-notes.md is the distilled apply input.
- This runtime change must be merged and archived before the sibling add-agent-workflow-automation apply starts.
- Known accepted design risk (former n5): session-checkpoint strict-reading vs session-handoff.mdc edit (precedent f7ee939) — documented in design, not a blocker.
- After apply: run build/lint/tests and `openspec validate add-agent-hook-runtime --strict` before declaring done.
- status: in-progress
- tasks: 0/10
- review: APPROVE

## Runtime
- runtime: local
- agent_id: none

## Prompt

```text
/opsx:apply add-agent-hook-runtime

You are the conductor for the next role session of change `add-agent-hook-runtime`.
Reply language: English (`project.agent_language: en`). Do not mix phases: the next role starts in a NEW chat after HARD STOP.

## Role
- Next role / phase subagent: `Implementer`
- Amp: spawn isolated skill `subagent-<phase-specialist>` with fresh context — the specialist body never runs in Amp's main thread.
- Cursor / Claude: spawn `.cursor/agents/<name>.md` / `.claude/agents/<name>.md`.
- The parent is conductor-only: verify the report, do not do the specialist's work.

## Start
`npx agent-orchestrator-kit handoff add-agent-hook-runtime --restore` is the canonical briefing (handoff.md, decisions.md, Attach). Read `openspec/changes/add-agent-hook-runtime/handoff.md` only if restore failed. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change = `Handoff.next_command`.

## Context (self-contained)
- Closed role: Spec Reviewer
- Change: add-agent-hook-runtime (status: proposed; tasks: 0/10; review: approve; last_role: Spec Reviewer)
- Done:
- Restored canonical briefing (`handoff --restore` exit 0); Tier 1 `gate-check --review add-agent-hook-runtime` exit 0 (only main-spec length INFO notices + intentional Files advisories); pre-spawn sha256 snapshot of both change folders, openspec/specs, templates, bin.
- Spawned isolated spec-reviewer (Tier 2 re-review, prior review.md existed); report Status: done, Verdict: APPROVE; all five T2 checklist items ✓.
- N1 (the only prior Required Before Apply item) reported resolved: design.md:64-78/:82 store contract, tasks.md:5/:10-11 (tasks 1.1/1.2 with per-case fixtures), delta spec.md:66-81 scenarios, sibling add-agent-workflow-automation task 3.2 + design.md:15/:43 keep the worktree jobs lease mutually exclusive incl. null-session writers. Prior minors n1–n7 resolved except n5 (accepted design risk, design.md:122).
- Same-class rescan: no further instances (task Dos self-contained, every design behaviour has a delta requirement/scenario, no proposal↔tasks drift, referenced paths/exports exist).
- Conductor verification: sha256 diff vs snapshot shows exactly review.md (rewritten) + apply-notes.md (new, 15 lines) changed; review.md has a single `**Verdict:** APPROVE` line; tasks.md 0 checked boxes; `gate-check --review-md` exit 0; `gate-check --review` exit 0; `openspec validate add-agent-hook-runtime --strict` exit 0.
- Blocked:
None.
- Attach:
- openspec/changes/add-agent-hook-runtime/apply-notes.md
- openspec/changes/add-agent-hook-runtime/review.md
- openspec/changes/add-agent-hook-runtime/tasks.md
- openspec/changes/add-agent-hook-runtime/design.md
- openspec/changes/add-agent-hook-runtime/specs/
- openspec/changes/add-agent-workflow-automation/tasks.md
- Subagents for this session:
- code-writer — implement one scoped task at a time from tasks.md in order (1.1 → …), following apply-notes.md constraints
- test-writer — add or update tests per task Done-when fixtures after each implementation task
- Constraints:
- Kit root is not an install: no .claude/agents at the root; spawn specialists as general-purpose with the templates/.agents/subagents body and verify reports with sha256 diff against a pre-spawn snapshot.
- Execute tasks in tasks.md order; apply-notes.md is the distilled apply input.
- This runtime change must be merged and archived before the sibling add-agent-workflow-automation apply starts.
- Known accepted design risk (former n5): session-checkpoint strict-reading vs session-handoff.mdc edit (precedent f7ee939) — documented in design, not a blocker.
- After apply: run build/lint/tests and `openspec validate add-agent-hook-runtime --strict` before declaring done.
- status: in-progress
- tasks: 0/10
- review: APPROVE
- status: spec-approved
- tasks: 0/10
- review: APPROVE

## Exit HARD STOP (you are NOT done until this succeeds)
Write `openspec/changes/add-agent-hook-runtime/handoff.md` → `npx agent-orchestrator-kit handoff add-agent-hook-runtime` (exit 0) → paste CLI stdout as one fenced block (first line `/opsx:…`, not shortened, no banner) → stop.
Full protocol: `.agents/rules/session-handoff.mdc`. OpenSpec files are the source of truth.
```
