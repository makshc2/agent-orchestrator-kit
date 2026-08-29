## Context

Kit v0.5.0 уже має git-tracked `openspec/changes/<name>/metrics.json` і CLI `npx agent-orchestrator-kit metrics`: `metricsRecordSessionStart` на `handoff --restore`, `metricsRecordSessionEnd` на persist (роль з `closedRole`, фаза через `phaseForRole`, опційні `--model` / spend), `metricsFinalizeArchive` лише якщо файл існує, `--no-metrics`, null-honest агрегати. OpenSpec-спеки немає (`openspec/specs/change-metrics/` відсутня).

Аудит: (1) відсутній файл не блокує archive — `metricsFinalizeArchive` повертає `null`; (2) токени/вартість не підтягуються самі — лише з явних прапорців, які агенти пропускають; owner відхилив цей шлях і вимагає auto-collect з локальних файлів Cursor / Claude Code / Amp **окремими цифрами**, без фейкового unified bill; (3) користувач питає про **продуктові LLM**, а `phases.*.agents` / колонка `agents` друкують Closed role; `session.model` лишається `null` без `--model`; (4) паритет трьох IDE лишається тим самим CLI + sync rules; collect — read-only локальні адаптери, не SDK і не billing API; (5) у цьому репо жоден архів не має `metrics.json` — порожній spend після archive без локальних usage-файлів очікуваний.

Наявні спеки: `session-handoff` (протокол persist), `lean-archive` (гейті archive: APPROVE, усі `[x]`, sync-рішення). `orchestrator-cli-controls` (status / gate-check / sync) не змінюється.

## Goals / Non-Goals

**Goals:**

- Заспекати поведінку v0.5.0 і виправити D1–D12: модель = LLM product id; резолв flag/env/null з попередженням; auto-collect spend з трьох локальних адаптерів; показ окремо по платформі й моделі; spend null-honest і не гейт; archive завжди фіналізує `metrics.json`; паритет трьох IDE через CLI + rules + адаптери.
- Людська таблиця `metrics` розрізняє ролі пайплайна і LLM-моделі та друкує таблиці by platform / by model.
- Протокол Session Exit вимагає `--model <llm-product-id>`, описує auto-collect і забороняє роль/субагент як модель та вгадування токенів.

**Non-Goals:**

- Вигаданий unified bill (сума різнорідних одиниць в один $).
- Cursor SDK, server CSV, cookies; npm `better-sqlite3` / `sql.js` / `ccusage`; pricing table; конвертація Amp credits → USD.
- Парсер Claude `/cost` як обов'язковий крок; Amp billing API; network collect.
- Бекфіл історичних архівів, Phase 4 dashboard, нові ролі чи субагенти.
- Гейт persist/archive/`gate-check`/pre-commit на наявність моделі, spend або `metrics.json`.
- Таксономія/нормалізація назв моделей у CLI.
- Зміна `orchestrator-cli-controls`.

## Decisions

### D1. Model = LLM product id, ніколи роль/субагент

`session.model` і `phases.*.models` зберігають рядок, який передав агент/користувач або usage-запис адаптера (`claude-opus-5`, `claude-fable-5`, `gpt-5.6-sol`, `cursor-grok-4.6`, `claude-opus-4-7` — без вигаданої таксономії, без lowercasing). `session.role` і JSON-поле `phases.*.agents` лишаються Closed role (`Architect`, `Implementer`, `Archiver`). CLI не відхиляє значення на кшталт `Architect` — дисципліна живе в протоколі, не в валідаторі.

Альтернатива «колонка agents = моделі» відкинута: зламала б сенс наявного JSON і заплутала б «які агенти писали фазу».

### D2. Резолв моделі — flag/env, warn, ніколи fail persist

Пріоритет, коли в сесії немає `sources`: `--model` (непорожній після trim) → env `AOK_MODEL` (непорожній після trim) → `null`. Порожній рядок = відсутнє значення. Persist і archive MUST NOT завершуватись non-zero через `null`. При записі сесії з `model: null` CLI SHALL друкувати попередження в stderr (підказка передати `--model` або `AOK_MODEL`; не `log.warn` у stdout). Не викликати Cursor SDK / Claude `/cost` / Amp API, щоб дізнатись ім'я моделі. Якщо collect дав `sources`, primary model береться з D10.

Альтернатива «обов'язковий `--model` як гейт persist» відкинута: зламала б усі наявні сесії консюмерів одразу після `update`.

### D3′. Auto-collect на persist/archive; прапорці лише override totals

