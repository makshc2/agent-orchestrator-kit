## ADDED Requirements

### Requirement: Propose проганяє Tier 1 до handoff на review

Команда `templates/.agents/commands/opsx-propose.md` і skill `templates/.agents/skills/openspec-propose/SKILL.md` MUST вимагати: після звіту `spec-architect` conductor сам запускає `npx agent-orchestrator-kit gate-check --review <name>` (Tier 1 pre-gate); рядок `**Gate:**` у звіті архітектора лише інформаційний і його не замінює, хоч би яке значення мав (зокрема `not run` чи відсутній рядок). Якщо exit ≠ 0, conductor MUST один раз переспавнити `spec-architect` з повним списком помилок gate-check (targeted fix) і MUST запустити gate-check повторно. Якщо exit усе ще ≠ 0, conductor MUST закрити сесію з `## Blocked`, перелічити помилки gate-check, що лишились, і поставити next command `/opsx:propose <name>`. Handoff на `/opsx:review <name>` без exit 0 MUST NOT відбуватись: рядок Prompt у розділі **Output** обох файлів і перший рядок промпта в Session Exit команди MUST пропонувати `/opsx:review <name>` лише після exit 0, а інакше — `## Blocked` і `/opsx:propose <name>`. Правило SHALL діяти однаково для першого propose, re-propose після Tier 2 REQUEST CHANGES і structure-only re-propose після T1-only REQUEST CHANGES (рядок `**Source:** gate-check` без `## Checklist`). Conductor MUST NOT сам виправляти proposal/design/specs/tasks за помилками gate-check. Стан «є `proposal.md`, немає `review.md`, gate-check exit ≠ 0» після `## Blocked` MUST маршрутизуватись на `/opsx:propose <name>` і в `openspec-guide` (MODIFIED-вимога pipeline-subagents «openspec-guide маршрутизує REQUEST CHANGES на propose»). `/opsx:quick` не має фази review і цей pre-gate не отримує; `opsx-quick.md` не змінюється. Pre-gate є адитивним: вимога «Скриптовий Tier 1 перед LLM-review» лишається чинною, і `/opsx:review` MUST і далі сам запускати Tier 1 до читання артефактів LLM-ом; вимога «Метрика discovery loops не більше двох» і рядок `Spec review discovery loops: ≤ 2` не змінюються; логіка, regex і вивід `gate-check --review` не змінюються.

#### Scenario: Відсутня Acceptance criteria виправляється в тій самій propose-сесії

- **GIVEN** `spec-architect` повернув `Status: done`, а `proposal.md` не має заголовка `## Acceptance criteria`
- **WHEN** conductor запускає `npx agent-orchestrator-kit gate-check --review <name>`
- **THEN** exit ≠ 0, і conductor один раз переспавнює `spec-architect` з повним списком помилок gate-check
- **AND** після виправлення повторний `gate-check --review <name>` дає exit 0
- **AND** next command сесії є `/opsx:review <name>`

#### Scenario: Повторний провал pre-gate закриває propose як Blocked

- **GIVEN** conductor уже один раз переспавнив `spec-architect` з помилками gate-check
- **AND** повторний `gate-check --review <name>` знову дає exit ≠ 0
- **WHEN** conductor закриває сесію
- **THEN** `handoff.md` має `## Blocked` з помилками gate-check, що лишились
- **AND** next command є `/opsx:propose <name>`, а не `/opsx:review <name>`
- **AND** підсумок сесії за розділом **Output** не пропонує `Run /opsx:review <name> in a fresh session` і не каже, що pre-gate пройдено
- **AND** conductor не редагував proposal/design/specs/tasks сам
- **AND** `openspec-guide`, викликаний для цього change до нового propose, теж називає next command `/opsx:propose <name>`

#### Scenario: Pre-gate діє і для structure-only re-propose

- **GIVEN** `review.md` з `Verdict: REQUEST CHANGES`, рядком `**Source:** gate-check` і без `## Checklist`
- **WHEN** виконується `/opsx:propose <name>` і `spec-architect` виправив лише помилки gate-check
- **THEN** conductor усе одно запускає `gate-check --review <name>` до handoff
- **AND** handoff на `/opsx:review <name>` відбувається лише при exit 0

#### Scenario: Review і далі запускає Tier 1 сам

- **GIVEN** propose завершився з `gate-check --review <name>` exit 0
- **WHEN** виконується наступний `/opsx:review <name>`
- **THEN** review MUST знову запустити `gate-check --review <name>` до спавну `spec-reviewer`
- **AND** рядок `Spec review discovery loops: ≤ 2` у `templates/.agents/skills/agent-orchestration/SKILL.md` не змінений

### Requirement: Шаблонні умови виходу Architect включають Tier 1 pre-gate

Шаблони kit, що описують умови виходу propose, MUST називати `gate-check --review` як pre-gate перед handoff на review:
- розділ `### propose → review` у `templates/.agents/skills/agent-orchestration/SKILL.md`: команда `npx agent-orchestrator-kit gate-check --review <name>` з вимогою exit 0, один re-spawn `spec-architect` і вихід `## Blocked` з `/opsx:propose <name>`;
- Orchestration Checklist того ж skill;
- абзац «Quality gates:» у `templates/AGENTS.md`;
- речення про двоярусний review у `templates/CLAUDE.md`;
- рядок CLI ↔ Cursor для `/opsx:propose` у `templates/.agents/skills/openspec-howto/SKILL.md`;
- блок **Exit gate:** розділу Role 2 Architect у `README.md`.

`templates/AGENTS.md` MUST лишатись коротшим за 4000 символів. `test/smoke.test.js` SHALL асертити `gate-check --review` у `opsx-propose.md`, у `openspec-propose/SKILL.md` і у зрізі skill між `### propose → review` та `### review → apply`. Для skill потрібен саме зріз: whole-file match хибно-позитивний через рядок маршрутизації `/opsx:review`.

#### Scenario: Skill називає pre-gate в умовах виходу Architect

- **GIVEN** kit після apply цього change
- **WHEN** читається зріз `templates/.agents/skills/agent-orchestration/SKILL.md` від `### propose → review` до `### review → apply`
- **THEN** зріз містить `gate-check --review` і `## Blocked`
- **AND** рядок `Spec review discovery loops: ≤ 2` поза зрізом не змінений

#### Scenario: AGENTS.md і CLAUDE.md згадують pre-gate propose

- **WHEN** читаються `templates/AGENTS.md` і `templates/CLAUDE.md`
- **THEN** кожен містить речення, що propose запускає `gate-check --review` як pre-gate і передає на review лише при exit 0
- **AND** `templates/AGENTS.md` коротший за 4000 символів
