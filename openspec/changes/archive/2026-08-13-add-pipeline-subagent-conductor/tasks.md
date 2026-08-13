## 1. Stage subagents

- [x] 1.1 Додати `templates/.agents/subagents/codebase-explorer.md`: readonly, ALWAYS для `/opsx:explore` дослідження репо; Do NOT write specs/code; контракт звіту
- [x] 1.2 Додати `templates/.agents/subagents/design-intake.md`: пише лише `design-brief.md` + `assets/`; ALWAYS для `/opsx:design`; Do NOT `src/`
- [x] 1.3 Додати `templates/.agents/subagents/spec-architect.md`: пише лише `openspec/changes/`; ALWAYS для `/opsx:propose`; Do NOT `src/` і не запускає apply
- [x] 1.4 Додати `templates/.agents/subagents/spec-reviewer.md`: readonly + `review.md`; ALWAYS для `/opsx:review`; Do NOT підміняти `code-reviewer` і не чіпати `src/`/`tasks.md`
- [x] 1.5 Додати `templates/.agents/subagents/spec-archiver.md`: archive delta + move change; ALWAYS для `/opsx:archive`; Do NOT нові фічі
- [x] 1.6 Посилити існуючі шість агентів: ALWAYS/Do NOT у `description`, контракт звіту; `code-writer` / `design-implementer` / `test-writer` — заборона чекбоксів `tasks.md`

## 2. Routing table (conductor)

- [x] 2.1 Вписати ексклюзивну таблицю «фаза × сигнал → субагент» у `templates/.agents/rules/agent-orchestration.mdc`: conductor MUST spawn, MUST NOT робити роботу спеціаліста
- [x] 2.2 Те саме в `templates/.agents/skills/agent-orchestration/SKILL.md` (замінити м’який Memory абзац на обов’язковий протокол + таблицю)
- [x] 2.3 У кожній `templates/.agents/commands/opsx-{explore,design,propose,review,apply,archive}.md` і відповідних `templates/.agents/skills/openspec-*/SKILL.md`: крок «spawn <агент>, не робити самому»; apply — checkbox ставить лише conductor
- [x] 2.4 `templates/.agents/commands/opsx-quick.md`: conductor spawn всередині сесії, без mid-session промпта між propose і apply

## 3. Session handoff

- [x] 3.1 Додати start-протокол (команда з paste → **Memory** → fallback `handoff.md`; вільне «продовжуй» = `next_command`) в always-apply rule, skill `agent-orchestration`, і на початок кожної `/opsx:*` команди
- [x] 3.2 Exit-протокол: (1) Memory, (2) `handoff.md`, (3) fenced промпт з `/opsx:` без ярлика, тіло мовою `project.agent_language`, задача прочитати Memory (без дубля саммарі); не стартувати наступну фазу в цьому чаті
- [x] 3.3 Оновити `templates/.agents/rules/memory-mcp-autosetup.mdc`: поля `Change:` / `Handoff:` (`next_role`, `next_command`, `session_count`, `summary`, `blocked`) / `Decision:`; старт читає, вихід пише; MCP down ≠ блок
- [x] 3.4 У `templates/orchestrator.yaml` і `profiles/{generic,vue3,node,mvp}/orchestrator.yaml` додати `handoff.restore_on_start`, `persist_on_exit`, `emit_next_session_prompt` = true
- [x] 3.5 `opsx-quick.md`: один exit prompt на verify/archive, без paste між propose і apply

## 4. Amp wrappers і docs

- [x] 4.1 У `bin/agent-orchestrator.js` `generateAmpSubagentSkills` і `templates/scripts/sync-local-agent-skills.sh` додати преамбулу MUST spawn isolated subagent / not main thread
- [x] 4.2 Оновити `templates/AGENTS.md`, `templates/CLAUDE.md`, `README.md`: conductor, таблиця, handoff.md, промпт наступної сесії без службового ярлика; уточнити що OpenSpec-файли — source of truth, Memory/handoff — індекс фази
- [x] 4.3 CHANGELOG запис для наступного релізу (без bump версії, якщо bump окремим реліз-кроком мейнтейнера)

## 5. Tests і validate

- [x] 5.1 Smoke: init ставить п’ять нових `subagents/*.md` і копіює їх у `.cursor/agents/` / `.claude/agents/` після sync
- [x] 5.2 Smoke: Amp wrapper `subagent-spec-architect` містить spawn-преамбулу
- [x] 5.3 Smoke: після init `orchestrator.yaml` має три нові handoff-прапорці; `agent-orchestration.mdc` містить імена всіх stage-субагентів таблиці
- [x] 5.4 `npm test` зелений; `npx openspec validate add-pipeline-subagent-conductor --strict --type change` проходить
