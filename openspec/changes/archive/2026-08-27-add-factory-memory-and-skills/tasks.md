# Tasks — add-factory-memory-and-skills

## 1. Decisions canon (session-handoff)

- [x] 1.1 Append рішень у decisions.md з handoff CLI
  Files: bin/agent-orchestrator.js
  Do: у persist-гілці команди `handoff <name>` після запису handoff.md взяти рішення з `parseDecisionItems(fields.decisions)`; при першому непорожньому рішенні створити `openspec/changes/<name>/decisions.md` з заголовком `# Decisions — <name>` і коментарем `<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->`; для кожного рішення дописати рядок `- <YYYY-MM-DD> <текст>` (локальна дата) лише якщо нормалізований текст (trim + послідовності пробілів згорнуті в один, без префікса `- <дата> `) відсутній серед наявних записів; наявні рядки не переписувати і не видаляти; при `Decisions: none` файл не створювати і не чіпати
  Done-when: повторний запуск `handoff <name>` з тим самим handoff.md не додає дублікатів; рішення з тим самим topic але новим текстом додається новим рядком зі збереженням старого; при `Decisions: none` decisions.md не з'являється

- [x] 1.2 Мірор Decision:* з decisions.md замість handoff.md
  Files: bin/agent-orchestrator.js
  Do: у `persistMemoryFromHandoff` замінити джерело `Decision:*`: після append-кроку 1.1 читати записи decisions.md у порядку файлу (рядки `- <YYYY-MM-DD> <текст>`), для кожного визначати topic як текст до першої двокрапки (обрізаний до 80 символів, як зараз) і upsert-ити `Decision:<topic>` з observation `chosen: <текст>` — останній запис topic-а у файлі перезаписує попередній; `Change:*` і `Handoff:*` продовжити писати з handoff.md; `Decision:*` інших changes не чіпати; міграцію старих ентитей не робити
  Done-when: після `handoff <name>` кожен topic з decisions.md має entity `Decision:<topic>` у `.cursor/memory.json` з текстом останнього запису цього topic-а; ентиті, чиї topic-и відсутні в decisions.md цього change-у, не змінені

- [x] 1.3 Restore друкує рішення з decisions.md
  Files: bin/agent-orchestrator.js
  Do: у гілці `--restore` команди `handoff` додати блок Decisions: якщо `openspec/changes/<name>/decisions.md` існує — надрукувати шлях і його записи-буллети; якщо файлу немає — надрукувати `decisions: none`; Memory JSON не використовувати як джерело друкованих рішень (наявний рядок з кількістю Memory-ентитей залишити як діагностику)
  Done-when: `handoff <name> --restore` для зміни з decisions.md друкує записи з файлу і exit 0; без файлу друкує `decisions: none` і exit 0

- [x] 1.4 Зафіксувати decisions.md у протокольних шаблонах
  Files: templates/.agents/rules/session-handoff.mdc, templates/.agents/rules/memory-mcp-autosetup.mdc, templates/.agents/skills/agent-orchestration/SKILL.md, templates/.agents/subagents/session-handoff.md
  Do: у Session Exit тексті session-handoff.mdc, agent-orchestration/SKILL.md і session-handoff.md дописати, що CLI `handoff <name>` веде append-only канон рішень `openspec/changes/<name>/decisions.md`, а Memory `Decision:*` — його дзеркало (напрям лише файл → Memory); у Session Start тексті — що накопичені рішення друкує `handoff --restore` з git-файлу; у memory-mcp-autosetup.mdc позначити `Decision:<topic>` як дзеркало decisions.md з тим самим writer-ом
  Done-when: усі чотири файли називають decisions.md каноном рішень і фіксують напрям синхронізації файл → Memory

## 2. Skill inventory (skill-inventory)

