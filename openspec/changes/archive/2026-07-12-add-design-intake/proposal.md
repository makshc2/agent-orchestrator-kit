# Proposal: add-design-intake

## Why

Перенос дизайну на фронт сьогодні залежить від живої Figma MCP-сесії, яка регулярно втрачає доступ (токени/квоти), а для скріншотів і фото немає жодної ролі чи артефакту в пайплайні. Кожен apply починається з нуля, дизайн-контекст живе тільки в чаті і губиться між сесіями. Пайплайну потрібна опційна фаза design-intake з durable-артефактом — design brief — який фіксує дизайн один раз і робить apply незалежним від зовнішніх інструментів.

## What Changes

- Нова команда-шаблон `templates/.agents/commands/opsx-design.md` — роль Design Intake: одноразовий захват дизайну з будь-якого джерела (Figma MCP, експорт, скріншот, фото) в `openspec/changes/<name>/design-brief.md` + `assets/`. Пише лише ці шляхи; для `src/` — read-only.
- Роль `design_intake` у `templates/orchestrator.yaml` та профілях (`generic`, `vue3`, `node`, `mvp`) + прапорець `pipeline.require_design_brief` (default `false`).
- CLI `status`: для кожної активної зміни показує наявність design brief (`brief: yes/no`).
- CLI `gate-check`: коли `require_design_brief: true` і diff торкається `src/`, гейт додатково вимагає `design-brief.md` в активній зміні; opt-out для не-UI змін — рядок `Design: none` у `proposal.md`.
- Документація: pipeline-діаграма і таблиця ролей у `templates/AGENTS.md`, `templates/CLAUDE.md`, правила `.agents/rules/agent-orchestration.mdc` і `openspec-workflow.mdc`, скіл `agent-orchestration`, `README.md`.
- Smoke-тести: init встановлює `opsx-design.md`; gate-check сценарії для brief-гейта.

## Capabilities

### New Capabilities

- `design-intake`: опційна фаза захвату дизайну — команда, роль, артефакт design brief, brief-гейт у CLI.

### Modified Capabilities

_Немає — існуючі специфікації (`kit-ci-verify`, `gitlab-consumer-verify`) не змінюються._

## Impact

- `templates/.agents/commands/opsx-design.md` — новий файл.
- `templates/orchestrator.yaml`, `profiles/*/orchestrator.yaml` — роль + прапорець.
- `bin/agent-orchestrator.js` — `status` (brief-рядок), `gate-check` (brief-гейт), `readPipelineConfig` (новий прапорець).
- `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/.agents/rules/*.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `README.md` — документація.
- `test/smoke.test.js` — нові тести init/gate-check/status.
- Сумісність: прапорець default `false` — існуючі consumer-проєкти не зачеплені; `update` доставить нову команду як звичайний template-файл.

## Non-goals

- Жодних змін у published-скілах репозиторію frontend-agent-skills (контент brief-плейбука вже там: `design-transfer`, `design-from-screenshot`, `figma-intake`).
- Без visual-regression / screenshot-diff у CI.
- Без менеджменту Figma-токенів чи вбудованого MCP-клієнта — kit лишається оркестрацією, не інтеграцією.
- Без обов'язкового brief за замовчуванням — тільки opt-in прапорець.
