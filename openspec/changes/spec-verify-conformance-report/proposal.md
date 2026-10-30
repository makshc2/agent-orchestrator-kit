## Why

AI Spec Verifier показує лише findings: у PR/MR важко побачити, що підтверджено кодом, чого бракує у наданих файлах і яка поведінка порушує явну заборону чи межу вимог. План `docs/course-derived-plan-2026-10-29.md` передбачає цей звіт; поточний промпт задає `line: null`, а екстрактор обрізає відповідь до 200 рядків.

## What Changes

- Доповнити формат verdict масивами `implemented`, `missing`, `scope_creep`, з доказами та відомими координатами коду; старі verdict без цих полів лишаються підтриманими.
- Задати правило класифікації: `missing` потребує наданого `file`, де поведінку очікує позитивна вимога; без нього — warning/info про невизначеність. Одна розбіжність потрапляє рівно в одну групу; `scope_creep` лише для коду, що робить заборонене чи виключене вимогою або явною межею.
- Дати моделі пронумеровані рядки тих самих дозволених source-файлів (без `nl`, який ламає рядки `\:`); вимагати реальний номер рядка або `null`, коли доказів недостатньо.
- Зберегти `findings` як джерело severity та чинні правила `pass`/`score`; нові групи самі по собі не блокують merge. Задати severity дзеркальних findings для `missing`/`scope_creep`: дзеркальний finding має ті самі spec/requirement/file/line і рахується один раз.
- Показувати однакові групи в GitHub PR і GitLab MR після `### Findings`, зберігши Summary, Score і Findings. Для legacy-verdict, SKIPPED і inconclusive verdict показувати різні підписи (`Not reported` / `Not checked`); inconclusive fallback розпізнається маркером `"inconclusive": true`.
- Доповнити skip/inconclusive verdict порожніми масивами; прибрати 200-рядкове обрізання валідного JSON (відповідь Amp йде у файл, не в argv/env).
- GitLab-коментар відправляти з файла (`--data-binary @file`), а не одним аргументом: без 200-рядкового обрізання payload може перевищити 131 072 байти.
- Додати офлайнові тести з fake Amp/gh/curl: без LLM, мережі, реальних токенів і публікації коментарів.

## Capabilities

### New Capabilities

Немає: розширюємо наявний opt-in verifier.

### Modified Capabilities

- `spec-verify-consumer`: адитивний формат conformance report, доказовість і координати, fallback/довгі відповіді та GitLab-відображення.
- `github-spec-verify`: GitHub-відображення трьох груп із підтримкою legacy-verdict.

## Impact

- `templates/scripts/verify-specs.sh`, `templates/scripts/post-pr-verdict-github.sh`, `templates/scripts/post-mr-verdict.sh`.
- Новий `test/spec-verify-conformance-report.test.js`; README та CHANGELOG; `openspec/changes/spec-verify-conformance-report/validation.md` із результатами перевірок (задача 4.2).
- Нових runtime-залежностей немає: Bash, Python 3, Amp і provider CLI залишаються чинними. `init/update` вже розповсюджують ці три скрипти, додатковий renderer-файл не потрібен.
- Зміна доставляється лише проєктам з увімкненим spec-verify через наявний update; consumer config, workflows і звичайні проєкти не потребують міграції.

## Non-goals

- Зміна блокувальних порогів, формули score, CI permissions, способу автентифікації або автоматичне ввімкнення verifier.
- Збір усього репозиторію, перевірка всіх незмінених вимог, підключення active delta specs, AST-аналіз чи доказ повної коректності реалізації.
- Визнання будь-якого файла без відповідної спеки scope creep; конфлікти визначаються за наданими вимогами.
- Міграція старих довгих main specs, оновлення OpenSpec, закриття попереднього change чи публікація пакета.

## Acceptance criteria

1. Новий промпт визначає всі три масиви та їхні поля; дозволені source-файли мають 1-based номери оригінальних рядків, а відфільтровані секретні файли не потрапляють у промпт.
2. Звіт розрізняє підтверджену поведінку, відсутню поведінку (лише з наданим `file`) та порушення явної заборони чи межі в межах наданих файлів; одна розбіжність потрапляє в одну групу. Непідтверджений висновок не оголошується error і не стає `missing`; невідомий `line` передається як `null`, невідомий `file` — лише для `implemented` та findings.
3. Error findings задають `pass: false`; warning/info — `pass: true`. Формула score рахує лише findings. Дзеркальний finding для `missing`/`scope_creep` має ті самі spec/requirement/file/line, severity за таблицею design §2 і рахується один раз; сам елемент групи штрафу не додає.
4. Legacy-verdict, новий verdict та валідна відповідь довша за 200 рядків (зокрема понад 131 072 байти) зберігаються без втрати полів. Чотири skip-гілки та invalid-JSON fallback мають усі три порожні масиви та зберігають чинні pass/score/skipped значення; fallback додатково має `"inconclusive": true`. Помилка Python-екстракції дає fallback, а не аварію скрипта.
5. Обидва comment-скрипти показують `### Implemented`, `### Missing`, `### Scope creep` після `### Findings` і перед футером `---`; evidence і `file:line` лише для непорожнього рядка file та JSON-цілого line > 0; `null`, відсутні та некоректні координати не стають вигаданим посиланням. `|` і CR/LF екрануються в усіх комірках. GitLab-коментар понад 131 072 байти доставляється з файла/stdin без E2BIG (exit 0).
6. Старі verdict не падають і не показують хибне «все реалізовано»: legacy/null/не-масив → `_Not reported by this verifier._`, `[]` → `_None reported._`, `skipped: true` → `_Not checked — verification skipped._`, `inconclusive: true` → `_Not checked — verifier response was inconclusive._`. GitHub/GitLab parity підтверджена тестами без реальної відправки.
7. Targeted тести, існуючі smoke-тести, Bash syntax check і strict OpenSpec/Tier 1 перевірки проходять.
