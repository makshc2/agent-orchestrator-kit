## Context

`metrics.json` v2 пишуть `metricsRecordSessionEnd` (persist), `metricsFinalizeArchive` (archive) і `metricsBackfillFile` (`--collect`, leftover), усі через `applyCollectedSessionFields` → `recomputeMetricsAggregates` → `saveMetricsFile`. `runCollectSpend` обгортає `collectSpend` із `bin/spend-collect.js`, який повертає `sources`, `ampThreads` і `notes` (`claude: project folder missing`, `cursor: usage file missing (spend hook not installed …)`, `amp: usage failed for …` тощо). Жоден caller `runCollectSpend` не читає `notes`; `catch` повертає `notes: []`. У файлі немає жодної перевірки правдоподібності: `durationMs` обмежено лише `Math.max(0, …)`, `startedAt` береться з `--started-at` / `pending` / `createdAt` без верхньої межі, роль проходить `canonicalRole`, який повертає перший сегмент як є, коли токен невідомий.

Source-записи вже несуть `cacheReadTokens` (`sourceRecord`, Claude :265, Cursor :770, Amp CLI thread :596), а `estimateClaudeCostUsd` уже рахує cache-split (CHANGELOG 0.15.0), але `applyCollectedSessionFields` і `compactModelRows` ці ключі відкидають — у сесії лишається тільки `inputTokens` із cache всередині. Тому «74 % завищення» з первинної рекомендації хибне (оцінка USD уже cache-aware), а бракує саме колонки, щоб побачити частку cache.

Дані 9 архівів (61 сесія): 31 рядок `adapter` без токенів і `sourceIds`; 11 рядків із неканонічною роллю; 1 рядок `durationMs` 5 913 634 789 (`startedAt` 2026-07-01, `threadId: null` — хибний старт, не reused thread); перша Architect-сесія в 3 архівах стартує до `createdAt` на хвилини-години, бо propose-чат створює каталог change-у посеред сесії; 3 архіви без `spend.costUsdTotal` (Amp / порожні, до появи ключа). Єдиний архів з `createdAt ≥ 2026-09-25` (`propose-review-pregate`) проходить усі інваріанти.

## Goals / Non-Goals

**Goals:**
- Зіпсований леджер видно одразу на persist / archive (stderr + `session.notes`) і в CI (contract-тест над новими архівами).
- Silent-провали адаптерів (не встановлений hook, відсутня тека проєкту, невдалий `amp threads usage`) видно в stderr.
- Cache-частка вхідних токенів зберігається поряд з `inputTokens`, не замінюючи його, і видна у зводці.
- Estimator дає правильні ставки для `claude-opus-5-5` і не переоцінює cache-read невідомих моделей.
- Spec change-metrics описує `costUsdTotal`, cache-ключі й ролі так, як їх пише код.

**Non-Goals:**
- Зміна семантики `inputTokens`, dedup-ключів Cursor, Amp Cost-once-per-thread, conversationId-first атрибуції.
- Блокування запису під `changes/archive/`, non-zero exit через інваріанти, schema v3, переписування історичних архівів.
- Amp per-session delta (snapshot на restore) — окремий change.
- Зміни `scripts/cursor-spend-collect.cjs` / `templates/scripts/cursor-spend-collect.cjs`, README, CHANGELOG, `package.json`.

## Decisions

**D1. Одна експортована функція для тесту і для writers.** `metricsSessionInvariantIssues(session, metrics)` повертає масив рядків; `metricsLedgerInvariantIssues(metrics)` додає `version` і суму `spend.costUsdTotal`. Contract-тест імпортує їх із `bin/agent-orchestrator.js` (як `canonicalRole`), writers викликають ту саму функцію — інваріанти не можуть розійтись між тестом і CLI. Арифметика `costUsdTotal` береться з тих самих `costUsdTotalOf` / `sessionFieldOrSources` / `roundUsd4` / `addNullable`, що й `recomputeMetricsAggregates`, тож перевірка і запис узгоджені за побудовою.
Альтернатива «окремий helper у тесті» відкинута: дублювання арифметики округлення — саме той клас дрейфу, який тест має ловити.

