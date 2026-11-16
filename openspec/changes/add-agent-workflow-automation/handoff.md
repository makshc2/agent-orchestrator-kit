# Session Handoff

## Closed role
Architect — proposal complete, ready for spec review

## Change
- name: add-agent-workflow-automation
- status: proposed
- tasks: 0/11
- review: pending
- last_role: Architect

## Done
- Created proposal, design, two delta specs and eleven implementation tasks.
- Strict change validation and conductor-run Tier 1 review gate passed; all four planning artifacts are complete.
- Scoped test evidence and freshness, optional completion and phase/scope enforcement, bounded checks, owned-file synchronization and local notifications.
- Aligned policy registration, dispatch, scoped store and capability handling with add-agent-hook-runtime.

## Decisions
- Dependency: apply only after add-agent-hook-runtime has been merged and archived; review the shared contract with that proposal.
- Verification: bind command results to relevant working-tree inputs and execution stability; checkbox and handoff progress alone do not invalidate test evidence.
- Enforcement: explicit opt-in, bounded follow-ups and cancellation handling; preserve the default nonblocking test-discipline behavior.
- Sync: use explicit ownership for automated update/sync; preserve foreign files and existing legacy sync behavior.
- Delivery scope: reuse existing opt-in CI archive; no automatic approvals, task completion, commits, npm publishing or fleet updates.

## Blocked
none — planning is complete; runtime merge/archive is an apply prerequisite

## Next command
`/opsx:review add-agent-workflow-automation`

## Next role
Spec Reviewer

## Attach
- openspec/changes/add-agent-workflow-automation/proposal.md
- openspec/changes/add-agent-workflow-automation/design.md
- openspec/changes/add-agent-workflow-automation/tasks.md
- openspec/changes/add-agent-workflow-automation/specs/
- openspec/changes/add-agent-hook-runtime/design.md

## Subagents to spawn
- spec-reviewer — independent semantic review after the Tier 1 gate passes

## Constraints
- Planning only; implementation tasks remain unchecked.
- Runtime dependency must be merged and archived before applying this change.
- Existing unrelated main-spec length INFO notices do not originate in this change; no artifact-budget warnings.

## Runtime
- runtime: local
- agent_id: none

## Prompt

```text
/opsx:review add-agent-workflow-automation

You are the conductor for the next role session of change `add-agent-workflow-automation`.
Reply language: English (`project.agent_language: en`). Do not mix phases: the next role starts in a NEW chat after HARD STOP.

## Role
- Next role / phase subagent: `spec-reviewer`
- Amp: spawn isolated skill `subagent-spec-reviewer` with fresh context — the specialist body never runs in Amp's main thread.
- Cursor / Claude: spawn `.cursor/agents/spec-reviewer.md` / `.claude/agents/spec-reviewer.md`.
- The parent is conductor-only: verify the report, do not do the specialist's work.

## Start
`npx agent-orchestrator-kit handoff add-agent-workflow-automation --restore` is the canonical briefing (handoff.md, decisions.md, Attach). Read `openspec/changes/add-agent-workflow-automation/handoff.md` only if restore failed. Only then spawn the phase specialist. Free-form "continue" / "next" with one active change = `Handoff.next_command`.

## Context (self-contained)
- Closed role: Architect — proposal complete, ready for spec review
- Change: add-agent-workflow-automation (status: proposed; tasks: 0/11; review: pending; last_role: Architect)
- Done:
- Created proposal, design, two delta specs and eleven implementation tasks.
- Strict change validation and conductor-run Tier 1 review gate passed; all four planning artifacts are complete.
- Scoped test evidence and freshness, optional completion and phase/scope enforcement, bounded checks, owned-file synchronization and local notifications.
- Aligned policy registration, dispatch, scoped store and capability handling with add-agent-hook-runtime.
- Blocked:
none — planning is complete; runtime merge/archive is an apply prerequisite
- Attach:
- openspec/changes/add-agent-workflow-automation/proposal.md
- openspec/changes/add-agent-workflow-automation/design.md
- openspec/changes/add-agent-workflow-automation/tasks.md
- openspec/changes/add-agent-workflow-automation/specs/
- openspec/changes/add-agent-hook-runtime/design.md
- Subagents for this session:
- spec-reviewer — independent semantic review after the Tier 1 gate passes
- Constraints:
- Planning only; implementation tasks remain unchecked.
- Runtime dependency must be merged and archived before applying this change.
- Existing unrelated main-spec length INFO notices do not originate in this change; no artifact-budget warnings.
- status: in-progress
- tasks: 0/11

## Exit HARD STOP (you are NOT done until this succeeds)
Write `openspec/changes/add-agent-workflow-automation/handoff.md` → `npx agent-orchestrator-kit handoff add-agent-workflow-automation` (exit 0) → paste CLI stdout as one fenced block (first line `/opsx:…`, not shortened, no banner) → stop.
Full protocol: `.agents/rules/session-handoff.mdc`. OpenSpec files are the source of truth.
```
