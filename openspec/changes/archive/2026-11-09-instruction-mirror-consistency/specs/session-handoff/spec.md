## MODIFIED Requirements

### Requirement: Спільні Session Start/Exit блоки живуть в одному rule

Канонічний текст протоколів Session Start і Session Exit SHALL існувати лише в `templates/.agents/rules/session-handoff.mdc` (`alwaysApply: true`). Команди `templates/.agents/commands/opsx-*.md` MUST посилатися на протокол одним-двома рядками і MUST NOT дублювати його текст. Skill `agent-orchestration` MAY нести лише згенеровані байт-ідентичні блоки-дзеркала цих секцій (`instruction-mirrors`), без рукописної копії; речення поза секціями (git-tracked шляхи, Closed role) лишає окремим абзацом.

#### Scenario: Команди без дубльованих блоків

- **WHEN** після `init`/`update` читаються файли `.agents/commands/opsx-*.md`
- **THEN** жоден не містить повного тексту start/exit протоколу, лише посилання на `.agents/rules/session-handoff.mdc`

#### Scenario: Skill без рукописної копії кроків

- **WHEN** читається `.agents/skills/agent-orchestration/SKILL.md` після `init`/`update`
- **THEN** кроки Session Start і Session Exit стоять лише між маркерами `aok:mirror`
- **AND** поза блоками лишаються речення «Write session artifacts only to git-tracked paths» і правило Closed role (речення після `—` дозволене, metrics зберігає канонічний токен)
