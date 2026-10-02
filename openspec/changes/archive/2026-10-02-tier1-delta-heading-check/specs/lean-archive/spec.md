## ADDED Requirements

### Requirement: Sync застосовує RENAMED Requirements

`npx agent-orchestrator-kit archive <name> --sync` SHALL застосовувати секцію `## RENAMED Requirements` delta spec у форматі openspec (`- FROM: \`### Requirement: Old\`` / `- TO: \`### Requirement: New\``; дефіс і бектики необов’язкові) до `openspec/specs/<capability>/spec.md`: рядок заголовка `### Requirement: <from>` замінюється на `### Requirement: <to>`, тіло вимоги лишається. Перейменування MUST застосовуватись до REMOVED/MODIFIED/ADDED того самого delta, щоб MODIFIED із новим ім’ям знаходив вимогу. Delta лише з RENAMED SHALL рахуватись непорожньою і синхронізуватись. Якщо `<from>` відсутній у main spec або `<to>` уже існує, sync MUST відмовити з конфліктом `<capability>: RENAMED requirement not found in main spec: "<from>"` або `<capability>: RENAMED target already exists in main spec: "<to>"` і не переміщувати change. Суфікс `(was: …)` у заголовках MODIFIED MUST NOT трактуватись як перейменування.

#### Scenario: RENAMED-only delta перейменовує вимогу в main spec

- **GIVEN** change з `review.md` (`Verdict: APPROVE`), усіма тасками `[x]` і delta `specs/auth/spec.md`, що містить лише `## RENAMED Requirements` з FROM `Old Req` і TO `Renamed Req`
- **AND** `openspec/specs/auth/spec.md` містить `### Requirement: Old Req` з тілом «The system SHALL use the original behavior.»
- **WHEN** виконується `archive add-auth --sync`
- **THEN** exit code 0, stdout містить `synced 1 main spec file(s)`
- **AND** main spec містить рядок `### Requirement: Renamed Req`, не містить `### Requirement: Old Req` і зберігає тіло «original behavior»

#### Scenario: RENAMED перед MODIFIED того самого delta

- **GIVEN** delta містить `## RENAMED Requirements` (FROM `Old Req`, TO `Renamed Req`) і `## MODIFIED Requirements` із заголовком `### Requirement: Renamed Req`
- **WHEN** обчислюється план sync
- **THEN** конфліктів немає
- **AND** новий вміст main spec містить `### Requirement: Renamed Req` з тілом із MODIFIED і не містить `### Requirement: Old Req`

#### Scenario: Відсутній FROM відмовляє archive

- **GIVEN** delta містить RENAMED з FROM `Missing Req`, якого немає в main spec
- **WHEN** виконується `archive <name> --sync`
- **THEN** stderr містить `sync conflict: auth: RENAMED requirement not found in main spec: "Missing Req"`
- **AND** exit code ≠ 0, change лишається в `openspec/changes/<name>`
