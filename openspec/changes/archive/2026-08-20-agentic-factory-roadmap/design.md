## Context

`agent-orchestrator-kit` v0.3.0 постачає spec-driven пайплайн `explore → [design] → propose → review → apply → verify → archive`, 12 субагентів, task-контракт (`gate-check --tasks`), двоярусний review (`gate-check --review` → `spec-reviewer` → `apply-notes.md`), archive CLI і parent-driven handoff (`handoff` / `handoff --restore` + `memory.json`).

Тобто control plane фабрики вже існує. Дірки — не в архітектурі пайплайна, а в трьох місцях, які проявляються у щоденній роботі над Vue 3 консюмерами:

| Стовп фабрики | Стан у kit | Розрив |
|---|---|---|
| Governance | `gate-check` детермінований, спека прямо каже «придатний для CI або pre-commit» | хука немає — локальний `git commit` у `src/` проходить без `Verdict: APPROVE` |
| Perceive (tools) | `memory` (baseline) + `figma` (launcher, env-file, `figma-setup`, `figma-status`, never-print-token); CI вже вміє `--ci github\|gitlab` | `github` і `browser` є лише рядками в `mcp.optional`; **gitlab у списку немає**; робочі репо на GitLab, особисті на GitHub |
| Workspace | `openspec/changes/<name>/` у git, `handoff.md` всередині change | cloud-run пише артефакти на VM; без commit/push вони не існують для ноутбука (кейс: гілка `cursor/agentic-factory-gap-analysis-a18e` з gap-аналізом, якої немає на GitHub) |
| Reason (decisions) | `Decision:<topic>` у `.cursor/memory.json` | `memory.json` у gitignore — рішення не видно в PR/MR і колезі |
| Skills | `.agents/skills/` + Amp `subagent-*` wrappers + delete-stale sync | немає машинного інвентарю «які skills мають бути живі для профілю» |
| Sandbox / Control Plane | Cursor sandbox | немає — і для Vue-apply не потрібен |

Оцінка зрілості: ~80% як workflow-фабрика для spec-driven розробки, ~50% як enterprise-платформа. Цінність для власника — у перших 20% процесу, не в платформенних 50%.

Constraints, які диктує сам kit: `pipeline.max_active_changes: 1`, `require_spec_review: true`, apply не стартує без явного Approve, archive після merge. Отже роадмап **не може** бути одним великим change — інакше він порушує правила, які сам описує.

## Goals / Non-Goals

**Goals:**

- Зафіксувати в git послідовність фаз розвитку kit-а до Agentic Factory з явними межами кожної фази.
- Прив'язати кожну фазу до стовпа фабрики і до конкретного болю в щоденному циклі.
- Зробити перехід між фазами перевірним: одна фаза = один change, наступна не стартує до archive попередньої.
- Відсікти платформенний скоуп (runtime, sandbox, dashboard) у Phase 4 з окремим рішенням.

**Non-Goals:**

- Будь-який код у цьому change (`bin/`, `templates/`, `profiles/`, `scripts/`).
- Новий пайплайн або друга модель ролей поверх наявної.
- Зовнішній orchestration runtime: LangGraph, CrewAI, Temporal.
- Hosted Control Plane API, Vue-dashboard run-ів, multi-tenant, RBAC, token accounting.
- Docker sandbox.
- Відновлення cloud-VM гілки з попереднім gap-аналізом.

## Decisions

### D1. Планувальний change замість `docs/agentic-factory.md`

Роадмап живе як OpenSpec change → після `/opsx:archive --sync` вимоги переїжджають у `openspec/specs/agentic-factory-roadmap/spec.md` і стають source of truth, який читає кожна наступна propose-сесія.

Альтернативи: (а) markdown у `docs/` — не потрапляє в контекст архітектора, не валідується, роз'їжджається зі спеками; (б) issues на GitHub — стан поза репо, недоступний агенту без GitHub MCP (якого ще немає — Phase 1). Відкинуто обидві.

### D2. Одна фаза = один change, порядок фіксований

