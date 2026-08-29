## Purpose

lean-archive — requirements merged from change lean-pipeline-v2.

## Requirements

### Requirement: Детермінований archive через CLI

Команда `npx agent-orchestrator-kit archive <name>` SHALL виконувати повний цикл архівації без LLM-рішень: перевірка гейтів, переміщення change у датований архів, strict-валідація, фінальний handoff.

#### Scenario: Успішна архівація завершеного change

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і відсутнім target-архівом
- **WHEN** виконується `npx agent-orchestrator-kit archive <name> --sync`
- **THEN** delta specs зливаються в `openspec/specs/`, change переміщується в `openspec/changes/archive/YYYY-MM-DD-<name>`, `openspec validate --all --strict` проходить, exit code 0, stdout містить підсумок (change, archive path, sync status)

#### Scenario: Відмова на незакритому гейті

- **GIVEN** change з незавершеними тасками (`- [ ]`) або без APPROVE при `require_spec_review: true`
- **WHEN** виконується `archive <name>`
- **THEN** exit code ≠ 0, stderr називає перший незакритий гейт, файли не переміщуються

#### Scenario: Delta specs вимагають явного sync-рішення

- **GIVEN** change містить delta specs
- **WHEN** виконується `archive <name>` без sync-прапорців
- **THEN** exit code ≠ 0, stderr пропонує `--sync` або `--no-sync --force`, файли не переміщуються

#### Scenario: Rollback при падінні валідації

- **GIVEN** архівація пройшла move, але `openspec validate --all --strict` падає
- **WHEN** CLI отримує ненульовий exit від validate
- **THEN** change повертається на початковий шлях, синхронізовані main specs відновлюються до pre-sync вмісту, новостворені spec-файли видаляються, exit code ≠ 0, помилка валідації в stderr

### Requirement: Тонка команда opsx-archive

Команда `templates/.agents/commands/opsx-archive.md` SHALL бути тонкою обгорткою над CLI: резолв імені change, виклик `archive`, показ stdout. Вона MUST NOT спавнити phase-субагентів і MUST NOT містити інструкцій ручного merge specs чи move.

#### Scenario: Розмір і зміст команди

- **GIVEN** встановлений kit після `init` або `update`
- **WHEN** читається `.agents/commands/opsx-archive.md`
- **THEN** файл ≤ 1.5 KB, не містить «spawn spec-archiver», містить виклик `npx agent-orchestrator-kit archive`

### Requirement: Archive завжди фіналізує metrics.json

Після успішного переміщення change команда `npx agent-orchestrator-kit archive <name>` MUST залишити `metrics.json` у архівній папці (створити default, якщо файлу не було), виставити `archivedAt`, очистити `pending`, перерахувати агрегати і додати одну сесію з `role: Archiver` і `phase: archive`. Модель і platform цієї сесії SHALL братися з того самого ланцюжка, що й persist (`--model`/`AOK_MODEL`, `--platform`/`AOK_PLATFORM`, primary з sources якщо collect їх дав). `durationMs` сесії Archiver MUST бути `null`. Якщо немає `--no-collect`, archive finalize MUST запустити collect для вікна Archiver: від `last session.endedAt` або `metrics.createdAt` до зараз. Якщо collect нічого не знайшов — spend-поля сесії Archiver MUST бути `null`. Якщо після фіналізації `spend.costUsd` є `null`, CLI SHALL надрукувати warning у stderr через `console.error` (Amp credits і заповнені токени не скасовують warning; не перевіряти `sessions.length === 0` і не перевіряти всі `METRICS_SPEND_KEYS`). Exit code успішного archive MUST NOT змінюватись через відсутність попереднього файлу, порожні сесії, `null` модель, `null` spend або порожній collect. Наявні гейті archive (review APPROVE, усі таски `[x]`, явне sync-рішення, вільний target, rollback при падінні validate) MUST NOT включати перевірку `metrics.json`.

#### Scenario: Archive без файлу створює metrics.json

- **GIVEN** change готовий до archive і не має `metrics.json`
- **WHEN** виконується `npx agent-orchestrator-kit archive <name>` з валідним sync-рішенням
- **THEN** `openspec/changes/archive/YYYY-MM-DD-<name>/metrics.json` існує
- **AND** `archivedAt` заповнений
- **AND** `pending` є `null`
- **AND** `sessions` містить запис з `role: Archiver` і `phase: archive`
- **AND** exit code 0

#### Scenario: Порожній spend дає warning, не помилку

- **GIVEN** після фіналізації `spend.costUsd` є `null`
- **WHEN** archive успішно завершив move і finalize
- **THEN** stderr містить попередження про відсутній USD (`spend.costUsd` є `null`)
- **AND** exit code 0

#### Scenario: Archive collect для вікна Archiver

- **GIVEN** остання сесія має `endedAt` раніше за usage-подію в tmp-фікстурі Claude JSONL
- **AND** подія входить у `[last session.endedAt, now]` і cwd збігається
- **WHEN** виконується `archive <name>` без `--no-collect`
- **THEN** сесія Archiver містить цю подію в `sources` або вона врахована в `spendByPlatform.claude`
- **AND** exit code 0

#### Scenario: Archive --no-collect не викликає адаптери

- **GIVEN** tmp-фікстура Claude JSONL з валідною подією
- **WHEN** виконується `archive <name> --no-collect` з валідним sync-рішенням
- **THEN** архівний `metrics.json` існує з сесією Archiver
- **AND** `sources` сесії Archiver є `[]`
- **AND** exit code 0

#### Scenario: Metrics не є archive-гейтом

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і валідним sync-рішенням
- **AND** `metrics.json` відсутній
- **WHEN** виконується `archive <name>`
- **THEN** відсутність файлу не є причиною відмови
- **AND** файли переміщуються, якщо інші гейті закриті

#### Scenario: Невалідний --platform на archive не рухає файли

- **GIVEN** change готовий до archive (гейті закриті)
- **WHEN** виконується `archive <name> --platform foo` з валідним sync-рішенням
- **THEN** exit code ≠ 0
- **AND** change лишається в `openspec/changes/<name>/` (move не виконується)