На `handoff <name>` (коли metrics увімкнено) і на `archive` finalize CLI MUST запускати локальні spend-колектори (D9). Явні `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` OVERRIDE лише session-level totals; вони MUST NOT витирати `spendByPlatform` / `spendByModel`, зібрані з файлів. Якщо `--total-tokens` немає, а override input або output є — `totalTokens` сесії = сума наявних override (як зараз). Ніколи не вгадувати. Ніколи не виводити USD з Amp credits. Дані, яких адаптер не знайшов, лишаються `null`, ніколи фейковим `0`. Persist/archive MUST NOT падати через порожній collect.

Альтернатива «лише прапорці, без адаптерів» відкинута owner-ом: агенти пропускають прапорці, цифри на трьох платформах не з'являються.

### D4. Archive завжди фіналізує metrics.json, ніколи не блокує

Після успішного move `metricsFinalizeArchive` MUST: завантажити файл або створити default (`loadMetricsFile` уже вміє); додати одну сесію Archiver (`role: Archiver`, `phase: archive`, `model` з ланцюжка D2/D10, `platform` з D5, `durationMs: null` — щоб `addNullable` не перетворив чесний null агрегатів на `0`); запустити collect для вікна Archiver (D3′/D11); виставити `archivedAt`, `pending: null`, `updatedAt`; перерахувати агрегати; зберегти. Завжди повертати шлях (прибрати early-return `null`). Якщо після цього `spend.costUsd` є `null` — `console.error` у stderr (Amp credits і заповнені токени не рятують цей warning; не перевіряти `sessions.length === 0` і не перевіряти всі `METRICS_SPEND_KEYS`). Exit code archive MUST NOT змінюватись через metrics.

Прапорці `--model` і `--platform` додаються до команди `archive` (ті самі resolver-и, що в persist); без прапорців працює env. Невалідний `--platform` MUST відхилятись **до** перевірки гейтів і move (exit 1), щоб не лишити напівзаархівований change. Явних spend-прапорців на archive немає: spend Archiver заповнює collect; якщо collect нічого не дав — spend-поля сесії `null`.

Альтернатива «залишити early-return» відкинута: саме вона дає «успішний archive без файлу».

### D5. Паритет трьох IDE — CLI + rules + локальні адаптери; platform flag/env/null

Той самий `npx agent-orchestrator-kit handoff` / `archive` / `metrics` на Cursor, Claude Code, Amp. Правила — `templates/.agents/rules/session-handoff.mdc` (sync). Немає Cursor SDK, парсера Claude `/cost` як обов'язкового кроку, Amp billing API. Локальний usage читають адаптери D9.

`session.platform`: `--platform cursor|claude|amp` → env `AOK_PLATFORM` (ті самі три значення, lowercase) → `null`. Невалідний `--platform` → persist/archive exit 1 (як невалідний `--runtime`). Невалідний непорожній `AOK_PLATFORM` → `null` + warning, не fail. Best-effort маркерів середовища **немає**: немає константи з низьким false-positive (урок `CURSOR_AGENT` з cloud-agent-handoff D1). `CURSOR_AGENT` MUST NOT виставляти `platform`.

### D6. Нова capability `change-metrics` + MODIFIED session-handoff + MODIFIED lean-archive

`change-metrics` спекає схему, restore/persist/metrics CLI, collect D9–D11, null-honest агрегати, `--no-metrics`, `--no-collect` і фікси D1–D12. `session-handoff` додає вимогу протоколу persist (не змінює наявні вимоги Memory/handoff). `lean-archive` додає фіналізацію metrics і collect на archive без зміни гейтів APPROVE / tasks / sync. Команду `metrics` MUST NOT вкладати в `orchestrator-cli-controls`.

### D7. Без бекфілу і без нових гейтів

Історичні архіви не мігруються. Phase 4 dashboard немає. Нових ролей/субагентів немає. `--no-metrics` лишається валідним opt-out на restore і persist. `gate-check` і pre-commit MUST NOT вимагати `metrics.json`.

### D8. JSON-поле `agents` не перейменовувати; таблиця друкує `roles` + `models`

Щоб не ламати `--json` і наявні файли, `phases.*.agents` лишається масивом Closed role. Людська таблиця MUST мати колонку `roles` (зміст `phase.agents`) і колонку `models` (зміст `phase.models`). Колонку з заголовком `agents`, яка друкує ролі й ховає моделі, MUST NOT лишати.

### D9. Три read-only локальні адаптери; без нових npm-залежностей; без мережі

Один persist/archive collect MUST викликати **усі три** адаптери (owner використовує Cursor + Claude + Amp на тих самих проєктах). Кожен адаптер read-only, offline, без API-ключів. Collect живе в `bin/spend-collect.js` і імпортується з `bin/agent-orchestrator.js`, щоб бути unit-testable. Нових npm-залежностей немає: `better-sqlite3`, `sql.js`, `ccusage` заборонені.

