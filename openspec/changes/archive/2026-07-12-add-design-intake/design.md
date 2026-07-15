# Design: add-design-intake

## Context

Пайплайн kit: `explore → propose → review → apply → verify → archive`. Ролі описані командами-шаблонами в `templates/.agents/commands/opsx-*.md`, конфіг — `templates/orchestrator.yaml` + 4 профілі. CLI (`bin/agent-orchestrator.js`, ~720 рядків, commander) вже має детерміністичні перевірки: `status` (парсить `tasks.md` і `review.md` через `parseTasksProgress`/`parseReviewVerdict`), `gate-check` (через `readPipelineConfig` + `gitDiffTouchesGlob`). Дизайн-контекст (Figma, скріншоти) ніде не фіксується — він живе в чаті apply-сесії і зникає.

Парний change у репо frontend-agent-skills (`add-design-transfer-skill`) вже додав published-скіли з методологією brief. Цей change додає **процесну** частину: коли brief створюється, хто його пише, і як він гейтиться.

## Goals / Non-Goals

**Goals:**

- Опційна фаза design-intake між explore і propose (або перед apply) з окремою роллю і командою `/opsx:design <name>`.
- Один durable-артефакт: `openspec/changes/<name>/design-brief.md` + `assets/` (референс-зображення).
- Детерміністичний brief-гейт у `gate-check` і видимість brief у `status`.
- Зворотна сумісність: default `require_design_brief: false`, жодних breaking-змін для consumer-проєктів.

**Non-Goals:**

- Контент методології переносу (це published-скіли іншого репо).
- Visual-regression CI, Figma-токени, MCP-клієнти.
- Автодетекція "UI-зміни" через аналіз diff — тільки явний opt-out маркер.

## Decisions

1. **Окрема команда `/opsx:design`, а не розширення `/opsx:explore`.** Intake пише файли (`design-brief.md`, `assets/`), а explore — строго read-only; змішування зламало б наявний контракт ролей. Альтернатива — дозволити explore писати brief — відхилена: розмиває "no code edits in explore" і ускладнює гейти.
2. **Brief живе в change-директорії, не в `openspec/specs/`.** Brief прив'язаний до конкретної зміни і архівується разом з нею; specs — довгоживучі вимоги. Альтернатива — окремий top-level `design/` каталог — відхилена: губиться зв'язок зміна↔дизайн і ускладнюється archive.
3. **Гейт: `require_design_brief` + маркер `Design: none`.** Детерміністика без AI: якщо прапорець `true` і diff торкається `src/`, активна зміна мусить мати `design-brief.md`, ІНАКШЕ `proposal.md` мусить містити рядок `Design: none` (не-UI зміна). Альтернативи: (а) вимагати brief для всіх змін — хибні спрацювання на бекенд-змінах; (б) детектити UI-файли по glob — крихко і стек-залежно. Реалізація дзеркалить `parseReviewVerdict`: нова `parseDesignBrief(changeDir)` + `hasDesignOptOut(changeDir)`.
4. **Роль у всіх профілях, прапорець default `false` всюди.** Навіть у `vue3` не вмикаємо за замовчуванням — увімкнення це рішення команди проєкту; профіль лише документує роль. `mvp` профіль отримує роль з приміткою, що в quick-режимі brief створюється тією ж сесією.
5. **Команда пише тільки `openspec/changes/<name>/design-brief.md` і `assets/`.** Дозволені шляхи перелічені в guardrails команди (як `review.md` у `opsx-review.md`). Формат brief у шаблоні команди — секції: Source (metadata: file key/node ids/capture date), Structure, Tokens, Reference images, Constraints, Confidence notes. Формат сумісний з brief-контрактом published-скіла `design-transfer`.
6. **Fallback ladder документується в команді.** Порядок: Figma MCP (одним проходом) → експортовані PNG/SVG → скріншоти → фото. Команда інструктує зберігати все в `assets/` негайно і ніколи не повертатись до Figma в apply.

## Config surface

```yaml
pipeline:
  require_spec_review: true
  require_design_brief: false   # new, opt-in
roles:
  design_intake:                # new
    command: /opsx:design
    mode: brief-only            # writes only design-brief.md + assets/
    model_hint: strong          # vision-capable
```

`readPipelineConfig` додатково повертає `requireDesignBrief` (парсинг того ж рівня, що `require_spec_review`).

## README / Docs / Test Impact

- **templates/AGENTS.md, CLAUDE.md**: pipeline-діаграма з опційною фазою `[design]`, рядок ролі в таблиці, гейт у Handoff Gates, рядок у Context to Pin (`@openspec/changes/<name>/design-brief.md` для Implementer).
- **templates/.agents/rules/agent-orchestration.mdc, openspec-workflow.mdc**: команда `/opsx:design` у списках Role Commands і Command → Skill Mapping.
- **templates/.agents/skills/agent-orchestration/SKILL.md**: роль, handoff design→propose/apply, анти-патерн "живий Figma у apply".
- **README.md**: розділ про design-intake і прапорець.
- **test/smoke.test.js**: (1) init кладе `opsx-design.md` і `orchestrator.yaml` містить `design_intake`; (2) gate-check: `require_design_brief: true` + зміни в `src/` + немає brief → exit 1; (3) те саме + `Design: none` у proposal → pass; (4) те саме + `design-brief.md` існує → pass; (5) `status` показує `brief: yes/no`.

## Risks / Trade-offs

- [Маркер `Design: none` — рядок у вільному тексті proposal] → парсимо регекспом по рядку (`/^Design:\s*none/mi`), документуємо точний формат у команді й правилах; хибно-негативний випадок безпечний (гейт лише вимагатиме brief).
- [Ще один прапорець збільшує матрицю конфігів] → default `false`, обидва гейти незалежні; smoke-тести покривають обидві гілки.
- [У consumer-проєктах після `update` з'явиться команда, але не роль у їхньому orchestrator.yaml] → `update` не перезаписує конфіг користувача навмисно; README описує ручне ввімкнення (3 рядки yaml). Команда без ролі працює як звичайний слеш-шаблон.
- [Великі `assets/` роздувають git] → команда інструктує стискати до розумного розміру (PNG, ~1–2 зображення на breakpoint) і не класти сирі відео/PSD.

## Open Questions

- Чи показувати brief-рядок у `status` завжди, чи лише коли `require_design_brief: true`? Пропозиція: завжди (дешево і корисно) — фінальне слово за reviewer.
