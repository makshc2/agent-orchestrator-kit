## Context

`verify-specs.sh` збирає main specs і дозволені змінені source-файли, викликає Amp та пише `artifacts/verdict.json`. Промпт містить лише findings і літеральний `line: null`. `sed ... | head -200` обрізає довгу відповідь. Обидва provider-скрипти вже показують Summary, Score, Findings та `file:line`, якщо line truthy; груп conformance немає. CI читає лише `pass`.

Підстава: `docs/course-derived-plan-2026-10-29.md`, пункт 1. Попередній `fix-main-spec-preflight` ще активний, але цей proposal створюється за прямим запитом користувача; його артефакти не змінюються. Нова фіча не мігрує довгі main specs і не залежить від оновлення OpenSpec.

## Goals / Non-Goals

**Goals:** адитивний звіт з доказами, однакове представлення в GitHub/GitLab, backward compatibility, перевірка без зовнішніх викликів.

**Non-Goals:** новий merge gate, повний аудит репозиторію, новий renderer-пакет, зміна CI/provider auth, active-delta verification, автоматичний ремонт суперечливих відповідей LLM.

## Decisions

### 1. Три додаткові масиви, один контракт елемента, одне правило класифікації

Промпт вимагає `implemented[]`, `missing[]`, `scope_creep[]`. Елемент кожної групи має `spec`, `requirement`, `message`, `file`, `line`. `spec` і `requirement` — точні рядки з наданих специфікацій, `message` — короткий доказ або пояснення розбіжності, `file` — repo-relative path наданого source-файла або `null`, `line` — додатне ціле 1-based або `null`. Окремого severity у групах немає.

| Група | Значення | `file` |
|---|---|---|
| implemented | Поведінка релевантної вимоги підтверджена наданим кодом; message пояснює чим саме. | наданий файл; `null` допустимий |
| missing | Позитивна вимога (SHALL/MUST/SHOULD/MAY зробити X), поведінка X відсутня або неповна в наданому файлі, де її очікує вимога. | обов'язково наданий файл (непорожній рядок); `line` може бути `null` |
| scope_creep | Наданий код робить те, що вимога чи явна межа забороняє або виключає (SHALL NOT, MUST NOT, явне виключення/non-goal у наданих специфікаціях). | обов'язково наданий файл; `line` може бути `null` |

Правило класифікації (контракт промпту, renderer його не перевіряє й не переказує):

1. Група визначається полярністю порушеної вимоги: невиконана або частково виконана позитивна вимога → лише `missing`; порушена заборона чи виключення → лише `scope_creep`. Одна розбіжність потрапляє рівно в одну групу; та сама комбінація spec/requirement/file не з'являється у двох групах.
2. Код, що робить інше, ніж вимагає позитивна вимога, але не порушує жодної заборони, — `missing`, не `scope_creep`.
3. `missing` вимагає наданого `file`, де поведінку очікує вимога. Якщо такого файла назвати не можна (реалізація може бути в незміненому файлі поза контекстом), елемент `missing` не створюється: модель пише warning/info finding про невизначеність.
4. `scope_creep` лише за явною забороною чи межею. Файл без відповідної спеки та «зайва» поведінка без заборони — не scope creep: info finding за чинним правилом.

Дослівні рядки промпту (тести 2.1 перевіряють їх підрядками; англійською, як решта промпту):

```
Conformance groups (additive; findings stay the only source of pass and score):
- implemented: provided code satisfies a relevant requirement; message cites the evidence.
- missing: a positive requirement whose behavior is absent or incomplete in a provided file where the behavior is expected. "file" MUST be that provided file (line may be null). If you cannot name such a file, do NOT add a missing item; add a warning or info finding about the uncertainty instead.
- scope_creep: provided code does what a requirement or an explicit boundary forbids or excludes (SHALL NOT, MUST NOT, an explicit exclusion or non-goal in the provided specs). "file" MUST be that provided file. A changed file without a related spec is an info finding, never scope_creep.
- One discrepancy goes to exactly one group: an unmet positive requirement is missing; a violated prohibition or exclusion is scope_creep.
```

Відсутність реалізації серед змінених файлів не доводить її відсутності у репозиторії. Звіт охоплює лише релевантні вимоги в межах наданого контексту. Більшість main specs цього репозиторію мають мало явних заборон, тому `scope_creep` очікувано заповнюється рідко: порожній масив не доводить відсутності надлишкової поведінки.