1. **claude** — `~/.claude/projects/<cwd-encoded>/*.jsonl`, де cwd-encoded будується з аргумента `collectSpend({ cwd })` (якщо `cwd` опущено — `process.cwd()`) заміною кожного `/` і кожного `.` на `-` (приклад: `/home/shevyakov.m/WebstormProjects/app` → `-home-shevyakov-m-WebstormProjects-app`). Парсити рядки assistant з `message.usage` + `message.model` (верифіковано: `input_tokens`, `output_tokens`, `cache_*`, model `claude-opus-4-7`). `inputTokens` = `input_tokens` плюс `cache_*`, якщо поля присутні. Вікно — поле рядка `timestamp` (не інше поле). Проєктний match — поле рядка `cwd` === цей `cwd`. `source: "claude-jsonl"`. Cost: `total_cost_usd` (або аналог на записі), інакше `costUsd: null`. Pricing table не постачати. id = `message.id`.

2. **amp** — `~/.local/share/amp/threads/*.json` (override `AMP_DATA_DIR` / `$XDG_DATA_HOME/amp`). Верифіковано: assistant `usage.model`, `usage.inputTokens` / `usage.totalInputTokens` / cache-поля, `usage.outputTokens`, `usage.timestamp`; **немає** `cwd` / `meta.cwd`. Проєктний match: порівняти `collectSpend` `cwd` (або `process.cwd()`, якщо аргумент опущено) з кожним `env.initial.trees[].uri` після зняття префікса `file://` (типово третій слеш: `file:///home/...` → `/home/...`). Multi-root: будь-яке дерево збігається — включити thread. Немає `trees` або масив порожній — пропустити thread. Не вигадувати `meta.cwd`. `inputTokens` = `usage.totalInputTokens`, якщо поле є, інакше `usage.inputTokens` плюс `cacheCreationInputTokens` і `cacheReadInputTokens`, якщо вони є. `ledger.jsonl` опційний і може бути відсутнім; не вимагати реальних `ampCredits` (немає іменованого production-файлу з відомою формою запису). Якщо ledger немає — `ampCredits: null`. Зберігати токени і `ampCredits` окремо. `source: "amp-thread"`. Ніколи не конвертувати credits → USD. id = `messageId` / `toMessageId`.

3. **cursor** — `agent-transcripts/*.jsonl` **не містять usage** (задокументований gap). Адаптер MUST snapshot-copy `state.vscdb` (+ `-wal`/`-shm`, якщо є) і читати системним CLI `sqlite3`, якщо він є. Default Linux: `~/.config/Cursor/User/globalStorage/state.vscdb` (також macOS Application Support / Windows APPDATA; тести — через `XDG_CONFIG_HOME`). Read-only. Якщо `sqlite3` або DB немає, або схема без token-полів — повернути порожньо + note, не оцінювати з `text.length`. `source: "cursor-vscdb"` або `source: "none"`. MUST NOT викликати Cursor SDK / server CSV / cookies.

### D10. Показувати окремо — не зливати платформи в один $

`metrics.json` отримує:

- `spendByPlatform`: мапа `cursor|claude|amp` → `{ inputTokens, outputTokens, totalTokens, costUsd, ampCredits, source }` (null-honest; `source` = id адаптера або `"none"`)
- `spendByModel`: масив `{ model, platform, inputTokens, outputTokens, totalTokens, costUsd, ampCredits }`

Людська команда `metrics` MUST друкувати дві додаткові таблиці: **by platform** і **by model**. MUST NOT друкувати єдиний «total $», що додає Amp credits + Claude USD + Cursor $. Рядок підсумку `cost` SHALL відображати лише `spend.costUsd` (сума рядків, де `costUsd` не `null`; Amp credits у своїй колонці таблиць).

Кожна сесія зберігає `sources: [{ id, platform, model, inputTokens, outputTokens, totalTokens, costUsd, ampCredits, at }]` плюс опційно `models: [ids]`, коли моделей більше однієї. `session.model` = primary (найбільший `totalTokens` серед sources цієї сесії) або резолв D2, якщо sources немає. При рівності токенів — стабільний порядок (platform, потім id).

Агрегат `spend.costUsd` на файлі SHALL підсумовувати лише USD: для кожної сесії взяти `session.costUsd`, якщо воно не `null`, інакше суму не-null `source.costUsd` цієї сесії (не додавати source USD поверх уже заповненого session.costUsd). `spend.inputTokens` / `outputTokens` / `totalTokens` — те саме правило. `spendByPlatform` і `spendByModel` SHALL перераховуватись з `session.sources`. Amp credits NEVER входять у `costUsd`.

