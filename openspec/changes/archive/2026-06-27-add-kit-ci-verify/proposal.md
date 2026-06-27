## Why

`agent-orchestrator-kit` розповсюджує CI-шаблон `agent-verify.yml` у consumer-проєкти, але сам kit repo не має власного CI. Це створює розрив між рекомендаціями kit і практикою розробки: зміни в kit не перевіряються автоматично на PR/push, хоча baseline (`npm test`, `openspec validate`) уже проходить локально.

## What Changes

- Додати `.github/workflows/agent-verify.yml` у корінь kit repo
- Workflow npm-only: `npm ci` → `openspec validate --all --strict` → `npm test`
- Тригери: `pull_request`, `push` на `main`/`master`/`develop`
- Без змін у `templates/`, npm scripts, publish або version bump

## Capabilities

### New Capabilities

- `kit-ci-verify`: автоматична верифікація kit repo на GitHub Actions (install, OpenSpec validate, test)

### Modified Capabilities

_(немає — існуючі specs відсутні)_

## Impact

- **Файли**: новий `.github/workflows/agent-verify.yml` у корені repo
- **CI**: GitHub Actions на PR і push до основних гілок
- **Залежності**: `@fission-ai/openspec` (вже в devDependencies), Node 20
- **Поза scope**: `templates/.github/workflows/agent-verify.yml`, lint/build scripts, npm publish, CHANGELOG/version
