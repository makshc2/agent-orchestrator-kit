## ADDED Requirements

### Requirement: Specialists own their artifact build steps

`spec-architect.md` SHALL contain the artifact build loop (`openspec new change`, `openspec status --change <name> --json`, `openspec instructions <id> --change <name> --json`, write to `resolvedOutputPath`) and `design-intake.md` SHALL contain the source ladder, capture rules, `design-brief.md` template and confidence markers. `opsx-propose.md`, `openspec-propose/SKILL.md` and `opsx-design.md` MUST point to the specialist instead of repeating those steps.

#### Scenario: Propose command has no build loop

- **WHEN** `opsx-propose.md` and `openspec-propose/SKILL.md` are read
- **THEN** neither contains `openspec instructions` nor "Delegate steps 3–5", and `spec-architect.md` contains `openspec instructions`

#### Scenario: Quick branch is preserved

- **WHEN** `spec-architect.md` is read after the move
- **THEN** it still contains the line `**Gate:** not run (/opsx:quick)` and the quick-mode scope

#### Scenario: Design command has no capture steps

- **WHEN** `opsx-design.md` and `design-intake.md` are read
- **THEN** `design-intake.md` contains the source ladder with the `figma-fetch` guidance and the `Confidence notes` section of the brief template
- **AND** `opsx-design.md` contains neither and still spawns `design-intake`

### Requirement: code-reviewer runs on request or before a PR on a non-empty diff

The `code-reviewer` description SHALL say it is used on request or before a PR/MR and keep its `Do NOT use for` clause. Its first step MUST run `git diff HEAD --stat -- <pipeline.src_glob>` (staged and unstaged), `git diff --stat <target-branch>...HEAD -- <pipeline.src_glob>` (commits) and list untracked source files; when all are empty it returns `Status: blocked` with `no implementation diff`. Its input MUST be `apply-notes.md` and `tasks.md`, not the proposal, design and every spec.

#### Scenario: No diff

- **WHEN** `code-reviewer` is spawned and every source diff probe is empty
- **THEN** it returns `Status: blocked` with `no implementation diff` and reviews nothing

#### Scenario: Staged changes count as a diff

- **WHEN** `code-reviewer` is spawned and the only source change is staged and not committed
- **THEN** `git diff HEAD --stat` lists it, so the reviewer does not return `no implementation diff`

### Requirement: Quick command has no time-box

`opsx-quick.md` SHALL keep its Guardrails (build/lint and test step, OpenSpec artifacts always written, one prompt only at final exit) and MUST NOT contain a time limit such as "Max ~3 hours"; the scope limit is the existing "1–3 files, clear scope, one behaviour".

#### Scenario: Guardrails after the edit

- **WHEN** `opsx-quick.md` Guardrails are read
- **THEN** they contain "emit exactly one only at final exit" and contain no "hours"

## MODIFIED Requirements

### Requirement: Exclusive routing table in always-apply and commands

Kit SHALL постачати таблицю маршрутизації «фаза × сигнал → субагент» в `templates/.agents/rules/agent-orchestration.mdc` (`alwaysApply: true`), у skill `agent-orchestration` і в кожній команді `templates/.agents/commands/opsx-*.md`. Кожен субагент MUST мати в `description` позитивний тригер (`ALWAYS use for` / `Use proactively`) і негативний (`Do NOT use for`). Виняток: для fallback/optional-субагентів (`session-handoff`, `spec-archiver`, `code-reviewer`) достатньо `Use ...` з умовою запуску.

#### Scenario: Init installs routing in always-apply rule

- **WHEN** виконується `agent-orchestrator-kit init`
- **THEN** `.agents/rules/agent-orchestration.mdc` містить таблицю з рядками для `session-handoff`, `codebase-explorer`, `spec-architect`, `spec-reviewer`, `code-writer`, `spec-archiver`

#### Scenario: Spec review is not code review

- **WHEN** фаза `/opsx:review`
- **THEN** таблиця призначає `spec-reviewer`, а не `code-reviewer`
- **AND** `description` у `code-reviewer` забороняє використовувати його як гейт proposal до apply

#### Scenario: Fallback and optional agents state a condition

- **WHEN** читаються `description` агентів `session-handoff`, `spec-archiver` і `code-reviewer`
- **THEN** кожен містить тригер `use` (регістр не важливий) з умовою запуску: fallback-умова або «on request or before a PR/MR»
- **AND** кожен містить застереження `Do NOT use`, а `ALWAYS use` не містить жоден
