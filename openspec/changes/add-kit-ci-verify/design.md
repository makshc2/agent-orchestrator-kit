## Context

`agent-orchestrator-kit` v0.1.3 — npm-пакет з CLI (`bin/agent-orchestrator.js`), шаблонами (`templates/`) і smoke-тестами (`npm test`, 12/12 pass). Kit встановлює consumer-проєктам workflow `templates/.github/workflows/agent-verify.yml` (multi-PM: npm/yarn/pnpm + lint + build + test), але сам kit repo не має `.github/workflows/`.

Baseline локально:
- `npm test` — pass
- `npx openspec validate --all --strict` — pass (немає active changes до цього change)

## Goals / Non-Goals

**Goals:**

- Додати `.github/workflows/agent-verify.yml` у корінь kit repo
- npm-only pipeline: `npm ci` → `openspec validate --all --strict` → `npm test`
- Тригери: `pull_request`, `push` на `main`/`master`/`develop`
- Node 20, `ubuntu-latest`

**Non-Goals:**

- Зміни `templates/.github/workflows/agent-verify.yml`
- Додавання lint/build scripts у `package.json`
- npm publish, version bump, CHANGELOG
- Розширення smoke-тестів під CI (існуючі тести достатні)

## Decisions

### 1. Окремий workflow у корені, не копія template

**Рішення:** Створити спрощений `.github/workflows/agent-verify.yml` у корені repo, а не symlink/copy з `templates/`.

**Rationale:** Template призначений для consumer-проєктів з різними PM і lint/build. Kit — npm-only, без `lint`/`build` scripts. Окремий файл уникає зайвих conditional steps і false failures (`yarn lint` без script).

**Альтернатива:** Використати template як є з `--if-present` для lint/build — відхилено: зайва складність, не відповідає npm-only scope.

### 2. npm ci замість npm install

**Рішення:** `npm ci` для детермінованого install з lockfile.

**Rationale:** Стандарт для CI; kit має `package-lock.json`.

### 3. openspec validate --all --strict

**Рішення:** Той самий прапор, що й у consumer template.

**Rationale:** `@fission-ai/openspec` уже в devDependencies; перевіряє change artifacts після merge.

### 4. Без окремого test job matrix

**Рішення:** Один job `verify`, послідовні steps.

**Rationale:** Kit має один test script (`node --test`); matrix не потрібен.

### 5. actions/checkout@v4 + setup-node@v4

**Рішення:** Ті самі версії actions, що й у template.

**Rationale:** Консистентність з consumer workflow; стабільні pinned major versions.

## Risks / Trade-offs

| Ризик | Мітигація |
|-------|-----------|
| Kit CI відрізняється від consumer template | Документовано в spec: template не змінюється; kit workflow — npm-only subset |
| `openspec validate` падає при invalid change | Очікувана поведінка; локально `openspec validate --strict` перед PR |
| Workflow не запуститься до push на GitHub | Перевірити вручну після merge; локально baseline уже green |

## Migration Plan

1. Додати `.github/workflows/agent-verify.yml` у PR
2. Merge → GitHub Actions автоматично активує workflow
3. Rollback: видалити workflow file (без впливу на npm package або consumers)

## Open Questions

_(немає — scope визначений у explore)_
