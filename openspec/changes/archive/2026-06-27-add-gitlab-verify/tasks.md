## 1. Templates

- [x] 1.1 Створити `templates/.gitlab/agent-verify.yml` — hidden `.agent-verify-base`, job `agent-verify`, multi-PM detect, openspec validate, lint/build/test з guards
- [x] 1.2 Створити `templates/.gitlab-ci.starter.yml.example` — include local + extends

## 2. CLI

- [x] 2.1 Додати опцію `--ci <gitlab|github|none>` на command `init` (default: `github`)
- [x] 2.2 Реалізувати `injectVerifyScripts(projectDir, { pm })` — `npx openspec validate --all --strict`, PM-aware prebuild chain, skip якщо немає `package.json`
- [x] 2.3 Рефактор init CI install: `gitlab` → fragment + scripts; `github` → GHA workflow; `none` → skip
- [x] 2.4 Додати `.gitlab/agent-verify.yml` до `KIT_MANAGED_PATHS` для `update`

## 3. Documentation

- [x] 3.1 README: секція GitLab verify (`prebuild`, fragment, starter example, `--ci gitlab`)
- [x] 3.2 AGENTS.md template: verifier для GitLab ≠ GitHub Actions
- [x] 3.3 `printNextSteps`: підказка `--ci gitlab` і prebuild для GitLab users

## 4. Tests

- [x] 4.1 Smoke: `init --ci gitlab` створює `.gitlab/agent-verify.yml`, не створює `.github/workflows/`
- [x] 4.2 Smoke: `init --ci gitlab` injects `verify:openspec` і `prebuild` у `package.json`
- [x] 4.3 Smoke: `init --ci gitlab` chains existing `prebuild`
- [x] 4.4 Smoke: fragment містить PM detection (pnpm/yarn/npm)
- [x] 4.5 Smoke: `init --ci github` (default) — backward compat, без script injection
- [x] 4.6 Smoke: `init --ci gitlab` + `update` refreshes `.gitlab/agent-verify.yml`
- [x] 4.7 Smoke: `init --ci none` — без CI файлів і без script injection
- [x] 4.8 Smoke: `init --ci gitlab --force` на проєкті з prebuild що вже містить `verify:openspec` — без duplicate chain
- [x] 4.9 Smoke: yarn lockfile → prebuild містить `yarn run verify:openspec`

## 5. Verification

- [x] 5.1 `npm test` — pass
- [x] 5.2 `openspec validate --change add-gitlab-verify --strict` — pass
- [x] 5.3 Локально: `init --ci gitlab` у temp dir → `npm run build` викликає openspec validate (mock або skip якщо openspec не в temp)
