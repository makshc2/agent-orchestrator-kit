# Tasks: add-design-intake

## 1. Команда і шаблон brief

- [x] 1.1 Створити `templates/.agents/commands/opsx-design.md`: роль Design Intake, дозволені шляхи запису (`design-brief.md`, `assets/`), fallback ladder джерел (Figma MCP одним проходом → експорт → скріншот → фото), повний шаблон brief (Source, Structure, Tokens, Reference images, Constraints, Confidence notes), правило маркерів впевненості для растрових джерел, guardrails у стилі `opsx-review.md`

## 2. Конфігурація ролей

- [x] 2.1 Додати роль `design_intake` (command `/opsx:design`, mode `brief-only`, model_hint `strong`) і `pipeline.require_design_brief: false` у `templates/orchestrator.yaml`
- [x] 2.2 Додати те саме в `profiles/generic/orchestrator.yaml`, `profiles/vue3/orchestrator.yaml`, `profiles/node/orchestrator.yaml`; у `profiles/mvp/orchestrator.yaml` — з приміткою про quick-режим

## 3. CLI

- [x] 3.1 `bin/agent-orchestrator.js`: розширити `readPipelineConfig` полем `requireDesignBrief` (default false, за зразком `requireSpecReview`)
- [x] 3.2 Додати `parseDesignBrief(changeDir)` (існування `design-brief.md`) і `hasDesignOptOut(changeDir)` (регексп `/^Design:\s*none/mi` по `proposal.md`)
- [x] 3.3 `status`: вивести рядок `brief: yes/no` для кожної активної зміни
- [x] 3.4 `gate-check`: після review-гейта, коли `requireDesignBrief` і diff торкається `src/` — fail з підказкою `/opsx:design <name>`, якщо немає brief і немає opt-out

## 4. Документація

- [x] 4.1 `templates/AGENTS.md` і `templates/CLAUDE.md`: опційна фаза design у pipeline, рядок ролі в таблиці, гейт у Handoff Gates, `design-brief.md` у Context to Pin для Implementer
- [x] 4.2 `templates/.agents/rules/agent-orchestration.mdc` (Role Commands + Session Rules) і `openspec-workflow.mdc` (Command → Skill Mapping)
- [x] 4.3 `templates/.agents/skills/agent-orchestration/SKILL.md`: роль у таблиці, handoff design→propose, анти-патерн "живий Figma MCP у apply-сесії"
- [x] 4.4 `README.md`: розділ Design intake (фаза, прапорець, маркер `Design: none`, ручне ввімкнення для існуючих проєктів після `update`)

## 5. Тести і верифікація

- [x] 5.1 `test/smoke.test.js`: init (профіль generic) кладе `.agents/commands/opsx-design.md`, а `orchestrator.yaml` містить `design_intake` і `require_design_brief`
- [x] 5.2 `test/smoke.test.js`: gate-check сценарії — brief відсутній → exit 1; `Design: none` у proposal → pass; `design-brief.md` існує → pass; прапорець вимкнено → brief не перевіряється
- [x] 5.3 `test/smoke.test.js`: `status` виводить `brief: yes/no`
- [x] 5.4 Запустити `npm test` — усі тести проходять
- [x] 5.5 Запустити `npx openspec validate add-design-intake --strict --type change` — проходить
