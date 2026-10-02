## Context

`readPipelineConfig` (`bin/agent-orchestrator.js`) — єдине місце, де CLI читає `pipeline.*`: його результат використовують `gate-check` (review/design-brief гейт, `max_active_changes`, `src_glob`), `status` (готовність до archive), `archive` (gate 1) і `gate-check --tasks` (`task_contract`). До цього change функція робила п’ять `content.match(...)` по всьому файлу, тому:

- `# require_spec_review: false` (закоментований рядок) перед справжнім ключем або `require_spec_review: false` під `roles.verifier:` давали `requireSpecReview === false` → `gate-check` виходив з «review not required», exit 0;
- `src_glob` читався regex-ом `[^"'\s#]+`, тобто обрізався на першому пробілі;
- `gitDiffTouchesGlob` / `gitStagedTouchesGlob` вставляли значення як одну pathspec у shell-рядок `git diff --name-only … -- "<value>"`; для `bin/,scripts/,templates/` чи `{src,lib,app}/` git повертав 0 файлів → «nothing to gate», exit 0.

`parseMcpInventory` і `parseSkillsInventory` у тому ж файлі вже є рядковими reader-ами, обмеженими top-level блоком (`^mcp:` / `^skills:`, вихід на першому рядку без відступу). Спека `skill-inventory` вимагає regex-парсер без YAML-залежності — рядковий reader це задовольняє.

`scripts/{cursor-spend-collect,cursor-spend-hook,memory-mcp-launcher}.cjs` у корені кіта — копії `templates/scripts/`; дрейф ловили лише ручним `cmp` з apply-notes двох archive-change. Єдиний червоний локальний тест (`sync-local-agent-skills.sh`) падає через відсутній `rsync`, тож новий тест не має залежати від нього.

## Goals / Non-Goals

**Goals:**
- Значення `pipeline.*` беруться лише з top-level блоку `pipeline:`; коментарі та інші секції не впливають.
- Hand-edited consumer-конфіги без `pipeline:` зберігають попередню поведінку (legacy-fallback).
- `src_glob` / `--src-glob` приймає список pathspec через кому або пробіл, кожен елемент іде git-у окремо.
- Для всіх шаблонів і профілів результат reader-а побітово той самий, що й раніше.
- Дрейф `scripts/*.cjs` від `templates/scripts/` ловиться тестом без `rsync`.

**Non-Goals:**
- Крок `gate-check` у CI кіта, `gate-check --review` по відкритих каталогах, branch protection — окремий change з дельтою `kit-ci-verify`.
- `init --force` на корені кіта; байтовий тест на `.agents/*` (курована підмножина).
- Зміна контракту «немає активного change → warn + exit 0»; режим `require_change_for_src`.
- YAML-бібліотека; розкриття `{a,b}/`; зміни `README.md` / `CHANGELOG.md` / `package.json`.

## Decisions

**D1. Рядковий reader, обмежений прямими дочірніми рядками `pipeline:`.** `parsePipelineSection` вмикається на `^pipeline:\s*(#.*)?$`, вимикається на першому рядку без відступу, запам’ятовує відступ першого дочірнього ключа і приймає лише рядки з тим самим відступом за формою `key:` / `key: value`. Рядки-коментарі (`  # …`) не матчать `[A-Za-z_]` після відступу, тож пропускаються; вкладені мапи (`  nested:\n    require_spec_review: false`) мають інший відступ і теж ігноруються. Обґрунтування: саме це закриває обидва спостережені кейси (коментар, інша секція) і додатково вкладений ключ, лишаючись у стилі `parseSkillsInventory`.
Альтернатива — YAML-парсер — відкинута: нова залежність і суперечність спеці `skill-inventory`.

**D2. `readYamlScalar` для значення.** Значення в подвійних або одинарних лапках читається цілком (включно з пробілами, комами, `#`), хвіст після закривної лапки відкидається; bare-значення зрізається на ` #` і трімиться. Так `src_glob: "bin/, scripts/ templates/" # three roots` дає рівно `bin/, scripts/ templates/`.

**D3. Валідація значень після reader-а, не всередині regex.** `require_spec_review` / `require_design_brief` приймають лише `true|false` (інакше дефолти `true` / `false`), `max_active_changes` — лише `^\d+$`, `task_contract` — лише `warn|strict|off`, інакше `warn`. Це повторює множину значень, яку приймали попередні regex, тож невалідне значення й далі дає дефолт, а не помилку.