**D2. Межа `startedAt ≥ createdAt − 12 год`, не −120 с.** Три з дев'яти архівів (включно з `propose-review-pregate` з 2,9M токенів на Architect-рядку) мають легітимний старт до `createdAt`: propose-чат створює `openspec/changes/<name>/` посеред сесії. 12 годин відсікають хибні старти класу 2026-07-01 (lead 1643 год) і не чіпають структурний випадок. Та сама межа у тесті й на запис.
Альтернатива «виключити sessions[0]» відкинута: не ловить хибний `--started-at` на першій сесії.

**D3. Fail-open: warning у stderr + `session.notes[]`, без clamp і без non-zero.** Spec «Persist і archive не падають лише через відсутні model або spend» і рішення 2026-08-29 (gate-check / pre-commit не вимагають metrics.json) забороняють робити телеметрію гейтом доставки. Сирі значення лишаються (щоб їх можна було дослідити), причина записується в `notes`, stdout persist лишається prompt-only (spec «Restore записує старт сесії…»: «Prompt MUST лишатись єдиним вмістом stdout»). `annotateSessionInvariants` не пише у `notes` перевірку `costUsdTotal`: на момент виклику сесія ще не пройшла `recomputeMetricsAggregates`, цей інваріант перевіряється на рівні леджера після запису. На archive додатково друкується `metricsLedgerInvariantIssues` фінального файла — архів є кінцевим станом, і оператор має побачити проблемні старі рядки, не лише Archiver.
Альтернатива «refuse next release з `--allow-implausible`» відкинута: заохочує агентів обходити CLI (ризик compliance, який STOP-клапан kit-а існує, щоб уникати).

**D4. Notes друкуються всередині `runCollectSpend`.** Усі collect-шляхи (persist, archive, leftover `attachLeftoverSources`, `metricsBackfillFile`) проходять через `runCollectSpend`, тож один `printCollectNotes` покриває їх усі; префікс `metrics: ` узгоджений із наявними `metrics: session.model is null …`. Виняток `collectSpend` стає нотаткою `collect: adapters failed: <message>` замість порожнього `notes: []`, і CLI, як і раніше, не падає.
Альтернатива «повертати notes callers і друкувати в командах» відкинута: чотири caller-и, у двох із них (leftover, backfill) stderr уже є єдиним каналом діагностики.

**D5. Cache-ключі адитивні, nullable, схема v2.** `cacheReadTokens` / `cacheCreationTokens` додаються в `emptySpendTotals`, `emptyPlatformSpend`, рядки `byModel` / `spendByModel`, `METRICS_SPEND_KEYS` (щоб `phases.*` і `spend` сумувалися тим самим циклом через `sessionFieldOrSources`) і в session-skeleton persist / archive. `normalizeMetricsV2` і default-merge `loadMetricsFile` терплять відсутні ключі (legacy → `null`), тож v3 не потрібен; v1→v2 коштував 11 сесій / $55.61. `resolveSessionSpend` бере `cacheReadTokens` з `ampThreads` (thread-level `amp threads usage`), інакше з суми source-записів; `cacheCreationTokens` — лише з source-записів. `resyncLeftoverSessionSpend` перераховує cache-ключі з `byModel`, коли там є значення, інакше лишає thread-level значення Amp. `sourceRecord` отримує `cacheCreationTokens` (Claude: `cache_creation_input_tokens`; Cursor: `cacheWriteTokens` з hook-рядка), щоб колонка була значущою для всіх трьох адаптерів. Семантика `inputTokens` (cache включено) не змінюється: spec «Три read-only адаптери», Amp `totalInputTokens`, Cursor-семантика, `cursorSpendFingerprint`.
Альтернатива «винести cache з `inputTokens`» відкинута: ламає три адаптери, dedup і ~168 smoke-асертів.

