## Why

Конфлікти заголовків delta specs проти main specs (`MODIFIED`/`REMOVED` заголовок відсутній у `openspec/specs/<capability>/spec.md`, `ADDED` уже існує) сьогодні перевіряє лише `archive --sync` (`planSpecSync` у `bin/agent-orchestrator.js`) — після propose, review і apply. Upstream `openspec validate --strict` main spec для MODIFIED не читає. У change `fix-metrics-session-attribution` знахідка `spend-source-title-exact` (MODIFY-заголовок не є точним live-заголовком) була єдиною з трьох блокерів раунду, яку б зловив скрипт; Tier 2 reviewer зараз робить байтове порівняння вручну. Пізня відмова sync на archive коштувала б окремої ручної сесії `openspec-sync-specs`. До того ж `parseDeltaSpec` не знає секції `## RENAMED Requirements` (FROM:/TO:), яку upstream validate приймає: delta лише з RENAMED архівується без перейменування в main spec.

Design: none

## What Changes

- **A. Shift-left перевірки заголовків у Tier 1.** `runTier1Review` викликає наявний `planSpecSync(projectDir, listDeltaSpecFiles(changeDir), name)` і додає `result.conflicts` у `errors` тими самими рядками, які archive друкує як sync conflict (`<capability>: MODIFIED requirement not found in main spec: "…"`, `REMOVED requirement not found in main spec`, `ADDED requirement already exists in main spec`). Порівняння точне, як у `findRequirementSpan`: без толерантності до регістру чи пробілів, інакше Tier 1 пропускав би те, що archive відмовить. Перевірка в archive лишається (main spec може змінитись між propose і archive).
- **B. RENAMED у `parseDeltaSpec` і `planSpecSync`.** Секція `## RENAMED Requirements` парситься в пари `{from, to}` у форматі openspec (`- FROM: \`### Requirement: Old\`` / `- TO: \`### Requirement: New\``, ті самі регулярні вирази, що в upstream change-parser). Sync застосовує перейменування першим (upstream validate вимагає, щоб MODIFIED використовував нове ім’я), з конфліктами `RENAMED requirement not found in main spec: "<from>"` і `RENAMED target already exists in main spec: "<to>"`. RENAMED рахується непорожньою секцією: повідомлення Tier 1 стає `no non-empty ADDED/MODIFIED/REMOVED/RENAMED Requirements section`. Жодного вигаданого суфікса `(was: …)`.
- **C. Експорт і тести.** `parseDeltaSpec` і `planSpecSync` додаються до `export { … }` для unit-тестів. Новий `test/tier1-delta-heading-check.test.js` (9 тестів): RENAMED-парсинг, pass на збіжних заголовках, fail на відсутньому MODIFIED (із рядком archive), байт-точність (регістр, подвійний пробіл), REMOVED-not-found і ADDED-already-exists, ADDED-only для capability без main spec, RENAMED-only pass / FROM відсутній / TO колізія, порядок RENAMED→MODIFIED у `planSpecSync`, `archive --sync` з RENAMED.
- **D. Списки покриття Tier 1 у шаблонах.** `templates/.agents/commands/opsx-review.md` (опис скрипта в кроці 2 і речення «Do NOT re-check what Tier 1 already covered» у кроці 4) і `templates/.agents/subagents/spec-reviewer.md` (крок 2) називають перевірку заголовків delta проти main specs. Списки LLM-only same-class rescan не змінюються.
- Без **BREAKING**: формат `{pass, errors[]}` і exit-коди `gate-check --review` не змінюються; archive поводиться як раніше для ADDED/MODIFIED/REMOVED.

## Capabilities

### New Capabilities

(немає)

### Modified Capabilities

