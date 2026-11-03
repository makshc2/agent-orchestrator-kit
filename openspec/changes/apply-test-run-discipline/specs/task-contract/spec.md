## ADDED Requirements

### Requirement: Fix changes start with a failing regression test

For a change whose name starts with `fix-` or whose brief describes a bug fix, the architect SHALL make the first implementation task a regression test that fails on the unfixed code, with a `Done-when:` that names the test and states it fails before the fix and passes after. The rule stays a text instruction; no lint enforces it.

#### Scenario: Bug that a test can reproduce
- **GIVEN** a change named `fix-cursor-leftover-window`
- **WHEN** the architect writes `tasks.md`
- **THEN** task 1.1 adds a test whose `Done-when:` says it fails before the fix and passes after

#### Scenario: Bug without an automated reproduction
- **GIVEN** a fix change that no automated test can reproduce
- **WHEN** the architect writes the artifacts
- **THEN** `design.md` states why, and the first task records the manual reproduction steps

#### Scenario: Guideline is carried by the shipped texts
- **WHEN** the kit templates are read
- **THEN** `spec-architect.md`, `opsx-propose.md`, the propose skill and `templates/openspec-config.yaml.example` each contain the guideline
- **AND** `gate-check --tasks` and `gate-check --review` report exactly as before for the same inputs
