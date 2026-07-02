# Proposal: Opt-in AI Spec Verifier for GitLab consumers

## Intent

Додати в kit opt-in інсталяцію **AI Spec Verifier** — GitLab CI job, який на MR звіряє змінений код у `src/` з `openspec/specs/` через Amp CLI і **блокує merge** при BLOCKED verdict. Reference-реалізація вже працює на capstone (standards-analyzer-logistic-hubs/frontend, Phase 2).

## Scope

- Нові шаблони: `templates/scripts/verify-specs.sh`, `templates/scripts/post-mr-verdict.sh`, `templates/.gitlab/spec-verify.yml`
- CLI: флаг `init --spec-verify` (діє лише з `--ci gitlab`), патч `roles.verifier.gates` у `.agents/orchestrator.yaml`
- `update`: оновлення spec-verify файлів **лише якщо вони вже встановлені** (opt-in зберігається)
- Docs: README секція, AGENTS.md template, `.gitlab-ci.starter.yml.example`, CHANGELOG
- Smoke tests для нового флага
- Реліз v0.1.6

## Non-goals

- GitHub Actions варіант spec-verify (лише GitLab у цій ітерації)
- Зміна існуючого `agent-verify.yml` fragment чи `prebuild` hook
- Автоматичне встановлення Amp CLI локально або створення CI variables
- Verifier-моделі інші ніж Amp (`@sourcegraph/amp`)
- Docs template `templates/docs/spec-verifier.md` (README достатньо)

## Why

Kit зараз покриває лише deterministic verifier (openspec validate + lint/build/test). AI-шар — перевірка «код відповідає specs» — існує тільки як ручна копіпаста з capstone. Opt-in флаг робить цей шар відтворюваним на будь-якому GitLab-проєкті з OpenSpec за одну команду.

## What Changes

- **`bin/agent-orchestrator.js`**: опція `--spec-verify` в `init`; `installSpecVerify()`; патч gates; opt-in refresh в `update`; next steps
- **`templates/scripts/verify-specs.sh`**: узагальнена версія capstone-скрипта (без Vue-специфіки; project context з `openspec/config.yaml`)
- **`templates/scripts/post-mr-verdict.sh`**: узагальнена версія (нейтральні англомовні рядки)
- **`templates/.gitlab/spec-verify.yml`**: hidden base + job `spec-verify`, blocking default, закоментований Phase 1 (`allow_failure: true`)
- **`templates/.gitlab-ci.starter.yml.example`**: закоментований include spec-verify
- **README.md, templates/AGENTS.md, CHANGELOG.md**: документація
- **`test/smoke.test.js`**: нові тести
- **`package.json`**: version 0.1.6

## Acceptance criteria

1. `init --ci gitlab --spec-verify` встановлює 3 нові файли, робить скрипти виконуваними, додає `spec-verify-blocking` у `roles.verifier.gates`
2. `init --ci gitlab` без флага НЕ встановлює spec-verify файли
3. `init --ci github --spec-verify` / `--ci none --spec-verify` — warning, файли не встановлюються
4. `update` оновлює spec-verify файли лише коли вони вже присутні в проєкті
5. Fragment не містить `allow_failure: true` (blocking default); Phase 1 задокументовано коментарем
6. `verify-specs.sh` gracefully skip-ає без `AMP_API_KEY` / без amp CLI / без змін у `src/` і ніколи не логує секрети
7. `npm test` зелений; `npx openspec validate --all --strict` проходить

## Capabilities

### New Capabilities

- `spec-verify-consumer`: opt-in AI Spec Verifier для GitLab consumer-проєктів

### Modified Capabilities

<!-- gitlab-consumer-verify не змінюється: prebuild hook і agent-verify.yml залишаються як є -->

## Impact

- Нові проєкти: `npx agent-orchestrator-kit init --profile vue3 --ci gitlab --spec-verify`
- Існуючі: повторний `init --ci gitlab --spec-verify --force` або ручне копіювання; далі `update` підтримує файли свіжими
- CI variables (`AMP_API_KEY`, `GITLAB_VERIFIER_TOKEN`) — відповідальність проєкту, задокументовано
