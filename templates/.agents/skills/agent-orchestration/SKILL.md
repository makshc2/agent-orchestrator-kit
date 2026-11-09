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

**Small change, any profile:** `/opsx:quick <name>` runs propose → light review → apply in one session. With `require_spec_review: true` the light review is mandatory: `gate-check --review`, then `spec-reviewer` in quick mode (REQUEST CHANGES only on a Blocker) writes a real `review.md`, so the CI gate and archive accept the change.

Read `.agents/orchestrator.yaml` for project-specific config (language, flags, MCP, review gate).

## Roles & Commands

| Role | Command | Mode | Model hint | Allowed output |
|------|---------|------|------------|----------------|
| Explorer | `/opsx:explore` | read-only | fast | chat only |
| Design Intake | `/opsx:design <name>` | brief-only | strong | `design-brief.md`, `assets/` |
| Architect | `/opsx:propose <name>` | specs-only | strong | `openspec/changes/` |
| Spec Reviewer | `/opsx:review <name>` | read-only | strong | `review.md`, Approve / Request Changes |
| Implementer | `/opsx:apply <name>` | code | strong | `src/`, `tasks.md [x]` |
| Quick (small change) | `/opsx:quick <name>` | specs+code | strong | `openspec/changes/` + `src/` |
| Verifier | CI / local scripts | — | — | exit codes |

## Conductor Routing (Differentiated by Phase)

<!-- aok:mirror:begin routing (generated from .agents/rules/agent-orchestration.mdc; edit the source and run sync) -->
The parent `/opsx:*` session is the **conductor**. Delegation is differentiated by phase: propose/review MUST spawn their specialist; apply is parent-driven with optional subagents; archive is a CLI call with phase subagents forbidden. Only the parent marks `tasks.md`. `spec-reviewer` ≠ `code-reviewer`.

| Phase / signal | Subagent | Status |
|--------|------------|--------|
| Status / gate / next command | `openspec-guide` | optional |
| Restore/persist when handoff CLI failed | `session-handoff` | fallback only |
| Broken kit / MCP / sync | `setup-doctor` | on signal |
| `/opsx:explore` | `codebase-explorer` | mandatory |
| `/opsx:design` | `design-intake` | mandatory |
| `/opsx:propose` | `spec-architect` | mandatory |
| `/opsx:review` (after `gate-check --review` passes) | `spec-reviewer` | mandatory |
| Apply + design brief/Figma/image | `design-implementer` | mandatory on signal |
| Apply: ≥ 2 independent tasks, no shared files, or explicit request | `code-writer` / `test-writer` | optional |
| Apply pre-PR | `code-reviewer` | optional |
| `/opsx:archive` (fallback) | — terminal/CI: `npx agent-orchestrator-kit archive <name>` | CLI; subagent forbidden (`spec-archiver` = CLI-failure fallback only) |
<!-- aok:mirror:end routing -->

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
npx agent-orchestrator-kit gate-check --review <name> # Tier 1 pre-gate: exit 0 required
```
(Use `npx` / `npm run` — bare `openspec` / `agent-orchestrator-kit` often exit 127 in Amp. See `cli-via-npm.mdc`.)

If `gate-check --review` exits ≠ 0: re-spawn `spec-architect` once with the full list of gate-check errors, then re-run it; still ≠ 0 → close the session with `## Blocked` and next command `/opsx:propose <name>`. No handoff to `/opsx:review` without exit 0. This applies to the first propose, re-propose, and structure-only re-propose; `/opsx:review` still runs Tier 1 itself.

### review → apply
Exit Reviewer only when verdict is explicit **APPROVE ✓** and `review.md` written.

Before apply, check `.agents/orchestrator.yaml`:
- `require_spec_review: true` → apply MUST find `review.md` with `Verdict: APPROVE` or Approve in session
- `require_spec_review: false` → apply allowed directly (mvp / quick mode)

If Request Changes — run `/opsx:propose <name>` to fix the punch list, then a new `/opsx:review`.

This is no longer only a chat convention: `npx agent-orchestrator-kit gate-check` runs in CI (both `agent-verify.yml` fragments) and fails the pipeline if `src/` changed without an approved `review.md` — a forgotten or skipped review is caught at merge time, not just at apply time. When `require_design_brief: true`, the same command also requires `design-brief.md` (or `Design: none` in `proposal.md`).

### apply → verify
Exit Implementer when:
- All `tasks.md` boxes `[x]`
- `npm run build` (or project build cmd) exits 0
- `npm run lint` exits 0
- Commit ready
- UI work followed `design-brief.md` — do **not** open live Figma MCP in the apply session

