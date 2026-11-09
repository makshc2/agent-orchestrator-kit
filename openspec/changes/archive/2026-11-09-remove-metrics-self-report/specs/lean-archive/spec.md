## MODIFIED Requirements

### Requirement: Гейті archive не залежать від metrics.json

Гейті команди `npx agent-orchestrator-kit archive <name>` (review APPROVE, усі таски `[x]`, явне sync-рішення, вільний target-шлях, rollback при падінні `openspec validate --all --strict`) MUST NOT включати перевірку наявності, вмісту чи заповненості `metrics.json` або секції `## Metrics` у `handoff.md`, за єдиним винятком Gate 0 (наступний абзац). Відсутній `metrics.json`, порожній spend, `null` модель, наявна чи відсутня секція `## Metrics` і порожній collect MUST NOT робити exit code успішного archive ненульовим.

Виняток — Gate 0 (вимога «Gate 0: archive відмовляє для вже заархівованої зміни»): archive MUST відмовити лише за **позитивного** свідчення, що АКТИВНИЙ каталог change-у вже заархівовано, — валідний JSON `metrics.json` із непорожнім `archivedAt` або `## Next command` = `none` у `handoff.md`. Відсутній, нечитабельний, невалідний чи порожній `metrics.json`, відсутній `handoff.md` і наявна чи відсутня секція `## Metrics` ніколи не є причиною відмови; Gate 0 читає `## Next command`, а не `## Metrics`, і не оцінює вміст чи заповненість метрик.

Невалідне значення `--platform` (не `cursor` / `claude` / `amp`) MUST відхилятись **до** переміщення change: команда завершується non-zero і не рухає файли.

Семантика самої фіналізації `metrics.json` на archive — створення файлу, `archivedAt`, `pending: null`, сесія `Archiver` / `archive` з `startedAt` з pending start і `durationMs` = дельта (не штучний `null`), leftover попередньої сесії до вікна Archiver, ланцюжки резолву `model` / `platform` / spend, opt-in `--collect`, warning про `null` `spend.costUsd` і зводка в stdout — належить capability `change-metrics` (див. «Archive завжди фіналізує metrics.json після успішного move»). `lean-archive` MUST NOT дублювати ці правила.

#### Scenario: Metrics не є archive-гейтом

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і валідним sync-рішенням
- **AND** `metrics.json` відсутній
- **WHEN** виконується `archive <name>`
- **THEN** відсутність файлу не є причиною відмови
- **AND** файли переміщуються, якщо інші гейті закриті

#### Scenario: A legacy or absent Metrics section does not block archive

- **GIVEN** one change with closed gates whose `handoff.md` has a legacy `## Metrics` section and another whose `handoff.md` has none
- **WHEN** `archive <name>` runs for each with a valid sync decision
- **THEN** the exit code is 0 for both
- **AND** each change is moved to `openspec/changes/archive/YYYY-MM-DD-<name>` and its archived `handoff.md` has no `## Metrics` section

#### Scenario: Невалідний --platform на archive не рухає файли

- **GIVEN** change готовий до archive (гейті закриті)
- **WHEN** виконується `archive <name> --platform foo` з валідним sync-рішенням
- **THEN** exit code ≠ 0
- **AND** change лишається в `openspec/changes/<name>/` (move не виконується)

#### Scenario: Невалідний або порожній metrics.json не блокує archive

- **GIVEN** change із закритими гейтами і `metrics.json` з невалідним JSON, або з `archivedAt: null`, або з порожнім `archivedAt`
- **WHEN** виконується `archive <name>` з валідним sync-рішенням
- **THEN** exit code 0 і change заархівовано

#### Scenario: Заповнений archivedAt в активному каталозі — єдиний виняток

- **GIVEN** change із закритими гейтами і `metrics.json`, де `archivedAt` заповнено
- **WHEN** виконується `archive <name>`
- **THEN** exit code ≠ 0 за Gate 0, а не за вмістом чи заповненістю метрик
- **AND** change лишається в `openspec/changes/<name>/`
