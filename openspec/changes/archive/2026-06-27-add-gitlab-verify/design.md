## Context

`agent-orchestrator-kit` v0.1.4 встановлює consumer-проєктам GitHub Actions workflow (`templates/.github/workflows/agent-verify.yml`) і документує Verifier як CI на GitHub. Типовий workflow користувача:

1. `kit init` → push у GitLab
2. DevOps пізніше додають `.gitlab-ci.yml` (не знають про orchestrator)
3. DevOps завжди запускають `npm run build`

Baseline kit: CLI (`bin/agent-orchestrator.js`), `KIT_MANAGED_PATHS`, smoke-тести (`npm test`).

## Goals / Non-Goals

**Goals:**

- `init --ci gitlab` — verify без участі DevOps через `prebuild` → `verify:openspec`
- Fragment `.gitlab/agent-verify.yml` для dev-controlled CI
- Starter example `.gitlab-ci.starter.yml.example`
- `update` оновлює fragment; backward compatible default `--ci github`
- Docs: GitLab verifier ≠ GitHub Actions

**Non-Goals:**

- Auto-modify існуючого `.gitlab-ci.yml` DevOps
- Root `.gitlab-ci.yml` у managed paths
- GitLab CI для kit repo (GitHub)
- GitLab Component registry
- `--ci both`
- `update` перезаписує `package.json` scripts
- Version bump / CHANGELOG (окремий release)

## Decisions

### 1. Primary integration: npm `prebuild` hook

**Рішення:** `init --ci gitlab` додає:

```json
"verify:openspec": "npx openspec validate --all --strict",
"prebuild": "<pm> run verify:openspec"
```

де `<pm>` — результат `detectPackageManager`: `npm`, `yarn` або `pnpm`.

Приклади prebuild після init:

| PM | prebuild (новий) | prebuild (chain з існуючим) |
|----|------------------|----------------------------|
| npm | `npm run verify:openspec` | `npm run verify:openspec && <existing>` |
| yarn | `yarn run verify:openspec` | `yarn run verify:openspec && <existing>` |
| pnpm | `pnpm run verify:openspec` | `pnpm run verify:openspec && <existing>` |

**Rationale:** DevOps завжди `npm run build` (або yarn/pnpm build); lifecycle hook `prebuild` виконується автоматично. PM-aware chain уникає змішування менеджерів у yarn/pnpm проєктах. Zero DevOps coordination.

**Альтернатива:** `pretest` — відхилено: test не завжди в CI.

**Альтернатива:** DevOps `include: local` — відхилено як primary: DevOps не знають про orchestrator.

### 2. Fragment, не root `.gitlab-ci.yml`

**Рішення:** `templates/.gitlab/agent-verify.yml` з hidden job `.agent-verify-base` + concrete `agent-verify` job.

**Rationale:** DevOps володіють root CI; kit не конфліктує. Dev може include до DevOps або використати starter.

**Starter:** `templates/.gitlab-ci.starter.yml.example` — copy/rename до push, не auto-install.

### 3. `--ci gitlab|github|none` на init

**Рішення:**

| Flag | Встановлює |
|------|------------|
| `github` (default) | `.github/workflows/agent-verify.yml` |
| `gitlab` | `.gitlab/agent-verify.yml` + package.json scripts |
| `none` | без CI файлів і без script injection |

**Rationale:** Backward compat; явний вибір для GitLab shops.

### 4. KIT_MANAGED_PATHS для update

**Рішення:** Додати `.gitlab/agent-verify.yml` до `KIT_MANAGED_PATHS`. GitHub path лишається.

**Rationale:** `update` оновлює kit-managed artifacts; `package.json` — project overlay.

### 5. Fragment: multi-PM + safe lint/build/test

**Рішення:** Fragment mirror consumer GHA template: PM detect (pnpm/yarn/npm), `openspec validate`, lint/build/test з `--if-present` для npm і guards для yarn/pnpm.

**Rationale:** Parity з GitHub template; root `package.json` типовий.

### 6. prebuild injection implementation

**Рішення:** Нова функція `injectVerifyScripts(projectDir, { pm })` у CLI:

- Якщо `package.json` відсутній — warn і skip injection (init продовжується)
- Parse `package.json`
- Додати `"verify:openspec": "npx openspec validate --all --strict"` якщо ключ відсутній
- Skip перезапис `verify:openspec` якщо вже є (warn)
- Обчислити `runCmd` = `${pm} run verify:openspec` через переданий `pm` з `detectPackageManager`
- Якщо `prebuild` відсутній — встановити `runCmd`
- Якщо `prebuild` існує і вже містить `verify:openspec` — skip chain (warn)
- Інакше chain: `"${runCmd} && <existing>"`
- Write back з preserve formatting (minimal JSON.stringify indent 2)

**Rationale:** Один раз на init; idempotent warn on re-run з `--force`; parity з GHA/fragment через `npx openspec`.

## Risks / Trade-offs

| Ризик | Мітигація |
|-------|-----------|
| DevOps перезаписують `.gitlab-ci.yml` | prebuild лишається primary path |
| DevOps не запускають `npm run build` (майбутнє) | docs: dev MR з include fragment |
| Конфлікт існуючого `prebuild` | chain, не replace |
| `pretest`/`prebuild` confusion | docs пояснюють чому prebuild |
| Lint/test не в DevOps CI | orchestrator local gates на apply; fragment покриває повний verify |
| Re-init `--force` дублює chain | перевірка на `verify:openspec` у prebuild |

## Migration Plan

1. Release kit з `--ci gitlab`
2. Existing consumers: `npx agent-orchestrator-kit update` + manual `verify:openspec`/`prebuild` або re-init scripts
3. Rollback: видалити scripts + `.gitlab/`; GitHub path не зачіпається

## Open Questions

_(немає — explore закрито)_
