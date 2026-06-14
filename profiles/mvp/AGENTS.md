# Agent Orchestration — {{PROJECT_NAME}} (MVP)

> Powered by [agent-orchestrator-kit](https://github.com/makshc2/agent-orchestrator-kit) v{{KIT_VERSION}} — **mvp profile**

Lightweight AI pipeline for **demos, spikes, and hypothesis testing**. Full spec review is optional.

## Pipeline

```
explore → quick (propose + apply) → verify → archive (optional)
```

Or full path when needed:

```
explore → propose → apply → verify
```

## Roles

| Role | Command | When |
|------|---------|------|
| Explorer | `/opsx:explore` | Scope unclear |
| Quick | `/opsx:quick <name>` | Demo / spike / 1–3 files |
| Architect | `/opsx:propose <name>` | Need full artifacts |
| Implementer | `/opsx:apply <name>` | Continue existing change |
| Verifier | local build/lint | Before demo handoff |

## Hard Rules (MVP)

- **`require_spec_review: false`** — no review gate
- Up to **3 active changes** in parallel
- **Archive optional** for throwaway demos
- Still run **build + lint** before declaring done
- Switch to **vue3/generic profile** when promoting demo to production

## Quick Start

```bash
/opsx:quick add-demo-widget
# or
/opsx:explore → /opsx:quick <name>
```

## Configuration

See `.agents/orchestrator.yaml` — `profile: mvp`, `quick_mode_enabled: true`.
