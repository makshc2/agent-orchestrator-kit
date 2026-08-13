## Context

Кіт уже розділяє фази по **нових чат-сесіях** і вже має Memory MCP плюс шість apply-орієнтованих субагентів. На практиці батько ігнорує каталог і робить етап сам; на виході не пише Memory; на вході нової сесії ніхто не читає стан. Користувач змушений щоразу вручну збирати «що було / що далі / яку команду запустити».

Це cross-cutting зміна шаблонів агентів (команди, rules, skills, subagents), не runtime-сервіс. IDE не вміє відкрити новий чат за агента — єдиний ручний крок, який лишається, це вставити згенерований промпт (або сказати «продовжуй», якщо start-протокол знайде `handoff.md`).

## Goals / Non-Goals

**Goals:**

- На кожній фазі OpenSpec conductor **зобов’язаний** делегувати спеціалісту з таблиці; сам не пише код/артефакти спеціаліста
- Старт сесії **завжди** відновлює контекст (prompt → `handoff.md` → Memory), без прохання користувача «нагадай, де ми»
- Кінець сесії **завжди** оновлює Memory, пише `handoff.md` і друкує промпт наступної сесії (текст для paste, без службового ярлика)
- Автономність спеціаліста: самодостатній промпт, структурований звіт, без мікроменеджменту
- Amp: wrappers змушують spawn isolated subagent, без Plugin API в цьому change

**Non-Goals:**

- Автоматично відкривати новий чат Cursor/Amp (немає API)
- Окремий `pipeline-router` субагент (варіант B) або Amp `createAgent` plugin (варіант C)
- Змішувати фази в одній сесії
- Заміняти CI-verifier субагентом
- Нові CLI-команди; `handoff.md` не є артефактом схеми OpenSpec (`validate` його ігнорує)
- 15+ generic-агентів

## Decisions

### 1. Conductor у батьківській сесії, не router-субагент

Батько `/opsx:*` лишається роллю пайплайну (explore/propose/…). Він читає таблицю і викликає `Task` (Cursor) / spawn (Amp). Робота спеціаліста в батькові = порушення правила.

**Чому не router-субагент:** зайвий рівень, вкладеність Cursor обмежена двома рівнями, `description` «обирає інших» знову generic. Таблиця в always-apply rule детермінованіша.

**Альтернатива:** сподіватись на автоделегування Cursor за `description` — відхилено, це поточний провал.

### 2. Таблиця маршрутизації (ексклюзивна)

Один сигнал → один primary субагент. Негативний роутинг у `description` обов’язковий (`Do NOT use for …`).

| Фаза / сигнал | Субагент | Readonly | Батько НЕ робить |
|---------------|----------|----------|------------------|
| статус / наступна команда | `openspec-guide` | так | — |
| зламаний кіт / MCP / sync | `setup-doctor` | ні (лише kit-файли) | бізнес-код |
| `/opsx:explore` дослідження репо | `codebase-explorer` | так | спеки, код |
| `/opsx:design` | `design-intake` | ні (brief+assets) | `src/` |
| `/opsx:propose` артефакти | `spec-architect` | ні (`openspec/changes/` лише) | `src/` |
| `/opsx:review` | `spec-reviewer` | так + `review.md` | імплементація |
| apply, UI з brief/Figma | `design-implementer` | ні | тести, архітектура |
| apply, звичайна таска | `code-writer` (одна таска) | ні | checkbox `tasks.md` |
| apply, після коду | `test-writer` | ні | фічі |
| apply → перед PR | `code-reviewer` | так | `/opsx:review` |
| `/opsx:archive` merge delta | `spec-archiver` | ні (specs+archive) | нові фічі |

`spec-reviewer` ≠ `code-reviewer`. Перший — гейт proposal до apply; другий — diff vs spec після apply.

Існуючі шість агентів **посилюються**: чіткіший `description` з ALWAYS / Do NOT, контракт звіту, заборона ставити `[x]` у `code-writer`.

Нові файли в `templates/.agents/subagents/`. Sync як і зараз → `.cursor/agents/`, `.claude/agents/`, Amp wrappers.

### 3. Контракт звіту спеціаліста

Кожен субагент завершує так:

```
## Subagent report: <name>
**Status:** done | blocked
**Files:** …
**Done:** …
**Blocked:** …
**Risks:** …
```

Conductor перевіряє звіт, лише тоді ставить `[x]` / пише `review.md` (для spec-reviewer — він сам пише `review.md`, це єдиний дозвіл ролі). `code-writer` **не** чіпає чекбокси.

### 4. Handoff — три шари, один контракт

IDE не шарить контекст між чатами. Тому:

| Шар | Навіщо | Якщо недоступний |
|-----|--------|------------------|
| Memory MCP `Change:` / `Handoff:` / `Decision:` | **основне сховище** стану між сесіями | warn + читати `handoff.md` |
| `openspec/changes/<name>/handoff.md` | дзеркало Memory у гілці | — обов’язковий запис навіть якщо MCP down |
| Промпт у чаті | запускає роль і **наказує прочитати Memory** | start без paste все одно читає Memory, потім файл |

Порядок на виході **суворий**: Memory → файл → промпт. Промпт не дублює саммарі сесії — він дає задачу прочитати вже записане Memory. Саммарі живе в entities і в `handoff.md`.

**Чому файл у change, не `.agents/cache/handoffs/`:** cache локальний і порожній; `handoff.md` їде з гілкою, наступна сесія на іншій машині його бачить. OpenSpec `validate` зайві md ігнорує.