- [x] 2.1 Секція skills: у шаблоні та профілях
  Files: templates/orchestrator.yaml, profiles/generic/orchestrator.yaml, profiles/vue3/orchestrator.yaml, profiles/node/orchestrator.yaml, profiles/mvp/orchestrator.yaml
  Do: додати в кожен файл секцію `skills:` з `kit:` (вісім скілів: agent-orchestration, openspec-howto, openspec-explore, openspec-propose, openspec-apply-change, openspec-archive-change, openspec-sync-specs, spec-workflow-openspec), `stack:` і `external:`; vue3: `stack:` = vue-core, vue-pinia, vue-axios, vue-router і `external: frontend-agent-skills`, рядок `notes:` у roles.implementer видалити; node: `stack:` = javascript-core, javascript-node, javascript-testing і `external: frontend-agent-skills`, рядок `notes:` у roles.implementer видалити; generic і mvp: `stack: []` і `external: ""` (notes mvp про quick-режим залишити — вони не є skill-інвентарем)
  Done-when: усі п'ять файлів містять секцію skills: з однаковим kit-переліком; у vue3 і node немає free-text notes зі списками скілів; generic/mvp мають порожні stack/external

- [x] 2.2 Парсер skills-інвентаря і видалення KIT_SKILL_DIRS
  Files: bin/agent-orchestrator.js
  Do: додати `parseSkillsInventory(content)` (regex-стиль `parseMcpInventory`: списки kit/stack, скаляр external) і `readSkillsInventory(projectDir)` з fallback-ом за відсутності секції — kit = відсортований перелік директорій `templates/.agents/skills/` kit-пакета (KIT_ROOT) без імен з префіксом `subagent-`, stack = [], external = ''; видалити константу `KIT_SKILL_DIRS`, а `KIT_MANAGED_PATHS` будувати з того самого enumeration-переліку templates
  Done-when: `rg KIT_SKILL_DIRS bin/` дає 0 збігів; `init` і `update` у тимчасовому проєкті приносять ті самі 8 kit-скілів у `.agents/skills/`, що й до зміни

- [x] 2.3 Секція Skill health у status
  Files: bin/agent-orchestrator.js
  Do: додати `printSkillHealth(projectDir)` і викликати в команді `status` після `printMcpHealth`; для кожного скіла з `readSkillsInventory` (kit + stack): `missing` — немає `.agents/skills/<name>/SKILL.md` (для stack-скіла додати підказку `npx <external> install`, без запуску установки), `stale` — SKILL.md у `.cursor/skills/<name>/` або `.claude/skills/<name>/` відсутній чи байтово відрізняється від джерела, інакше `ok`; виділити з `generateAmpSubagentSkills` спільну функцію-builder вмісту wrapper-а і для кожного `.agents/subagents/<n>.md` з валідним frontmatter порівняти байтово очікуваний вміст з `.agents/skills/subagent-<n>/SKILL.md`, друкуючи підсумок wrappers (`ok n/n` або перелік stale/missing); жодних мережевих запитів і mtime-порівнянь; process.exitCode не змінювати за жодного стану
  Done-when: `status` у kit-репо друкує секцію Skill health; після видалення `.cursor/skills/openspec-howto/` рядок скіла показує stale; exit code 0 при missing і stale

## 3. Тести та документація

- [x] 3.1 Смоук-тести нової поведінки
  Files: test/smoke.test.js
  Do: додати тести: (а) `handoff <name>` створює decisions.md з датованим записом, повторний запуск не дублює, нова редакція topic-а — новий рядок при збереженому старому, `Decisions: none` не створює файл; (б) memory.json після persist містить `Decision:<topic>` з текстом останнього запису topic-а з decisions.md; (в) `handoff --restore` друкує записи з decisions.md, без файлу — `decisions: none`, exit 0; (г) `parseSkillsInventory` парсить повну секцію і fallback спрацьовує без секції; (д) `skills.kit` з templates/orchestrator.yaml збігається з переліком директорій templates/.agents/skills/ без subagent-*; (е) `status` містить Skill health і завершується exit 0 при відсутньому і при розсинхронізованому скілі
  Done-when: `npm test` зелений локально

- [x] 3.2 Оновити README і CHANGELOG
  Files: README.md, CHANGELOG.md
  Do: у README додати підрозділ про decisions.md (git-канон рішень, append-only, writer — `handoff <name>`, Memory як дзеркало, читання через `handoff --restore`) і підрозділ про skills-інвентар (`skills: kit/stack/external` в orchestrator.yaml, Skill health у `status` як warn-only, установка external-скілів вручну через `npx frontend-agent-skills install`); у CHANGELOG додати unreleased-запис Phase 2 з обома можливостями
  Done-when: README описує обидві можливості з прикладами команд; CHANGELOG містить unreleased-запис Phase 2