Альтернатива — замінити findings групами — відхилена: вона ламає старі consumers і змішує класифікацію з blocking-policy.

### 2. Findings лишаються джерелом рішення; severity дзеркальних findings

Промпт зберігає чинні правила: `pass` false тоді й лише тоді, коли є finding severity error; score = max(0, 100 − 10 × errors − 3 × warnings). Кожен елемент `missing`/`scope_creep` має рівно один дзеркальний finding із тими самими `spec`, `requirement`, `file`, `line` (null лишається null). Дзеркальний finding рахується в score один раз; елемент групи штрафу не додає; другого finding для тієї самої розбіжності модель не створює. Елементи `implemented` finding не мають.

| Група | Умова | Severity дзеркального finding |
|---|---|---|
| missing | вимога SHALL/MUST, поведінка повністю відсутня у вказаному файлі | error |
| missing | поведінка часткова/неповна, або вимога SHOULD/MAY | warning |
| scope_creep | код порушує SHALL NOT / MUST NOT | error |
| scope_creep | код порушує SHOULD NOT або явне non-goal/виключення без SHALL NOT | warning |

Finding про невизначеність (немає наданого файла) не дзеркалить жодного елемента й має severity warning або info. Дослівні рядки промпту:

```
Every missing or scope_creep item MUST have exactly one mirrored finding with the same spec, requirement, file and line (null stays null). A mirrored finding counts once in the score; the group item itself adds no penalty; never add a second finding for the same discrepancy.
Severity of the mirrored finding: missing -> "error" if the requirement is SHALL or MUST and the behavior is wholly absent from that file, otherwise "warning"; scope_creep -> "error" if it violates SHALL NOT or MUST NOT, otherwise "warning". implemented items have no finding.
```

Сам факт непорожнього масиву не блокує merge. Реалізація не додає перерахунок verdict чи нормалізацію legacy JSON: відповідальність за семантичну оцінку лишається у verifier-промпті, workflows без змін.

### 3. Координати з оригінальних source-файлів

