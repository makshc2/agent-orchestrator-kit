## Why

Tech-skill rules and recovery context still depend on agents remembering to read them. A local hook runtime can deliver context to the conductor and subagents, preserve observed progress, and expose unsupported platform behavior without adding another orchestration pipeline.

## What Changes

- Add an opt-in local event dispatcher with versioned platform adapters, capability reporting, bounded execution, deduplication, and worktree-isolated storage.
- Resolve stack skills from configuration, role, task files, and newly accessed files; deliver full applicable content where supported and report `read`, `injected`, or `missing` accurately.
- Provide metrics-neutral session/resume briefings and compaction recovery plus technical snapshots separate from semantic checkpoints.
- Install/remove only kit-owned hooks; preserve existing Git, spend, and user hooks. Add local audit/health and diagnostic notifications.
- Publish a small extension contract for the separately planned `add-agent-workflow-automation`. This first change is independently useful; the second may be planned now but may only be applied after this change is merged and archived.

## Capabilities

### New Capabilities

- `agent-hook-runtime`: opt-in adapters, normalized events, extension API, lifecycle context, skill delivery, technical recovery, and bounded local diagnostics.

### Modified Capabilities

- `pipeline-subagents`: accept verified full-content delivery instead of duplicate reads and audit its provenance while retaining manual-read fallback; both apply twins carry one byte-identical parent skill-delivery block.
- `agentic-factory-roadmap`: define two sequential local hook follow-ons, distinct from the deferred external platform phase.

## Impact

New local modules under `bin/hooks/`, managed launcher/plugin templates, additive configuration for all profiles, and CLI hook setup/status commands. Source prompts and their generated mirrors require synchronized updates. Existing checkpoint, handoff, metrics, Git hooks, archive, and verification semantics remain compatible. No new network service or runtime npm download is required.

## Non-goals

Test execution/evidence, completion or phase/scope enforcement, formatters, `update --sync`, archive automation changes, workflow outcome notifications, and rollout metrics belong to the second proposal. Neither change grants approvals, ticks tasks, invents decisions, commits, publishes, or updates the twelve managed projects automatically. External runtimes, dashboards, RBAC, Docker sandboxes, and a second orchestration loop remain out of scope.

## Acceptance criteria

- Disabled consumers retain existing behavior; repeated enable/disable preserves foreign hooks and installed spend/Git integrations.
- Claude, Cursor, and Amp adapters report version-tested capabilities, including cloud and subagent limitations, with explicit manual fallbacks.
- Main-agent and subagent fixtures resolve Vue skills and installed generic/Node equivalents; missing files never block. Receipts distinguish full content delivered, successful reads, and unavailable paths.
- Repeated start/resume/compaction events neither reset metrics nor erase checkpoint decisions, `done`, or `next`; isolated technical snapshots survive interruption.
- Duplicate, concurrent, malformed, oversized, and timed-out events preserve valid state and never block in observe mode. Context/health operates locally without per-tool LLM calls or package downloads.
- Contract, adapter, profile-installation, recovery, and instruction-generation tests pass alongside the existing suite and strict OpenSpec validation.
