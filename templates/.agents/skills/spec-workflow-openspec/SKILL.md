---
name: spec-workflow-openspec
description: Користувач використовує OpenSpec (@fission-ai/openspec), а не SpecKit/Specify. Застосовуй при spec-driven workflow, плануванні фіч, згадках SpecKit, Specify, .specify/, specify-rules, або коли треба обрати інструмент специфікацій. Не налаштовуй SpecKit — використовуй OpenSpec і skill openspec-howto.
---

# Spec workflow: OpenSpec, не SpecKit

## Перевага користувача

**OpenSpec** — spec-driven workflow у проєктах.  
**SpecKit / Specify** — **не використовується**.

Не пропонуй і не налаштовуй:
- `.specify/`
- `specify-rules.mdc`
- SpecKit CLI, `/speckit.*` команди
- інтеграції `cursor-agent` / `.specify/integration.json`

## Що використовувати замість SpecKit

| SpecKit | OpenSpec |
|---------|----------|
| `.specify/` | `openspec/` |
| `specify-rules.mdc` | `openspec/config.yaml` |
| SpecKit commands | `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, `/opsx:archive` |
| `.specify/init-options.json` | `openspec/config.yaml` + npm scripts |

## Структура OpenSpec

```
openspec/
├── config.yaml
├── specs/<domain>/spec.md
└── changes/
    ├── <change-name>/
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   └── specs/<domain>/spec.md
    └── archive/
```

## Коли застосовувати

- Планування фічі або рефакторингу — `/opsx:propose <kebab-name>`
- Невизначений скоуп — `/opsx:explore`
- Реалізація затвердженого плану — `/opsx:apply`
- Після merge — `/opsx:archive`

## Детальний посібник

Для CLI, валідації, іменування changes і типових сценаріїв — читай skill **`openspec-howto`**.

## Vue skills + Amp

При встановленні `vue-cursor-skills`:
- дзеркалюй `.cursor/skills/` → `.agents/skills/`
- **не** налаштовуй SpecKit
- якщо в проєкті є `openspec/` — дотримуйся OpenSpec workflow
