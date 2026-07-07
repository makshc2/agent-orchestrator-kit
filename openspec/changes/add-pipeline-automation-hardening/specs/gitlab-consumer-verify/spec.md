## MODIFIED Requirements

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
