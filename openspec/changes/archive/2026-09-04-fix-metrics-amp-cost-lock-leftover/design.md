## Context

`change-metrics` уже вимагає, щоб рядок Amp `Cost: $N` потрапляв у `session.costUsd` **і** `spendByPlatform.amp.costUsd`, щоб leftover був у вікні `[last.endedAt, leftoverEnd)`, і щоб Amp parent без tty брав id з `amp threads list`, не з `session.json lastThreadId`. Live watch 2026-09-04 на registration-log-fe `issue-card-sticky-new-visitor` показав, що імплементація це ламає.

Amp billed на трьох сесіях: $4.42 + $8.81 + $12.69 = **$25.92**. Фінальні `spend.costUsd` і `spendByPlatform.amp.costUsd` = **null**. `spend.costUsdEstimated` = $8.48 (лише Cursor). Archiver: `sources []`, `platform/threadId/model null`, `spendSource: unreported`. Після archive leftover файл не переписав.

Шість уже знайдених причин (архітектуру не змінюємо):

1. **AMP-COST-DROP.** `collectAmpCli` при `usage.costUsd != null` ставить лише `src.costSource = 'amp-usage'`, ніколи `sources[].costUsd`. `resolveSessionSpend` коректно пише `session.costUsd` з `ampThreadTotals`. `recomputeSpendMaps` / `recomputeMetricsAggregates` при `sources.length > 0` сумують лише `sources[].costUsd` і **скіпають** `session.costUsd`.
2. **RESTORE-NO-LOCK.** `detectSessionClient` після env дивиться Amp parent, потім tty-hint. `readAmpSessionHint` повертає `lastThreadId` у об'єкті, але detect ігнорує його, якщо батько не `amp`. Amp-агент робить `npx … handoff --restore` (батько `node`, часто без tty і без `AMP_*`) → `pending.platform/threadId null`, `clientSource: none`.
3. **LEFTOVER-CROSS-SESSION.** `metricsRecordSessionEnd` leftover не передає `platforms`. `attachLeftoverSources` кличе `runCollectSpend` з `ampThreadId: session.threadId || env`. Implementer з `threadId: null` → `listRecentAmpThreadIds` чіпляє пізніший archive-thread і Cursor hook.
4. **SESSION-TOKEN-STALE.** `sessionSpendIsFrozen` трактує `amp-usage` + числовий `session.costUsd` як freeze. Leftover мержить sources, але не resync `inputTokens` (495 184 vs ~1.18M).
5. **USAGE-MODELS-DUP.** `applyCollectedSessionFields` конкатенує `ampThreads[].models` без дедупа; leftover збирає чужі threads.
6. **ROLE-NOT-CANONICAL.** Persist уже пише `session.role` через `canonicalRole`. `metricsRecordSessionStart` пише `pending.role` сирим (`fields.nextRole` / Closed-текст).

Design: none (немає UI). Не бекфілимо FE-архів цього прогону.

## Goals / Non-Goals

**Goals:**

- Після persist/recompute Amp Cost:$N один раз **на кожну кваліфікуючу сесію** у `spend`, `spendByPlatform.amp` і `phases.<phase>.costUsd`, навіть коли всі `sources[].costUsd` null; кілька таких сесій складаються (`$4.42 + $8.81 + $12.69` = `$25.92`).
- Restore без Amp-env / Cursor-env / Amp parent / tty залочить свіжий `session.json lastThreadId` як `amp-session-last`.
- Amp parent без tty і далі бере `amp threads list`, не `lastThreadId`.
- Leftover без `--collect` збирає лише `last.platform` і лише session thread (або `T-…` префікс з `sources[].id`); без id не кличе `listRecentAmpThreadIds`; явний leftover `ampThreadId` не додає env-thread у collect.
- Після leftover `amp-usage` токени = сума sources; billed Cost не дропається; `spendSource` лишається `amp-usage`.
- `usageModels` — унікальні моделі лише цього thread.
- `pending.role` — канонічний токен.

**Non-Goals:**

- Бекфіл FE/VMS архівів
- Amp credits parser, disk thread files, hook duplicate events
- Ширше leftover вікно, HTTP, нові npm-залежності
- Зміна Cursor estimate table / змішування billed і estimate
- Протокол агентського тексту `session-handoff` окрім канону `pending.role` якщо він уже в change-metrics

## Decisions

### D1. Cost один раз у rollup, ніколи на кожен source

