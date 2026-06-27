## Purpose

CI verification workflow for the agent-orchestrator-kit repository itself.

## Requirements

### Requirement: Kit repo має CI workflow agent-verify

Kit repo SHALL мати GitHub Actions workflow `.github/workflows/agent-verify.yml`, який автоматично верифікує зміни на pull request і push до основних гілок.

#### Scenario: Workflow тригериться на pull request

- **WHEN** відкрито або оновлено pull request у kit repo
- **THEN** GitHub Actions запускає job `verify` з workflow `agent-verify`

#### Scenario: Workflow тригериться на push до main

- **WHEN** виконано push до гілки `main`, `master` або `develop`
- **THEN** GitHub Actions запускає job `verify` з workflow `agent-verify`

### Requirement: CI виконує npm install, OpenSpec validate і test

Job `verify` SHALL виконувати послідовно: встановлення залежностей через `npm ci`, валідацію OpenSpec і npm test.

#### Scenario: Успішна верифікація

- **WHEN** job `verify` виконується на чистому checkout з валідним `package-lock.json`
- **THEN** workflow виконує `npm ci`, потім `npx openspec validate --all --strict`, потім `npm test`
- **AND** job завершується зі статусом success, якщо усі кроки пройшли

#### Scenario: Провал OpenSpec validate

- **WHEN** `openspec validate --all --strict` повертає non-zero exit code
- **THEN** job `verify` завершується зі статусом failure

#### Scenario: Провал npm test

- **WHEN** `npm test` повертає non-zero exit code
- **THEN** job `verify` завершується зі статусом failure

### Requirement: CI npm-only для kit repo

Workflow у kit repo SHALL бути спрощеним для npm: без детекції pnpm/yarn і без кроків lint/build (kit не має відповідних scripts).

#### Scenario: Використовується npm ci

- **WHEN** job `verify` встановлює залежності
- **THEN** workflow виконує `npm ci` (не pnpm/yarn install)

#### Scenario: Lint і build не виконуються

- **WHEN** job `verify` проходить кроки після OpenSpec validate
- **THEN** workflow не містить кроків `npm run lint` або `npm run build`

### Requirement: CI використовує Node 20 на ubuntu-latest

Job `verify` SHALL виконуватися на `ubuntu-latest` з Node.js 20.

#### Scenario: Середовище runner

- **WHEN** job `verify` стартує
- **THEN** runner — `ubuntu-latest`
- **AND** Node.js версії 20 доступний через `actions/setup-node@v4`

### Requirement: Template workflow залишається без змін

Change SHALL NOT модифікувати `templates/.github/workflows/agent-verify.yml` — consumer template лишається multi-PM з lint/build.

#### Scenario: Template не торкається

- **WHEN** change `add-kit-ci-verify` застосовано
- **THEN** файл `templates/.github/workflows/agent-verify.yml` не змінений