**D4. Legacy-fallback лише за відсутності блоку `pipeline:`.** `parsePipelineLegacy` відтворює попередні regex (перше входження будь-де); для `src_glob` він тепер приймає значення в лапках із пробілами/комами або bare до кінця рядка мінус коментар. Обґрунтування: refuter-и вимагали не ламати ручно відредаговані конфіги без секції; всі шаблони й профілі мають `pipeline:`, тож для них fallback не вмикається.
Альтернатива — завжди legacy, якщо секція не дала ключа — відкинута: тоді `# require_spec_review: false` поза секцією знову б спрацьовував.

**D5. `splitSrcGlob` + `execFileSync` з масивом pathspec.** Поділ по `/[\s,]+/`, порожні елементи відкидаються. `gitNameOnlyTouches` викликає `execFileSync('git', ['diff','--name-only', ...range, '--', ...paths])`: без shell не потрібні лапки, елементи з пробілами чи спецсимволами не ламають команду. Порожній список → `null` (невідомо), а команда `gate-check` ще до цього підставляє дефолт `src/`, тож `null` з цієї гілки на практиці не виникає. Повідомлення CLI показують нормалізований список через кому (`bin/,templates/`), щоб користувач бачив, що саме гейтилось.
Альтернатива — розкривати `{a,b}/` у коді — відкинута: формат списку через кому/пробіл простіший і не потребує власного парсера дужок; приклад у шаблоні замінено.

**D6. Чисті експортовані функції для unit-тестів.** `parsePipelineConfig(content)` і `splitSrcGlob(value)` додано до `export { … }`; `readPipelineConfig(projectDir)` стає тонкою обгорткою (I/O + виклик). CLI-тести покривають ті самі кейси end-to-end через `spawnSync` CLI, як у `test/smoke.test.js`.

**D7. Байтовий тест лише для трьох `scripts/*.cjs`.** `Buffer.equals` над `fs.readFileSync` для `cursor-spend-collect.cjs`, `cursor-spend-hook.cjs`, `memory-mcp-launcher.cjs`. `.agents/*` кореня не включено свідомо (курована підмножина), `orchestrator.yaml` кореня не існує за дизайном.

**D8. Тести в одному новому файлі.** Усі нові тести (парсер, split, CLI, байтова рівність) живуть у `test/gate-check-config-parser-and-src-glob.test.js` за конвенцією репо «нові тести в новому файлі change»; `test/smoke.test.js` не змінюється, бо жоден наявний асерт не суперечить новій поведінці.

## Risks / Trade-offs

- [Consumer, у якого ключі `pipeline.*` стояли поза блоком `pipeline:` при наявному блоці, тепер отримує дефолти] → Такий файл є помилкою конфігурації; попередня поведінка на ньому була випадковою. Шаблони/профілі так не роблять; legacy-fallback покриває файли без блоку взагалі.
- [Відступ дочірніх ключів фіксується за першим ключем: змішані відступи під `pipeline:` частково ігноруються] → YAML і сам вимагає однакового відступу для сусідніх ключів мапи.
- [Рядок `#` у колонці 0 всередині блоку `pipeline:` міг би сприйматися як наступний top-level ключ] → Reader пропускає такі рядки (`/^#/` → continue) до перевірки `/^\S/`, бо в YAML коментар без відступу не закриває мапу; це покрито unit-тестом.
- [`src_glob` з фігурними дужками (`"{src,lib}/"`) ріжеться по комі на літеральні pathspec, що нічого не матчать] → Brace expansion лишається non-goal (D5); `gate-check` друкує warn з підказкою перелічити шляхи через кому/пробіл, щоб «nothing to gate» не виглядало як успіх.
- [Текст повідомлення «no changes under …» тепер показує нормалізований список (`bin/,templates/` замість `bin/, templates/`)] → Smoke-асерти перевіряють лише `nothing to gate`; новий тест фіксує нову форму.
- [`execFileSync` замість `execSync`: інша поведінка при відсутньому git] → Обидва кидають, обидва перехоплюються в `try/catch` → `null`, контракт «null = перевіряти гейт» без змін.
- [Тест байтової рівності стане червоним при навмисній зміні лише `templates/scripts/`] → Це і є мета: дрейф видно за секунду, виправлення — скопіювати файл у `scripts/`.
