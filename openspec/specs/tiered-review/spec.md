## Purpose

tiered-review — requirements merged from change lean-pipeline-v2.

## Requirements

### Requirement: Скриптовий Tier 1 перед LLM-review

Команда `npx agent-orchestrator-kit gate-check --review <name>` SHALL виконувати детерміновані перевірки: `openspec validate --strict --type change`, task-контракт-лінт, наявність секцій `Non-goals` і `Acceptance criteria` в proposal.md, наявність непорожніх ADDED/MODIFIED/REMOVED секцій у delta specs. Команда `/opsx:review` MUST запускати Tier 1 до читання артефактів LLM-ом.

#### Scenario: Падіння Tier 1 завершує review без LLM-читання

- **GIVEN** change, що не проходить task-контракт-лінт або validate
- **WHEN** виконується `/opsx:review <name>`
- **THEN** у чат виводиться REQUEST CHANGES з помилками gate-check, `review.md` записується з `Verdict: REQUEST CHANGES`, phase-субагент не спавниться, артефакти LLM не читає

#### Scenario: Tier 1 OK передає скорочений чекліст у Tier 2

- **GIVEN** change, що проходить `gate-check --review`
- **WHEN** спавниться `spec-reviewer`
- **THEN** його чекліст містить лише LLM-перевірки (узгодженість артефактів, конфлікти з main specs, scope creep, самодостатність тасків) без пунктів, які вже покрив Tier 1

### Requirement: apply-notes.md при APPROVE

При вердикті APPROVE reviewer MUST записати `openspec/changes/<name>/apply-notes.md` (≤ 20 рядків): критичні констрейнти, підводні камені, що не чіпати, команди перевірки. Це єдиний додатковий файл, дозволений reviewer-у поруч із `review.md`.

#### Scenario: APPROVE створює дистилят для apply

- **GIVEN** review завершився APPROVE
- **WHEN** перевіряється директорія change
- **THEN** існують `review.md` (`Verdict: APPROVE`) і `apply-notes.md` з констрейнтами для виконавця
