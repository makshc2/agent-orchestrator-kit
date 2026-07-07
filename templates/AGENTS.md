# Agent Orchestration — {{PROJECT_NAME}}

> Powered by [agent-orchestrator-kit](https://github.com/makshc2/agent-orchestrator-kit) v{{KIT_VERSION}}

This project uses a **spec-driven, role-separated AI pipeline** built on [OpenSpec](https://github.com/fission-ai/openspec).
Every feature follows the same cycle regardless of stack or IDE.

## Pipeline

```
explore → propose → review → apply → verify → archive
```

Each phase runs in a **separate agent session** with a dedicated role, model hint, and permissions.
Never mix phases in one chat — this is the single most important rule.

## Roles

| Role | Command | Mode | Model hint |
|------|---------|------|------------|
| Explorer | `/opsx:explore` | read-only | fast |
| Architect | `/opsx:propose <name>` | writes `openspec/changes/` only | strong |
| Spec Reviewer | `/opsx:review <name>` | read-only | medium/strong |
| Implementer | `/opsx:apply <name>` | writes `src/` | strong |
| Verifier | CI (automatic) | scripts only | — |

Verifier runs on **GitHub Actions** (default) or **GitLab** via `prebuild` → `verify:openspec` when using `init --ci gitlab`. GitLab projects do not use `.github/workflows/`.

With `init --ci gitlab --spec-verify` or `init --ci github --spec-verify`, an **AI Spec Verifier** also runs on MRs/PRs changing `src/`: an Amp agent checks the changed code against `openspec/specs/` and a **BLOCKED verdict fails the pipeline** (gate `spec-verify-blocking` in `.agents/orchestrator.yaml`).

Both CI fragments also run `agent-orchestrator-kit gate-check` — a deterministic check that fails the pipeline when `src/` changed but the active change has no `review.md` with `Verdict: APPROVE` (when `require_spec_review: true`). Run `agent-orchestrator-kit status` at the start of any session to see task progress, review verdict, and archive readiness for every active change without querying `openspec` per change.

## Hard Rules

- **One active change per developer** at a time.
- **No apply without spec-review approval** (explicit Approve in chat).
- **No code edits** during explore or spec-review sessions.
- **Archive after every merge** (`/opsx:archive`).
- **Always run local build/lint** before opening a PR.

## Handoff Gates

| Transition | Gate |
|------------|------|
| explore → propose | Decision brief written; change name chosen |
| propose → review | `openspec validate --strict` passes ✓ |
| review → apply | Reviewer writes explicit **Approve** — enforced in CI by `gate-check` |
| apply → verify | All `tasks.md` checkboxes `[x]`; local build OK |
| verify → archive | CI green; PR merged — check `agent-orchestrator status` for "ready to archive" |

## Context to Pin per Role

| Role | Attach (`@`) |
|------|-------------|
| Explorer | `@openspec/specs/` + relevant `@src/` subtree |
| Architect | `@openspec/config.yaml` + explore brief |
| Reviewer | entire `@openspec/changes/<name>/` |
| Implementer | `@openspec/changes/<name>/tasks.md` |

## Configuration

See `.agents/orchestrator.yaml` for role config, pipeline flags, and MCP baseline.

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
