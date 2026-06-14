---
name: openspec-howto
description: Посібник з використання OpenSpec CLI (@fission-ai/openspec) у проєктах. Команди /opsx:explore, /opsx:propose, /opsx:apply, /opsx:archive — коли використовувати кожну; CLI list, validate, status, show — що роблять і коли; як називати changes, delta-спеки, артефакти, типові сценарії. Використовуй коли користувач питає "як працює OpenSpec", "openspec list validate status show", "/opsx", "openspec workflow", "як архівувати change".
---

# OpenSpec — посібник

Spec-driven workflow на базі `@fission-ai/openspec` (профіль `core`).

## Архітектура

```
openspec/
├── config.yaml          # контекст проєкту для AI
├── specs/               # source of truth після archive
│   └── <domain>/spec.md
└── changes/
    ├── <change-name>/
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   └── specs/<domain>/spec.md   # delta
    └── archive/
```

- `changes/` — активна робота
- `specs/` — як працює система (через archive)

## Чотири команди

### `/opsx:explore`
**Коли:** скоуп неясний, треба обговорити підхід.
**Що робить:** Q&A, пошук по коду, без файлів.

### `/opsx:propose <kebab-name>`
**Коли:** є чітка задача — фіча або серйозний баг.
**Що робить:** створює `openspec/changes/<name>/` з proposal/design/tasks/specs.
**Іменування:** `add-...`, `fix-...`, `refactor-...`, `migrate-...`.

### `/opsx:apply`
**Коли:** артефакти переглянуто, план затверджено.
**Що робить:** виконує `tasks.md`, пише код, ставить `[x]`.

### `/opsx:archive`
**Коли:** код merged у dev/main, build/lint OK.
**Що робить:** мерджить delta у `openspec/specs/<domain>/spec.md` (ADDED/MODIFIED/REMOVED) і переносить change у `archive/`.

## Цикл

```
ідея → /opsx:explore (опційно) → /opsx:propose <name>
     → review артефактів → /opsx:apply
     → npm run build → merge → /opsx:archive
```

## CLI (read-only — не змінює код)

| Команда | Навіщо |
|---------|--------|
| `list` | Активні changes або specs |
| `validate` | Формат артефактів (не Vue-код) |
| `status` | Прогрес артефактів одного change |
| `show` | Вміст change/spec у термінал |

### list
```bash
npm run openspec:list
npx openspec list --specs --sort name --json
```
Вивід: назва, `N/M tasks`, час оновлення.

### validate
```bash
npm run openspec:validate
npx openspec validate <name> --strict --type change
```
✓/✗ по кожному change. Якщо ✗ — дивись `status`.

### status
```bash
npx openspec status --change <name>
```
`[x]/[ ]` по proposal, design, specs, tasks.

### show
```bash
npx openspec show <name> [--type change|spec] [--json]
```

### Інше
```bash
npm run openspec:update
npx openspec archive <name>
npx openspec view
```

### Типовий порядок
`list` → `status --change <n>` → `validate` → `show <n>`

### CLI ↔ Cursor
- `/opsx:propose` → потім `status`, `validate`
- `/opsx:apply` → `list` показує оновлені tasks
- `/opsx:archive` → `npx openspec archive <name>`

## Коли OpenSpec потрібен

| Так | Ні |
|-----|-----|
| Нова фіча | Typo / текст кнопки |
| Зміна архітектури | Один стиль (1-2 рядки) |
| Серйозний баг | Прибрати console.log |
| Нова вимога | Дрібний eslint-fix |

**Правило:** якщо не змінюються вимоги системи і влазить у 1-2 рядки — без change.

## Шаблон запиту /opsx:propose

```text
/opsx:propose <kebab-name>

[Контекст]
Що зараз: ...

[Задача]
1-3 речення.

[Скоуп]
- файл A
- файл B

[Non-goals]
- не чіпати X

[Acceptance]
1) ...
2) `npm run build` clean

[API]   ← якщо релевантно
GET /api/v1/...
```

## Артефакти — хто пише що

| Файл | Draft | Уточнюєш | Фіналізує |
|------|-------|----------|-----------|
| `proposal.md` | агент | ти | ти |
| `design.md` | агент | ти + Q&A | ти |
| `tasks.md` | агент | ти (додаєш T-таски) | `/opsx:apply` |
| `specs/<domain>/spec.md` | агент (delta) | ти | `/opsx:archive` merge |

Редагуєш просто відкривши файл або кажеш агенту: «У change `X` додай у `tasks.md` пункт …».

## Delta — формат

```markdown
# Delta for <domain>

## ADDED Requirements

### Requirement: <назва>
Система ПОВИННА ...

#### Scenario: <ситуація>
- GIVEN ...
- WHEN ...
- THEN ...

## MODIFIED Requirements
### Requirement: <стара назва>
Нова поведінка.

## REMOVED Requirements
### Requirement: <що видаляємо>
```

Один сценарій ≈ один acceptance. Без коду в спеці.

## Типові сценарії

### Фіча
`/opsx:propose add-X` → review → `/opsx:apply` → build → merge → `/opsx:archive`

### Баг
`/opsx:propose fix-<symptom>` з proposal про root cause → `/opsx:apply` → smoke → `/opsx:archive`

### Не знаю як
`/opsx:explore` → `/opsx:propose` → далі стандартно

### Дрібниця
Без OpenSpec — просто правиш.

### Перерване apply
`npx openspec status --change <name>` → `/opsx:apply` (продовжує з `[ ]`)

## Часті помилки

- `/opsx:apply` без рев’ю → читай `tasks.md`
- 1 change на 10 різнотемних задач → розбий
- Не робиш `/opsx:archive` → втрачаєш source of truth
- Правиш `openspec/specs/` напряму → лише через archive
- Дрібниця через OpenSpec → накладні витрати

## Швидка пам’ятка

| Хочу | Команда |
|------|---------|
| Обговорити | `/opsx:explore` |
| Почати | `/opsx:propose <kebab>` |
| Зробити | `/opsx:apply` |
| Закрити | `/opsx:archive` |
| Active | `npm run openspec:list` |
| Валідація | `npm run openspec:validate` |
| Прогрес | `npx openspec status --change <n>` |
| Показати | `npx openspec show <n>` |

## Установка у новому проєкті

```bash
npm install -D @fission-ai/openspec@latest
npx openspec init --tools cursor --force --profile core
```

Додай у `package.json`:

```json
"openspec:list": "openspec list",
"openspec:validate": "openspec validate --all",
"openspec:update": "openspec update --force"
```

Заповни `openspec/config.yaml` контекстом проєкту (стек, мова, правила).

## Інтеграція з PR / онбордингом

- PR description: лінк на `openspec/changes/<name>/proposal.md`
- Онбординг: показуєш `openspec/specs/`
- Документація системи: ростe сама з archived changes
