# Design: Lean pipeline v2

## Огляд

Вартість фази має бути пропорційна її невизначеності:

```
Фаза       Невизначеність   Виконання v2
──────────────────────────────────────────────────────────────
propose    висока           parent + spec-architect (як зараз),
                            вихід — самодостатній план (task-контракт)
review     середня          Tier 1 скрипт → Tier 2 LLM → apply-notes.md
apply      низька           parent пише код САМ по tasks+notes,
                            субагенти опційні
archive    ~нульова         один CLI-виклик, без субагентів
handoff    нульова          CLI + parent, субагент лише fallback
```

## 1. `archive` CLI (bin/agent-orchestrator.js)

Нова команда `archive <name>`:

1. Резолв change через `npx openspec status --change <name> --json` (spawn openspec як child process, як існуючі команди).
2. Гейти (порядок, перший що падає — у stderr, exit 1):
   - `review.md` існує і містить `Verdict: APPROVE` (лише коли `pipeline.require_spec_review: true` в `.agents/orchestrator.yaml`);
   - `tasks.md`: немає `- [ ]`;
   - target `changesDir/archive/YYYY-MM-DD-<name>` не існує.
3. Перед merge CLI робить snapshot вмісту кожного main spec-файлу, який буде змінено або створено. За `--sync` delta specs зливаються в `openspec/specs/` (простий merge ADDED/MODIFIED/REMOVED, як робить spec-archiver вручну).
4. `mv changeRoot → archive/YYYY-MM-DD-<name>`.
5. `npx openspec validate --all --strict`. Якщо валідація падає, CLI повністю відкочує операцію: відновлює main specs зі snapshot до стану перед sync, видаляє створені merge-ем spec-файли, повертає change на початковий шлях і завершується з exit 1.
6. Фінальний handoff: запис `handoff.md` в архівній папці (Closed role: Archiver, Next: none) + upsert memory.json; next-prompt не друкується (пайплайн завершено).
7. stdout: підсумок (change, schema, archive path, sync status) — parent-агент показує його as-is.

| Delta specs | Прапорці | Поведінка | Exit |
|---|---|---|---|
| присутні | `--sync` | merge і archive | 0 |
| присутні | без sync-прапорців | stderr вимагає явний `--sync` або `--no-sync --force`; нічого не переміщується | 1 |
| присутні | `--no-sync` без `--force` | відмова; нічого не переміщується | 1 |
| присутні | `--no-sync --force` | archive без merge | 0 |
| відсутні | будь-які або відсутні sync-прапорці | archive; sync-прапорці не впливають | 0 |

`opsx-archive.md` v2 (~1 KB): Session Start посилання → резолв імені (AskUserQuestion при неоднозначності) → `npx agent-orchestrator-kit archive <name> [--sync]` → показати stdout → Session Exit посилання. Жодних спавнів.

## 2. Task-контракт + gate-check лінт

Формат таска в tasks.md:

```markdown
- [ ] 2.1 Короткий заголовок
  Files: src/router/index.js, src/stores/auth.js
  Do: конкретна зміна, 1–3 рядки
  Done-when: перевірна умова або команда
```

Лінт у `gate-check` (нова функція, той самий файл CLI):

- парсер тасків: рядки `- [ ]`/`- [x]` + індентовані `Files:`/`Do:`/`Done-when:`;
- помилки: відсутнє поле; заборонені патерни в Do (`as needed`, `if necessary`, `update X` без деталей — регексп-список); `Files:` вказує на неіснуючий шлях поза `new file:`-префіксом;
- режими: `warning` (default, старі changes) / `strict` (exit ≠ 0) — керується `pipeline.task_contract: warn|strict|off` в orchestrator.yaml;
- виклик: `gate-check --tasks <name>` окремо і всередині `gate-check --review <name>`.

Правила пишуться також в `openspec/config.yaml` template (rules.tasks) — щоб propose-LLM генерував контрактні таски одразу.

## 3. Двоярусний review

`gate-check --review <name>` (Tier 1, скрипт):

1. `npx openspec validate <name> --strict --type change`;
2. task-контракт-лінт (п.2);
3. proposal.md містить секції `Non-goals` і `Acceptance criteria`;
4. delta specs: секції `ADDED|MODIFIED|REMOVED Requirements` присутні й непорожні.

Вихід: JSON-звіт `{pass, errors[]}` + людський stdout.

`opsx-review.md` v2:

