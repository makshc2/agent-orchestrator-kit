# Tasks — add-cloud-agent-handoff

## 1. Runtime у handoff (cloud-agent-handoff, session-handoff)

- [x] 1.1 Секція Runtime у моделі handoff.md
  Files: bin/agent-orchestrator.js
  Do: додати `Runtime` у `HANDOFF_SECTIONS` (перед `Prompt`); у `buildHandoffMarkdown` рендерити секцію `## Runtime` рядками `- runtime: <local|cloud>` і `- agent_id: <id|none>`; у `fieldsFromSections` читати наявну секцію Runtime (парсер полів `runtime:`/`agent_id:` з буллетів, толерантний до відсутньої секції); `missingHandoffFields` не розширювати — файли без Runtime лишаються валідними
  Done-when: persist для handoff.md без секції Runtime завершується exit 0 і файл після запису містить `## Runtime` з обома полями

- [x] 1.2 Детекція runtime і agent_id
  Files: bin/agent-orchestrator.js
  Do: додати `resolveRuntime(opts, env, existingFields)` з пріоритетом `--runtime` → `AOK_RUNTIME` → константа `CLOUD_ENV_MARKERS` (стартово `['CURSOR_BACKGROUND_AGENT']`; маркер присутній і непорожній → cloud) → значення з наявної секції Runtime → `local`; невалідне `--runtime` (не local/cloud) — log.err + exit 1; аналогічно `resolveAgentId` з пріоритетом `--agent-id` → `AOK_AGENT_ID` → наявне значення → `none`; додати опції `--runtime <runtime>` і `--agent-id <id>` до команди `handoff`; викликати обидва resolver-и в persist-гілці і записувати результат у fields
  Done-when: `handoff <name> --runtime cloud` дає `runtime: cloud`; `AOK_RUNTIME=cloud` без прапорця дає `runtime: cloud`; без прапорця/env/маркерів — `runtime: local`, `agent_id: none`; `--runtime foo` завершується non-zero

- [x] 1.3 Runtime у фінальному handoff команди archive
  Files: bin/agent-orchestrator.js
  Do: у команді `archive <name>` при побудові фінальних fields викликати ті самі `resolveRuntime`/`resolveAgentId` (без прапорців — лише env/маркери/наявний файл/дефолт), щоб фінальний handoff.md в архівній папці містив секцію Runtime
  Done-when: після `archive <name>` файл `openspec/changes/archive/<date>-<name>/handoff.md` містить `## Runtime` з валідним runtime

## 2. Cloud-check (cloud-agent-handoff)

- [x] 2.1 Гілка --cloud-check у команді handoff
  Files: bin/agent-orchestrator.js
  Do: додати опцію `--cloud-check` до команди `handoff`; гілка виконує: (а) `git status --porcelain -- openspec/changes/<name>/` — непорожній вивід = знахідка зі списком шляхів; (б) `git rev-parse --abbrev-ref @{upstream}` і `git rev-list --count @{upstream}..HEAD` — відсутній upstream, помилка git або count > 0 = знахідка з підказкою `git push -u origin HEAD`; runtime читати через `resolveRuntime` (прапорець/env/маркери/файл/дефолт); при `cloud` знахідки друкуються через log.err і process.exitCode = 1, при `local` — через log.warn і exit 0; чистий стан — log.ok і exit 0; помилки git ловити try/catch — не crash; `git commit`/`git push` не виконувати
  Done-when: cloud + брудний `openspec/changes/<name>/` → non-zero з шляхами; cloud + незапушена гілка → non-zero з підказкою push; cloud + чисто і запушено → exit 0; local + брудно → warning і exit 0

- [x] 2.2 Cloud-підказка в persist
  Files: bin/agent-orchestrator.js
  Do: у persist-гілці після запису handoff.md і Memory, якщо resolved runtime = `cloud`, надрукувати в stderr блок наступних кроків: `git add openspec/changes/<name>/` → `git commit` → `git push` → `npx agent-orchestrator-kit handoff <name> --cloud-check` (exit 0 обов'язковий); stdout лишити чистим prompt-ом; при `local` нічого не додавати
  Done-when: persist з `--runtime cloud` містить у stderr усі чотири кроки, stdout починається з `/opsx:`; persist з `runtime: local` не містить cloud-блоку

## 3. Протокол workspace-дисципліни (cloud-agent-handoff)

- [x] 3.1 Правило git-tracked шляхів і cloud-виходу
  Files: templates/.agents/rules/session-handoff.mdc, templates/.agents/skills/agent-orchestration/SKILL.md, templates/.agents/subagents/session-handoff.md
  Do: у session-handoff.mdc додати правило: агент (local або cloud) пише артефакти сесії лише в git-tracked шляхи (не /tmp, не gitignored-кеші); у Session Exit додати cloud-кроки: якщо runtime = cloud — після persist обов'язково commit → push → `handoff <name> --cloud-check` з exit 0, закриття без цього = неповний handoff; згадати секцію Runtime у переліку секцій handoff.md кроку 1; у SKILL.md і session-handoff.md дзеркально стиснуто описати те саме (Runtime у шаблоні, cloud-вихід, git-tracked шляхи)
  Done-when: усі три файли називають git-tracked шляхи вимогою, описують cloud-кроки Session Exit і містять Runtime у шаблоні секцій

## 4. Тести та документація

- [x] 4.1 Смоук-тести Phase 3
  Files: test/smoke.test.js
  Do: додати тести в tmp-git-репо: (а) persist пише `## Runtime` з `runtime: local`/`agent_id: none` за замовчуванням; (б) `--runtime cloud` і `AOK_RUNTIME=cloud` дають `runtime: cloud`; невалідний `--runtime` — non-zero; (в) legacy handoff.md без Runtime — persist exit 0 і секція дописана; (г) `--cloud-check` при cloud: non-zero на untracked файлі під change-ом, non-zero без upstream з підказкою push, exit 0 при закоміченому й запушеному стані (upstream емулювати локальним bare-remote); (д) `--cloud-check` при local: warning і exit 0 на брудному стані; (е) persist з `--runtime cloud` друкує cloud-кроки в stderr, stdout починається з `/opsx:`; (є) archive пише Runtime у фінальний handoff
  Done-when: `npm test` зелений локально

- [x] 4.2 README і CHANGELOG
  Files: README.md, CHANGELOG.md
  Do: у README-секції роадмапу позначити Phase 3 реалізованою і додати підрозділ: секція Runtime у handoff.md, пріоритет детекції (`--runtime` → `AOK_RUNTIME` → маркери → файл → local), налаштування `AOK_RUNTIME=cloud`/`AOK_AGENT_ID` в environment-конфігу cloud-агента, команда `handoff <name> --cloud-check` з диференційованим вердиктом і порядок cloud-виходу persist → commit → push → cloud-check; у CHANGELOG додати запис Phase 3 в `[Unreleased]`
  Done-when: README документує обидва прапорці, обидва env і cloud-вихід; CHANGELOG містить unreleased-запис Phase 3
