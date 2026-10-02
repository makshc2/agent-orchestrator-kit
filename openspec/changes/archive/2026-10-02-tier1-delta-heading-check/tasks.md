## 1. CLI: RENAMED у delta-парсері, перевірка заголовків у Tier 1

- [x] 1.1 parseDeltaSpec читає секцію RENAMED (FROM:/TO:)
  Files: bin/agent-orchestrator.js
  Do: Над `function parseDeltaSpec` додати `function splitRenamePairs(sectionBody)`, що проходить рядки тіла секції і збирає пари `{ from, to }` за регулярними виразами upstream openspec (`/^\s*-?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/` і такий самий для `TO:`; пара закривається на `TO:` після `FROM:`), і `function deltaSpecEntryCount(sections)`, що повертає суму довжин ADDED+MODIFIED+REMOVED+RENAMED. У `parseDeltaSpec` ініціалізувати `sections` як `{ ADDED: [], MODIFIED: [], REMOVED: [], RENAMED: [] }`, розширити regex заголовка до `/^(ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/` і для RENAMED викликати `splitRenamePairs(body)`, для решти — `splitRequirementBlocks(body)`.
  Done-when: `node -e "import('./bin/agent-orchestrator.js').then(({parseDeltaSpec})=>console.log(JSON.stringify(parseDeltaSpec('## RENAMED Requirements\n- FROM: \`### Requirement: A\`\n- TO: \`### Requirement: B\`\n').RENAMED)))"` друкує `[{"from":"A","to":"B"}]`; `grep -c -F 'function splitRenamePairs' bin/agent-orchestrator.js` друкує 1

- [x] 1.2 planSpecSync застосовує RENAMED першим і рахує його непорожньою секцією
  Files: bin/agent-orchestrator.js
  Do: У `planSpecSync` замінити умову пропуску порожнього delta на `if (deltaSpecEntryCount(delta) === 0) continue;`. Перед циклом `for (const req of delta.REMOVED)` вставити цикл `for (const pair of delta.RENAMED)`: якщо `findRequirementSpan(content, pair.from)` дає null — додати конфлікт `` `${capability}: RENAMED requirement not found in main spec: "${pair.from}"` `` і `continue`; якщо `findRequirementSpan(content, pair.to)` знайдено — додати `` `${capability}: RENAMED target already exists in main spec: "${pair.to}"` `` і `continue`; інакше замінити в `content` рядок заголовка `### Requirement: ${pair.from}` на `### Requirement: ${pair.to}` на позиції `span[0]`, не чіпаючи тіла. Цикли REMOVED/MODIFIED/ADDED не змінювати.
  Done-when: `grep -c -F 'RENAMED requirement not found in main spec' bin/agent-orchestrator.js` друкує 1; `grep -c -F 'RENAMED target already exists in main spec' bin/agent-orchestrator.js` друкує 1; `node --test --test-reporter=tap --test-name-pattern="planSpecSync applies RENAMED|archive --sync writes the RENAMED" test/tier1-delta-heading-check.test.js | grep -E '^# (pass|fail) '` друкує `# pass 2` і `# fail 0`

- [x] 1.3 runTier1Review додає конфлікти planSpecSync у errors
  Files: bin/agent-orchestrator.js
  Do: У `runTier1Review` зберегти `const deltaSpecs = listDeltaSpecFiles(changeDir);`, у циклі по delta замінити інлайн-суму трьох секцій на `deltaSpecEntryCount(sections) === 0` і текст помилки на `` `${rel}: no non-empty ADDED/MODIFIED/REMOVED/RENAMED Requirements section` ``; після циклу додати `errors.push(...planSpecSync(projectDir, deltaSpecs, name).conflicts);` з коментарем, що це та сама перевірка, яку виконує `archive --sync`. Рядки конфліктів не префіксувати і не нормалізувати; `findRequirementSpan` не змінювати.
  Done-when: `grep -c -F 'errors.push(...planSpecSync(projectDir, deltaSpecs, name).conflicts);' bin/agent-orchestrator.js` друкує 1; `grep -c -F 'no non-empty ADDED/MODIFIED/REMOVED/RENAMED Requirements section' bin/agent-orchestrator.js` друкує 1; `grep -c -F 'no non-empty ADDED/MODIFIED/REMOVED Requirements section' bin/agent-orchestrator.js` друкує 0

- [x] 1.4 Експорт parseDeltaSpec і planSpecSync для тестів
  Files: bin/agent-orchestrator.js
  Do: У блок `export { … }` наприкінці файлу після `firstSpawnName,` додати рядки `parseDeltaSpec,` і `planSpecSync,`.
  Done-when: `node -e "import('./bin/agent-orchestrator.js').then((m)=>console.log(typeof m.parseDeltaSpec, typeof m.planSpecSync))"` друкує `function function`

## 2. Шаблони: списки покриття Tier 1