```
agentic-factory-roadmap          ← цей change: карта, docs-only
add-factory-gates-and-mcp        ← Phase 1: governance + tools
add-factory-memory-and-skills    ← Phase 2: decisions у git + skill manifest
add-cloud-agent-handoff          ← Phase 3: cloud/local один workspace
(add-factory-control-plane)      ← Phase 4: лише за окремим рішенням
```

Причина: `max_active_changes: 1` і метрики kit-а (4–8 сесій, ≤2 apply-ітерації, ≤1 review-loop). Один change «зробити фабрику» гарантовано вибиває обидві межі. Альтернатива «епік із трьома під-changes» відкинута: OpenSpec не має ієрархії epic→change, залежність тримається порядком і цією спекою.

### D3. Порядок фаз за критерієм «болить щодня»

Phase 1 перша, бо governance-розрив активний **на кожному commit**, а відсутність GitHub MCP — на кожному PR. Phase 2 (decisions, manifest) болить при передачі колезі. Phase 3 — при роботі з двох машин / cloud. Phase 4 не болить взагалі.

Альтернативний порядок «спочатку observability, потім гейти» відкинуто: логувати нічого, поки гейт не спрацьовує.

### D4. Phase 1 — pre-commit як opt-in, не як default для всіх профілів

Хук ставиться через явний прапорець `init` (напр. `--hooks`) і/або в профілі `vue3`; `mvp` (`require_spec_review: false`) — no-op. Причина: kit ставиться в чужі репо, які можуть мати власний husky/lefthook; безумовне переписування hooks-конфігу — регресія для консюмера.

Технічний напрям для Phase 1 (деталі — у власному design.md): shell-скрипт `templates/scripts/pre-commit-gate-check.sh`, який викликає `npx agent-orchestrator-kit gate-check`; підключення через `core.hooksPath` або наявний husky, якщо він у проєкті. Прямий запис у `.git/hooks/` без opt-in — заборонений.

### D5. Phase 1 — VCS/Browser MCP повторюють патерн Figma, а не вводять новий

Figma-патерн уже провалідований спекою `figma-token-setup`: `.agents/<tool>.local.env` (gitignored) + `.agents/<tool>.local.env.example` (committed) + `scripts/<tool>-mcp-launcher.cjs` + `<tool>-setup` / `<tool>-status` CLI, які **ніколи не друкують токен**, + запис у `mcp.json.example` / Amp settings без секрету.

Наслідок: Phase 1 не вигадує архітектуру, а тиражує наявну. Це також знімає ризик «токен у `.mcp.json`», який уже відкинутий у `figma-token-setup`. Те саме для `github`, `gitlab` і `browser`. Контракт launcher-а — stdio MCP, який підключається в усіх трьох IDE (див. D10), а не Cursor-native tool.

### D10. Повний паритет Cursor, Claude Code і Amp Code

Kit уже є multi-IDE (`.cursor/`, `.claude/`, Amp `.agents/skills/` + `subagent-*`). Фази 1–3 MUST зберігати цей паритет: можливість, яка працює в Cursor, MUST працювати в Claude Code і Amp Code без деградації («в Cursor є браузер, в Amp — ні»).

| Шар | Cursor | Claude Code | Amp Code |
|---|---|---|---|
| Пайплайн `/opsx:*` | є | є | є (ізольовані `subagent-*`) |
| Memory MCP | `.mcp.json` + launcher | той самий launcher | `amp.mcpServers` + той самий launcher |
| VCS MCP (Phase 1) | `.mcp.json` + launcher | той самий launcher | `amp.mcpServers` + той самий launcher |
| Browser MCP (Phase 1) | **stdio launcher kit-а**, не Cursor IDE browser | той самий launcher | той самий launcher |
| Pre-commit `gate-check` | git hook, поза IDE | те саме | те саме |
| Decisions / cloud→git | файли в git | те саме | те саме |

Правила:

1. Кожен новий MCP (`github`, `gitlab`, `browser`) ставиться через `scripts/<tool>-mcp-launcher.cjs` і потрапляє в **обидва** committed examples: `.agents/mcp.json.example` (Cursor/Claude) і Amp settings example. `npx agent-orchestrator-kit memory-setup` / майбутній `mcp-setup` оновлює живі конфіги всіх трьох, не лише `.mcp.json`.
2. Cursor IDE browser MAY існувати як додатковий інструмент сесії; він **не** закриває вимогу Browser MCP. Claude і Amp не мають того самого native browser — kit ставить портативний stdio-сервер.
3. Нові субагенти/skills фаз 1–3 синхронізуються як зараз: `.agents/` → `.cursor/agents/` + `.claude/agents/` + Amp `subagent-*` wrappers з ізоляцією головного треда.
4. Cursor Cloud Agent — окремий runtime. Після `git push` ту саму гілку відкривають Cursor Desktop, Claude Code і Amp. Phase 3 не робить Claude/Amp «cloud agents»; він робить артефакти видимими в усіх трьох через git.

Альтернатива «в Cursor native browser, в інших — skip» відкинута: це ламає `design-implementer` і перевірку Hydra UI в робочих сесіях Amp/Claude.

### D9. Хост коду: GitHub особисто, GitLab на роботі

Власник kit-а тримає **особисті** репозиторії (включно з `agent-orchestrator-kit`) на GitHub, а **робочі** Vue-консюмери — на GitLab, часто **self-hosted** (не `gitlab.com`). `--ci` керує лише шаблонами CI (`agent-verify.yml` vs `.gitlab/agent-verify.yml`). Phase 1 VCS MCP MUST визначати хост з `git remote get-url origin`, інакше робочий GitLab не побачать.

Правило детекції (канон для Phase 1):

1. Взяти URL `origin` (`git remote get-url origin`).
2. Якщо hostname — `github.com` → ставити GitHub MCP, GitLab MCP не ставити.
3. Інакше, якщо hostname — `gitlab.com` **або** містить `gitlab` **або** це відомий self-hosted GitLab origin → ставити GitLab MCP з **base URL з remote** (не хардкод `https://gitlab.com`). GitHub MCP не ставити.
4. `--ci` не перевизначає remote: GitLab origin + випадковий `--ci github` → усе одно GitLab MCP.
5. Немає remote / нерозпізнаний хост → не ставити жоден VCS MCP; `status` показує пропуск, не GitHub за замовчуванням.

| Контекст | Typical origin | Phase 1 VCS MCP | Рев’ю |
|---|---|---|---|
| Особисті репо / цей kit | `github.com/makshc2/...` | `github` | PR |
| Робочі Vue-консюмери | self-hosted GitLab (`gitlab.*.work` тощо) | `gitlab` + instance URL з remote | MR |

`mcp.optional` SHALL містити і `github`, і `gitlab`, і `browser`. Токени — окремі gitignored env-файли; робочий GitLab-токен і hostname інстанса не потрапляють в особистий GitHub-проєкт і навпаки.

Альтернатива «лише `--ci`» відкинута: CI-прапорець не знає self-hosted hostname, без нього GitLab MCP не підключить правильний API. Альтернатива «завжди обидва MCP» відкинута: зайві секрети й шум у `status`.

### D6. Phase 2 — файл у change канонічний, Memory MCP — дзеркало

`memory.json` лишається швидким індексом для старту сесії, але канон рішень — файл у git (`decisions.md` у change або секція в `design.md`, яку читає `handoff`). Напрям синхронізації: файл → Memory, ніколи навпаки.

Причина: `.cursor/memory.json` у `.gitignore` (за правилом memory-autosetup) — рішення, що живуть лише там, не існують для рев'ювера PR і для іншої машини.

### D7. Phase 3 — дисципліна workspace, а не Control Plane

Правило: агент (local або cloud) MAY писати лише в git-tracked шляхи; закриття сесії з незакомміченими OpenSpec-артефактами = incomplete handoff. Реалізація — поле `runtime: local|cloud` (+ `agent_id`) у `handoff.md`, попередження в `handoff` CLI, rule/skill для cloud-сесії.

