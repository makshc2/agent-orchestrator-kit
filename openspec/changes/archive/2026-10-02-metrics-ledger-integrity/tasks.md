## 1. Інваріанти леджера і попередження на запис

- [x] 1.1 Експортовані функції інваріантів і канонічний перелік ролей
  Files: bin/agent-orchestrator.js
  Do: Додати константи `METRICS_MAX_SESSION_MS` (24 год) і `METRICS_START_BEFORE_CREATED_MS` (12 год); `CANONICAL_ROLE_TOKENS` і `isCanonicalRole`; `metricsSessionInvariantIssues(session, metrics)` (роль, `durationMs` ≤ 24 год, `startedAt` ≥ `createdAt − 12 год`, `endedAt` ≤ `archivedAt`, `adapter` ⇒ `sourceIds` або токени, `costUsdTotal = round4(costUsd ?? costUsdEstimated)` через `costUsdTotalOf` / `sessionFieldOrSources` / `roundUsd4`) і `metricsLedgerInvariantIssues(metrics)` (`version` = 2, кожна сесія, `spend.costUsdTotal = round4(Σ)`); експортувати обидві разом з `isCanonicalRole`, `CANONICAL_ROLE_TOKENS`, `renderMetricsSummary`.
  Done-when: `node -e "import('./bin/agent-orchestrator.js').then(m=>{const i=m.metricsSessionInvariantIssues({role:'Conductor',durationMs:90000000,startedAt:'2026-07-01T00:00:00.000Z',endedAt:'2026-09-10T00:00:00.000Z',spendSource:'adapter',sourceIds:[],costUsdTotal:1},{createdAt:'2026-09-01T00:00:00.000Z',archivedAt:'2026-09-09T00:00:00.000Z'});console.log(i.length, typeof m.metricsLedgerInvariantIssues, m.isCanonicalRole('Conductor'))})"` друкує `6 function false`

- [x] 1.2 Попередження на persist і archive, fail-open
  Files: bin/agent-orchestrator.js
  Do: Додати `warnMetricsIssues` (stderr `metrics: warning: …`) і `annotateSessionInvariants(session, metrics, { print })`, який пише issues (крім `costUsdTotal`, що перевіряється після recompute) у `session.notes[]` без clamp; викликати його в `metricsRecordSessionEnd` після `applyCollectedSessionFields` (з друком) і в `metricsFinalizeArchive` після встановлення `archivedAt` (без друку), а після фінального `loadMetricsFile` в archive друкувати `metricsLedgerInvariantIssues(latest)`. Exit code persist / archive не змінювати.
  Done-when: `grep -c -E '^  annotateSessionInvariants\(session, metrics' bin/agent-orchestrator.js` друкує 2 (два виклики на 2-пробільному відступі; визначення функції починається з `function`); `grep -c -F 'warnMetricsIssues(metricsLedgerInvariantIssues(latest))' bin/agent-orchestrator.js` друкує 1; `node --test test/metrics-ledger-integrity.test.js 2>&1 | grep -c "^ok .*implausible --started-at"` друкує 1

- [x] 1.3 canonicalRole: Spec Architect → Architect
  Files: bin/agent-orchestrator.js
  Do: У `canonicalRole` перед перевіркою `^architect` додати `/^spec\s+architect\b/i` → `Architect`; `Conductor` / `Code Reviewer` не додавати як токени (рішення D8).
  Done-when: `node -e "import('./bin/agent-orchestrator.js').then(m=>console.log(m.canonicalRole('Spec Architect — propose complete'), m.canonicalRole('Conductor')))"` друкує `Architect Conductor`

## 2. Notes адаптерів у stderr

- [x] 2.1 runCollectSpend друкує notes і не ковтає винятки
  Files: bin/agent-orchestrator.js
  Do: Додати `printCollectNotes(notes)` (stderr `metrics: <note>`); у `runCollectSpend` зберегти результат `collectSpend` у змінну, у `catch (error)` повертати `notes: ['collect: adapters failed: <message>']` замість `[]`, викликати `printCollectNotes(collected.notes)` перед `return`.
  Done-when: `grep -c -F "notes: [\`collect: adapters failed: \${reason}\`]" bin/agent-orchestrator.js` друкує 1; `grep -c -F 'printCollectNotes(collected.notes);' bin/agent-orchestrator.js` друкує 1; `node --test test/metrics-ledger-integrity.test.js 2>&1 | grep -c "^ok .*adapter note to stderr only"` друкує 1

## 3. Cache-колонки

