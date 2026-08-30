## Context

Поточний стан (`change-metrics` v0.6.0):

- `handoff --restore` пише `metrics.pending.startedAt`, `handoff <name>` закриває сесію і рахує `durationMs`. Ця частина працює і не потребує змін.
- Spend приходить з `collectSpend()` (`bin/spend-collect.js`): три read-only адаптери — Claude JSONL (`~/.claude/projects/<cwd-encoded>/*.jsonl`), Amp threads (`~/.local/share/amp/threads/*.json`), Cursor hook (`.agents/spend/cursor-usage.jsonl`). Прапорці `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` перекривають лише session-level totals.
- На реальних змінах цей шлях дає `null`: Cursor hook вимагає рестарту IDE і записує лише частину turn-ів, Amp thread-match консервативний за дизайном, Claude JSONL є лише коли сесія йшла через Claude Code. Прапорці агенти пропускають, бо вони опційні і нічого не ламають.
- Той самий change часто закривається сесіями з різних IDE (Cursor і Amp), тому `spendByPlatform` мусить складатись із записів різних хостів.

Обмеження, які лишаються чинними: без мережі, без API-ключів, без нових npm-залежностей, без pricing-таблиці в кіті, `metrics.json` git-tracked, persist і archive не падають через відсутній spend.

## Goals / Non-Goals

**Goals:**

- Зробити агента, який закриває сесію, задекларованим джерелом spend: `## Metrics` у `handoff.md` — обов'язковий крок Session Exit, як і решта секцій.
- `persist` читає секцію і пише `session.model`, `session.platform`, токени, `costUsd`, `ampCredits`, `spendSource` без будь-якого адаптера в шляху.
- Прибрати адаптери з дефолтного шляху persist/archive, лишивши їх як явний opt-in.
- Archive дає людині фінальну зводку по всьому change одним stdout.
- Однаковий протокол і однаковий результат у Cursor, Amp і Claude Code; синхронізація між IDE — через git-tracked `metrics.json`.

**Non-Goals:**

- Будь-які API / SDK / billing-інтеграції (Cursor SDK, Claude `/cost` parser, Amp billing API).
- Pricing-таблиця в кіті і обчислення USD з токенів.
- Єдиний «total bill», що складає Amp credits з USD.
- Гейт persist на наявність або правдоподібність чисел.
- Бекфіл spend у вже заархівовані зміни.
- Розвиток `spend-collect` як основного джерела.

## Decisions

### D1. Формат секції — плоский bullet-список `key: value`

```markdown
## Metrics
- platform: cursor
- model: claude-opus-5
- input_tokens: 128000
- output_tokens: 9400
- cost_usd: 0.42
- amp_credits: none
- spend_source: self-report
```

Парсер — той самий підхід, що вже є у `parseRuntimeBulletFields`: regex по рядках `- key: value`, нечутливий до регістру ключа, толерантний до відсутніх рядків і до порядку. Значення `unknown`, `none`, `n/a`, `—` і порожній рядок нормалізуються в `null`. Числа приймаються з розділювачами (`128,000`, `128 000`) і з `$` для `cost_usd`.

Альтернативи: YAML front-matter (потребує парсера і ламає читабельність `handoff.md`), JSON-блок у fenced code (агенти регулярно ламають лапки), окремий файл `session-metrics.json` (ще один артефакт, який так само забувають). Bullet-список виграє тим, що він уже є в цьому файлі (`## Runtime`) і його неможливо «зламати синтаксисом».

### D2. Ланцюжок пріоритетів

Для кожного поля окремо, перше не-null виграє:

| Поле | Ланцюжок |
|------|----------|
| `model` | `--model` → `## Metrics: model` → `AOK_MODEL` → primary з `sources` (лише при `--collect`) → `null` |
| `platform` | `--platform` → `## Metrics: platform` → `AOK_PLATFORM` → host env → primary з `sources` (лише при `--collect`) → `null` |
| токени, `costUsd`, `ampCredits` | прапорці → `## Metrics` → sources (лише при `--collect`) → `null` |

