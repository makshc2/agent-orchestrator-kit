# MVP Profile

Fast AI pipeline for **demos, prototypes, and hypothesis testing**.

```bash
npx agent-orchestrator-kit init --profile mvp --lang uk --name "My Demo"
```

## Differences from vue3/generic

| Setting | vue3 | mvp |
|---------|------|-----|
| `require_spec_review` | true | **false** |
| `max_active_changes` | 1 | **3** |
| `archive_after_merge` | true | **false** |
| Primary command | `/opsx:propose` | **`/opsx:quick`** |
| Delta specs | required | optional |

## Recommended stack setup

```bash
npm i -D @fission-ai/openspec
npx openspec init
# copy openspec/config.yaml.example → openspec/config.yaml

npx frontend-agent-skills install --agent all --yes
./scripts/sync-local-agent-skills.sh
```

## When to graduate to vue3 profile

- Feature goes to production
- Team needs spec review gate
- Multi-day changes with delta specs

Update `.agents/orchestrator.yaml` manually or re-init with `--profile vue3` (preserves openspec/).
