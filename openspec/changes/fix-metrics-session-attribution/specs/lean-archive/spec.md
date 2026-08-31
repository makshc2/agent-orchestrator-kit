## MODIFIED Requirements

### Requirement: Гейті archive не залежать від metrics.json

Гейті команди `npx agent-orchestrator-kit archive <name>` (review APPROVE, усі таски `[x]`, явне sync-рішення, вільний target-шлях, rollback при падінні `openspec validate --all --strict`) MUST NOT включати перевірку наявності, вмісту чи заповненості `metrics.json` або секції `## Metrics` у `handoff.md`. Відсутній `metrics.json`, порожній spend, `null` модель, відсутній самозвіт і порожній collect MUST NOT робити exit code успішного archive ненульовим.

Невалідне значення `--platform` (не `cursor` / `claude` / `amp`) MUST відхилятись **до** переміщення change: команда завершується non-zero і не рухає файли.

Семантика самої фіналізації `metrics.json` на archive — створення файлу, `archivedAt`, `pending: null`, сесія `Archiver` / `archive` з `startedAt` з pending start і `durationMs` = дельта (не штучний `null`), leftover попередньої сесії до вікна Archiver, ланцюжки резолву `model` / `platform` / spend, opt-in `--collect`, warning про `null` `spend.costUsd` і зводка в stdout — належить capability `change-metrics` (див. «Archive завжди фіналізує metrics.json після успішного move»). `lean-archive` MUST NOT дублювати ці правила.

#### Scenario: Metrics не є archive-гейтом

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і валідним sync-рішенням
- **AND** `metrics.json` відсутній
- **WHEN** виконується `archive <name>`
- **THEN** відсутність файлу не є причиною відмови
- **AND** файли переміщуються, якщо інші гейті закриті

#### Scenario: Незаповнений самозвіт не блокує archive

- **GIVEN** change з закритими гейтами, у якого `handoff.md` не має секції `## Metrics`
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** exit code 0
- **AND** change переміщено в `openspec/changes/archive/YYYY-MM-DD-<name>`

#### Scenario: Невалідний --platform на archive не рухає файли

- **GIVEN** change готовий до archive (гейті закриті)
- **WHEN** виконується `archive <name> --platform foo` з валідним sync-рішенням
- **THEN** exit code ≠ 0
- **AND** change лишається в `openspec/changes/<name>/` (move не виконується)