Прапорці лишаються найвищим пріоритетом: це ручний override для випадку, коли секція вже записана, а persist перезапускають. Host env опускається нижче самозвіту, бо агент знає свою платформу точніше, ніж евристика по змінних оточення (в Amp-сесії всередині Cursor обидва маркери можуть бути виставлені).

Час — виняток: `startedAt` / `endedAt` / `durationMs` ставить лише CLI, самозвіт їх не перекриває. Це єдині поля, де CLI має точніші дані, ніж агент.

### D3. `session.spendSource` — походження чисел

Нове поле сесії — непорожній рядок. Якщо агент указав `spend_source` у секції (наприклад `cursor-ui`, `amp-thread-ui`, `claude-cost`, `estimate`), це значення виграє; інакше CLI ставить один з чотирьох дефолтів:

- `self-report` — числа з `## Metrics`;
- `flag` — хоча б одне число з CLI-прапорця;
- `adapter` — числа з `--collect`;
- `unreported` — секції немає або всі числові поля порожні.

Поле потрібне, щоб `metrics` і archive-зводка чесно показували, наскільки цифрам можна вірити, і щоб можна було порахувати частку сесій без самозвіту без парсингу історії.

### D4. Відсутня секція — warn + `unreported`, не fail

Розглядались три варіанти:

1. **fail persist** — найсильніший стимул, але прямо конфліктує з чинною вимогою «persist і archive не падають лише через відсутні model або spend» і створює гірший стан: сесія не закривається, `pending` висить, наступний restore отримує зіпсований `startedAt`.
2. **тихий null** — поточна поведінка, яка і призвела до проблеми.
3. **warn + `spendSource: "unreported"` + автододавання скелета секції** — обрано.

Persist пише сесію з null-spend, друкує в stderr іменоване попередження (з підказкою, які саме рядки додати) і дописує в `handoff.md` скелет `## Metrics` зі значеннями `unknown`. Наступна сесія відкриває файл і бачить порожні поля замість відсутньої секції — заповнити наявний шаблон дешевше, ніж згадати про відсутній.

Форсинг лишається на рівні протоколу (`session-handoff.mdc` робить заповнення секції кроком Session Exit), а не на рівні exit code.

### D5. Порядок дій у persist

`## Metrics` читається і сесія записується **до** друку next-thread prompt. Порядок stdout/stderr:

1. stderr: запис `handoff.md`, Memory, статуси;
2. запис `metrics.json` (сесія + агрегати);
3. stderr: попередження про `unreported` / `model: null`, якщо вони є;
4. stdout: next-thread prompt (єдиний вміст stdout, як і зараз).

Це гарантує, що агент не «додасть метрики після промпта», і не ламає чинний контракт «stdout = лише промпт».

**Власник write-back у `## Metrics`.** Крок 1 (запис `handoff.md`) свідомо лишається **перед** кроком 2 (`metricsRecordSessionEnd`), як і в чинному коді. Наслідок: секція у файлі рендериться з розібраного самозвіту (`fields.metrics`) плюс `unknown` для порожніх полів, і CLI **не** переписує її резолвленими значеннями. Тобто `handoff.md` лишається записом того, що заявив агент, а `metrics.json` — записом того, що реально потрапило в сесію після ланцюжка прапорець → самозвіт → env → host → sources. Розбіжність між ними можлива і є очікуваною: `--input-tokens 7` над секцією зі `100` дає `7` у `metrics.json` і лишає `100` у файлі; `platform: chatgpt` дає `null` у сесії, warning у stderr і лишає `chatgpt` у файлі.

Альтернатива — підняти резолв spend / model / platform вище за `buildHandoffMarkdown` і писати у файл уже резолвлені значення — відкинута: вона змішує самозвіт з CLI-override в одному артефакті (втрачається можливість побачити, що саме заявив агент), змушує перебудувати порядок persist заради косметики і не додає жодної спостережуваної гарантії, якої не дає `metrics.json`.

### D6. Адаптери — opt-in `--collect`