### D11. Вікно + dedup, щоб три платформи на одному change не double-count

Вікно collect: `[pending.startedAt || last session.endedAt || metrics.createdAt, endedAt]`. Для archive `endedAt` = зараз; нижня межа — кінець останньої сесії або `createdAt`.

Проєктний match порівнює з аргументом `collectSpend({ cwd })` (якщо опущено — `process.cwd()`). Claude: поле рядка `cwd` === цей шлях; вікно — поле рядка `timestamp`; без поля `cwd` — не включати. Amp: thread входить, якщо хоча б один `env.initial.trees[].uri` після strip `file://` дорівнює цьому шляху; немає trees — пропустити thread; не читати і не вигадувати `cwd` / `meta.cwd`; вікно usage — `usage.timestamp`. Cursor: workspace id, якщо є; без ідентифікатора проєкту — не включати (never guess).

Dedup: пропустити `source.id`, яке вже є в будь-якому існуючому `session.sources` (claude `message.id`, amp `messageId`/`toMessageId`, cursor bubble id).

`--no-metrics` як і раніше пропускає collect (сесія не пишеться). `--no-collect` (новий прапорець persist і archive) пропускає адаптери, але все одно записує сесію (flags-only / null).

### D12. Протокол Session Exit

`session-handoff.mdc` MUST сказати: persist auto-collect локальний usage з Claude JSONL, Amp threads, Cursor vscdb; батько SHOULD все одно передати `--model`; батько MUST NOT вгадувати токени; прапорці override totals only. Прибрати старий primary path «немає скрейперів / spend лише коли UI платформи показав числа». І далі заборонено: Cursor SDK, парсер Claude `/cost` як обов'язковий крок, Amp billing API.

## Risks / Trade-offs

- **Агенти й далі не передадуть `--model`** → мітигація: протокол робить прапорець обов'язковим (SHOULD/MUST у rule); CLI попереджає, але не валить persist; `AOK_MODEL` можна виставити один раз; collect може заповнити primary model з usage.
- **Сесія Archiver з `durationMs: 0` зіпсувала б null-honest суми** → мітигація D4: `durationMs` Archiver = `null`.
- **Невалідний `--platform` падає, а відсутня модель — ні** → прийнято: явний поганий enum ≠ відсутнє значення; модель — вільний рядок без enum.
- **Подвоєна сесія Archiver при повторному ручному finalize** → прийнято: успішний `archive` виконується один раз; target-архів уже є гейтом.
- **Trade-off: CLI не відхиляє `--model Architect`** → прийнято: валідатор таксономії був би крихкий і хибноблокуючий; дисципліна в протоколі.
- **Legacy `metrics.json` без `platform` / `spendByPlatform`** → мітигація: відсутнє поле читається як `null` / default-мапа; `loadMetricsFile` мержить із default.
- **Cursor schema drift / немає sqlite3** → адаптер повертає порожньо + note, `source: "none"`; не оцінювати з `text.length`; persist не падає.
- **Amp credits ≠ USD** → окрема колонка `ampCredits`; ніколи не додавати до `costUsd` і не друкувати як $.
- **Claude cache tokens** → якщо `cache_*` присутні на записі, вони входять до `inputTokens`; інакше лише `input_tokens`.
- **Три платформи на одному change double-count** → вікно + проєктний match (D11) + dedup за `source.id`.
- **Amp thread без cwd** → match лише `env.initial.trees[].uri`; немає trees — skip; фікстури MUST NOT вигадувати `meta.cwd`.
- **Claude project folder** → encode `/` і `.` → `-`; вікно за `timestamp`; тести передають явний `collectSpend({ cwd })`, не хардкодять шлях кіт-репо.
- **CI читає домашній каталог розробника** → тести MUST ставити `HOME` / `AMP_DATA_DIR` / `XDG_CONFIG_HOME` на tmp-фікстури.

## Migration Plan

Немає міграції даних і немає бекфілу архівів. Консюмери отримують нову поведінку після `npx agent-orchestrator-kit update` (нові тексти правил) і нової версії CLI. Наявні `metrics.json` без `platform` / `spendByPlatform` валідні. Rollback: відкат пакета; зайві поля JSON нешкідливі для старого CLI (ігнорує невідомі поля при merge). `--no-metrics` не змінюється. `--no-collect` ігнорується старим CLI (невідомий прапорець — залежить від commander: нова версія додає опцію).

## Open Questions

Немає. D1/D2/D4/D6/D7/D8 збережені; D3 замінено на D3′; D5 уточнено (адаптери замість «немає локальних файлів»); D9–D12 зафіксовані owner-ом.
