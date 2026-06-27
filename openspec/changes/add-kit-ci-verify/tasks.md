## 1. CI Workflow

- [x] 1.1 Створити `.github/workflows/agent-verify.yml` у корені kit repo
- [x] 1.2 Налаштувати тригери: `pull_request`, `push` на `main`/`master`/`develop`
- [x] 1.3 Додати job `verify` на `ubuntu-latest` з Node 20 (`actions/checkout@v4`, `actions/setup-node@v4`)
- [x] 1.4 Додати steps: `npm ci` → `npx openspec validate --all --strict` → `npm test`
- [x] 1.5 Переконатися, що workflow npm-only (без pnpm/yarn detect, lint, build)

## 2. Verification

- [x] 2.1 Локально: `npm ci && npx openspec validate --all --strict && npm test` — усі кроки pass
- [x] 2.2 Локально: `openspec validate --change add-kit-ci-verify --strict` — change artifacts valid
- [x] 2.3 Переконатися, що `templates/.github/workflows/agent-verify.yml` не змінений