`--no-collect` замінюється на `--collect` на `handoff <name>` і `archive`. Дефолт — без адаптерів. `bin/spend-collect.js`, `metrics --collect`, `templates/scripts/cursor-spend-hook.cjs` і `cursor-spend-collect.cjs` лишаються в кіті без змін коду: хто хоче звіряти самозвіт з локальними даними — вмикає явно. При `--collect` зібрані `sources` пишуться в сесію, але **не перекривають** self-report totals; вони лише наповнюють `spendByPlatform` / `spendByModel` і дають `spendSource: "adapter"`, коли самозвіту не було.

`ensureCursorSpendHook` прибирається з `handoff --restore` і persist. Кожна сесія більше не переписує `.cursor/hooks.json` і не друкує статус hook у stderr. Ensure лишається в `init`, `update`, `sync`, `mcp-setup`, тобто hook і далі ставиться, але як частина setup, а не як побічний ефект кожного handoff.

**BREAKING** для тих, хто передає `--no-collect` у скриптах: прапорець зникає. Це прийнятно — прапорцю менше ніж один мінорний реліз, і його семантика тепер дефолтна.

### D7. Archive: самозвіт Archiver + фінальна зводка

Сесія `Archiver` створюється так само, як і зараз, але її `model` / `platform` / spend беруться з `## Metrics` архівованого `handoff.md` (файл уже переїхав у `openspec/changes/archive/<date>-<name>/`) або з прапорців `archive --model` / `--platform` / spend-прапорців. Це той самий протокол, що й у persist, без окремого механізму.

Після finalize `archive` друкує в stdout зводку по всьому change одним блоком: `sessions`, work time, lead time, `tokens`, `cost`, таблицю by phase (sessions / duration / tokens / cost / roles / models), by platform (tokens / cost / ampCredits) і by model. Формат перевикористовує вже наявні `formatMetricsDuration` / `formatMetricsNumber` / `formatMetricsCost` і рендерер команди `metrics`, щоб не з'явилось двох різних виглядів однієї таблиці — рендерер виноситься у спільну функцію `renderMetricsSummary(metrics)`.

Правило «жодного unified total $, що додає Amp credits до USD» діє і тут.

### D8. Крос-IDE

Джерело `spendByPlatform` — `session.platform` з самозвіту, а не host-евристика і не адаптер. Сесія Cursor і сесія Amp на одному change дають два записи з різними `platform`, які складаються в агрегати при кожному записі. Ніякої синхронізації в реальному часі не потрібно: `metrics.json` git-tracked, обидва IDE читають і пишуть один файл у робочому дереві.

Amp-специфіка: `amp_credits` живе окремим полем на рівні сесії (`session.ampCredits`) і в `spendByPlatform.amp.ampCredits`; воно ніколи не потрапляє в `costUsd` і в жодну суму USD.

## Risks / Trade-offs

- **Агент може написати неправдиві числа** → self-report чесно позначений `spendSource: "self-report"`; хто хоче звірки — запускає `--collect` і бачить `sources` поруч. Кіт свідомо обирає приблизні, але наявні цифри замість точних, але порожніх.
- **Агент усе одно пропустить секцію** → `unreported` робить пропуск видимим у `metrics` і в archive-зводці, а скелет із `unknown` у `handoff.md` знижує вартість заповнення наступного разу. Якщо частка `unreported` лишиться високою, наступна ітерація зможе ввести опційний гейт у `orchestrator.yaml` — цей change такого гейта не додає.
- **BREAKING на `--no-collect`** → прапорець зникає разом з релізом; CHANGELOG фіксує заміну на `--collect`, тести покривають обидві гілки.
- **Cursor hook перестає самолікуватись у persist** → hook і далі ставиться в `init` / `update` / `sync` / `mcp-setup`; проєкти, які оновляться без `update`, просто не матимуть hook — а він більше і не потрібен для основного шляху.
- **`## Metrics` збільшує `handoff.md`** → сім рядків проти повного самозвіту у промпті; секція лишається останньою перед `## Prompt`, щоб не заважати читанню Done/Decisions.
- **Числа з різних платформ не зводяться в один рахунок** → це навмисно: таблиці by platform і by model лишаються роздільними, Amp credits ніколи не сумуються з USD.
