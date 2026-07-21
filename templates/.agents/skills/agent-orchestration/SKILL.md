---
name: agent-orchestration
description: >
  Spec-driven AI agent pipeline orchestration built on OpenSpec. Load when deciding which
  role/command to use, how to handoff between phases, which model to pick, or when a session
  should stop and a new one start. Commands: /opsx:explore, /opsx:design, /opsx:propose, /opsx:review,
  /opsx:apply, /opsx:archive, /opsx:quick.
disable-model-invocation: false
allowed-tools: Bash, Read
---

# Agent Orchestration

Spec-driven 5-role pipeline. Each role runs in a separate session. Mixing roles in one chat
is the primary source of wasted tokens and failed implementations.

## Pipeline

```
explore → [design] → propose → review → apply → verify → archive
```

`[design]` is optional (`/opsx:design`) — capture UI into `design-brief.md` + `assets/` so apply does not depend on live Figma.

**MVP profile** (`require_spec_review: false`):
```
explore → quick (propose+apply) → verify → archive (optional)
```
In quick mode the same session may create the design brief before propose+apply.

Read `.agents/orchestrator.yaml` for project-specific config (language, flags, MCP, review gate).

## Roles & Commands

| Role | Command | Mode | Model hint | Allowed output |
|------|---------|------|------------|----------------|
| Explorer | `/opsx:explore` | read-only | fast | chat only |
| Design Intake | `/opsx:design <name>` | brief-only | strong | `design-brief.md`, `assets/` |
| Architect | `/opsx:propose <name>` | specs-only | strong | `openspec/changes/` |
| Spec Reviewer | `/opsx:review <name>` | read-only | medium | `review.md`, Approve / Request Changes |
| Implementer | `/opsx:apply <name>` | code | strong | `src/`, `tasks.md [x]` |
| Quick (MVP) | `/opsx:quick <name>` | specs+code | strong | `openspec/changes/` + `src/` |
| Verifier | CI / local scripts | — | — | exit codes |

## Handoff Protocol

### explore → design (optional)
Exit Explorer into Design Intake when:
- Change has UI and a Figma URL, export, screenshot, or photo is available
- kebab-case change name chosen

Start Design Intake with:
```
/opsx:design <name>
```

### design → propose
Exit Design Intake when `design-brief.md` (+ `assets/`) is written. Non-UI changes: skip design and put `Design: none` in `proposal.md` when `require_design_brief: true`.

### explore → propose
Exit Explorer when:
- Problem is stated in 3–5 sentences
- 2–3 solution options surfaced with a recommendation
- kebab-case change name chosen
- Non-goals listed

Start Architect with:
```
/opsx:propose <name>

Context from explore:
- Problem: ...
- Approach: ...
- Non-goals: ...
- Draft acceptance: ...
```
### propose → review
Exit Architect when:
```bash
npx openspec validate <name> --strict --type change  # must pass ✓
npx openspec status --change "<name>"                # applyRequires artifacts all done
```
(Use `npx` / `npm run` — bare `openspec` / `agent-orchestrator-kit` often exit 127 in Amp. See `cli-via-npm.mdc`.)

### review → apply
Exit Reviewer only when verdict is explicit **APPROVE ✓** and `review.md` written.

Before apply, check `.agents/orchestrator.yaml`:
- `require_spec_review: true` → apply MUST find `review.md` with `Verdict: APPROVE` or Approve in session
- `require_spec_review: false` → apply allowed directly (mvp / quick mode)

If Request Changes — fix artifacts, re-run `/opsx:review`.

This is no longer only a chat convention: `npx agent-orchestrator-kit gate-check` runs in CI (both `agent-verify.yml` fragments) and fails the pipeline if `src/` changed without an approved `review.md` — a forgotten or skipped review is caught at merge time, not just at apply time. When `require_design_brief: true`, the same command also requires `design-brief.md` (or `Design: none` in `proposal.md`).

### apply → verify
Exit Implementer when:
- All `tasks.md` boxes `[x]`
- `npm run build` (or project build cmd) exits 0
- `npm run lint` exits 0
- Commit ready
- UI work followed `design-brief.md` — do **not** open live Figma MCP in the apply session

### verify → archive
After PR merged + CI green:
```
/opsx:archive <name>
```

## Session Rules

**Start of each session:**
1. Announce role: "Starting Spec Reviewer session for change: <name>"
2. Run `npx agent-orchestrator-kit status` (or `npx openspec list`) — confirm active change limit (`max_active_changes` in orchestrator.yaml) and see task/review/brief progress for every active change at a glance
3. Read `orchestrator.yaml` for project config and review gate

**During session:**
- Stay in role — do not drift into next phase
- Pause and ask if requirements are unclear
- Never edit files outside your role's allowed output

**End of each session:**
- Show progress summary
- State explicit next step and next role
- If apply: confirm build/lint status

## Model Selection Guide

| Phase | Use case | Recommended |
|-------|----------|-------------|
| explore | Q&A, brainstorm | fast (rush/flash) |
| design | Vision / layout capture | strong (vision-capable) |
| propose | Architecture decisions | strong (opus/sonnet) |
| review | Artifact analysis | medium or strong |
| apply complex | Multi-file refactor | strong |
| apply simple | 1–2 file change | medium or fast |
| fix lint | Mechanical | fast |

## Memory MCP Entities

Store these between sessions (key → value):

| Key | Example value |
|-----|---------------|
| `Change:<name>` | `status: spec-approved, tasks: 3/7` |
| `Decision:<topic>` | `chosen: xlsx over csv, reason: ...` |
| `Convention:<area>` | `api errors: use ApiError class` |
| `Handoff:<name>` | `next_role: implementer, session_count: 2` |

At start of new session: read relevant entities to restore context without re-explanation.

## Orchestration Checklist (per change)

- [ ] explore session closed before propose started
- [ ] `npx openspec validate <name> --strict --type change` passed before review
- [ ] explicit **Approve** received before apply (when `require_spec_review: true`)
- [ ] `review.md` with `Verdict: APPROVE` exists (when review required)
- [ ] all tasks `[x]` + build OK before PR
- [ ] `npx agent-orchestrator-kit gate-check` passes locally before pushing (mirrors the CI gate)
- [ ] `/opsx:archive` run after merge — `npx agent-orchestrator-kit status` shows "ready to archive"

## Anti-patterns

| Anti-pattern | Impact |
|-------------|--------|
| Explore + propose in one chat | Architect has stale exploration context |
| Apply without review | ~60% chance of rework |
| Live Figma MCP in apply session | Token/quota loss; context not durable across sessions |
| All tasks in one apply session | Context overload; model drifts |
| No archive after merge | Next propose has stale domain specs |
| Strong model on lint fixes | 5–10x cost with no quality gain |
| Skip Memory MCP | Every session re-explains domain |

## Metrics (health check per change)

- Sessions: 4–8 (not 1 marathon, not 20 micro-sessions)
- Apply iterations to PR: ≤ 2
- Spec review loops: ≤ 1
- Tasks rework: ≤ 10%

If apply iterations > 2 → problem is in Architect or Reviewer, not Implementer.