Після чинного sensitive-path фільтра нумерувати всі рядки дозволеного файла, включно з порожніми, від 1: `awk '{printf "%d\t%s\n", NR, $0}' "$full_path"` (формат рядка в промпті — `<N><TAB><текст>`; промпт пояснює, що префікс не є частиною коду). Не використовувати `nl -ba`: GNU `nl` трактує вихідні рядки `\:`, `\:\:`, `\:\:\:` як роздільники секцій — друкує їх порожніми без номера й скидає лічильник. `awk` не має такої семантики і друкує останній рядок без кінцевого `\n` з номером. `$(...)` обрізає кінцеві порожні рядки, номери попередніх рядків це не змінює. Текст промпту, доданий цією зміною, не містить backticks, `$` і `\`: heredoc `<<PROMPT` у `verify-specs.sh` не має лапок, тож вони розкрилися б як підстановки; формат рядка пишеться словами, дослівне речення промпту (тест 2.1 перевіряє його підрядком): «Source files are shown with line numbers: each line is its 1-based line number, a TAB character, then the original text; the number prefix is not part of the code and the numbers are the line coordinates for findings and groups.» Не нумерувати весь зібраний промпт наскрізь. Номер означає рядок файла у HEAD, а не номер у diff чи промпті. За невідомого місця лишати `line: null`; якщо невідомий file, обидва поля null (для `missing`/`scope_creep` невідомий file неможливий — див. §1). Додавання номерів не змінює перелік файлів і не послаблює sensitive-path фільтр.

Це допомагає моделі посилатися на реальний код, але не гарантує точності LLM. AST-верифікацію координат не вводимо; renderer не показує недодатний/нецілий line, boolean чи line без file.

### 4. Legacy, skipped, inconclusive і довгі відповіді

- Старий object verdict без груп зберігається і читається без міграції.
- `write_skipped_verdict` додає всі три `[]`; зберігає pass true, score 100, skipped true. Це охоплює no changes, no specs, no Amp, no API key. Маркер skipped — наявне поле `"skipped": true`.
- Invalid-JSON fallback (`write_inconclusive_verdict`) додає всі три `[]` і **маркер `"inconclusive": true`** (JSON boolean); зберігає pass true, score 50, skipped false та чинний warning finding. Маркер пише лише скрипт; у JSON-схему промпту його не додаємо. Renderer розпізнає fallback за цим полем, а не за текстом summary; поле, що прийшло у валідному verdict від моделі, обробляється так само (походження не розрізняється).
- Прибрати `head -200` і змінну `AMP_RESPONSE`. Транспорт: `amp -x < "$PROMPT_FILE" > "$RESPONSE_FILE" 2>/dev/null || true`, де `RESPONSE_FILE="$ARTIFACTS_DIR/amp-response.txt"`. Відповідь ніколи не передається через argv чи env (ліміт одного рядка аргументу `MAX_ARG_STRLEN` = 131 072 байти).
- Екстракція — єдина коректна форма (роздільник `PY` стоїть в окремому рядку, `then` йде наступним рядком):
  ```
  if ! python3 - "$RESPONSE_FILE" "$VERDICT_FILE" <<'PY'
  …тіло Python…
  PY
  then
    write_inconclusive_verdict
  fi
  ```
  Скрипт Python іде через stdin-heredoc, шляхи через argv; тіло обгортає роботу в `try/except Exception` і при будь-якій помилці робить `sys.exit(1)` без traceback у CI-лозі. Python (UTF-8, `errors="replace"`) читає файл; початок кандидата — перший рядок, що після пробілів починається з `{`; `JSONDecoder.raw_decode` читає весь object (pretty, compact, fenced, текст навколо допустимий). Результат мусить бути object (`dict`). Валідний object записується як **сирий зріз** `text[start:end]` + `\n` (не пере-серіалізується, поля й порядок ключів збережені) спочатку в `$VERDICT_FILE.tmp`, потім `os.replace`. Будь-яка помилка (немає кандидата, помилка декодування, не object, виняток запису, відсутній `python3`, ненульовий код) → `write_inconclusive_verdict`; виклик стоїть у умові `if`, тому `set -e` скрипт не обриває. Після обробки `head -c 500 "$RESPONSE_FILE"` (лише при fallback), потім `rm -f "$RESPONSE_FILE" "$VERDICT_FILE.tmp"`.
- Невалідний перший кандидат — fallback, без пошуку «валідного» вкладеного finding як заміни verdict. Так само fallback, коли `{` не на початку рядка: `Verdict: {…}` на тому самому рядку — документована поведінка, не помилка. Нову обов'язкову schema-validation не додаємо.

Зняття обрізання входить у scope, бо три додаткові масиви роблять поточну втрату звіту імовірнішою.

### 5. Коментарі з сумісним представленням

Обидва наявні comment-скрипти зберігають Summary/Score/Findings/статус. Тіло коментаря має порядок: `### Summary`, `### Findings`, `### Implemented`, `### Missing`, `### Scope creep`, порожній рядок, футер `---` з наявним підписом. Заголовки — рівно `### Implemented`, `### Missing`, `### Scope creep` (рівень 3), кожен розділений порожнім рядком від попереднього блока.

**Підписи секції груп** (визначаються по порядку, перший збіг; для кожної з трьох груп окремо):

| № | Умова | Вміст секції |
|---|---|---|
| 1 | `skipped` — JSON `true` | `_Not checked — verification skipped._` (навіть якщо група непорожня) |
| 2 | `inconclusive` — JSON `true` | `_Not checked — verifier response was inconclusive._` |
| 3 | поле відсутнє, `null` або не масив | `_Not reported by this verifier._` |
| 4 | порожній масив `[]` | `_None reported._` |
| 5 | масив із ≥1 object-елементом | таблиця; non-object елементи пропускаються |
| 6 | масив без жодного object-елемента | `_Not reported by this verifier._` |

`_None reported._` отже можливий лише для не-skipped, не-inconclusive verdict із `[]`. Підписи рядкові, дослівні (тире — U+2014). Для SKIPPED/inconclusive Summary і статус лишаються на місці; findings-таблиця не змінюється.

**Таблиця групи:** рівно
```
| Spec | Requirement | Evidence | File |
|------|-------------|----------|------|
```
плюс рядок на елемент: `spec`, `requirement`, `message` (Evidence), File.

**Findings:** заголовок таблиці `| | Severity | Spec | Requirement | Message | File |` без змін. Якщо `findings` відсутнє, null, не масив, порожнє або без object-елементів — `_No findings._`; non-object елементи пропускаються без винятку. Іконка — за рядковим `severity` (error/warning/info), будь-що інше (відсутнє, null, не рядок) — ⚪.

**Комірки (усі, у групах і у findings):** значення `null` або відсутнє → `—`; не-рядок → `json.dumps(value, ensure_ascii=False)`; потім `\r\n`, `\r` і `\n` → один пробіл (кожна така послідовність); потім `|` → `\|`. Інших перетворень немає (зокрема зворотний слеш не екранується).

**Комірка File:** «відомий file» — непорожній рядок. Відомий file + `line`, що є JSON-цілим (`type(line) is int`, не bool, не float `3.0`, не рядок `"3"`) і `> 0` → `file:line`; відомий file з іншим line → лише `file`; null/відсутній/порожній/не-рядковий file → `—` (навіть коли line заданий). Екранування застосовується до складеного значення.

Обидва render-блоки читають verdict за `$VERDICT_FILE`, переданим аргументом Python (`python3 - "$VERDICT_FILE" <section> <<'PYEOF'`, де `<section>` ∈ findings/implemented/missing/scope_creep), а не за відносним `artifacts/verdict.json`. **Skipped (одне визначення):** у групових підписах `skipped` — лише JSON `true`. Статус у заголовку (`STATUS`) виводиться як і раніше, через `str(v.get('skipped', False)).lower() == "true"`; тому для нелогічного `"skipped": "true"` статус SKIPPED, а групи показують підпис за наступними рядками таблиці (не «Not checked — verification skipped»). Ця розбіжність для небулевого `skipped` свідомо прийнята, одну перевірку не уніфікуємо.

**Вивід тексту verdict:** усі Python-виклики обох скриптів, що друкують текст verdict (SUMMARY, STATUS/SCORE-вилучення, findings і три групи), починаються з `sys.stdout.reconfigure(errors="replace")` (у `python3 -c "…"` — з одинарними лапками `errors='replace'`, щоб не ламати подвійні лапки shell, і з `import sys`). Інакше самотній сурогат у валідному JSON (`"x\ud800y"`) дає `UnicodeEncodeError`. Формат і значення Summary/Score/статусу не змінюються; змінюється лише обробка некодованих символів (вони друкуються як `?`).

**GitLab-транспорт:** `json.dumps` (за замовчуванням `ensure_ascii=True`) дає 6 байтів на кириличну літеру, тож payload легко перевищує 131 072 байти — ліміт одного аргументу (`MAX_ARG_STRLEN`) на Linux; `curl … --data "$COMMENT_JSON"` тоді падає з E2BIG (exit 126), `set -euo pipefail` обриває скрипт, а PASS verdict блокує merge. Тому JSON payload пишеться у тимчасовий файл (`PAYLOAD_FILE=$(mktemp)`, `trap 'rm -f "$PAYLOAD_FILE"' EXIT`), а curl відправляє його як `--data-binary @"$PAYLOAD_FILE"` (допустима рівноцінна форма — `@-` зі stdin). Заголовки `PRIVATE-TOKEN` і `Content-Type: application/json`, `--request POST`, `-o /dev/null -w "%{http_code}"`, URL notes та обробка HTTP-статусу лишаються; токен у stdout/stderr не друкується; коментар не передається через argv чи env. `--data-binary` обрано замість `--data`, бо `--data @file` вилучає CR/LF.

Паралельні реалізації лишаються в двох існуючих скриптах; один parity-тест перевіряє однакове тіло від `### Findings` до футера. Новий shared helper вимагав би розширення install/update paths без користі для цієї малої зміни. Жоден render-шлях не піднімає виняток на коректному JSON-object: у GitHub це зробило б job червоним (крок Evaluate verdict пропускається), у GitLab — перервало б `script`, а PASS verdict заблокував би merge.

### 6. Офлайнова регресійна перевірка

Новий `node:test` suite створює тимчасовий git-проєкт із двома комітами, копіями трьох скриптів та контрольованим PATH. Fake Amp віддає fixture із файлу (`cat`, не argv) і записує stdin; fake gh копіює `--body-file`, fake curl (bash-скрипт, тож ліміт argv відтворюється природно, його не обходять перевіркою всередині fake) розбирає аргументи: `--data-binary @FILE` копіює вміст файла в capture одразу під час виклику (скрипт видаляє тимчасовий файл після curl), `--data-binary @-` читає stdin, а інлайн `--data VALUE` записується з позначкою `inline` (потрібно лише baseline-тестам `legacy` на початкових скриптах); capture містить JSON payload, джерело (`file`/`stdin`/`inline`) і argv без вмісту payload; повертає HTTP 201. У тестах застосовуються лише sentinel-токени, ізольовані HOME/config, timeout і cleanup; реальні Amp/gh/curl не викликаються.

Покрити новий та legacy verdict, warning-only/pass і error/blocked fixtures, порожні/відсутні/некоректні групи, skipped/inconclusive-підписи, null/невалідні line, findings-робастність (non-list, non-object, null-поля, non-string severity), pipe/CR/LF у всіх комірках, порядок заголовків, запуск renderer поза root (з decoy `artifacts/verdict.json` у cwd), no-context/no-token skips, усі skip-verifier гілки, invalid JSON, compact/fenced JSON, префікс на тому ж рядку (fallback), відповідь понад 200 рядків і понад 131 072 байти, нумерацію з рядками `\:\:\:`, `\:` та останнім рядком без `\n`, GitLab payload понад 131 072 байти з кирилицею (код 201, exit 0, payload прийшов із файла/stdin, а не з argv), самотній сурогат у summary (`"x\ud800y"`). Тести промпту перевіряють контракт (дослівні рядки §1–§2 і речення про нумерацію з §3), що output-приклад містить `implemented`/`missing`/`scope_creep` з полями `spec`, `requirement`, `message`, `file`, `line`, що літеральний `"line": null` замінено на «positive integer or null» і що промпт не згадує `inconclusive` (маркер лише скриптовий), numbered source та exclusion, не стверджують доведеної якості LLM. Baseline-тести legacy на початкових скриптах перевіряють інваріанти (статус, score, pass, рядки Findings, exit code, транспорт), а не все тіло коментаря. Існуючий smoke suite перевіряє незмінність доставки opt-in скриптів.

## Risks / Trade-offs

- [LLM вигадує evidence або координати] → numbered input, null для невідомого, `missing`/`scope_creep` лише з наданим file, заборона висновків поза наданим контекстом; семантична точність не гарантується тестами заглушок.
- [Більші звіти, GitHub] → повний JSON без штучного 200-рядкового обриву. GitHub обмежує коментар 65 536 символами; три групи роблять перевищення імовірним, а `gh pr comment` при відмові лише друкує `Failed to post PR comment` і завершується з кодом 0. Batching/truncation коментарів поза scope; ліміт описується у README.
- [Більші звіти, GitLab-транспорт] → знята 200-рядкова межа робить payload понад 131 072 байти досяжним (кирилиця = 6 байтів на літеру в `json.dumps`); одноаргументний `--data` тоді дає E2BIG (exit 126) і обрив скрипта. Payload іде з файла (`--data-binary @"$PAYLOAD_FILE"`), перевіряється фікстурою задачі 3.1(i). Це окремо від API-лімітів: відмова GitLab API (HTTP не 2xx) лише друкується, exit 0; точний ліміт розміру GitLab не фіксуємо. Помилка самого curl (мережа) лишається чинною поведінкою скрипта, поза scope.
- [Тихий PASS] → валідний object без булевого `pass` (наприклад `{"error": …}`) зберігається як verdict, а CI читає `v.get('pass', True)` → PASS. Це чинна поведінка (не регресія); schema-validation свідомо не вводимо.
- [Рідкий `scope_creep`] → правило §1 допускає його лише за явною забороною; порожній масив не означає відсутності надлишкової поведінки.
- [Дрейф двох renderer-блоків] → спільний набір fixture-очікувань для GitHub і GitLab.
- [Legacy сприйнятий як повний аудит] → різні підписи Not reported / Not checked / None reported, збережені Summary і skipped/inconclusive статуси.
- [Відповідь із префіксом на рядку з `{`] → fallback (inconclusive); документується у README.

## Migration Plan

Після review та реалізації — звичайний реліз kit, потім `update` у проєктах із вже встановленим spec-verify. Старі verdict читаються без міграції (legacy skipped verdict без груп показується як `_Not checked — verification skipped._`), нові додаткові поля (`implemented`, `missing`, `scope_creep`, `inconclusive`) ігноруються старими consumers. Rollback — повернути попередні три скрипти; workflows/config та збережені verdict не змінювати.

## Open Questions

Блокувальних продуктових питань немає. Перевірка якості семантичного судження на реальних PR/MR належить майбутнім evals, не цьому change.
