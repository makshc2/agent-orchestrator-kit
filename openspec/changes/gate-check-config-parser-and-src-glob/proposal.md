## Why

`gate-check` читає `pipeline.*` з `.agents/orchestrator.yaml` п’ятьма «голими» regex по всьому файлу: перше входження `require_spec_review:` будь-де перемагає. Перевірено на копії: закоментований рядок `# require_spec_review: false` перед справжнім ключем або той самий ключ під `verifier:` змушують `gate-check` друкувати «review not required» і виходити з exit 0 — один символ у YAML consumer-репо мовчки вимикає review-гейт. Другий латентний баг: `pipeline.src_glob` передається git-у як одна літеральна pathspec, тож список `"bin/,scripts/,templates/"` (і приклад `"{src,lib,app}/"` із самого шаблону — git не розкриває фігурні дужки) дає 0 файлів, «nothing to gate» і exit 0 для кожного багато-каталогового репо; regex `src_glob` до того ж обрізає значення на першому пробілі. Третє: три `scripts/*.cjs` кореня кіта мають бути байтовими копіями `templates/scripts/`, але це перевіряють лише ручним `cmp` із двох archive apply-notes, а єдиний червоний локальний тест — через відсутній `rsync`.

Design: none

## What Changes

- **A. Секційний reader `pipeline.*`.** `readPipelineConfig` у `bin/agent-orchestrator.js` замість п’яти regex по всьому файлу використовує рядковий reader за зразком `parseSkillsInventory`: ключі приймаються лише як прямі дочірні рядки top-level блоку `pipeline:`, рядки-коментарі пропускаються, хвіст `# …` після значення зрізається, значення у лапках (включно з пробілами й комами) читається цілком. Коли блоку `pipeline:` у файлі немає — fallback на попередній regex-reader (перше входження ключа будь-де), щоб ручно відредаговані consumer-конфіги без секції не змінили поведінку. Нова експортована функція `parsePipelineConfig(content)` (чиста, без I/O) тестується напряму.
- **B. Багато-шляховий `src_glob`.** Нова `splitSrcGlob` ділить `pipeline.src_glob` / `--src-glob` по комах і пробілах; `gitDiffTouchesGlob` / `gitStagedTouchesGlob` передають кожен елемент окремим git pathspec через `execFileSync` (без shell-лапок). Порожній список після split → дефолт `src/`. Повідомлення CLI показують нормалізований список (`no changes under bin/,templates/ — nothing to gate`). Коментар біля `src_glob` у `templates/orchestrator.yaml` і чотирьох профілях пояснює формат списку і замінює непрацюючий приклад `"{src,lib,app}/"` на `"src/,lib/,app/"`; опис опції `--src-glob` називає список pathspec.
- **C. Тести.** Новий `test/gate-check-config-parser-and-src-glob.test.js`: unit-тести `parsePipelineConfig` (закоментований ключ перед справжнім, ключ під `verifier:`, вкладений ключ під `pipeline:`, legacy-файл без `pipeline:`, шаблон і профілі), `splitSrcGlob`, CLI-тести gate-check для цих же кейсів і для `src_glob: "bin/,templates/"` (зміна під `templates/` блокує; зміна поза списком — «nothing to gate»; `--staged --src-glob bin/,lib/`), і байтова рівність `scripts/{cursor-spend-collect,cursor-spend-hook,memory-mcp-launcher}.cjs` з `templates/scripts/` через `fs.readFileSync` (без rsync).
- Без **BREAKING**: для всіх шаблонів і профілів (одне входження кожного ключа всередині `pipeline:`, `src_glob: "src/"`) результат reader-а ідентичний попередньому; один pathspec без ком/пробілів поводиться як раніше.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `orchestrator-cli-controls`: вимога «CLI команда gate-check» — `pipeline.*` читається лише з top-level блоку `pipeline:` (коментарі та інші секції не впливають, legacy-fallback без блоку), а `--src-glob` / `pipeline.src_glob` є списком git pathspec через кому або пробіл.
- `commit-review-gate`: вимога «Гейт блокує commit коду без APPROVE і є no-op у MVP-режимі» — `--staged` використовує той самий багато-шляховий `src_glob`, тож staged-зміна під будь-яким елементом списку блокується.

## Impact

