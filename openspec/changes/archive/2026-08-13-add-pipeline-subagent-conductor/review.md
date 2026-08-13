# Spec Review: add-pipeline-subagent-conductor

## Verdict: APPROVE

Повторне рев'ю (2026-08-13, друга ітерація): попередній `review.md` був старіший за
`design.md`/`tasks.md`/`handoff.md` — Architect після нього додав вимогу мови промпта.
Поточний стан артефактів узгоджений наскрізь: proposal → design → 2 delta-спеки
(`pipeline-subagents`, `session-handoff`) → 22 таски.
`npx openspec validate add-pipeline-subagent-conductor --strict --type change` ✓
(перевірено в цій сесії). `openspec list`: один active change ✓.

## Що змінилось після першого рев'ю

- Нова вимога **«Next-session prompt follows agent_language»** у `session-handoff`:
  тіло промпта — мовою `project.agent_language`, ідентифікатори (`/opsx:*`, ключі
  Memory, шляхи) — латиницею. Узгоджено з design §6 (приклад для `uk`) і таскою 3.2.
  Ключ `project.agent_language` реально існує в `templates/orchestrator.yaml` і всіх
  4 профілях ✓.

## Verified against repo

- Усі 6 існуючих субагентів на місці (`templates/.agents/subagents/`), 5 нових — лише
  в тасках 1.1–1.5. Списки збігаються зі спекою «Stage subagents» (11 імен).
- Команди `opsx-{explore,design,propose,review,apply,archive,quick}.md`,
  `agent-orchestration.mdc`, `memory-mcp-autosetup.mdc`, skill `agent-orchestration` —
  існують; таски 2.x/3.x посилаються на реальні файли.
- `templates/orchestrator.yaml` вже має секцію `handoff:` — нові прапорці (3.4) її
  розширюють, не ламають. Усі 4 профілі мають `orchestrator.yaml`.
- `generateAmpSubagentSkills` існує в `bin/agent-orchestrator.js` (L619),
  `sync-local-agent-skills.sh` у `templates/scripts/` — таска 4.1 реалістична.
- Smoke-сценарії (5.1–5.3) перевіряють наявність файлів/рядків, чесно не обіцяють
  runtime-поведінку LLM — узгоджено з Risk/Mitigation у design.
- Лічильник тасок: 6+4+5+3+4 = 22 ✓.

## Notes (не блокують)

- **Стале «Blocked»:** `figma-token-setup` вже заархівовано
  (`archive/2026-08-13-figma-token-setup`). Секції Blocked у proposal/design (Risk
  «Два active changes») і handoff застарілі — apply стартує без передумов.
- Сценарій «Apply exit does not start archive in the same chat» структурно потрапив
  під вимогу `agent_language`, хоча логічно належить exit-протоколу. Validate це
  пропускає; імплементації не заважає — можна не чіпати.
- Сценарій «Init installs routing in always-apply rule» перелічує 5 з 11 агентів —
  прийнятно як spot-check; smoke 5.3 суворіший («імена всіх stage-субагентів
  таблиці»). Імплементеру орієнтуватися на 5.3.
- Право на `review.md` визначене однозначно: пише `spec-reviewer`, conductor — ні.
  `spec-reviewer` ≠ `code-reviewer` закріплено в таблиці й description-вимогах.
- `handoff.md` поза схемою OpenSpec — підтверджено: файл лежить у change, validate ✓.

## Next

`/opsx:apply add-pipeline-subagent-conductor` — без передумов.