**Обрано:** не писати `Cost: $N` у `sources[].costUsd` (помножить $N × N messages). У `recomputeSpendMaps` і `recomputeMetricsAggregates`: токени / `costUsdEstimated` і далі з sources; для **кожної** сесії окремо якщо `sum(sources.costUsd)` **цієї** сесії є `null`, а `session.costUsd` є числом — додати (`addNullable`) її `session.costUsd` **один раз для цієї сесії** у `spend.costUsd`, `spendByPlatform[session.platform].costUsd` і `phases[session.phase].costUsd`. Наявне значення агрегату від попередньої сесії MUST NOT блокувати fallback наступної: три Amp-сесії `$4.42 + $8.81 + $12.69` SHALL дати `$25.92`, не зупинитись після першого внеску. `spendByModel` MAY взяти billed з унікальних `usageModels` цього thread; MUST NOT ставити `session.costUsd` на кожен рядок моделі.

Те саме per-session fallback у `scripts/cursor-spend-collect.cjs` `recompute` (і templates): leftover rewrite після archive не має зрізати `spendByPlatform.amp.costUsd`. Рішення «чи додати `session.costUsd`» залежить лише від суми sources поточної сесії, не від того, чи `spend.costUsd` / бакет / фаза вже мають число. Зараз collect-скрипт для `spend`/`phases` уже бере `session.costUsd`, якщо він є, але platform-бакет сумує лише sources.

**Відхилено:** копіювати Cost на кожен source. **Відхилено:** брати `costUsd` з `costUsdEstimated`.

### D2. Restore `amp-session-last`, коли батько не amp

Порядок detect лишається: Amp-env → Cursor-env → Claude-env → Amp parent (tty-hint або `amp threads list`) → **нове** → `{none}`.

**Обрано:** якщо env не перемогли і `parentComm` не є `amp`, і `session.json.lastThreadId` свіжий (вікно `AMP_TTY_MAX_AGE_MS` = 2h; свіжість з `updatedAt` на корені JSON, інакше mtime файла) — повернути `{ platform: 'amp', threadId: lastThreadId, source: 'amp-session-last' }`. Якщо `lastThreadId` порожній, але файл існує і свіжий — SHALL узяти перший id з `amp threads list`, `source: 'amp-session-list'`. Amp-env і далі б’є Cursor-env.

Якщо батько **є** `amp` і tty немає — чинне правило: `amp threads list`, MUST NOT `lastThreadId`. Не регресувати тест `parent amp without tty uses threads list`.

Persist без `--collect` уже збирає locked `pending.threadId`. Після lock `T-lock` collect Amp CLI SHALL експортувати саме цей thread.

**Відхилено:** завжди брати `lastThreadId` і для Amp parent (зламає чинний spec). **Відхилено:** вимагати tty для Amp-агента під `npx`.

### D3. Leftover scoped до last.platform і thread id

**Обрано:**

- `attachLeftoverSources` / archive leftover без `--collect` передають `platforms: [last.platform]`, коли `last.platform` є `amp` | `cursor` | `claude`. Cursor leftover на Amp-сесії MUST NOT запускатись.
- Якщо `last.platform` є `null`, leftover MUST NOT запускати всі адаптери. Amp leftover тоді лише коли є `last.threadId` або унікальний префікс з `sources[].id`: текст до першого `:`, якщо id починається з `T-` (`T-apply:8` → `T-apply`; `T-01a06c70-…:8` → повний thread id). Тоді `platforms: ['amp']`.
- Amp leftover `ampThreadId` = `last.threadId` або витягнутий префікс. MUST NOT fallback на `AMP_*` env, якщо це відкриє інший thread.
- Передати в collect прапорець на кшталт `listRecentAmpThreads: false` (ім’я на розсуд implementer): `collectAmpCli` MUST NOT викликати `listRecentAmpThreadIds`, коли leftover не має thread id **або** коли thread id уже відомий (не підміняти відомий id списком).
- Leftover-режим з непорожнім `ampThreadId`: `collectAmpCli` MUST зібрати **лише цей id**. MUST NOT робити `push(ampCurrentThreadId(env))` і MUST NOT додавати `AMP_CURRENT_THREAD` / `AMP_THREAD_ID` у `ids` (зараз рядок ~507 робить це безумовно). Явний leftover `T-apply` плюс env `T-archive` MUST NOT експортувати `T-archive`.
- Incoming Amp leftover: `source.id` MUST починатись з `<threadId>:`. Чужий `T-archive:2` відкидається навіть якщо CLI його експортував.
- ExclusiveEnd (`at >= pending.startedAt` наступної) лишається; thread-фільтр зверху. Grace 120s не змінювати.

`--collect` на persist/archive leftover MAY збирати всі адаптери, але Amp incoming усе одно ріжеться за leftover thread.

**Відхилено:** лишити leftover без `platforms` (бойовий leak Cursor + archive thread). **Відхилено:** розширити grace.

