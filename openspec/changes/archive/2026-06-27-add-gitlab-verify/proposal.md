## Why

Consumer-проєкти kit живуть на GitLab; DevOps налаштовують `.gitlab-ci.yml` після push і не знають про OpenSpec/orchestrator. Поточний kit встановлює лише GitHub Actions workflow — verify gate у pipeline фактично не працює. DevOps завжди запускають `npm run build`, тому інтеграція через `prebuild` дає zero-config verify без участі DevOps.

## What Changes

- Додати опцію `init --ci gitlab|github|none` (default: `github` — backward compatible)
- При `--ci gitlab`: merge `verify:openspec` (`npx openspec validate --all --strict`) + PM-aware `prebuild` у `package.json`; копіювати `.gitlab/agent-verify.yml`; **не** встановлювати `.github/workflows/`
- Додати `templates/.gitlab/agent-verify.yml` (hidden job + concrete job, multi-PM)
- Додати `templates/.gitlab-ci.starter.yml.example` для раннього push до DevOps
- Розширити `KIT_MANAGED_PATHS` для `.gitlab/agent-verify.yml` у `update`
- Оновити README і AGENTS.md template: verifier для GitLab через `prebuild`, не GitHub Actions
- Smoke-тести: `--ci gitlab|none|github`, PM-aware prebuild injection, update fragment, `--force` idempotency

## Capabilities

### New Capabilities

- `gitlab-consumer-verify`: GitLab verify для consumer-проєктів — npm prebuild hook, CI fragment, init/update CLI, docs

### Modified Capabilities

_(немає — `openspec/specs/` порожній)_

## Impact

- **Файли**: `bin/agent-orchestrator.js`, `templates/.gitlab/`, `templates/.gitlab-ci.starter.yml.example`, `test/smoke.test.js`, `README.md`, `templates/AGENTS.md` (або root template)
- **CLI**: новий flag `--ci` на `init`; `update` оновлює GitLab fragment
- **Consumer `package.json`**: one-time merge scripts на init (не на update)
- **Поза scope**: GitLab CI для kit repo (лишається GitHub), auto-modify існуючого `.gitlab-ci.yml`, GitLab Component registry, `--ci both`, version bump/CHANGELOG (окремий release)
