## Purpose

GitLab verify integration for consumer projects initialized with agent-orchestrator-kit.

## Requirements

### Requirement: Init підтримує --ci gitlab

CLI `init` SHALL приймати опцію `--ci` зі значеннями `gitlab`, `github`, `none`. Default SHALL бути `github`.

#### Scenario: Init з GitLab CI provider

- **WHEN** користувач виконує `agent-orchestrator-kit init --ci gitlab`
- **THEN** kit встановлює `.gitlab/agent-verify.yml` з templates
- **AND** kit НЕ встановлює `.github/workflows/agent-verify.yml`

#### Scenario: Init з GitHub CI provider (default)

- **WHEN** користувач виконує `agent-orchestrator-kit init` без `--ci`
- **THEN** kit встановлює `.github/workflows/agent-verify.yml`
- **AND** kit НЕ модифікує `package.json` scripts для verify

#### Scenario: Init без CI

- **WHEN** користувач виконує `agent-orchestrator-kit init --ci none`
- **THEN** kit не встановлює CI workflow files
- **AND** kit не модифікує `package.json` scripts для verify

### Requirement: GitLab init injects verify scripts у package.json

При `--ci gitlab` init SHALL додати scripts для OpenSpec validate через `prebuild` hook. Script `verify:openspec` SHALL бути `npx openspec validate --all --strict`. Prebuild chain SHALL використовувати detected package manager (`npm`, `yarn`, `pnpm`) — не hardcode `npm run`.

#### Scenario: Новий package.json без prebuild (npm)

- **WHEN** init `--ci gitlab` на проєкті з `package.json` без `prebuild` і без yarn/pnpm lockfiles
- **THEN** `package.json` містить `"verify:openspec": "npx openspec validate --all --strict"`
- **AND** `package.json` містить `"prebuild": "npm run verify:openspec"`

#### Scenario: Yarn project prebuild injection

- **WHEN** init `--ci gitlab` на проєкті з `yarn.lock` і без існуючого `prebuild`
- **THEN** `package.json` містить `"prebuild": "yarn run verify:openspec"`

#### Scenario: pnpm project prebuild injection

- **WHEN** init `--ci gitlab` на проєкті з `pnpm-lock.yaml` і без існуючого `prebuild`
- **THEN** `package.json` містить `"prebuild": "pnpm run verify:openspec"`

#### Scenario: Існуючий prebuild chain (npm)

- **WHEN** init `--ci gitlab` на npm-проєкті з існуючим `"prebuild": "node scripts/check.js"`
- **THEN** `prebuild` стає `"npm run verify:openspec && node scripts/check.js"`

#### Scenario: verify:openspec вже існує

- **WHEN** init `--ci gitlab` і `verify:openspec` вже в `package.json`
- **THEN** init не перезаписує `verify:openspec`
- **AND** CLI виводить попередження skip

#### Scenario: prebuild вже містить verify:openspec

- **WHEN** init `--ci gitlab` з `--force` і `prebuild` вже містить `verify:openspec`
- **THEN** init не дублює chain у `prebuild`
- **AND** CLI виводить попередження skip

#### Scenario: package.json відсутній

- **WHEN** init `--ci gitlab` у директорії без `package.json`
- **THEN** init не створює `package.json`
- **AND** CLI виводить попередження skip script injection
- **AND** init встановлює `.gitlab/agent-verify.yml` як зазвичай

#### Scenario: npm run build triggers OpenSpec validate

- **WHEN** CI або dev виконує `npm run build` після init `--ci gitlab` на npm-проєкті
- **THEN** npm автоматично виконує `prebuild` перед build
- **AND** `npx openspec validate --all --strict` виконується

### Requirement: GitLab CI fragment agent-verify

Kit SHALL розповсюджувати `templates/.gitlab/agent-verify.yml` з job template для OpenSpec validate, lint, build, test, а також опційної перевірки orchestration review-gate.

#### Scenario: Fragment містить hidden base job

- **WHEN** файл `.gitlab/agent-verify.yml` встановлено
- **THEN** він містить hidden job `.agent-verify-base` з Node 20 image
- **AND** містить concrete job `agent-verify` що extends base

#### Scenario: Fragment detect package manager

- **WHEN** job `agent-verify` виконується в проєкті з `pnpm-lock.yaml`
- **THEN** before_script встановлює залежності через pnpm з frozen lockfile
- **WHEN** job виконується в проєкті з `yarn.lock`
- **THEN** before_script встановлює залежності через yarn з frozen lockfile
- **WHEN** job виконується в проєкті з `package-lock.json` без інших lockfiles
- **THEN** before_script виконує `npm ci`

#### Scenario: Fragment pipeline steps

- **WHEN** job `agent-verify` виконується
- **THEN** script виконує `npx openspec validate --all --strict`
- **AND** lint, build, test з безпечними guards (`--if-present` або еквівалент)

#### Scenario: Fragment MR і branch rules

- **WHEN** pipeline triggered для merge request
- **THEN** job `agent-verify` виконується
- **WHEN** push до default branch або `develop`
- **THEN** job `agent-verify` виконується

#### Scenario: Fragment включає gate-check крок

- **WHEN** job `agent-verify` виконується
- **THEN** script також виконує `npx agent-orchestrator-kit gate-check` (або еквівалентний локальний виклик) як окремий крок
- **AND** цей крок не провалює pipeline, якщо `.agents/orchestrator.yaml` відсутній (graceful degrade для проєктів без review-гейту)

### Requirement: Starter example для раннього push

Kit SHALL включати `templates/.gitlab-ci.starter.yml.example` з мінімальним include fragment.

#### Scenario: Starter include local fragment

- **WHEN** dev копіює starter у `.gitlab-ci.yml` перед DevOps setup
- **THEN** файл містить `include: - local: '.gitlab/agent-verify.yml'`
- **AND** job `agent-verify` extends `.agent-verify-base`

### Requirement: Update оновлює GitLab fragment

Command `update` SHALL оновлювати `.gitlab/agent-verify.yml` з templates разом з іншими kit-managed paths.

#### Scenario: Update refreshes fragment

- **WHEN** користувач виконує `agent-orchestrator-kit update`
- **THEN** `.gitlab/agent-verify.yml` перезаписується з kit template
- **AND** `package.json` scripts не змінюються

### Requirement: Kit не модифікує root .gitlab-ci.yml DevOps

Init і update SHALL NOT створювати або змінювати `.gitlab-ci.yml` у корені consumer-проєкту.

#### Scenario: Init gitlab не створює root gitlab-ci

- **WHEN** init `--ci gitlab` завершується
- **THEN** файл `.gitlab-ci.yml` не створений у корені проєкту

### Requirement: Documentation описує GitLab verify path

README і AGENTS.md template SHALL описувати GitLab verifier через `prebuild` hook, не GitHub Actions.

#### Scenario: README GitLab section

- **WHEN** dev читає README після init `--ci gitlab`
- **THEN** документація пояснює що verify спрацьовує через `npm run build` → `prebuild`
- **AND** документація згадує optional fragment include для dev-controlled CI