- `bin/agent-orchestrator.js` — `readYamlScalar`, `parsePipelineSection`, `parsePipelineLegacy`, `parsePipelineConfig` (експорт), `readPipelineConfig` стає обгорткою; `splitSrcGlob` (експорт), `gitNameOnlyTouches`, `gitDiffTouchesGlob`, `gitStagedTouchesGlob` на `execFileSync`; нормалізація `srcGlob` у команді `gate-check`; опис опції `--src-glob`; імпорт `execFileSync`.
- `templates/orchestrator.yaml`, `profiles/{generic,mvp,node,vue3}/orchestrator.yaml` — лише коментар біля `src_glob` (значення `"src/"` без змін).
- Новий `test/gate-check-config-parser-and-src-glob.test.js`; `test/smoke.test.js` не змінюється (усі наявні асерти gate-check лишаються чинними).
- Delta specs `orchestrator-cli-controls`, `commit-review-gate`.
- Споживачі `status`, `archive`, `gate-check --tasks` (через `taskContractMode`) отримують той самий об’єкт конфігурації, тож секційний reader діє і для них.

## Non-goals

- Не додавати крок `gate-check` у `.github/workflows/agent-verify.yml` кіта і не запускати `gate-check --review` на кожен відкритий каталог у CI (explore-стадія без proposal.md падала б; потребує окремого change з дельтою `kit-ci-verify`).
- Не запускати `init --force` на корені кіта і не додавати байтовий тест на кореневий `.agents/` (курована підмножина, `ask-before-heavy-ops.mdc`).
- Не змінювати контракт «src змінився, але активного change немає → warn + exit 0» і не додавати режим `require_change_for_src`.
- Не вводити YAML-залежність: reader лишається рядковим (вимога `skill-inventory` про regex-парсер без YAML).
- Не чіпати `README.md`, `CHANGELOG.md`, `package.json` (docs-прохід і bump — після merge).
- Не розкривати фігурні дужки `{a,b}/` самостійно — формат списку задає кома/пробіл.

## Acceptance criteria

1. **Коментар і чужа секція не вимикають гейт.** У проєкті з `pipeline:\n  # require_spec_review: false\n  require_spec_review: true`, зміною під `src/` і активним change без `review.md` `gate-check --base HEAD~1` завершується exit 1 з `review gate failed`; те саме для `require_spec_review: false` під `roles.verifier:`.
2. **Legacy-fallback.** Файл без блоку `pipeline:` з `require_spec_review: false` на верхньому рівні дає `review not required`, exit 0.
3. **Список src_glob.** `src_glob: "bin/,templates/"` і зміна `templates/a.js` → exit 1 `review gate failed`; `src_glob: "bin/ scripts/ templates/"` і зміна `scripts/x.cjs` → exit 1; зміна лише `docs/a.md` → exit 0 з `no changes under bin/,templates/ — nothing to gate`; `--staged --src-glob bin/,lib/` блокує staged `lib/a.js`, а `--src-glob bin/` для тієї ж index дає `nothing to gate`.
4. **Чисті функції.** `parsePipelineConfig` і `splitSrcGlob` експортуються з `bin/agent-orchestrator.js`; `parsePipelineConfig` для `templates/orchestrator.yaml` повертає `{requireSpecReview: true, requireDesignBrief: false, maxActiveChanges: 1, taskContract: 'warn', srcGlob: 'src/'}`, для `profiles/mvp` — `requireSpecReview: false`, `taskContract: 'off'`; `splitSrcGlob('bin/,scripts/ templates/')` → `['bin/','scripts/','templates/']`.
5. **Шаблони.** `grep -rn "src,lib,app" templates profiles` порожній; коментар біля `src_glob` у шаблоні й чотирьох профілях містить `"src/,lib/,app/"`; значення `src_glob: "src/"` не змінене.
6. **Байтова рівність.** Тест читає `scripts/{cursor-spend-collect,cursor-spend-hook,memory-mcp-launcher}.cjs` і `templates/scripts/` через `fs.readFileSync` і порівнює `Buffer.equals`, без `rsync` і без `.agents/*`.
7. **Зелений прогін.** `node --test test/gate-check-config-parser-and-src-glob.test.js` — усі тести pass; `npm test` зелений (окрім одного наявного rsync-тесту в середовищі без rsync); `npx openspec validate gate-check-config-parser-and-src-glob --strict --type change` і `gate-check --review gate-check-config-parser-and-src-glob` дають exit 0.