- [x] 2.1 opsx-review.md називає перевірку заголовків delta проти main specs
  Files: templates/.agents/commands/opsx-review.md
  Do: У кроці «### 2. Tier 1 — deterministic gate-check» у реченні «The script runs …» замінити «and non-empty ADDED/MODIFIED/REMOVED delta-spec sections check.» на «the non-empty ADDED/MODIFIED/REMOVED/RENAMED delta-spec sections check, and the delta-heading check against main specs (every MODIFIED/REMOVED/RENAMED `### Requirement:` heading byte-matches `openspec/specs/<capability>/spec.md`; no ADDED heading already exists there — the same check `archive --sync` runs).»; у кроці «### 4. Review checklist (Tier 2 — LLM-only)» у реченні «Do NOT re-check what Tier 1 already covered (…)» додати в дужки після «delta-spec section structure» текст «, byte-exact MODIFIED/REMOVED/RENAMED headings present in main specs and ADDED headings absent from them». Абзац «Re-review MUST scan the same defect class …» і пункт «No conflicts with existing `openspec/specs/` requirements» не змінювати.
  Done-when: `grep -c -F 'the same check `archive --sync` runs' templates/.agents/commands/opsx-review.md` друкує 1; `grep -c -F 'byte-exact MODIFIED/REMOVED/RENAMED headings present in main specs and ADDED headings absent from them' templates/.agents/commands/opsx-review.md` друкує 1; `grep -c -F 'another referenced heading/path that does not exist' templates/.agents/commands/opsx-review.md` друкує 1

- [x] 2.2 spec-reviewer.md не повторює перевірку заголовків
  Files: templates/.agents/subagents/spec-reviewer.md
  Do: У кроці «2. Apply the LLM-only checklist — do NOT re-check what Tier 1 covered (…)» додати в дужки після «delta-spec section structure» текст «, byte-exact MODIFIED/REMOVED/RENAMED headings present in main specs and ADDED headings absent from them». Пункт «conflicts with existing `openspec/specs/` requirements» і правило same-class rescan не змінювати.
  Done-when: `grep -c -F 'byte-exact MODIFIED/REMOVED/RENAMED headings present in main specs and ADDED headings absent from them' templates/.agents/subagents/spec-reviewer.md` друкує 1; `grep -c -F 'another referenced heading/path that does not exist' templates/.agents/subagents/spec-reviewer.md` друкує 1

## 3. Тести

- [x] 3.1 Фікстурні тести Tier 1 heading check і RENAMED
  Files: new file: test/tier1-delta-heading-check.test.js
  Do: Створити файл з 9 тестами `node:test`, що імпортує `parseDeltaSpec` і `planSpecSync` з `../bin/agent-orchestrator.js` і має власні хелпери (ізольований env з HOME/XDG у temp dir, `init --profile generic` у temp dir, stub `openspec` у `node_modules/openspec`, який на `validate` завжди виходить 0, фікстура change з proposal/tasks/review.md APPROVE/delta `specs/auth/spec.md` і main spec з `Old Req` та `Dead Req`): (1) `parseDeltaSpec` повертає пари RENAMED; (2) збіжні MODIFIED/REMOVED/ADDED → `pass: true`, `errors: []`; (3) MODIFIED `Old Requirement` → `pass: false`, exit 1, `errors` містить `auth: MODIFIED requirement not found in main spec: "Old Requirement"`; (4) `old req` і `Old  Req` → fail з тими самими рядками; (5) REMOVED `Ghost Req` і ADDED `Old Req` → обидва конфлікти; (6) ADDED-only для capability без main spec → pass; (7) RENAMED-only → pass без `no non-empty`, відсутній FROM і наявний TO → відповідні конфлікти; (8) `planSpecSync` з RENAMED+MODIFIED нового імені → без конфліктів, новий заголовок у `newContent`; (9) `archive add-auth --sync` з RENAMED-only delta → exit 0, main spec містить `### Requirement: Renamed Req` і тіло «original behavior».
  Done-when: `node --test --test-reporter=tap test/tier1-delta-heading-check.test.js | grep -E '^# (pass|fail) '` друкує `# pass 9` і `# fail 0`

- [x] 3.2 Повний npm test і validate зелені
  Files: test/tier1-delta-heading-check.test.js, bin/agent-orchestrator.js
  Do: З кореня репозиторію запустити `npm test` і `npx openspec validate --all --strict`. Якщо тест падає, виправити причину у файлах тасків 1.1–3.1, не послаблюючи асертів і не змінюючи `test/smoke.test.js`, `package.json`, `profiles/`, `README.md`, `CHANGELOG.md`, і повторити запуск.
  Done-when: `npm test` дає exit 0; `npx openspec validate --all --strict` дає exit 0; `git diff --quiet -- package.json profiles/ README.md CHANGELOG.md test/smoke.test.js` дає exit 0
