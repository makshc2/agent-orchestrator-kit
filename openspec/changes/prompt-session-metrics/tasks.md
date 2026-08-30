## 1. Парсер і запис секції `## Metrics`

- [x] 1.1 Додати `Metrics` у `HANDOFF_SECTIONS` і рендер секції в `buildHandoffMarkdown` між `## Runtime` і `## Prompt`
  Files: bin/agent-orchestrator.js
  Do: додати рядок `'Metrics'` у `HANDOFF_SECTIONS` після `'Runtime'`; у `buildHandoffMarkdown` вивести блок `## Metrics` з рядками `- platform:`, `- model:`, `- input_tokens:`, `- output_tokens:`, `- cost_usd:`, `- amp_credits:`, `- spend_source:`, підставляючи `unknown` для null-значень з `fields.metrics`; рендерити лише розібраний самозвіт `fields.metrics` — не передавати сюди значення прапорців, `AOK_MODEL`, `AOK_PLATFORM`, host env чи `sources` (write-back резолвлених значень у файл не робиться, див. design D5)
  Done-when: `buildHandoffMarkdown` з порожнім `fields.metrics` дає секцію `## Metrics` із сімома рядками `unknown`, секція стоїть перед `## Prompt`, а persist з `--input-tokens 7` над секцією з `input_tokens: 100` лишає у файлі `input_tokens: 100`

- [x] 1.2 Написати `parseMetricsSection(body)` з нормалізацією значень
  Files: bin/agent-orchestrator.js
  Do: за зразком `parseRuntimeBulletFields` розібрати рядки `- key: value` без урахування регістру ключа; повернути `{ platform, model, inputTokens, outputTokens, totalTokens, costUsd, ampCredits, spendSource, warnings }`; нормалізувати `unknown`/`none`/`n/a`/`-`/`—`/`null`/порожнє в `null`; для чисел зняти коми, пробіли і `$`; непарсабельне число дає `null` плюс запис у `warnings`; ключі часу ігнорувати; `totalTokens` повертати лише коли ключ `total_tokens` реально є в секції — суму `input + output` не рахувати тут, її єдиний власник — `resolveSessionSpend` (таск 2.3)
  Done-when: `parseMetricsSection` на рядках `input_tokens: 128,000`, `cost_usd: $1.25`, `model: unknown`, `duration_ms: 999` повертає `128000`, `1.25`, `null`, `totalTokens: null` і не має поля тривалості

- [x] 1.3 Провалідувати `platform` із самозвіту як warn-only
  Files: bin/agent-orchestrator.js
  Do: у `parseMetricsSection` перевірити значення `platform` проти `VALID_PLATFORMS`; невалідне непорожнє значення дає `null` і повідомлення у `warnings`, без зміни exit code
  Done-when: секція з `platform: chatgpt` дає `platform: null` і один запис у `warnings`

