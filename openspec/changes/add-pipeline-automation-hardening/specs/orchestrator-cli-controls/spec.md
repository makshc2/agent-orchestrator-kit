## ADDED Requirements

### Requirement: CLI команда status

CLI SHALL надавати команду `agent-orchestrator status`, яка виводить агрегований стан усіх активних (не заархівованих) OpenSpec changes без потреби вручну запускати `openspec status` для кожної зміни.

#### Scenario: Status для активної зміни з задачами

- **WHEN** користувач виконує `agent-orchestrator-kit status` у проєкті з активною зміною, що має `tasks.md` (3 з 7 позначено `[x]`)
- **THEN** вивід показує назву зміни та прогрес `3/7 tasks`

#### Scenario: Status показує review verdict

- **WHEN** активна зміна має `review.md` з `Verdict: APPROVE`
- **THEN** вивід status позначає цю зміну як "review: APPROVE"
- **WHEN** `review.md` відсутній
- **THEN** вивід позначає зміну як "review: none"

#### Scenario: Status позначає готовність до archive

- **WHEN** усі задачі в `tasks.md` позначені `[x]`
- **THEN** вивід status позначає зміну як "ready to archive"

#### Scenario: Немає активних changes

- **WHEN** `openspec/changes/` не містить активних змін (окрім `archive/`)
- **THEN** `agent-orchestrator status` виводить повідомлення "No active changes" і завершується з exit code 0

### Requirement: CLI команда gate-check

CLI SHALL надавати команду `agent-orchestrator gate-check [change-name]`, яка перевіряє review-gate детерміновано (exit code), придатну для виклику з CI або pre-commit hook.

#### Scenario: Gate-check блокує без review approve

- **WHEN** `.agents/orchestrator.yaml` має `pipeline.require_spec_review: true`
- **AND** git diff проти base містить зміни у `src/` (або `--src-glob` шаблоні)
- **AND** для активної зміни немає `review.md` з `Verdict: APPROVE`
- **THEN** `gate-check` завершується з ненульовим exit code і повідомленням, яку зміну і що саме бракує

#### Scenario: Gate-check проходить з approve

- **WHEN** ті самі умови, але `review.md` містить `Verdict: APPROVE`
- **THEN** `gate-check` завершується з exit code 0

#### Scenario: Gate-check пропускає коли review не потрібен

- **WHEN** `pipeline.require_spec_review: false` (mvp/quick профіль)
- **THEN** `gate-check` завершується з exit code 0 і повідомленням "review not required"

#### Scenario: Gate-check пропускає коли немає змін у src

- **WHEN** git diff проти base не містить змін у `--src-glob` (default `src/`)
- **THEN** `gate-check` завершується з exit code 0 без перевірки review.md

#### Scenario: Gate-check попереджає про перевищення max_active_changes

- **WHEN** кількість активних (не заархівованих) changes перевищує `pipeline.max_active_changes`
- **THEN** `gate-check` виводить попередження (warning), але НЕ завершується ненульовим exit code лише через це

#### Scenario: Gate-check graceful degrade без orchestrator.yaml

- **WHEN** `.agents/orchestrator.yaml` відсутній у проєкті
- **THEN** `gate-check` завершується з exit code 0 і info-повідомленням, що конфігурацію не знайдено

### Requirement: sync видаляє застарілі skills та rules

`agent-orchestrator sync` SHALL видаляти з `.cursor/skills/`, `.cursor/rules/`, `.claude/skills/` файли й директорії, яких більше немає у відповідних джерелах `.agents/skills/`, `.agents/rules/` — щоб поведінка була ідентична `sync-local-agent-skills.sh` (`rsync --delete`).

#### Scenario: Видалений skill зникає після sync

- **WHEN** скіл `openspec-howto` існує в `.cursor/skills/openspec-howto/` з попереднього sync
- **AND** директорія `.agents/skills/openspec-howto/` більше не існує (видалена, наприклад, після `update` на новішу версію kit-а)
- **AND** користувач виконує `agent-orchestrator-kit sync --target cursor`
- **THEN** `.cursor/skills/openspec-howto/` більше не існує після sync

#### Scenario: Delete не зачіпає generated-only файли поза skills/rules

- **WHEN** користувач виконує `agent-orchestrator-kit sync --target cursor`
- **AND** `.cursor/memory.json` існує (локальний Memory MCP стан)
- **THEN** `.cursor/memory.json` залишається недоторканим після sync

#### Scenario: Claude sync теж видаляє застарілі skills

- **WHEN** скіл видалено з `.agents/skills/`
- **AND** користувач виконує `agent-orchestrator-kit sync --target claude`
- **THEN** відповідна директорія в `.claude/skills/` видаляється
