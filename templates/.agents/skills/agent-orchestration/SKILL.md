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

## Conductor Routing (Differentiated by Phase)

The parent `/opsx:*` session is the conductor. Delegation cost must match phase uncertainty: **propose and review MUST spawn their specialist** (the parent never writes artifacts or the verdict); **apply is parent-driven** — the parent writes code and tests itself from `tasks.md` + `apply-notes.md`, subagents are optional; **archive is one CLI call** — phase subagents are forbidden.

| Phase / signal | Subagent | Status |
|----------------|------------|--------|
| Status, gate failure, next command | `openspec-guide` | optional |
| Restore/persist when handoff CLI failed | `session-handoff` | fallback only |
| Broken kit, MCP, or generated-file sync | `setup-doctor` | on signal |
| `/opsx:explore` repository investigation | `codebase-explorer` | mandatory |
| `/opsx:design` | `design-intake` | mandatory |
| `/opsx:propose` | `spec-architect` | mandatory |
| `/opsx:review` (Tier 2, after `gate-check --review` passes) | `spec-reviewer` | mandatory |
| Apply task with design brief/Figma/image | `design-implementer` | mandatory on signal |
| Apply: ≥ 2 independent tasks with no shared files, or explicit user request | `code-writer` / `test-writer` | optional |
| Apply before PR/MR | `code-reviewer` | optional |
| `/opsx:archive` | — run `npx agent-orchestrator-kit archive <name>` | CLI; phase subagent forbidden (`spec-archiver` = CLI-failure fallback only) |

`spec-reviewer` is not `code-reviewer`. Spawned specialists MUST NOT edit `tasks.md`; the parent checks a box only after verifying the task's Done-when condition. If an apply task requires information beyond its Files/Do/Done-when contract + `apply-notes.md` + referenced artifacts, STOP: record the gap in `handoff.md` and route back to `/opsx:propose <name>` — improvisation is forbidden.

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
Archive is one deterministic CLI call — `npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]` — which checks gates, merges delta specs on `--sync`, moves the change to the dated archive, validates with rollback, and writes the final handoff. No phase subagent.

## Session Rules

**Start of each session:**
1. Honor the pasted `/opsx:<phase> <name>` command and announce that role.
2. Run `npx agent-orchestrator-kit status` (or `npx openspec list --json`) and read `orchestrator.yaml`; resolve the active change and gates.
3. Run `npx agent-orchestrator-kit handoff --restore` (or `handoff <name> --restore`). Accumulated decisions print from git-tracked `openspec/changes/<name>/decisions.md`, not from Memory.
4. Read Memory entities `Change:<name>`, `Handoff:<name>`, and `Decision:*` when MCP works.
5. If restore CLI fails and Memory is empty, read `openspec/changes/<name>/handoff.md`; Memory failure alone is not a blocker.
6. Spawn `session-handoff` in restore mode **only if** `handoff --restore` failed or printed no briefing (Amp: isolated `subagent-session-handoff`). Skip this spawn when CLI restore exits 0.
7. Only after restoration, spawn the routed phase specialist. If the user said “continue” / “next” and exactly one active change has `Handoff.next_command`, execute it instead of asking for a phase.

**During session:**
- Stay in role — do not drift into next phase
- Pause and ask if requirements are unclear
- Never edit files outside your role's allowed output