- [x] 1.4 Підключити секцію до `fieldsFromSections`
  Files: bin/agent-orchestrator.js
  Do: у `fieldsFromSections` викликати `parseMetricsSection(sectionOr(sections, 'Metrics', ''))` і покласти результат у `fields.metrics`; зберегти сумісність з файлами без секції (порожній об'єкт із `null`-полями)
  Done-when: `readHandoffFields` для файлу без `## Metrics` повертає `fields.metrics` з усіма `null` і без винятків

## 2. Ланцюжки резолву в persist

- [x] 2.1 Розширити `resolveModel` самозвітом
  Files: bin/agent-orchestrator.js
  Do: змінити сигнатуру на `resolveModel(opts, env, reported)` і реалізувати порядок `--model` → `reported.model` → `AOK_MODEL` → `null`; оновити всі місця виклику
  Done-when: persist із `## Metrics: model: claude-opus-5` і `AOK_MODEL=gpt-5.6-sol` пише `session.model` рівним `claude-opus-5`

- [x] 2.2 Розширити `resolvePlatform` самозвітом
  Files: bin/agent-orchestrator.js
  Do: додати `reported.platform` у ланцюжок між `--platform` і `AOK_PLATFORM`; лишити fail на невалідному `--platform` і warn-only на невалідних `AOK_PLATFORM` і самозвіті
  Done-when: із `CURSOR_AGENT=1` і `## Metrics: platform: amp` сесія пишеться з `platform: amp`, а `--platform foo` і далі дає non-zero

- [x] 2.3 Реалізувати `resolveSessionSpend(opts, reported, sources)` і `spendSource`
  Files: bin/agent-orchestrator.js
  Do: пополе повернути токени, `costUsd` і `ampCredits` за порядком прапорець → самозвіт → sources → `null`; порахувати `totalTokens` як суму резолвлених `inputTokens` і `outputTokens`, коли жодне джерело не дало `total_tokens` — це єдине місце обчислення суми в кіті (парсер із таска 1.2 суми не рахує); повернути `spendSource` за правилом: `reported.spendSource` → `flag` → `self-report` → `adapter` → `unreported`
  Done-when: чотири persist-прогони (лише прапорці, лише секція, секція плюс прапорці, порожньо) дають у `metrics.json` очікувані `inputTokens`/`outputTokens`/`totalTokens`/`costUsd` і очікуваний `spendSource`

- [x] 2.4 Переписати `metricsRecordSessionEnd` на новий ланцюжок
  Files: bin/agent-orchestrator.js
  Do: прибрати безумовний виклик `runCollectSpend`; замінити `applyCollectedSessionFields` — воно зараз ставить `session.model = primaryModelFromSources(sources) || resolvedModel` і перетирає session-level totals значеннями з `sources`, що інвертує новий ланцюжок; після заміни `session.model` бере `resolveModel` (таск 2.1), `session.platform` — `resolvePlatform` (таск 2.2), а токени / `costUsd` / `ampCredits` — `resolveSessionSpend` (таск 2.3), тож `sources` можуть лише заповнити поля, які лишились `null`, і ніколи не перезаписують прапорець чи самозвіт; писати в сесію `spendSource` і `ampCredits`; викликати `collectSpend` і backfill лише коли `opts.collect === true`; лишити `startedAt`/`endedAt`/`durationMs` як розрахунок CLI
  Done-when: persist без `--collect` при наявних tmp-фікстурах адаптерів пише `sources: []`; з `--collect` `sources` непорожній, але сесія з `## Metrics` (`input_tokens: 1000`) і адаптерним source на `5` лишає `inputTokens: 1000`, а `--model cursor-grok-4.6` перемагає `primaryModelFromSources`

- [x] 2.5 Додати попередження про незаповнений самозвіт і запис скелета секції
  Files: bin/agent-orchestrator.js
  Do: після запису сесії з `spendSource: "unreported"` надрукувати в stderr іменоване попередження з переліком очікуваних ключів; переконатись, що `handoff.md` після persist містить секцію зі значеннями `unknown` — скелет пише той самий `buildHandoffMarkdown` із таска 1.1, повторного запису файлу після `metricsRecordSessionEnd` не додавати; stdout лишити тільки промптом
  Done-when: persist без `## Metrics` дає exit 0, попередження в stderr, `## Metrics` зі значеннями `unknown` у файлі, stdout, що починається з `/opsx:`, і рівно один запис `handoff.md` за прогін persist

## 3. Прапорці CLI

- [x] 3.1 Замінити `--no-collect` на `--collect` у команді `handoff`
  Files: bin/agent-orchestrator.js
  Do: видалити `.option('--no-collect', ...)`, додати `.option('--collect', 'Additionally collect local spend adapters', false)` і передавати `collect: opts.collect === true` у `metricsRecordSessionEnd`
  Done-when: `handoff <name> --help` показує `--collect` і не показує `--no-collect`

- [x] 3.2 Замінити `--no-collect` на `--collect` у команді `archive`
  Files: bin/agent-orchestrator.js
  Do: те саме для `archive`; передати `collect: opts.collect === true` у `metricsFinalizeArchive`
  Done-when: `archive --help` показує `--collect`, а archive без прапорця не читає каталоги адаптерів

- [x] 3.3 Прибрати `ensureCursorSpendHook` із сесійних команд
  Files: bin/agent-orchestrator.js
  Do: видалити виклики `ensureCursorSpendHook` з гілки `handoff --restore`, з persist і з команди `metrics`; лишити виклики в `init`, `update`, `sync`, `mcp-setup`; у `printSpendHealth` позначити hook як опційний
  Done-when: persist у проєкті без `.cursor/hooks.json` не створює цей файл і не друкує рядок про hook

## 4. Агрегати і вивід

- [x] 4.1 Наповнювати `spendByPlatform` і `spendByModel` із session-level самозвіту
  Files: bin/agent-orchestrator.js
  Do: у `recomputeSpendMaps` додати внесок сесій з непорожнім `session.platform` (токени, `costUsd`, `ampCredits`); коли сума `session.sources` дорівнює session-level totals — рахувати один раз; лишати `source: "none"` для бакетів без адаптерних записів
  Done-when: дві сесії `cursor` і `amp` без `sources` дають правильні бакети, а сесія із `sources`, сума яких дорівнює totals, не подвоює токени

- [x] 4.2 Винести рендер людського виводу в `renderMetricsSummary(metrics)`
  Files: bin/agent-orchestrator.js
  Do: перенести друк підсумку, таблиць by phase / by platform / by model і списку сесій із дії команди `metrics` у окрему функцію, що повертає масив рядків; команду `metrics` перевести на неї
  Done-when: `metrics <name>` друкує той самий вивід, що й до рефакторингу, і тести smoke на цю команду проходять

- [x] 4.3 Показати `spendSource` у виводі `metrics`
  Files: bin/agent-orchestrator.js
  Do: додати в підсумок лічильник сесій зі `spendSource: "unreported"` і показати `spendSource` у рядку кожної сесії; дефолт для legacy-записів належить шару відображення — `renderMetricsSummary` трактує відсутній або порожній `session.spendSource` як `unreported`, а `loadMetricsFile` записів сесій не нормалізує і файл не мігрує
  Done-when: `metrics <name>` для файлу з двома `unreported` сесіями друкує їх кількість, а `metrics <name>` над legacy-файлом із сесією без ключа `spendSource` рахує її як `unreported` і не змінює файл на диску

- [x] 4.4 Друкувати зводку по change у stdout `archive`
  Files: bin/agent-orchestrator.js
  Do: після `metricsFinalizeArchive` перечитати файл і надрукувати `renderMetricsSummary` у stdout після наявних рядків `change/schema/archive/sync/handoff/memory/metrics`; обгорнути виклик у try/catch, щоб помилка рендера не змінювала exit code
  Done-when: `archive <name>` друкує таблиці by phase, by platform і by model і завершується exit 0 навіть коли `metrics.json` містить лише одну сесію

- [x] 4.5 Резолвити метрики сесії Archiver із архівованого `handoff.md`
  Files: bin/agent-orchestrator.js
  Do: у гілці archive після move прочитати `## Metrics` з `join(targetDir, 'handoff.md')` через `parseMetricsSection` і передати результат у `metricsFinalizeArchive` як `reported`; використати ті самі ланцюжки резолву, що й persist
  Done-when: archive без прапорців моделі й платформи бере їх із секції архівованого `handoff.md`

## 5. Шаблони протоколу

- [x] 5.1 Оновити канонічне правило Session Exit
  Files: templates/.agents/rules/session-handoff.mdc
  Do: додати крок заповнення `## Metrics` перед запуском `handoff <name>`, перелічити ключі і правило `unknown` замість нуля; прибрати текст про auto-collect і `--no-collect`; описати `--collect` як опційний
  Done-when: файл містить перелік ключів секції і не містить рядка `--no-collect`

- [x] 5.2 Оновити субагента session-handoff
  Files: templates/.agents/subagents/session-handoff.md
  Do: у режимі persist додати запис `## Metrics` до списку обов'язкових секцій і замінити абзац про auto-collect на опис самозвіту
  Done-when: persist-розділ перелічує `## Metrics` серед секцій, які пише fallback-субагент

- [x] 5.3 Оновити субагента spec-archiver
  Files: templates/.agents/subagents/spec-archiver.md
  Do: додати вимогу заповнити `## Metrics` перед `npx agent-orchestrator-kit archive <name>` і згадати фінальну зводку в stdout
  Done-when: файл описує самозвіт Archiver і зводку

- [x] 5.4 Оновити skill і кореневі документи агентів
  Files: templates/.agents/skills/agent-orchestration/SKILL.md, templates/AGENTS.md, templates/CLAUDE.md
  Do: синхронізувати опис Session Exit із новим кроком самозвіту і прибрати згадки auto-collect як обов'язкового механізму
  Done-when: три файли описують ту саму послідовність кроків, що й `session-handoff.mdc`

## 6. Тести і документація

- [x] 6.1 Тести парсера секції
  Files: test/smoke.test.js
  Do: покрити нормалізацію `unknown`, числа з комами і `$`, невалідну платформу, ігнорування ключів часу і те, що секція без ключа `total_tokens` дає `totalTokens: null` у парсері, а суму `input + output` видно вже в `metrics.json` після persist (власник — `resolveSessionSpend`)
  Done-when: `npm test` проходить, містить нові кейси парсера і кейс «секція з `input_tokens: 128000` і `output_tokens: 9400` без `total_tokens` дає `sessions[0].totalTokens` рівним `137400`»

- [x] 6.2 Тести persist на ланцюжки і `spendSource`
  Files: test/smoke.test.js
  Do: додати кейси «прапорець перемагає самозвіт», «самозвіт перемагає env і host», «persist без секції дає unreported плюс warning плюс exit 0», «дефолтний persist не читає фікстури адаптерів», «persist з `--collect` наповнює sources, але не перекриває самозвіт», «persist з `--input-tokens 7` над секцією з `input_tokens: 100` лишає у `handoff.md` рядок `input_tokens: 100`»
  Done-when: усі шість кейсів зелені

- [x] 6.3 Тести агрегатів і виводу
  Files: test/smoke.test.js
  Do: покрити `spendByPlatform` з двох платформ без `sources`, відсутність подвійного рахунку із `sources`, лічильник `unreported` у `metrics`, наявність таблиць у stdout `archive`
  Done-when: тести підтверджують суми і наявність таблиць у stdout archive

- [x] 6.4 Тести на прибраний self-heal hook
  Files: test/smoke.test.js
  Do: перевірити, що persist і `handoff --restore` не створюють `.cursor/hooks.json`, а `update` створює його з чотирма подіями
  Done-when: обидві перевірки зелені і наявні тести адаптерів у `test/spend-collect.test.js` не змінюються

- [x] 6.5 Переписати наявні smoke-тести, що спираються на `--no-collect`
  Files: test/smoke.test.js
  Do: переписати чотири живі місця, які ламає видалення прапорця. (1) `test('persist Claude fixture fills session totals; flags override; --no-collect skips adapters')` (близько рядка 2133) — перейменувати на `--collect`-семантику, додати `--collect` до двох перших `cliExec(dir, 'handoff add-thing')` і `cliExec(dir, 'handoff add-thing --cost-usd 9.99')`, бо без прапорця `sources` тепер порожні; (2) `cliExec(dir, 'handoff add-thing --no-collect')` (близько рядка 2217) — замінити на `cliExec(dir, 'handoff add-thing')` зі збереженням тверджень `sources: []` і `totalTokens: null`; (3) `test('archive --no-collect finalizes without Archiver sources')` (близько рядка 2267) — перейменувати на дефолтну поведінку archive без прапорця; (4) `runCliStub(dir, 'archive add-auth --sync --no-collect')` (близько рядка 2286) — замінити на `runCliStub(dir, 'archive add-auth --sync')`, лишивши перевірку `archiver.sources` рівних `[]`; додати один кейс, що `handoff <name> --no-collect` тепер завершується non-zero з повідомленням про невідомий прапорець
  Done-when: у `test/smoke.test.js` лишається рівно один виклик CLI з `--no-collect` — той, що очікує non-zero і повідомлення про невідомий прапорець; `npm test` завершується exit 0

- [x] 6.6 Оновити README, CHANGELOG і версію
  Files: README.md, CHANGELOG.md, package.json
  Do: описати секцію `## Metrics`, ланцюжки резолву, `--collect`, зводку archive і опційний hook; додати запис CHANGELOG із позначкою BREAKING про `--no-collect` та підняти мінорну версію кіта
  Done-when: README і CHANGELOG не містять `--no-collect` як чинного прапорця, а версія в `package.json` піднята

- [x] 6.7 Прогнати повний локальний verify
  Files: package.json, test/smoke.test.js, test/spend-collect.test.js
  Do: виконати `npm test` і `npx openspec validate --all --strict`, полагодити знайдені розбіжності
  Done-when: обидві команди завершуються exit 0