**Чому Memory все одно обов’язковий attempt:** користувач може сказати «продовжуй apply» без paste і без `@handoff.md`. Graph зручний, якщо MCP підключений. Правило: спробувати записати/прочитати; відсутність MCP ≠ провал сесії.

### 5. Протокол старту (automatic, до відповіді користувачу)

Always-apply + кожна `/opsx:*`:

1. Оголосити роль.
2. `npx agent-orchestrator-kit status` / `npx openspec list`.
3. Відновити, у цьому порядку:
   - виконати `/opsx:<phase>` з pasted промпта, якщо він є;
   - **прочитати Memory** `Change:<name>`, `Handoff:<name>`, `Decision:*` (це основна задача старту);
   - якщо Memory MCP недоступний або entities порожні — прочитати `openspec/changes/<active>/handoff.md`.
4. Якщо один active change і `handoff.next_command` відомий, а користувач написав вільно («продовжуй», «далі») — виконати ту команду, **не** питати «яка фаза?».
5. Потім спавнити субагентів фази. Не робити їхню роботу в батькові.

Це і є «щоб не робити кожного разу самому»: paste задає роль і наказує прочитати Memory; без paste кіт все одно читає Memory, потім `handoff.md`.

### 6. Протокол виходу (не можна пропустити)

Фаза не вважається закритою, поки conductor не:

1. Оновить Memory (якщо MCP є):

   | Entity | Поля |
   |--------|------|
   | `Change:<name>` | `status`, `tasks n/m`, `last_role`, `review` |
   | `Handoff:<name>` | `next_role`, `next_command`, `session_count`, `summary`, `blocked` |
   | `Decision:<topic>` | кожне рішення сесії |

2. Запише `handoff.md` за шаблоном (секції: Closed role, Done, Decisions, Blocked, Next command, Attach, Subagents to spawn, готовий prompt).

3. Надрукує в чаті один fenced блок **після** успішного (або failed-with-warn) запису Memory. Без службового ярлика. Перший рядок — команда фази (ідентифікатор лишається англійським: `/opsx:review`). **Тіло промпта — мовою `project.agent_language`** з `.agents/orchestrator.yaml` (для `uk` — українською). Англійська не потрібна моделям для якості; це був лише дефолт чернетки. Промпт наказує прочитати Memory, не дублює саммарі.

Приклад при `agent_language: uk`:

```
/opsx:<next> <name>

Починаю сесію <Роль> для change: <name>
Перед будь-якою роботою прочитай Memory: Change:<name>, Handoff:<name>, Decision:*.
Якщо Memory MCP недоступний — прочитай openspec/changes/<name>/handoff.md.
Ти conductor: спавни субагентів за таблицею. Не змішуй фази.
```

4. **Не** починає наступну фазу в цьому чаті.

`/opsx:quick` (mvp): handoff всередині сесії не емітиться між propose і apply; на виході quick — один prompt на verify/archive.

### 7. Конфіг

У `templates/orchestrator.yaml` і профілях розширити `handoff:`:

```yaml
handoff:
  explore_to_propose: decision_brief
  propose_to_review: validate_strict
  review_to_apply: explicit_approve
  apply_to_verify: all_tasks_checked
  restore_on_start: true
  persist_on_exit: true
  emit_next_session_prompt: true
```

Прапорці документаційні для агента (як інші handoff-ключі зараз). CLI їх не енфорсить — немає хука «кінець чату».

### 8. Amp wrappers

У генераторі (`bin/agent-orchestrator.js` + `sync-local-agent-skills.sh`) додати преамбулу після frontmatter:

> Parent MUST run this skill as an isolated subagent (fresh context). Do not execute in the main thread. Return only the structured subagent report.

Тіло як і зараз копіюється з `.agents/subagents/<name>.md`. Plugin `createAgent` — поза скоупом.

### 9. Документація vs «файли — єдиний контракт»

README зараз каже: *no shared memory between sessions, only files*. Уточнити: **source of truth лишається OpenSpec-файли**; Memory і `handoff.md` — індекс «де ми в циклі», не заміна `proposal.md`/`tasks.md`.

## Risks / Trade-offs

- **[Risk] Модель ігнорує MUST spawn** → Mitigation: таблиця в трьох місцях (always-apply, skill, кожна команда); негативний роутинг; smoke перевіряє наявність рядків, не runtime LLM.
- **[Risk] Memory MCP часто відключений** → Mitigation: `handoff.md` + prompt самодостатні; MCP best-effort.
- **[Risk] Забагато субагентів (~11)** → Mitigation: кожен має унікальний слот у таблиці, не «helper»; не додавати інших у цьому change.
- **[Trade-off] Людина все одно відкриває новий чат** → прийнято: кіт генерує 100% тексту вставки; start без paste теж працює.
- **[Risk] spec-architect у propose пише артефакти, а validate робить батько** → Mitigation: conductor після звіту ганяє `openspec validate --strict` сам (дешево, не спеціаліст).
- **[Risk] Два active changes (`figma-token-setup` + цей)** → Mitigation: перед apply заархівувати complete change; у proposal вже зазначено.

## Migration Plan

1. Implement шаблони + генератор wrappers + yaml прапорці + docs + smoke.
2. Реліз kit minor (після bump у apply).
3. Консюмери: `npx agent-orchestrator-kit@latest update` і `sync`.
4. Rollback: `update` на попередню версію; `handoff.md` у старих changes безпечно лишити.

## Open Questions

Немає — paste лишається свідомим ручним кроком; автостарт нового чату не обіцяємо.