- [x] 3.1 Source-записи несуть cacheCreationTokens
  Files: bin/spend-collect.js
  Do: `sourceRecord` приймає `cacheCreationTokens` і ставить ключ лише для числа; `collectClaude` передає обчислений `cacheCreationTokens`; `collectCursor` передає `numOrNull(row.cacheWriteTokens)`.
  Done-when: `grep -c -F 'if (cacheWrite != null) record.cacheCreationTokens = cacheWrite;' bin/spend-collect.js` друкує 1; `grep -c -F 'cacheCreationTokens: numOrNull(row.cacheWriteTokens),' bin/spend-collect.js` друкує 1

- [x] 3.2 Cache-ключі на сесії, byModel, phases, spend, spendByPlatform, spendByModel
  Files: bin/agent-orchestrator.js
  Do: Додати `METRICS_CACHE_KEYS = ['cacheReadTokens', 'cacheCreationTokens']` і включити їх у `METRICS_SPEND_KEYS`; додати `null`-ключі в `emptySpendTotals`, `emptyPlatformSpend`, рядки `compactModelRows` / `mergeModelRows` / `recomputeSpendMaps.addModelRow`, `sessionTotalsFromModels`, Amp-override `byModel` і session-skeleton persist / archive; сумувати в `sessionTotalsFromSources`, `ampThreadTotals` (`cacheReadTokens`), `spendTuple`, `addSpendNums`; `resolveSessionSpend` повертає `cacheReadTokens = firstNonNull(fromAmp, fromSources)` і `cacheCreationTokens = fromSources`; `applyCollectedSessionFields` пише їх на сесію; `resyncLeftoverSessionSpend` перераховує з `byModel`, коли там є число. `inputTokens` не чіпати.
  Done-when: `grep -c -F "const METRICS_SPEND_KEYS = ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'costUsdEstimated', ...METRICS_CACHE_KEYS];" bin/agent-orchestrator.js` друкує 1; `grep -c -F 'session.cacheCreationTokens = spend.cacheCreationTokens;' bin/agent-orchestrator.js` друкує 1; `node --test test/metrics-ledger-integrity.test.js 2>&1 | grep -c "^ok .*Claude cache split lands"` друкує 1

- [x] 3.3 Рядок cache hit у зводці
  Files: bin/agent-orchestrator.js
  Do: Додати `formatCacheHitLine(spend)` (`null`, коли `cacheReadTokens` є `null`; інакше `N% (R cache-read of I input tokens)`, N обрізано до 100) і в `renderMetricsSummary` після рядка `cost:` додати `cache hit: …`, лише коли рядок не `null`.
  Done-when: `grep -c -F 'if (cacheHit) lines.push(`cache hit: ${cacheHit}`);' bin/agent-orchestrator.js` друкує 1; `node -e "import('./bin/agent-orchestrator.js').then(m=>{const x=m.normalizeMetricsV2({version:2,change:'x',createdAt:'2026-09-01T10:00:00.000Z',sessions:[{role:'Implementer',durationMs:1,spendSource:'adapter',sourceIds:['a'],inputTokens:1000,cacheReadTokens:800}]});m.recomputeMetricsAggregates(x);console.log(m.renderMetricsSummary(x).find(l=>l.startsWith('cache hit:')))})"` друкує `cache hit: 80.0% (800 cache-read of 1000 input tokens)`

## 4. Ставки estimator-а

- [x] 4.1 claude-opus-5-5 і дешевший fallback cache-read
  Files: bin/claude-cost-estimate.js
  Do: Додати `'claude-opus-5-5': { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 }` над рядком `'claude-opus'`; ввести `FALLBACK_RATES = { input: 3, cacheRead: 0.3, cacheWrite: 3, output: 15 }` і рахувати `usd` однією формулою через `ratesForModel(model) || FALLBACK_RATES`; експортувати `ratesForModel`.
  Done-when: `node -e "import('./bin/claude-cost-estimate.js').then(m=>console.log(JSON.stringify(m.ratesForModel('claude-opus-5-5')), m.estimateClaudeCostUsd({model:'gpt-6-astra',cacheReadTokens:1000000}), m.estimateClaudeCostUsd({model:'gpt-6-astra',inputTokens:1000000,outputTokens:10000})))"` друкує `{"input":4,"cacheRead":0.2,"cacheWrite":5,"output":20} 0.3 3.15`

## 5. Мертвий конфіг

