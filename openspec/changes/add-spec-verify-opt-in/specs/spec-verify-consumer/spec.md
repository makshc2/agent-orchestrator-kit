# Spec: Spec Verify Consumer (opt-in)

## ADDED Requirements

### Requirement: init --spec-verify installs AI Spec Verifier files for GitLab

When `init` is run with `--ci gitlab --spec-verify`, the CLI SHALL install `.gitlab/spec-verify.yml`, `scripts/verify-specs.sh`, and `scripts/post-mr-verdict.sh` into the consumer project and make the scripts executable.

#### Scenario: GitLab init with spec-verify flag

- **WHEN** `agent-orchestrator-kit init --ci gitlab --spec-verify` runs in a project
- **THEN** `.gitlab/spec-verify.yml` exists in the project
- **AND** `scripts/verify-specs.sh` and `scripts/post-mr-verdict.sh` exist

#### Scenario: GitLab init without the flag

- **WHEN** `agent-orchestrator-kit init --ci gitlab` runs without `--spec-verify`
- **THEN** none of the spec-verify files are installed

#### Scenario: spec-verify flag with non-GitLab CI provider

- **WHEN** `init --ci github --spec-verify` or `init --ci none --spec-verify` runs
- **THEN** the CLI prints a warning that spec-verify requires `--ci gitlab`
- **AND** no spec-verify files are installed

### Requirement: Spec verify CI fragment is blocking by default

The installed `.gitlab/spec-verify.yml` SHALL define a `spec-verify` job that runs on merge request events with `src/**/*` changes and SHALL NOT contain an active `allow_failure: true` directive. A commented Phase 1 fallback SHALL document how to make the job non-blocking.

#### Scenario: Fragment inspected after install

- **WHEN** the installed `.gitlab/spec-verify.yml` is inspected
- **THEN** job `spec-verify` extends a hidden base job
- **AND** rules restrict it to merge request events with `src/**/*` changes
- **AND** no uncommented `allow_failure: true` is present
- **AND** artifacts include `artifacts/verdict.json`

### Requirement: Verifier script degrades gracefully and never logs secrets

`scripts/verify-specs.sh` SHALL write a skipped passing verdict and exit 0 when there are no `src/` changes, no spec files, no `amp` CLI, or no `AMP_API_KEY`. The script SHALL NOT print token or key values and SHALL exclude sensitive file patterns from prompt content.

#### Scenario: Missing AMP_API_KEY in CI

- **WHEN** `verify-specs.sh` runs without `AMP_API_KEY` set
- **THEN** `artifacts/verdict.json` contains `"pass": true` and `"skipped": true`
- **AND** the script exits 0 without printing any secret values

#### Scenario: Sensitive files excluded from prompt

- **WHEN** changed files include paths matching `.env`, `secret`, `token`, `key`, `.pem`, or `.p12` patterns
- **THEN** their content is not included in the verifier prompt

### Requirement: Orchestrator gates include spec-verify-blocking when opted in

When `--spec-verify` is used with `--ci gitlab`, the CLI SHALL add `spec-verify-blocking` to `roles.verifier.gates` in `.agents/orchestrator.yaml`, idempotently.

#### Scenario: Gates patched on init

- **WHEN** `init --ci gitlab --spec-verify` completes
- **THEN** `.agents/orchestrator.yaml` lists `spec-verify-blocking` under verifier gates
- **AND** running init again does not duplicate the gate entry

### Requirement: update refreshes spec-verify files only when previously installed

The `update` command SHALL overwrite `.gitlab/spec-verify.yml`, `scripts/verify-specs.sh`, and `scripts/post-mr-verdict.sh` only if the corresponding file already exists in the consumer project.

#### Scenario: Project with spec-verify installed

- **WHEN** `update` runs in a project where `.gitlab/spec-verify.yml` exists
- **THEN** the fragment and scripts are refreshed from kit templates

#### Scenario: Project without spec-verify

- **WHEN** `update` runs in a project where spec-verify files are absent
- **THEN** no spec-verify files are created