### verify → archive
After PR merged + CI green, run it from a terminal — no chat needed:
```
npx agent-orchestrator-kit archive <name> --sync
```
Archive is one deterministic CLI call — `npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]` — which refuses a folder that already looks archived (Gate 0), checks gates, merges delta specs on `--sync`, moves the change to the dated archive, validates with rollback, and writes the final handoff. No phase subagent. An opted-in CI job (`AOK_ARCHIVE_ON_MERGE=true`) runs the same command with `--if-ready` after merge; `/opsx:archive <name>` in chat is only the fallback when a terminal or CI was not available.

## Session Rules

**Start of each session:**
<!-- aok:mirror:begin session-start (generated from .agents/rules/session-handoff.mdc; edit the source and run sync) -->
1. Honor pasted `/opsx:<phase> <name>` and announce the role.
2. `npx agent-orchestrator-kit handoff <name> --restore` (or `handoff --restore` with one active change). The CLI briefing is canonical — it prints handoff.md (Done, Attach), the last 10 entries of git-tracked `openspec/changes/<name>/decisions.md` (older entries stay in the file) and the Memory JSON count. No separate Memory MCP read step. Restore also locks the session client (`cursor` / `claude` / `amp`) into `metrics.json` `pending` — persist will follow that client’s spend flow. Override with `--platform` when detection is wrong.
3. Only if the restore CLI failed → read `openspec/changes/<name>/handoff.md` directly; spawn `session-handoff` in restore mode ONLY if both are unavailable (Amp: isolated `subagent-session-handoff`) — a fallback, never a routine step. Then start phase work (spawn a specialist when the phase routing requires one); free-form continue/next/«далі» with one active change → execute `Handoff.next_command`.
<!-- aok:mirror:end session-start -->

**During session:**
- Stay in role — do not drift into next phase
- Pause and ask if requirements are unclear
- Never edit files outside your role's allowed output

**End of each session (HARD STOP — you are NOT done):**
<!-- aok:mirror:begin session-exit (generated from .agents/rules/session-handoff.mdc; edit the source and run sync) -->
1. The parent writes `openspec/changes/<name>/handoff.md` itself: Closed role, Change, Done, Decisions, Blocked, Next command, Next role, Attach, Subagents to spawn, Constraints, Runtime.
2. Put decisions in `## Decisions`; only the CLI writes `decisions.md`. Do not put token counts in `handoff.md`.
3. `npx agent-orchestrator-kit handoff <name> --model <llm-product-id>` — require exit 0 (appends non-empty Decisions into append-only `openspec/changes/<name>/decisions.md`, upserts absolute-path Memory JSON, records the session into `openspec/changes/<name>/metrics.json`, prints the expanded prompt on stdout). `--model` is the LLM product id of this chat (`claude-opus-5`, `claude-fable-5`, `gpt-5.6-sol`, `cursor-grok-4.6-xhigh-fast`, `accounts/fireworks/models/glm-5p2`) — NEVER pass a Closed role, a subagent name, or an Amp **mode** (`low`, `medium`, `high`, `ultra`) as `--model`. The parent SHOULD still pass `--model`. The parent MUST NOT guess tokens. Persist collects spend for the client locked at restore (Amp: `amp threads export` + local threads; Cursor: hook file; Claude: JSONL). Where the client has no adapter data (Cursor gaps), `--model`, `--platform` and the spend flags are the manual fallback: `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` override session-level totals only and do not wipe platform maps. Optional `--platform cursor|claude|amp` or `AOK_PLATFORM`. Optional `--collect` runs all three adapters, not only the locked client. The same `npx agent-orchestrator-kit handoff <name>` works in Cursor, Claude Code, and Amp. `decisions.md` is the git canon of change decisions; Memory `Decision:*` is a file→Memory mirror only. Cloud sessions pass `--runtime cloud` (or set `AOK_RUNTIME=cloud` / `AOK_AGENT_ID` in the cloud-agent environment).
4. Spawn `session-handoff` in persist mode ONLY if step 3 failed (Amp: isolated `subagent-session-handoff`). Fallback, never routine; the CLI prompt names it only when `handoff.spawn_handoff_subagent: true` in `orchestrator.yaml`.
5. Memory MCP is an optional mirror: if tools are available, update `Change:<name>`, `Handoff:<name>`, `Decision:*` in one call; unavailability never blocks closing.
6. Paste CLI stdout as one fenced block. First line `/opsx:…` (green apply: the CLI prints one archive line for a terminal). Body uses `project.agent_language`. Self-contained (Done/Blocked/Attach/spawn/HARD STOP; Decisions come from restore, not from the prompt). No banner.
7. If runtime is cloud: after persist, `git add openspec/changes/<name>/` → `git commit` → `git push` → `npx agent-orchestrator-kit handoff <name> --cloud-check` (exit 0 required). Closing without this is an incomplete handoff. Persist prints these steps on stderr; the CLI never runs `git commit` / `git push`.
8. Stop. Next role and any out-of-OpenSpec hotfix = new chat. Never run full persist twice; regenerate the prompt only with `handoff <name> --no-metrics`.
<!-- aok:mirror:end session-exit -->

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
- `session-handoff` — fallback only, when CLI restore/persist failed (Amp: isolated `subagent-session-handoff`)

