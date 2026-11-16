## MODIFIED Requirements

### Requirement: Test results are not a gate

By default test discipline SHALL remain instruction-only. `handoff`, `archive` and every `gate-check` mode MUST NOT read the `tests:` line or run tests, and archive gates MUST NOT depend on `metrics.json` for test state. Only explicitly enabled workflow completion-hook enforcement SHALL check structured verification evidence; it MUST preserve documented skip, narrowed-run and user-accepted-failure outcomes.

#### Scenario: CLI ignores the line
- **GIVEN** a change whose Done has no `tests:` line and all tasks are ticked
- **WHEN** `handoff <name>` and `archive <name> --sync` run
- **THEN** both behave exactly as they did before this change

#### Scenario: Always-apply budgets untouched
- **WHEN** the change is applied
- **THEN** no always-apply rule file and not `templates/AGENTS.md` is edited

#### Scenario: Default or observe mode remains nonblocking
- **WHEN** workflow hooks are absent, off or in observe mode
- **THEN** no new test enforcement occurs and existing manual apply instructions remain effective

#### Scenario: Explicit completion enforcement
- **WHEN** workflow completion enforcement is explicitly enabled and genuine completion lacks fresh evidence
- **THEN** only the completion hook requests bounded correction using structured evidence
- **AND** handoff, archive and gate-check retain their exclusions and manual interruption remains possible