- Крок 1: Tier 1. Якщо `pass: false` → одразу вивести REQUEST CHANGES з помилками скрипта, записати `review.md` (Verdict: REQUEST CHANGES, джерело: gate-check), HARD STOP. Артефакти LLM не читає.
- Крок 2 (Tier 1 OK): spawn `spec-reviewer` (як зараз, обов'язково) зі скороченим чеклістом — лише LLM-питання: узгодженість proposal↔design↔tasks, конфлікти з main specs, scope creep, «чи виконає таск сліпий виконавець без design.md»;
- Крок 3: при APPROVE spec-reviewer додатково пише `openspec/changes/<name>/apply-notes.md`: ≤ 20 рядків — критичні констрейнти, підводні камені, що НЕ чіпати, команди перевірки. Це другий дозволений файл reviewer-а (поруч із review.md).

## 4. Apply без обов'язкового делегування

`opsx-apply.md` v2:

- читає: `tasks.md` + `apply-notes.md` (+ review-гейт як зараз). `design.md`/`proposal.md` — лише коли таск посилається на них або поле контракту неповне;
- parent пише код і тести сам, таск за таском, чекбокси ставить сам;
- субагенти: дозволені для ≥ 2 незалежних тасків без спільних файлів (паралелізація) або на явний запит користувача; `design-implementer` лишається для design-brief/Figma сигналу;
- escape-клапан (жорсткіший за поточний Pause): якщо таск вимагає інформації поза Files/Do/Done-when + apply-notes + згадані артефакти — STOP, записати gap у handoff.md, наступна команда `/opsx:propose <name>` (доповнення плану). Імпровізація заборонена текстом команди.

## 5. Handoff без субагента

- `templates/orchestrator.yaml` + profiles: `handoff.spawn_handoff_subagent: false` (default v2).
- Session Start (усі команди): `npx agent-orchestrator-kit status` → `handoff --restore` (CLI друкує briefing). Memory MCP не читається окремим кроком — CLI вже читає memory.json. Субагент `session-handoff` спавниться лише якщо CLI повернув помилку І `handoff.md` нечитабельний.
- Session Exit: parent сам пише `handoff.md` → `npx agent-orchestrator-kit handoff <name>` (exit 0) → paste stdout-prompt. Memory MCP крок — «якщо доступний, одним викликом; недоступність не блокує».
- `session-handoff.md` субагент: description змінюється на fallback-only.

## 6. Дедуплікація і prompt caching

- Канонічні блоки Session Start / Session Exit живуть лише в `templates/.agents/rules/session-handoff.mdc` (always-apply). У кожній opsx-команді замість ~2 KB — рядок: «Session Start/Exit: виконай протокол із `.agents/rules/session-handoff.mdc`».
- Порядок контексту стабільний: always-apply rules → команда → динаміка (status output, handoff briefing). Команди не містять динамічних плейсхолдерів у верхній частині.

## Trade-offs

- **CLI-merge delta specs (archive --sync) простіший за LLM-merge**: покриває стандартні ADDED/MODIFIED/REMOVED; конфліктний merge (перетин requirement-ів) CLI детектує і відмовляється — тоді разовий шлях через skill `openspec-sync-specs` лишається. Альтернатива «завжди LLM» відкинута через вартість.
- **Apply в parent-треді** втрачає ізоляцію контексту субагентів, але план уже зафіксований і провалідований — ризик компенсують task-контракт + escape-клапан + verify/CI. Альтернатива «субагент на таск» лишається доступною опцією.
- **apply-notes.md — ще один артефакт**, але він скорочує вхідний контекст найдовшої фази (apply читає 2 файли замість 4+) і пишеться під час уже оплаченого review-контексту.
- **Warning-режим лінта за замовчуванням** — м'яка міграція; strict вмикається у профілях свідомо. Альтернатива «одразу strict» зламала б активні changes консюмерів.

## Ризики

- Регресія якості apply без субагент-ізоляції → мітигація: strict task-контракт у профілях generic/vue3/node після обкатки.
- CLI archive на нестандартних схемах (не spec-driven) → використовує лише status JSON поля (artifactPaths, changesDir), без хардкоду імен файлів; tasks-гейт пропускається, якщо tasks-артефакту немає в схемі.
- Консюмери зі старими командами після `update` + `sync` отримують нові тонкі команди автоматично; змішаний стан (стара команда + новий CLI) працює — CLI-гейти самодостатні.