### D4. Freeze лише flag і числовий self-report; токени з sources, cost з Cost

**Обрано:** `sessionSpendIsFrozen` повертає true лише коли `spendSource === 'flag'` **або** (`spendSource === 'self-report'` і є хоч одне числове spend-поле). `amp-usage`, `adapter`, `unreported`, placeholder self-report (`unknown` / null числа) MUST NOT бути freeze.

Після leftover для `amp-usage`:

- `inputTokens` / `outputTokens` / `totalTokens` = сума всіх sources.
- `session.costUsd` лишається, якщо usage / наявний session billed є числом, а сума `sources[].costUsd` є `null`. MUST NOT затирати billed `null`-сумою sources.
- `spendSource` лишається `amp-usage`, якщо `costUsd` прийшов з Amp usage/Cost. Стає `adapter` лише коли і токени, і cost узяті лише з sources (немає billed).

`applyCollectedSessionFields` leftover зараз викликає `resolveSessionSpend` з `reported` без `costUsd` — це дропне billed. Leftover resync MUST передати наявний `session.costUsd` як збережене billed або не викликати повний resolve, який затирає cost.

**Відхилено:** freeze всіх `amp-usage` (бойовий stale 495184). **Відхилено:** міняти `spendSource` на `adapter` лише через нові токени.

### D5. usageModels — цей thread, унікальні за іменем

**Обрано:** після collect/leftover `session.usageModels` = моделі з `ampThreads`, чий `id` є leftover/session thread (або префікс з sources). Унікальність за `model` (рядок після `matchAmpUsageModel`): залишити рядок з більшим `totalTokens` (або `inputTokens+outputTokens`); при рівності — останній. Не конкатенувати таблиці інших threads.

**Відхилено:** мержити usage всіх зібраних threads (Review #2 / Implementer дублікати Luna і чужі Fable/Sol).

### D6. pending.role через canonicalRole

**Обрано:** `metricsRecordSessionStart` пише `role: canonicalRole(role) || role || ''`. Речення `Archiver — deferred until the CI-green…` → `Archiver`. `handoff.md` MAY лишати повне Closed role. `session.role` на persist уже канонічний — не регресувати.

Не мапити kebab `spec-reviewer` → `Spec Reviewer` у цьому change (чинний smoke `pending.role === 'spec-reviewer'` лишається валідним: `canonicalRole('spec-reviewer')` повертає сегмент `spec-reviewer`).

**Відхилено:** чіпати протокол `session-handoff` (агентський текст). Канон `pending.role` живе в `change-metrics`.

### D7. Тести на rollup після persist/recompute, не лише ampThreads[0]

Чинний `collectSpend Amp CLI` перевіряє `ampThreads[0].costUsd === 1.3` і не бачить drop у maps. Додати кейси, що після persist або прямого recompute `spend.costUsd` і `spendByPlatform.amp.costUsd` дорівнюють Cost. Фікстура 3+ sources з `costUsd: null` і `session.costUsd: 12.69` MUST падати на поточному `recomputeSpendMaps`.

## Risks / Trade-offs

- **[Ризик] Leftover rewrite у `cursor-spend-collect.cjs` знову зріже `spendByPlatform.amp.costUsd`.** → той самий Cost-once fallback у `recompute` скрипта; `cmp` scripts↔templates.
- **[Ризик] Свіжий `lastThreadId` належить чужому Amp-чату в тому ж `session.json`.** → вікно 2h; Amp parent без tty і далі list, не lastThreadId; Amp-env перемагає.
- **[Ризик] Implementer з порожніми sources і `threadId: null` не отримає Amp leftover.** → свідомо: без префікса `listRecent` заборонений (краще miss, ніж archive-thread). Restore lock має дати threadId на наступних сесіях.
- **[Ризик] `applyCollectedSessionFields` дропає billed при leftover resync.** → D4: зберегти `session.costUsd`, не викликати resolve, який бере `fromSources.costUsd` null як перемогу.
- **[Ризик] Історичні архіви ($25.92 miss) лишаються кривими.** → свідомо; бекфіл поза scope.
- **[Ризик] `canonicalRole('spec-reviewer')` не стає `Spec Reviewer`.** → свідомо; окремий change, якщо потрібна нормалізація kebab next-role.

## Migration Plan

Немає міграції файлів. Нові persist/restore/leftover пишуть за новими правилами. Rollback = попередня версія кіта. Споживачі читають ту саму схему v1. Уже заархівовані consumer `metrics.json` не чіпаємо.

## Open Questions

Немає. D1–D7 фіксують шість бойових причин без HTTP, без нових залежностей і без нового leftover-вікна.