**End of each session (HARD STOP — you are NOT done):**
1. Write `openspec/changes/<name>/handoff.md` in the parent using the template below, including `## Metrics`.
2. Fill `## Metrics` (`platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`, `spend_source`) before persist. Use `unknown` for unknown numbers — never invent `0`. Do not set `spend_source: self-report` when tokens are `unknown`. `--model` / `model` is the LLM product id (example `cursor-grok-4.6-xhigh-fast`); family `cursor-grok-4.6` is only a fallback; the CLI takes the product id from hook sources when they exist; Closed role MAY have a sentence after `—`; metrics stores the canonical token.
3. Run `npx agent-orchestrator-kit handoff <name> --model <llm-product-id>` and require exit 0. `--model` is the LLM product id of this chat (`claude-opus-5`, `claude-fable-5`, `gpt-5.6-sol`, `cursor-grok-4.6-xhigh-fast`) — NEVER pass a Closed role (`Architect`, `Implementer`, `Explorer`) or a subagent name (`spec-architect`, `session-handoff`) as `--model`. The parent SHOULD still pass `--model`. The parent MUST NOT guess tokens. `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` override session-level totals only and do not wipe platform maps or rewrite `## Metrics`. Optional `--platform cursor|claude|amp` or `AOK_PLATFORM`. Optional `--collect` also runs local spend adapters. The same command works in Cursor, Claude Code, and Amp and MUST NOT require Cursor SDK, a Claude `/cost` parser, or an Amp billing API as a required step. The CLI appends non-empty Decisions into append-only `openspec/changes/<name>/decisions.md` (the git canon), upserts Memory JSON with an absolute path (`Decision:*` is a file→Memory mirror only), and prints the expanded self-contained prompt on stdout. Spawn `session-handoff` in persist mode ONLY if this CLI step failed.
4. If Memory MCP tools are available, mirror `Change:<name>`, `Handoff:<name>`, and new `Decision:<topic>` entities in one call — optional; its absence never blocks closing.
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

## Runtime
- runtime: <local | cloud>
- agent_id: <id | none>

## Metrics
- platform: <cursor | claude | amp | unknown>
- model: <llm-product-id | unknown>
- input_tokens: <n | unknown>
- output_tokens: <n | unknown>
- cost_usd: <n | unknown>
- amp_credits: <n | unknown>
- spend_source: <self-report | flag | adapter | unreported | unknown>

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

Before specialist work, the parent MUST restore context in order: honor the pasted `/opsx:*` command; run `npx agent-orchestrator-kit handoff --restore` (the CLI briefing is canonical — no separate Memory MCP read step); if the CLI failed, read `openspec/changes/<name>/handoff.md`; spawn `session-handoff` in restore mode ONLY when both failed. Missing Memory MCP never blocks a session. With one active change, free-form “continue” uses `Handoff.next_command` instead of asking for the phase. Amp spawns any needed subagent as an isolated `subagent-*` skill.

Before declaring a session closed, the parent MUST, in order: (1) write `openspec/changes/<name>/handoff.md` itself including `## Metrics` (keys `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`, `spend_source`). Use `unknown` for unknown numbers — never invent `0`. Do not set `spend_source: self-report` when tokens are `unknown`. `--model` / `model` is the LLM product id (example `cursor-grok-4.6-xhigh-fast`); family `cursor-grok-4.6` is only a fallback; the CLI takes the product id from hook sources when they exist; Closed role MAY have a sentence after `—`; metrics stores the canonical token. (2) run `npx agent-orchestrator-kit handoff <name> --model <llm-product-id>` (exit 0) — NEVER pass a Closed role or subagent name as `--model`; the parent SHOULD still pass `--model` and MUST NOT guess tokens; spend flags override session totals only and do not rewrite `## Metrics`; optional `--platform`; optional `--collect` for local adapters; the same CLI works in Cursor, Claude Code, and Amp and MUST NOT require Cursor SDK, Claude `/cost`, or Amp billing as a required step; this CLI appends `decisions.md` and mirrors `Decision:*` file→Memory; spawn `session-handoff` persist ONLY if this CLI step failed, (3) paste the CLI stdout prompt whose first line is `/opsx:<next> <name>`. Memory MCP mirroring is an optional single call. Never write Memory back into `decisions.md`. The prompt has no `NEXT_SESSION_PROMPT` label, uses `project.agent_language`, and MUST be self-contained (Done, Decisions, Blocked, attach, spawn, HARD STOP) so the next thread can run if Memory MCP is ignored. Never start the next phase in the current chat. Write session artifacts only to git-tracked paths (never `/tmp`, never gitignored caches). If runtime is cloud: after persist, commit → push → `npx agent-orchestrator-kit handoff <name> --cloud-check` with exit 0; closing without that is an incomplete handoff.

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
