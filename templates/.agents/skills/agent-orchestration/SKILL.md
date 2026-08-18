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

## Conductor Routing (Mandatory and Exclusive)

The parent `/opsx:*` session is the conductor. It MUST spawn the selected specialist with a self-contained prompt, MUST verify the structured report, and MUST NOT do the specialist's work itself. Each signal has exactly one primary subagent.

| Phase / signal | MUST spawn | Specialist scope |
|----------------|------------|------------------|
| Status, gate failure, next command | `openspec-guide` | Read-only pipeline diagnosis |
| Session start restore / session exit persist | `session-handoff` | Memory, `handoff.md`, next-thread prompt |
| Broken kit, MCP, or generated-file sync | `setup-doctor` | Kit setup repair only |
| `/opsx:explore` repository investigation | `codebase-explorer` | Read-only repository research |
| `/opsx:design` | `design-intake` | `design-brief.md` and `assets/` only |
| `/opsx:propose` | `spec-architect` | Change artifacts only |
| `/opsx:review` | `spec-reviewer` | Pre-apply verdict and `review.md` only |
| Apply task with design brief/Figma/image | `design-implementer` | UI implementation |
| Apply ordinary implementation task | `code-writer` | One production-code task |
| Apply after implementation | `test-writer` | Automated tests |
| Apply before PR/MR | `code-reviewer` | Post-implementation spec review |
| `/opsx:archive` | `spec-archiver` | Delta merge and archive move |

`spec-reviewer` is not `code-reviewer`. During apply, specialists MUST NOT edit `tasks.md`; only the conductor may mark a checkbox after a `Status: done` report and verification that the reported files exist.

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
1. Honor the pasted `/opsx:<phase> <name>` command and announce that role.
2. Run `npx agent-orchestrator-kit status` (or `npx openspec list --json`) and read `orchestrator.yaml`; resolve the active change and gates.
3. Run `npx agent-orchestrator-kit handoff --restore` (or `handoff <name> --restore`).
4. Read Memory entities `Change:<name>`, `Handoff:<name>`, and `Decision:*` when MCP works.
5. If restore CLI fails and Memory is empty, read `openspec/changes/<name>/handoff.md`; Memory failure alone is not a blocker.
6. Spawn `session-handoff` in restore mode **only if** `handoff --restore` failed or printed no briefing (Amp: isolated `subagent-session-handoff`). Skip this spawn when CLI restore exits 0.
7. Only after restoration, spawn the routed phase specialist. If the user said “continue” / “next” and exactly one active change has `Handoff.next_command`, execute it instead of asking for a phase.

**During session:**
- Stay in role — do not drift into next phase
- Pause and ask if requirements are unclear
- Never edit files outside your role's allowed output

**End of each session (HARD STOP — you are NOT done):**
1. Spawn `session-handoff` in persist mode (Amp: isolated `subagent-session-handoff`). If spawn fails, persist in the parent — never skip.
2. Write `openspec/changes/<name>/handoff.md` using the template below even if Memory MCP fails.
3. Run `npx agent-orchestrator-kit handoff <name>` and require exit 0. The CLI upserts Memory JSON with an absolute path and prints the expanded self-contained prompt on stdout.
4. If Memory MCP tools work, also update `Change:<name>`, `Handoff:<name>`, and new `Decision:<topic>` entities.
5. Paste the CLI stdout as one fenced next-session prompt. First line is `/opsx:<next> <name>`; body uses `project.agent_language`; keep Done/Decisions/Blocked/spawn/HARD STOP complete. No banner. Do not emit a thin “read Memory” stub.
6. Do not start the next phase in this chat. If apply, include build/lint status in the persisted Done section.

`handoff.md` template:

````markdown
# Session Handoff

## Closed role
<role and completion status>

## Change
- name: <name>
- status: <proposed | spec-approved | applying | blocked>
- tasks: <n/m>
- review: <pending | APPROVE | REQUEST_CHANGES | none>
- last_role: <role>

## Done
<full persisted summary the next thread needs>

## Decisions
- <topic>: <chosen> — <reason>

## Blocked
<blocker or none>

## Next command
`/opsx:<next> <name>`

## Next role
<role or subagent name>

## Attach
- `openspec/changes/<name>/<artifact>`

## Subagents to spawn
- `<phase-specialist>` — <signal> (Amp: isolated `subagent-<name>`)
- `session-handoff` — restore at start, persist at exit (Amp: isolated `subagent-session-handoff`)

## Constraints
- language: <project.agent_language>
- do not mix phases
- conductor must spawn specialists

## Prompt

The Prompt section is overwritten by `npx agent-orchestrator-kit handoff <name>`. Do not hand-write a thin stub.
````

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

## Mandatory Memory and Handoff Protocol

Before specialist work, the conductor MUST restore context in order: honor the pasted `/opsx:*` command; run `npx agent-orchestrator-kit handoff --restore`; read Memory entities `Change:<name>`, `Handoff:<name>`, and `Decision:*`; if restore CLI and Memory fail, read `openspec/changes/<name>/handoff.md`. Memory failure is not a blocker when the file exists. With one active change, free-form “continue” uses `Handoff.next_command` instead of asking for the phase. Amp MUST spawn `session-handoff` and the phase specialist as isolated `subagent-*` skills.

Before declaring a session closed, the conductor MUST, in order: (1) spawn `session-handoff` persist, (2) write `openspec/changes/<name>/handoff.md`, (3) run `npx agent-orchestrator-kit handoff <name>` (exit 0), (4) paste the CLI stdout prompt whose first line is `/opsx:<next> <name>`. The prompt has no `NEXT_SESSION_PROMPT` label, uses `project.agent_language`, and MUST be self-contained (Done, Decisions, Blocked, attach, spawn, HARD STOP) so the next thread can run if Memory MCP is ignored. Never start the next phase in the current chat.

| Entity | Required fields |
|--------|-----------------|
| `Change:<name>` | `status`, `tasks n/m`, `last_role`, `review` |
| `Handoff:<name>` | `next_role`, `next_command`, `session_count`, `summary`, `blocked` |
| `Decision:<topic>` | `chosen`, `reason` |

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
| Skip Memory MCP / skip `handoff` CLI | Next thread has no context; Amp looks like it “ignored the rules” |

## Metrics (health check per change)

- Sessions: 4–8 (not 1 marathon, not 20 micro-sessions)
- Apply iterations to PR: ≤ 2
- Spec review loops: ≤ 1
- Tasks rework: ≤ 10%

If apply iterations > 2 → problem is in Architect or Reviewer, not Implementer.
