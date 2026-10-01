## Context

`runTier1Review` (`gate-check --review`) детерміновано перевіряє `openspec validate --strict`, task-контракт, заголовки proposal і непорожні delta-секції, але не читає main specs. `planSpecSync` (викликається лише з `archive --sync`) знаходить заголовки через `findRequirementSpan` — точний `indexOf` рядка `### Requirement: <name>` — і повертає `conflicts` для REMOVED/MODIFIED-not-found і ADDED-already-exists. Upstream `openspec validate --strict` (validator.js) перевіряє лише cross-section конфлікти всередині одного delta-файлу й пари RENAMED, але не читає main spec. `parseDeltaSpec` знає лише ADDED/MODIFIED/REMOVED: секція `## RENAMED Requirements` (FROM:/TO:, описана в `openspec-sync-specs/SKILL.md` і `opsx-sync.md`) ігнорувалась, а delta лише з RENAMED давала `no non-empty … section` у Tier 1 і `continue` у sync.

## Goals / Non-Goals

**Goals:**
- Конфлікт заголовка delta ↔ main spec падає в Tier 1 (propose pre-gate і review) тим самим рядком і тією самою точністю, що в archive.
- `## RENAMED Requirements` парситься і застосовується в sync; Tier 1 приймає RENAMED-only delta.
- Tier 2 reviewer не робить байтове порівняння заголовків вручну.

**Non-Goals:**
- Лінти (b) design.md у `Do:`, (c) orphan D-id / delta-requirement, (d) `See:` анкори.
- Зміни LLM-only списків same-class rescan.
- Толерантність до пробілів/регістру; суфікс `(was: …)`.
- Зняття перевірки з archive.

## Decisions

**D1. Перевикористати `planSpecSync`, а не писати окремий matcher.** Tier 1 викликає `planSpecSync(projectDir, deltaSpecs, name)` і додає `conflicts` у `errors` без префікса. Один код і один рядок повідомлення гарантують, що Tier 1 падає рівно тоді, коли впав би archive, і що reviewer бачить той самий текст, який пізніше міг би надрукувати archive. Альтернатива «власний regex з нормалізацією» відкинута: толерантність у Tier 1 пропустила б те, що archive відмовить (`findRequirementSpan` точний).

**D2. RENAMED — у форматі openspec, застосований першим.** `splitRenamePairs` використовує ті самі регулярні вирази FROM:/TO:, що upstream `change-parser.js` (необов’язковий `- `, необов’язкові бектики, `### Requirement:`). У `planSpecSync` перейменування йде до REMOVED/MODIFIED/ADDED, бо upstream validate забороняє MODIFIED зі старим ім’ям (`MODIFIED references old name from RENAMED`), тож після перейменування MODIFIED нового імені знаходиться. Перейменування замінює лише рядок заголовка в межах span, тіло вимоги лишається. Конфлікти: `RENAMED requirement not found in main spec: "<from>"`, `RENAMED target already exists in main spec: "<to>"`. Альтернатива «суфікс `(was: …)` у MODIFIED-заголовку» відкинута: конфліктує з нативним RENAMED, який validate --strict уже перевіряє.

**D3. RENAMED рахується непорожньою секцією.** `deltaSpecEntryCount` (ADDED+MODIFIED+REMOVED+RENAMED) замінює інлайн-суму в Tier 1 і в `planSpecSync`; повідомлення — `no non-empty ADDED/MODIFIED/REMOVED/RENAMED Requirements section`. Інакше RENAMED-only delta, яку validate --strict приймає, падала б у Tier 1.

**D4. Перевірка в archive лишається.** Між propose і archive інша зміна може заархівуватись і змінити main spec; Tier 1 зменшує, але не усуває ризик. `archive --sync` і далі друкує `sync conflict: …` і відмовляє.

**D5. Експорт для unit-тестів.** `parseDeltaSpec` і `planSpecSync` додаються в `export { … }` (як `attachLeftoverSources` для smoke). Тести живуть у новому `test/tier1-delta-heading-check.test.js` з власними мінімальними хелперами (ізольований env, `init` у temp dir, stub `openspec`, який на `validate` завжди проходить — тож результат gate-check визначають лише перевірки кіта). `test/smoke.test.js` не змінюється: `makeArchiveFixture` збіжна з main spec і проходить новий чек.

**D6. Шаблони — лише списки покриття Tier 1.** У `opsx-review.md` опис скрипта (крок 2) і речення «Do NOT re-check what Tier 1 already covered» (крок 4), у `spec-reviewer.md` крок 2. Пункт Tier 2 «No conflicts with existing `openspec/specs/` requirements» лишається — це семантичні конфлікти, не заголовки. `spec-architect.md` не змінюється: архітектор отримує точний рядок помилки через propose pre-gate (tiered-review «Propose проганяє Tier 1 до handoff на review») і виправляє його в тій самій сесії.

## Risks / Trade-offs

- Tier 1 тепер читає main specs: ≈0.1 с і залежність від стану `openspec/specs/`; для consumer-проєктів без main spec capability (ADDED-only) поведінка не змінюється.
- `findRequirementSpan` шукає `indexOf` заголовка без прив’язки до кінця рядка (`Old Req` збігається з `Old Req 2`, якщо той стоїть раніше). Це наявна семантика archive; change її не змінює, щоб Tier 1 і archive лишались ідентичними.
- Для активних changes, створених до цього change, Tier 1 може вперше показати конфлікт, який раніше виплив би лише на archive — це і є мета.
