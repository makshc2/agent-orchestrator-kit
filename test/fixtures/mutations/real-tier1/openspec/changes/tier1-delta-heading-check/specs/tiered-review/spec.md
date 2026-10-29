## MODIFIED Requirements

### Requirement: Скриптовий Tier 1 перед LLM-review

Команда `npx agent-orchestrator-kit gate-check --review <name>` SHALL виконувати детерміновані перевірки: `openspec validate --strict --type change`, task-контракт-лінт, наявність секцій `Non-goals` і `Acceptance criteria` в proposal.md, наявність непорожніх ADDED/MODIFIED/REMOVED/RENAMED секцій у delta specs і перевірку заголовків delta проти main specs тим самим кодом, що й `archive --sync` (`planSpecSync`): кожен заголовок `### Requirement:` у MODIFIED і REMOVED та кожен `FROM:` у RENAMED MUST байт-у-байт існувати в `openspec/specs/<capability>/spec.md`, а кожен заголовок ADDED і кожен `TO:` у RENAMED MUST NOT там існувати. Порівняння точне, без толерантності до регістру чи пробілів, бо archive відмовить за тих самих умов. Кожен конфлікт SHALL потрапляти в `errors` тим самим рядком, який archive друкує як sync conflict (`<capability>: MODIFIED requirement not found in main spec: "<name>"`, `REMOVED requirement not found in main spec`, `ADDED requirement already exists in main spec`, `RENAMED requirement not found in main spec`, `RENAMED target already exists in main spec`). Capability без main spec приймає лише ADDED. Перевірка конфліктів в archive лишається чинною: main spec може змінитись між propose і archive. Команда `/opsx:review` MUST запускати Tier 1 до читання артефактів LLM-ом.

#### Scenario: Падіння Tier 1 завершує review без LLM-читання

- **GIVEN** change, що не проходить task-контракт-лінт або validate
- **WHEN** виконується `/opsx:review <name>`
- **THEN** у чат виводиться REQUEST CHANGES з помилками gate-check, `review.md` записується з `Verdict: REQUEST CHANGES`, phase-субагент не спавниться, артефакти LLM не читає

#### Scenario: Tier 1 OK передає скорочений чекліст у Tier 2

- **GIVEN** change, що проходить `gate-check --review`
- **WHEN** спавниться `spec-reviewer`
- **THEN** його чекліст містить лише LLM-перевірки (узгодженість артефактів, конфлікти з main specs, scope creep, самодостатність тасків) без пунктів, які вже покрив Tier 1

#### Scenario: MODIFIED-заголовок, відсутній у main spec, падає в Tier 1

- **GIVEN** delta `openspec/changes/<name>/specs/auth/spec.md` має `## MODIFIED Requirements` із заголовком `### Requirement: Old Requirement`, а `openspec/specs/auth/spec.md` містить лише `### Requirement: Old Req`
- **WHEN** виконується `gate-check --review <name> --json`
- **THEN** `pass` є `false`, exit code 1
- **AND** `errors` містить `auth: MODIFIED requirement not found in main spec: "Old Requirement"`
- **AND** той самий рядок для заголовка `old req` або `Old  Req` (регістр, подвійний пробіл) — без нормалізації

#### Scenario: RENAMED проходить Tier 1 і падає на відсутньому FROM

- **GIVEN** delta містить лише `## RENAMED Requirements` з `- FROM: \`### Requirement: Old Req\`` і `- TO: \`### Requirement: Renamed Req\``, а main spec має `Old Req` і не має `Renamed Req`
- **WHEN** виконується `gate-check --review <name> --json`
- **THEN** `pass` є `true` і `errors` не містить `no non-empty`
- **AND** якщо FROM відсутній у main spec — `errors` містить `auth: RENAMED requirement not found in main spec: "<from>"`
- **AND** якщо TO уже існує в main spec — `errors` містить `auth: RENAMED target already exists in main spec: "<to>"`