## Constraints
- language: <project.agent_language>
- do not mix phases
- conductor must spawn specialists

## Runtime
- runtime: <local | cloud>
- agent_id: <id | none>

## Prompt

The Prompt section is overwritten by `npx agent-orchestrator-kit handoff <name>`. Do not hand-write a thin stub.
````

## Model Selection Guide

| Phase | Use case | Recommended |
|-------|----------|-------------|
| explore | Q&A, brainstorm | fast (Amp `low`) |
| design | Vision / layout capture | strong (vision-capable) |
| propose | Architecture decisions | strong (opus/sonnet) |
| review | Artifact analysis | strong (same level as propose) |
| apply complex | Multi-file refactor | strong |
| apply simple | 1–2 file change | medium or fast |
| fix lint | Mechanical | fast |

## Mandatory Memory and Handoff Protocol

The canonical Session Start and Session Exit protocol is the generated blocks under Session Rules (source: `.agents/rules/session-handoff.mdc`). Write session artifacts only to git-tracked paths (never `/tmp`, never gitignored caches). `--model` is the LLM product id (example `cursor-grok-4.6-xhigh-fast`); family `cursor-grok-4.6` is only a fallback; the CLI takes the product id from hook sources when they exist. Closed role MAY have a sentence after `—`; metrics stores the canonical token. Missing Memory MCP never blocks a session. Never write Memory back into `decisions.md`.

| Entity | Required fields |
|--------|-----------------|
| `Change:<name>` | `status`, `tasks n/m`, `last_role`, `review` |
| `Handoff:<name>` | `next_role`, `next_command`, `session_count`, `summary`, `blocked` |
| `Decision:<topic>` | `chosen`, `reason` |

## Orchestration Checklist (per change)

- [ ] explore session closed before propose started
- [ ] `npx openspec validate <name> --strict --type change` passed before review
- [ ] `npx agent-orchestrator-kit gate-check --review <name>` exit 0 at the end of propose (Tier 1 pre-gate) before review
- [ ] explicit **Approve** received before apply (when `require_spec_review: true`)
- [ ] `review.md` with `Verdict: APPROVE` exists (when review required)
- [ ] all tasks `[x]` + build OK before PR
- [ ] `npx agent-orchestrator-kit gate-check` passes locally before pushing (mirrors the CI gate)
- [ ] `npx agent-orchestrator-kit archive <name> --sync` run after merge (terminal or opted-in CI; `/opsx:archive` is the fallback) — `npx agent-orchestrator-kit status` shows "ready to archive"

## Anti-patterns

| Anti-pattern | Impact |
|-------------|--------|
| Explore + propose in one chat | Architect has stale exploration context |
| Apply without review | ~60% chance of rework |
| Live Figma MCP in apply session | Token/quota loss; context not durable across sessions |
| No archive after merge | Next propose has stale domain specs |
| Strong model on lint fixes | 5–10x cost with no quality gain |
| Skip Memory MCP / skip `handoff` CLI | Next thread has no context; Amp looks like it “ignored the rules” |
| one-finding review loop | fragments defects across many propose/review sessions |

## Metrics (health check per change)

- Sessions: 4–8 (not 1 marathon, not 20 micro-sessions)
- Apply iterations to PR: ≤ 2
- Spec review discovery loops: ≤ 2 (optional Tier 1 structural RC plus one semantic Tier 2 RC; a confirmation APPROVE after an exhaustive propose does not count as a discovery loop)
- Tasks rework: ≤ 10%

If apply iterations > 2 → problem is in Architect or Reviewer, not Implementer.
