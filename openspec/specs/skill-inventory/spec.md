## Purpose

skill-inventory — requirements merged from change add-factory-memory-and-skills.

## Requirements

### Requirement: Машинний інвентар skills живе в orchestrator.yaml

Шаблон `templates/orchestrator.yaml` і всі профілі (`generic`, `vue3`, `node`, `mvp`) SHALL містити секцію `skills:` з ключами: `kit:` — список скілів, які постачає kit; `stack:` — стекові скіли профілю; `external:` — назва npm-пакета-джерела stack-скілів. Профілі, що сьогодні перелічують стекові скіли free-text-ом у `roles.*.notes` (vue3, node), MUST замінити ці notes машинним списком у `skills.stack`. CLI SHALL читати інвентар regex-парсером без YAML-залежності (стиль `parseMcpInventory`); за відсутності секції `skills:` CLI SHALL використовувати fallback: `kit` — перелік директорій `templates/.agents/skills/` установленого kit-пакета без `subagent-*` wrapper-ів, `stack` і `external` — порожні.

#### Scenario: Init постачає секцію skills

- **WHEN** виконується `init --profile vue3`
- **THEN** `.agents/orchestrator.yaml` містить `skills.kit` з kit-скілами, `skills.stack` зі стековими скілами профілю та `skills.external: frontend-agent-skills`
- **AND** `roles.implementer` не містить free-text notes зі списком скілів

#### Scenario: Legacy-проєкт без секції працює через fallback

- **GIVEN** `.agents/orchestrator.yaml` без секції `skills:` (проєкт, ініціалізований старішим kit-ом)
- **WHEN** виконується `npx agent-orchestrator-kit status`
- **THEN** Skill health показує kit-скіли з fallback-переліку
- **AND** команда завершується з exit 0 без вимоги редагувати конфігурацію

### Requirement: Перелік kit-скілів не хардкодиться в CLI

`bin/agent-orchestrator.js` MUST NOT містити хардкодний масив імен kit-скілів (`KIT_SKILL_DIRS`). Managed-перелік для `init`/`update` SHALL визначатися з фактичного вмісту `templates/.agents/skills/` kit-пакета; очікування для health-перевірок SHALL читатися з `skills:` конфігурації проєкту. `skills.kit` у `templates/orchestrator.yaml` MUST збігатися з переліком директорій `templates/.agents/skills/`.

#### Scenario: Новий скіл потрапляє в update без правки списків

- **GIVEN** у `templates/.agents/skills/` kit-пакета додано нову директорію скіла
- **WHEN** виконується `update` у консюмер-проєкті
- **THEN** новий скіл копіюється в `.agents/skills/` без зміни жодного хардкодного переліку в CLI

#### Scenario: Шаблон і templates не дрейфують

- **WHEN** виконується тестовий прогін kit-а (`npm test`)
- **THEN** тест звіряє `skills.kit` з `templates/orchestrator.yaml` з переліком директорій `templates/.agents/skills/` і падає при розбіжності

### Requirement: Skill health видимий у status

`npx agent-orchestrator-kit status` SHALL друкувати секцію Skill health: для кожного скіла з `skills.kit` і `skills.stack` — стан `ok` / `missing` / `stale`, де `missing` — відсутній `.agents/skills/<name>/SKILL.md`; `stale` — джерело існує, але `SKILL.md` у `.cursor/skills/<name>/` або `.claude/skills/<name>/` відсутній чи байтово відрізняється від джерела; `ok` — джерело і обидві IDE-копії збігаються. Для кожного `.agents/subagents/<n>.md` секція SHALL перевіряти свіжість Amp wrapper-а `.agents/skills/subagent-<n>/SKILL.md` байтовим порівнянням зі згенерованим вмістом. Перевірки MUST бути статичними (без мережевих запитів) і MUST NOT порівнювати за mtime. Секція MUST бути warn-only: exit code команди MUST NOT ставати ненульовим через стан скілів — паритет з MCP health. Для `missing` stack-скіла вивід SHALL підказувати установку пакета з `skills.external`; автоустановка external-пакетів MUST NOT виконуватись.

#### Scenario: Розсинхронізована IDE-копія показується як stale

- **GIVEN** скіл присутній у `.agents/skills/` і був синхронізований
- **WHEN** його копію в `.cursor/skills/` видалено або змінено
- **AND** виконується `status`
- **THEN** рядок скіла показує `stale`
- **AND** exit code лишається 0

#### Scenario: Відсутній external-скіл дає підказку без установки

- **GIVEN** профіль зі `skills.stack`, що містить `vue-core`, і `skills.external: frontend-agent-skills`
- **AND** `.agents/skills/vue-core/` відсутній
- **WHEN** виконується `status`
- **THEN** рядок `vue-core` показує `missing` з підказкою установки `frontend-agent-skills`
- **AND** жодна установка пакета не запускається

#### Scenario: Застарілий Amp wrapper видимий

- **GIVEN** `.agents/subagents/<n>.md` змінено після останньої генерації wrapper-а
- **WHEN** виконується `status`
- **THEN** Skill health позначає wrapper `subagent-<n>` як `stale`
- **AND** свіжі wrapper-и рахуються у підсумковому рядку як `ok`

#### Scenario: Skill health ніколи не валить CI

- **GIVEN** довільна комбінація станів `missing` і `stale`
- **WHEN** виконується `status` локально або в CI
- **THEN** команда завершується з exit 0
- **AND** новий блокуючий гейт для скілів не вводиться