- `tiered-review`: вимога «Скриптовий Tier 1 перед LLM-review» отримує перевірку заголовків delta проти main specs тим самим кодом, що й `archive --sync`, і RENAMED як непорожню секцію; сценарії Tier 1 fail / Tier 2 shortened checklist без змін.
- `lean-archive`: нова вимога — `archive --sync` застосовує `## RENAMED Requirements` (FROM:/TO:) до main spec перед REMOVED/MODIFIED/ADDED і відмовляє на відсутньому FROM чи наявному TO.

## Impact

- `bin/agent-orchestrator.js`: `parseDeltaSpec` (+ `splitRenamePairs`, `deltaSpecEntryCount`), `planSpecSync` (RENAMED першим), `runTier1Review` (RENAMED у підрахунку секцій, виклик `planSpecSync`, conflicts → errors), блок `export`.
- `templates/.agents/commands/opsx-review.md`, `templates/.agents/subagents/spec-reviewer.md`: списки покриття Tier 1. Generated copies (`.claude/`, `.cursor/`, Amp wrappers) оновлюються `update` / `sync`, не окремими тасками.
- Новий `test/tier1-delta-heading-check.test.js`; `test/smoke.test.js` не змінюється (фікстура `makeArchiveFixture` уже збіжна з main spec і проходить новий чек).
- `openspec/specs/tiered-review/spec.md`, `openspec/specs/lean-archive/spec.md` — через delta.
- `README.md` і `CHANGELOG.md` — окремий docs pass після merge; `package.json` без змін.

## Non-goals

- Жодних лінтів «`Do:` згадує design.md», orphan D-id / delta-requirement, `See:` анкорів — шум на tasks.md кіта, порушує task-contract «Без нового лінту».
- Не прибирати з LLM same-class rescan класи «referenced heading/path does not exist» і «`Do:` not executable without design.md» (`opsx-review.md`, `spec-reviewer.md`, `spec-architect.md`) — детермінованого еквівалента немає.
- Не додавати толерантність до регістру/пробілів у `findRequirementSpan` і не змінювати його prefix-семантику (`indexOf` заголовка).
- Не прибирати перевірку конфліктів з archive.
- Не вигадувати суфікс `(was: …)` для перейменувань.
- Не змінювати `spec-architect.md`, `opsx-propose.md`, `opsx-quick.md`, профілі, README, CHANGELOG, версію пакета.

## Acceptance criteria

1. **Tier 1 ловить конфлікти заголовків.** Для change із delta `## MODIFIED Requirements` і заголовком, якого немає в `openspec/specs/<capability>/spec.md`, `gate-check --review <name> --json` дає `pass: false`, exit 1 і `errors` містить `<capability>: MODIFIED requirement not found in main spec: "<name>"`; аналогічно `REMOVED requirement not found in main spec` і `ADDED requirement already exists in main spec`. Регістр або подвійний пробіл у заголовку — теж fail.
2. **Збіжні заголовки проходять.** Фікстура з MODIFIED/REMOVED, що є в main spec, і ADDED, якого немає, дає `pass: true`; ADDED-only delta для capability без main spec теж `pass: true`.
3. **RENAMED.** `parseDeltaSpec` повертає `RENAMED: [{from, to}]`; RENAMED-only delta проходить Tier 1 без `no non-empty`; відсутній FROM дає `RENAMED requirement not found in main spec`, наявний TO — `RENAMED target already exists in main spec`; `archive --sync` записує новий заголовок у main spec, зберігши тіло вимоги; `planSpecSync` застосовує RENAMED до MODIFIED.
4. **Шаблони.** `opsx-review.md` і `spec-reviewer.md` називають перевірку заголовків delta проти main specs у списках покриття Tier 1; фрази, які асертить smoke (`MUST NOT stop at the first blocking`, `same defect class`, `Previous findings`, `Required Before Apply`, `**Source:** gate-check`, `Vue 3`), лишаються.
5. **Тести.** `node --test test/tier1-delta-heading-check.test.js` дає `# pass 9` / `# fail 0`; `npm test` зелений; `npx openspec validate --all --strict` проходить.
