# План за мотивами курсу AI Agentic Engineering (2026-10-29)

Джерело: https://neoversity.com.ua/ai-agentic-engineering (Neoversity, викладач Іван Лапа). Це маркетингова сторінка: з неї відомі назви уроків і артефактів, але не їхній вміст. Рішення нижче адаптовані під kit і не є копією курсу. Оцінки розміру й ризиків — припущення, які перевіряються в `/opsx:propose`.

## Що таке курс

5 тижнів, 8 уроків, основа — «4-pillar harness» (Skills, Subagents, MCP, Hooks). Теми по тижнях: system design; топологія агентів (Hub-and-Spoke проти Peer Mesh, MCP); CI-пайплайн (SDD, quality gates: hooks, TDD, plan-verifier, evals, mutation testing); масштаб (git worktrees і fan-out, plugin packaging, 30-day rollout). Шість артефактів: DevDigest, harness-плагін, plan-verifier у GitHub Actions, eval-пайплайн на 20 трейсах, cost-аудит, rollout doc.

## Вхідні умови

- `docs/improvement-plan-2026-10-01.md` уже відхилив жорсткі гейти за `metrics.json`, обов'язковий code-reviewer в apply, паралельні лінзи Tier 2. Тут вони не повертаються.
- R2a, R3a, R4, R7-lite, R12 заархівовані; `openspec/changes/` порожній; ledger із ціною та кешем є.
- Діють «одна фаза — один change», бюджети розміру шаблонів і паритет Cursor / Claude Code / Amp.
- Token accounting, Control Plane і dashboard лишаються в Phase 4 (`agentic-factory-roadmap`).

## Підсумок

| # | Зміна | Розмір | Суть |
|---|---|---|---|
| 1 | `spec-verify-conformance-report` | S | Звіт Implemented / Missing / Scope creep і `file:line` у verdict |
| 2 | `artifact-mutation-evals` | M | Детермінований eval: мутуємо артефакти зміни, перевіряємо, чи Tier 1 це ловить |
| 3 | `review-eval-judge` | M, опційно | LLM-eval `spec-reviewer` на засіяних дефектах, запуск вручну |
| 4 | Explore: hook-гейти режимів і plugin | пізніше | Лише дослідження |

## 1. `spec-verify-conformance-report`

**Навіщо.** `templates/scripts/verify-specs.sh` повертає `pass`, `score`, `findings`, але `line` завжди `null`, а розбивки на реалізоване, відсутнє і зайве немає. Без неї складно відрізнити «агент не дописав» від «агент нафантазував зайвого».

**Що зробити:**
- Додати в JSON-схему промпту `implemented[]`, `missing[]`, `scope_creep[]`. Лише додавання полів, старий `verdict.json` лишається валідним.
- Вимагати `line`; коли неможливо визначити, лишати `null`.
- Оновити `post-pr-verdict-github.sh` і `post-mr-verdict.sh`, щоб показували три групи в коментарі.
- Правило «лише `error` блокує merge» не змінювати.

**Перевірка.** Тест на fallback-verdict (`write_skipped_verdict`) і на парсинг старого формату. Зміна торкає `templates/scripts` і специфікації `github-spec-verify`, `spec-verify-consumer`.

**Ризик.** Модель може вигадувати номери рядків, тому `line` необов'язковий.

## 2. `artifact-mutation-evals`

**Навіщо.** Ідея мутаційного тестування з курсу, застосована до артефактів зміни: беремо чисту заархівовану зміну, ламаємо одну річ і дивимось, чи гейти помітили. Зараз невідомо, який відсоток дефектів ловить `gate-check --review` (Tier 1). Без цього числа неможливо чесно оцінювати зміни шаблонів (R9-lite, R1-narrow).

**Приклади мутацій:**
- Видалити `Done-when:` у таску.
- Зіпсувати заголовок MODIFIED-вимоги.
- Вставити в `Do:` фразу «as needed».
- Додати MODIFIED-вимогу з тим самим заголовком, що вже змінила інша зміна. Це відтворює інцидент із `fix-next-session-prompt` (тихий перезапис main spec).

**Як зробити:**
- `test/fixtures/mutations/` і один `node:test`-файл: список мутацій, очікуваний вердикт, причина.
- Результат — таблиця caught / missed. Пропущене фіксується як відома прогалина, а не як падіння.
- Без LLM: безкоштовно, детерміновано, йде в загальному `npm test`.

**Результат.** Таблиця «клас дефекту → Tier 1 ловить / не ловить» і з неї кандидати на нові лінти. Заборона з task-contract :101 (regex-лінт на `Done-when`) діє: лише структурні перевірки.

## 3. `review-eval-judge` (опційно, після 2)

**Навіщо.** Аналог «20-trace eval»: чи не погіршився `spec-reviewer` після змін шаблонів.

**Корпус.** В архіві 21 `review.md`, 6 із REQUEST CHANGES. Проблема: артефакти комітяться через години після раундів, тож стан «до виправлення» не завжди відновлюється з git. Основа корпусу — засіяні дефекти з пункту 2; реальні REQUEST CHANGES додаються лише там, де вхід відновлюється.

**Як зробити:** binary judge (знайдено / не знайдено); запуск вручну з `claude -p --max-budget-usd ...`, не в CI (ultra-review $2.5–4.7 за прогін); результат лише в `docs/`, нічого не блокує.

Починати тільки якщо пункт 2 покаже, що LLM-шар потрібен.

## 4. Лише explore

- **Hook-гейти режимів.** Правило «без правок коду в explore/review» тримається тільки на тексті. Hook на `Edit`/`Write` дав би гарантію, але hook не знає активного режиму, а можливості hooks різні в Claude Code, Cursor і Amp. JSON-формати Claude Code треба перевірити заново.
- **Plugin для Claude Code.** Другий канал дистрибуції поруч із `npx init`. Ціна: генератор і drift-тест, щоб тримати синхронність із `.agents/`. Вигода лише для Claude Code при вимозі паритету трьох IDE.

## Що не беремо

| З курсу | Чому ні |
|---|---|
| Worktrees і fan-out | Суперечить «одна активна зміна»; паралельний `code-writer` дозволений і жодного разу не знадобився |
| Hub-and-Spoke проти Mesh, 5 subagents | У нас уже Hub-and-Spoke (conductor + 12 шаблонів) |
| Власний MCP-сервер, 3 skills, CLAUDE.md ≤200 | Є launchers, 8 skills і бюджети розміру |
| pgvector-пам'ять | Канон рішень у git, Memory MCP лише дзеркало (рішення roadmap) |
| Cost-аудит, 30-day rollout | 5 з 6 названих метрик (cost, cache hit, routing, rework, час) уже в ledger і в метриках (a)–(j) improvement-plan |
| DevDigest | Окремий продукт, не вдосконалення kit |

## Порядок

1. `spec-verify-conformance-report`.
2. `artifact-mutation-evals`.
3. За підсумками 2 вирішити, чи потрібен пункт 3 і чи робити explore по пункту 4.

Відкрите питання: чи заносити ці зміни в roadmap-spec як нову фазу (його вимоги описують лише фази 1–4).