- [x] 5.1 Видалити roles.*.model_hint із шаблону і профілів
  Files: templates/orchestrator.yaml, profiles/generic/orchestrator.yaml, profiles/node/orchestrator.yaml, profiles/vue3/orchestrator.yaml, profiles/mvp/orchestrator.yaml
  Do: Видалити кожен рядок `model_hint: …` у секції `roles` (по 5 у кожному файлі); решту ролей, `command`, `mode` і `pipeline.require_design_brief` не чіпати.
  Done-when: `grep -c model_hint templates/orchestrator.yaml profiles/generic/orchestrator.yaml profiles/node/orchestrator.yaml profiles/vue3/orchestrator.yaml profiles/mvp/orchestrator.yaml | grep -vc ':0$'` друкує 0; `grep -c -F 'mode: brief-only' templates/orchestrator.yaml profiles/generic/orchestrator.yaml profiles/node/orchestrator.yaml profiles/vue3/orchestrator.yaml profiles/mvp/orchestrator.yaml | grep -c ':1$'` друкує 5

## 6. Тести і дельти spec

- [x] 6.1 Новий тестовий файл metrics-ledger-integrity
  Files: new file: test/metrics-ledger-integrity.test.js
  Do: Contract-тест над `openspec/changes/archive/*/metrics.json` з `createdAt ≥ KIT_METRICS_CONTRACT_SINCE` (`2026-09-25T00:00:00.000Z`) через `metricsLedgerInvariantIssues`; тест, що історичний архів `2026-09-07-fix-metrics-dedup-window-compact-schema` досі порушує інваріанти (не переписаний); unit-тести інваріантів, `canonicalRole`, `ratesForModel` / fallback; CLI-тести: cursor без hook → `metrics: cursor: usage file missing` у stderr і prompt-only stdout; `--started-at` 10 днів тому → два `metrics: warning:` і `session.notes`; Claude jsonl із cache → cache-ключі на всіх рівнях і `cache hit: 80.0%` у `metrics`; summary без cache даних не друкує рядок; шаблони без `model_hint`.
  Done-when: `node --test test/metrics-ledger-integrity.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 11` і `# fail 0`

- [x] 6.2 Дельта change-metrics
  Files: new file: openspec/changes/metrics-ledger-integrity/specs/change-metrics/spec.md
  Do: ADDED: «Поле costUsdTotal у сесіях і агрегатах», «Nullable cache-ключі cacheReadTokens і cacheCreationTokens», «Інваріанти правдоподібності — попередження на запис, не блокування», «Contract-тест над архівними metrics.json», «Notes адаптерів друкуються в stderr», «Рядок cache hit у зводці», «Ставки Claude Opus 5.5 і fallback cache-read»; MODIFIED: «Канонічна Closed role у metrics.json» (alias `Spec Architect`, `Conductor` / `Code Reviewer` неканонічні).
  Done-when: `grep -c '^### Requirement: ' openspec/changes/metrics-ledger-integrity/specs/change-metrics/spec.md` друкує 8; `grep -c -F '### Requirement: Канонічна Closed role у metrics.json' openspec/specs/change-metrics/spec.md openspec/changes/metrics-ledger-integrity/specs/change-metrics/spec.md | grep -c ':1$'` друкує 2

- [x] 6.3 Дельта design-intake
  Files: new file: openspec/changes/metrics-ledger-integrity/specs/design-intake/spec.md
  Do: MODIFIED «Роль design_intake у конфігурації» — повний текст вимоги без фрагмента `і \`model_hint: strong\``, сценарій «Роль у всіх профілях» без змін.
  Done-when: `grep -c -F 'model_hint: strong' openspec/changes/metrics-ledger-integrity/specs/design-intake/spec.md` друкує 0; `grep -c -F '### Requirement: Роль design_intake у конфігурації' openspec/changes/metrics-ledger-integrity/specs/design-intake/spec.md` друкує 1

- [x] 6.4 Валідація і регресії
  Files: openspec/changes/metrics-ledger-integrity/proposal.md, openspec/changes/metrics-ledger-integrity/design.md, openspec/changes/metrics-ledger-integrity/tasks.md
  Do: Прогнати `npx openspec validate metrics-ledger-integrity --strict --type change`, `node bin/agent-orchestrator.js gate-check --review metrics-ledger-integrity`, `node bin/agent-orchestrator.js gate-check --tasks metrics-ledger-integrity` і `npm test`; виправити знайдене до exit 0 (крім відомого падіння `sync-local-agent-skills.sh` через відсутній `rsync` у контейнері).
  Done-when: `npx openspec validate metrics-ledger-integrity --strict --type change >/dev/null && node bin/agent-orchestrator.js gate-check --review metrics-ledger-integrity >/dev/null 2>&1; echo $?` друкує 0; `npm test 2>&1 | grep -E '^# fail '` друкує `# fail 1` лише з `rsync: not found` або `# fail 0`