Альтернатива «тягнути файли з VM через API» відкинута: залежність від зовнішнього стану, який kit не контролює.

### D8. Phase 4 — стеля, а не спринт

Audit log фаз, opt-in Docker sandbox, Control Plane API + dashboard стартують лише якщо Phase 1–3 живуть без тертя щонайменше у 2–3 консюмер-репо. Це інший продукт (платформа, не kit), і рішення про нього приймається окремо, з власним explore.

## Критерій переходу між фазами

Фаза вважається закритою, коли її change заархівований (`/opsx:archive --sync`), CI зелений, і `npx agent-orchestrator-kit status` не показує активних змін. Лише тоді стартує `/opsx:explore` наступної фази.

Phase 4 додатково вимагає підтвердженого досвіду Phase 1–3 у 2–3 проєктах.

## Мапінг фаз на пайплайн (як це відчувається в роботі)

Приклад: Hydra-логін у Vue-консюмері, після Phase 1.

| Крок | Дія | Що робить фабрика |
|---|---|---|
| 1 | новий чат `/opsx:explore` | `codebase-explorer`, decision brief |
| 2 | новий чат `/opsx:propose fix-hydra-hash-callback` | `spec-architect`, таски з Files/Do/Done-when |
| 3 | новий чат `/opsx:review` | Tier 1 `gate-check --review` → `spec-reviewer` → `apply-notes.md` |
| 4 | новий чат `/opsx:apply` | parent пише Vue 3 `<script setup>` / Pinia / Axios |
| 5 | `git commit` | **Phase 1**: pre-commit `gate-check` блокує без APPROVE |
| 6 | PR (GitHub) або MR (GitLab) | CI validate + lint + build; **Phase 1**: VCS MCP хоста читає checks |
| 7 | merge → `/opsx:archive --sync` | delta → `openspec/specs/` |

Кроки 1–4, 6 (CI), 7 працюють уже сьогодні. Phase 1 закриває 5 і Perceive у 6.

## Risks / Trade-offs

- **Роадмап застаріє, бо фази пишуться заздалегідь** → мітигація: фази 2–4 описані на рівні мети й меж, без деталей реалізації; кожна отримує власний `/opsx:explore` + `design.md`, де рішення уточнюються.
- **Спокуса зробити Phase 1 і Phase 2 одним change** → мітигація: delta spec робить «одна фаза = один change» перевірною вимогою, `max_active_changes: 1` тримає механічно.
- **Pre-commit hook ламає чужий husky/lefthook у консюмері** → мітигація: opt-in (D4), no-op при `require_spec_review: false`, документований спосіб відключення.
- **VCS MCP тягне секрет у репо** → мітигація: патерн Figma (D5); `github-status` / `gitlab-status` не друкують значення; токени ізольовані по хосту (D9).
- **GitHub-only MCP ламає робочі GitLab-репо** → мітигація: D9 — хост і GitLab instance URL з `git remote origin`, не з `--ci`.
- **Cursor-only MCP (IDE browser) ламає Claude/Amp** → мітигація: D10 — stdio launcher у `.mcp.json` і Amp settings; native Cursor browser не є контрактом.
- **Phase 4 «просочиться» в ранні фази як «маленький audit log»** → мітигація: явні non-goals у proposal і вимога окремого рішення в спеці.
- **Trade-off: карта коштує один повний цикл** (`propose → review → apply → archive`) без жодного рядка коду. Прийнято: вартість одного циклу нижча за вартість переробки Phase 1, зробленої без узгоджених меж.

## Migration Plan

Міграції немає — change нічого не змінює в наявних файлах. Rollback: видалити папку change (або не архівувати). Наявні консюмери не зачіпаються до Phase 1.

## Open Questions

- Phase 1: `core.hooksPath` чи husky-first, якщо в консюмері вже є husky? (вирішується в design.md Phase 1)
- Phase 2: `decisions.md` окремим файлом чи секцією `design.md`, яку парсить `handoff`?
- Phase 3: чи має `handoff --cloud-check` падати з non-zero, чи лишатись warning-ом?
