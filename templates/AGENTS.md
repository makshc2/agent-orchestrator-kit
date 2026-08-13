# Agent Orchestration — {{PROJECT_NAME}}

> Powered by [agent-orchestrator-kit](https://github.com/makshc2/agent-orchestrator-kit) v{{KIT_VERSION}}

This project uses a **spec-driven, role-separated AI pipeline** built on [OpenSpec](https://github.com/fission-ai/openspec).
Every feature follows the same cycle regardless of stack or IDE.

## Pipeline

```
explore → [design] → propose → review → apply → verify → archive
```

`[design]` is optional — run `/opsx:design` when the change has UI and you need a durable design brief (Figma, screenshot, or photo). Skip for non-UI work; use `Design: none` in `proposal.md` when `require_design_brief: true`.

Each phase runs in a **separate agent session** with a dedicated role, model hint, and permissions.
Never mix phases in one chat — this is the single most important rule.

The parent `/opsx:*` session is a **conductor**: it restores handoff state, spawns the required specialist, verifies the structured report, and never performs the specialist's work itself.

## Roles

| Role | Command | Mode | Model hint |
|------|---------|------|------------|
| Explorer | `/opsx:explore` | read-only | fast |
| Design Intake | `/opsx:design <name>` | writes `design-brief.md` + `assets/` only | strong |
| Architect | `/opsx:propose <name>` | conductor; `spec-architect` writes change artifacts | strong |
| Spec Reviewer | `/opsx:review <name>` | conductor; `spec-reviewer` writes only `review.md` | medium/strong |
| Implementer | `/opsx:apply <name>` | conductor; apply specialists write code/tests | strong |
| Verifier | CI (automatic) | scripts only | — |

## Conductor Routing

| Phase / signal | Subagent |
|----------------|----------|
| Status, gate failure, next command | `openspec-guide` |
| Session start restore / session exit persist | `session-handoff` |
| Broken kit, MCP, or sync | `setup-doctor` |
| `/opsx:explore` repository research | `codebase-explorer` |
| `/opsx:design` | `design-intake` |
| `/opsx:propose` | `spec-architect` |
| `/opsx:review` | `spec-reviewer` |
| Apply with design evidence | `design-implementer` |
| Apply ordinary task | `code-writer` |
| Apply tests | `test-writer` |
| Apply pre-PR review | `code-reviewer` |
| `/opsx:archive` | `spec-archiver` |

This routing is mandatory and exclusive. `spec-reviewer` is not `code-reviewer`; only the conductor marks `tasks.md` after a verified `Status: done` report.

Verifier runs on **GitHub Actions** (default) or **GitLab** via `prebuild` → `verify:openspec` when using `init --ci gitlab`. GitLab projects do not use `.github/workflows/`.

With `init --ci gitlab --spec-verify` or `init --ci github --spec-verify`, an **AI Spec Verifier** also runs on MRs/PRs changing `src/`: an Amp agent checks the changed code against `openspec/specs/` and a **BLOCKED verdict fails the pipeline** (gate `spec-verify-blocking` in `.agents/orchestrator.yaml`).

Both CI fragments also run `npx agent-orchestrator-kit gate-check` — a deterministic check that fails the pipeline when `src/` changed but the active change has no `review.md` with `Verdict: APPROVE` (when `require_spec_review: true`), and optionally requires `design-brief.md` (when `require_design_brief: true`, unless `proposal.md` has `Design: none`). At session start run `npx agent-orchestrator-kit status` (not a bare global binary — Amp PATH often lacks it; see `.agents/rules/cli-via-npm.mdc`).

## Hard Rules

- **One active change per developer** at a time.
- **No apply without spec-review approval** (explicit Approve in chat).
- **No code edits** during explore, design-intake, or spec-review sessions.
- **Archive after every merge** (`/opsx:archive`).
- **Always run local build/lint** before opening a PR.
- **Conductor MUST spawn** the routed specialist and MUST NOT do specialist work in the parent session.

## Handoff Gates

| Transition | Gate |
|------------|------|
| explore → design | UI change needs a brief; change name chosen |
| explore → propose | Decision brief written; change name chosen (skip design if non-UI) |
| design → propose | `design-brief.md` (+ `assets/`) written |
| propose → review | `npx openspec validate <name> --strict --type change` passes ✓ |
| review → apply | Reviewer writes explicit **Approve** — enforced in CI by `gate-check` |
| apply → verify | All `tasks.md` checkboxes `[x]`; local build OK |
| verify → archive | CI green; PR merged — check `npx agent-orchestrator-kit status` for "ready to archive" |

## Context to Pin per Role

| Role | Attach (`@`) |
|------|-------------|
| Explorer | `@openspec/specs/` + relevant `@src/` subtree |
| Design Intake | design source (Figma URL / images) + `@openspec/changes/<name>/` |
| Architect | `@openspec/config.yaml` + explore brief (+ `@design-brief.md` if present) |
| Reviewer | entire `@openspec/changes/<name>/` |
| Implementer | `@openspec/changes/<name>/tasks.md` + `@openspec/changes/<name>/design-brief.md` |

## Configuration

See `.agents/orchestrator.yaml` for role config, pipeline flags, and MCP baseline.

## Session Handoff

**HARD STOP.** A `/opsx:*` session is incomplete without persist + the fenced next-thread prompt. Amp often skips Memory MCP and in-thread specialist work — use the CLI and isolated `subagent-*` spawns.

At session start, before specialist work: honor the pasted `/opsx:*` command, run `npx agent-orchestrator-kit status`, run `npx agent-orchestrator-kit handoff --restore`, read Memory `Change:<name>`, `Handoff:<name>`, `Decision:*`, then fall back to `openspec/changes/<name>/handoff.md`. Spawn `session-handoff` in restore mode when context is incomplete (Amp: isolated `subagent-session-handoff`). Then spawn the routed phase specialist (Amp: isolated wrapper, never the main thread).

At exit, in order: spawn `session-handoff` persist → write `handoff.md` → `npx agent-orchestrator-kit handoff <name>` (exit 0, upserts absolute-path Memory JSON) → paste the CLI stdout prompt as one fenced block. The prompt body uses `project.agent_language`, has no service banner, and MUST be self-contained (Done, Decisions, Blocked, attach, which subagent to spawn, HARD STOP). Never start the next phase in the current chat.

OpenSpec artifacts remain the source of truth for requirements and tasks. Memory and `handoff.md` index the phase. The pasted prompt is the next thread's operating brief even if Memory is ignored.

Memory MCP MUST use `node scripts/memory-mcp-launcher.cjs` (never a relative `MEMORY_FILE_PATH`). Run `npx agent-orchestrator-kit memory-setup` when the launcher is missing.

### Optional: Figma personal token

For design intake against private Figma files, each developer configures a local token (never commit, never paste into chat):

```bash
npx agent-orchestrator-kit figma-setup
# edit .agents/figma.local.env → FIGMA_ACCESS_TOKEN=...
npx agent-orchestrator-kit figma-status
```

MCP starts via `scripts/figma-mcp-launcher.cjs` (secret stays out of `.mcp.json`). See kit README → **Figma token**.

## Skills & Commands

All skills live in `.agents/skills/` (committed to git).
Local IDE sync: run `./scripts/sync-local-agent-skills.sh`.

| Skill | When |
|-------|------|
| `agent-orchestration` | Pipeline decisions, role selection, handoff |
| `openspec-howto` | OpenSpec CLI, cycle, naming |
| `openspec-propose` | Creating change artifacts |
| `openspec-apply-change` | Implementing tasks |
| `openspec-archive-change` | Archiving after merge |

## Metrics (track per change)

| Metric | Target |
|--------|--------|
| Sessions per change | 4–8 |
| Apply iterations to PR | ≤ 2 |
| Spec review loops | ≤ 1 |
| Tasks rework after apply | ≤ 10% |
| CI fails on PR | ≤ 1 |

If apply iterations > 2 — fix in Architect/Reviewer, not Implementer.
