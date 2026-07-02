# Design: Opt-in AI Spec Verifier

## Context

- Reference: capstone `standards-analyzer-logistic-hubs/frontend` — job `spec-verify` (Phase 2, blocking), `scripts/verify-specs.sh`, `scripts/post-mr-verdict.sh`
- Kit CI-механіка: `init --ci gitlab` ставить `.gitlab/agent-verify.yml` + prebuild hook; fragment підключається консюмером через `include: local`
- `update` перезаписує `KIT_MANAGED_PATHS` безумовно — для opt-in файлів це неприйнятно

## Goals / Non-Goals

**Goals:**

- Один флаг → відтворюваний AI verifier gate на будь-якому GitLab+OpenSpec проєкті
- Blocking за замовчуванням (Phase 2), Phase 1 — свідомий крок консюмера (розкоментувати `allow_failure`)
- Стек-агностичні скрипти: project context береться з `openspec/config.yaml`, не хардкодиться

**Non-Goals:**

- GitHub Actions підтримка
- Retry/flaky-mitigation для Amp API
- Автоконфігурація CI variables

## Decisions

### 1. Окремий fragment `.gitlab/spec-verify.yml`, не розширення `agent-verify.yml`

Opt-in шар не повинен зачіпати проєкти без флага. Окремий файл → окремий include, незалежний lifecycle в `update`.

**Альтернатива:** один fragment з обома jobs — відхилено: `update` перезаписує agent-verify.yml для всіх, spec-verify просочився б у проєкти без opt-in.

### 2. Структура fragment: hidden base + concrete job

Той самий патерн, що `.agent-verify-base` / `agent-verify`. Консюмер може перевизначити stage/rules через `extends`.

Blocking default: без `allow_failure`. Phase 1 — закоментований рядок `# allow_failure: true` з поясненням.

### 3. Генералізація скриптів

- Prompt без Vue-специфіки; секція Project Context наповнюється вмістом `openspec/config.yaml` (якщо існує)
- Усі службові рядки/fallback-verdict — англійською
- Політика graceful skip збережена: нема змін у `src/` / нема specs / нема amp CLI / нема `AMP_API_KEY` → `pass: true, skipped: true`, exit 0
- Секрети ніколи не логуються (успадковано з reference)

### 4. CLI

- `init --spec-verify`: валідний лише з `--ci gitlab`; інакше `log.warn` + skip
- `installSpecVerify()`: копіює fragment + 2 скрипти (respects `--force`), `chmod +x`
- `patchOrchestratorSpecVerify()`: вставляє `- spec-verify-blocking` після `- openspec-validate-strict` у `.agents/orchestrator.yaml` (ідемпотентно; якщо якоря нема — warn)
- Next steps: include fragment у `.gitlab-ci.yml`, створити `AMP_API_KEY` і `GITLAB_VERIFIER_TOKEN`

### 5. `update` — opt-in refresh

Новий список `KIT_OPTIN_PATHS` (spec-verify.yml, verify-specs.sh, post-mr-verdict.sh): копіюється **лише якщо dest уже існує**. `KIT_MANAGED_PATHS` не змінюється.

## Risks / Trade-offs

- **[Risk] Проєкт з нестандартним layout (`app/` замість `src/`)** → Mitigation: rules/скрипт документовано; консюмер редагує fragment через `extends` і `SRC_GLOB` у скрипті
- **[Risk] Amp CLI breaking change** → Mitigation: `npm install -g @sourcegraph/amp@latest` в job; збій → invalid JSON → cautious pass з warning finding (не блокує помилково)
- **[Trade-off] Blocking default суворіший за capstone-шлях (там Phase 1 → Phase 2)** → свідомо: kit ставить кінцевий стан, Phase 1 — один розкоментований рядок

## Migration Plan

1. Реліз v0.1.6
2. Нові проєкти — флаг при init; існуючі — `init --ci gitlab --spec-verify` поверх (файли нові, конфліктів нема) або `--force`
3. Rollback консюмера: розкоментувати `allow_failure: true` або прибрати include

## Open Questions

Немає.