**D6. Рядок `cache hit` у `renderMetricsSummary`.** Один рендерер для `metrics <name>` і `archive` (spec «Archive друкує людську зводку»), тож рядок додається там: `cache hit: N% (R cache-read of I input tokens)`, де `N = cacheReadTokens / inputTokens × 100`, обрізано до 100; рядок пропускається, коли `spend.cacheReadTokens` є `null`, щоб legacy-файли не отримали хибний «0 %». Persist не друкує зводку (stdout prompt-only), тому рядок видно в `metrics` і `archive`.

**D7. Ставки.** `claude-opus-5-5` отримує окремий рядок `{ input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 }` (довший префікс перемагає `claude-opus`); fallback невідомої моделі переходить у `FALLBACK_RATES = { input: 3, cacheRead: 0.3, cacheWrite: 3, output: 15 }` — cache-read 0.1× input, як у всіх опублікованих ставках; `ratesForModel` експортується для тесту. Наявний тест `3.15` для `gpt-6-astra` без cache лишається зеленим. Таблиця ставок версіонується в CHANGELOG — запис робить docs pass після merge.

**D8. Ролі.** `Spec Architect` → `Architect`: це ім'я субагента kit-а (`spec-architect.md`), а не окрема роль; рядок із такою роллю пишеться з 2026-09-07 після правила 0.11.0 — живий дефект. `Conductor` і `Code Reviewer` не входять у Closed role жодного шаблону й не стають токенами (новий токен змінив би `phaseForRole` і закритий перелік у spec); вони лишаються сирим рядком, а інваріант D1 позначає їх як неканонічні, тож новий архів із ними не пройде contract-тест. `Code Reviewer` → `Spec Reviewer` відкинуто: це різні фази (review коду після apply vs review spec).

**D9. Contract-тест виключає історію за датою.** `KIT_METRICS_CONTRACT_SINCE = 2026-09-25` (реліз 0.16.0): усі старіші архіви порушують інваріанти (31 adapter-null, 1 duration > 24 год, 11 ролей, 3 без `spend.costUsdTotal`), а рішення 2026-08-29 забороняє їх мігрувати. Тест не є порожнім: `propose-review-pregate` входить і проходить; тест також асертить, що принаймні один архів перевірено, і що історичний архів усе ще містить порушення (доказ, що його не переписали).

**D10. Мертвий `model_hint`.** Ключ не читає жоден код (`grep -rn model_hint bin/ test/ templates/` → лише сам yaml); його прибрано з шаблону і 4 профілів. Spec design-intake вимагала `model_hint: strong` для `design_intake` — delta MODIFIED прибирає цю частину, роль і `require_design_brief` лишаються. README :586 показує ключ у прикладі — docs pass після merge.

## Risks / Trade-offs

- [Нові `null`-ключі у `spend` / `spendByPlatform` / `byModel` змінюють форму файла] → адитивно; `normalizeMetricsV2` і default-merge терплять їх; `--migrate` не перераховує; smoke-тести порівнюють лише числові поля (`metrics-readable`, `migrate`).
- [Попередження на кожен persist без hook («usage file missing»)] → це і є мета: 29 Cursor-рядків adapter-null пояснюються не встановленим hook-ом; stderr, не stdout.
- [Хибне попередження про роль для legit нестандартних Closed role] → лише warning + note; канонічний перелік закритий у spec.
- [Межа 12 год пропустить хибний старт у межах доби] → свідомий компроміс (D2); 24-годинна межа `durationMs` ловить решту.
- [`cacheCreationTokens` з Cursor `cacheWriteTokens` може бути відсутнім у старих hook-рядках] → `null`-honest, ключ ставиться лише коли число є.
- [`cursor-spend-collect.cjs` пише сесії без cache-ключів] → `sessionFieldOrSources` повертає `null`; колонка чесна, не хибно нульова; скрипт поза scope.
- [Fallback cache-read дешевшає → `costUsdEstimated` невідомих моделей зменшується] → зміна лише для майбутніх записів; estimate помічений `api-estimate-fallback`.
