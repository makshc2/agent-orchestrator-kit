## ADDED Requirements

### Requirement: Apply runs the test command once before the last box

The apply command and the apply skill SHALL tell the implementer to run `verifier.test_command` from `.agents/orchestrator.yaml` once, from the project root, after the last pending task is implemented and before its box is ticked. Only the last 20 lines of output are shown. A green run of the same command earlier in the session with no edit since counts. The step wording MUST be identical in both files.

#### Scenario: Last task waits for the test run
- **GIVEN** one task is pending and its Done-when holds
- **WHEN** the implementer follows the apply command
- **THEN** it runs the configured test command once and ticks the last box only after a green run
- **AND** boxes of earlier tasks are ticked as before

#### Scenario: Earlier green run is reused
- **GIVEN** an earlier task already ran the same command green and no file changed after it
- **WHEN** the last task is verified
- **THEN** the implementer does not run the command again

#### Scenario: Twins carry the same step
- **WHEN** `opsx-apply.md` and `openspec-apply-change/SKILL.md` are compared
- **THEN** the paragraph of the test step is byte-identical in both
- **AND** `/opsx:quick` inherits it through "Apply is parent-driven exactly as in `/opsx:apply`"

### Requirement: Empty test command is skipped with a warning

When `verifier.test_command` is empty or missing, or `.agents/orchestrator.yaml` is absent, the implementer MUST skip the run, warn that tests were not run, record `tests: skipped (no test_command)` and then tick the last box when its Done-when holds. The implementer MUST NOT infer a command such as `npm test`.

#### Scenario: Empty command
- **GIVEN** `verifier.test_command` is `""` and the last task's Done-when holds
- **WHEN** the last task is verified
- **THEN** no test process is started and a warning is shown
- **AND** Done contains `tests: skipped (no test_command)`, the last box is ticked and `## Blocked` is not changed for it

#### Scenario: No guessed command
- **GIVEN** the project has a `package.json` with a `test` script and an empty `verifier.test_command`
- **WHEN** the test step runs
- **THEN** the implementer does not run `npm test`

### Requirement: A red test run stops apply

A non-zero exit of the test command SHALL stop apply with the last box unticked and Done recording `tests: red (see Blocked)`. A cause inside the tasks' `Files:` is fixed in the same session and the command is run again. Any other cause ends through the escape valve: `## Blocked` holds the failing command and its tail, and the next command is `/opsx:propose <name>`.

#### Scenario: Regression inside the change
- **GIVEN** the run fails in a test of a file listed in a task's `Files:`
- **WHEN** the implementer fixes it and re-runs
- **THEN** the last box is ticked only after the green run

#### Scenario: Cause outside the plan
- **GIVEN** the run fails and the cause needs a file no task lists
- **WHEN** the session ends
- **THEN** `## Blocked` names the command and the failing tail, the next command is `/opsx:propose <name>` and Done contains `tests: red (see Blocked)`
- **AND** the last box stays unticked

### Requirement: A pre-existing failure needs a user decision and has one way out

A test that fails the same way on the unchanged code MUST NOT be skipped or accepted by the implementer: the last box stays unticked, `## Blocked` names the test, and the session waits for the user. When the user accepts it, the implementer SHALL tick the last box, record `tests: <passed>/<total> (accepted by user: <test name>)` and leave `## Blocked` empty for it.

#### Scenario: User accepts the failure
- **GIVEN** one test fails identically on the unchanged code and the user explicitly accepts it
- **WHEN** the implementer closes the session
- **THEN** Done records `tests: 216/217 (accepted by user: <test name>)` with the real counts and name
- **AND** the last box is ticked and `## Blocked` is `none`, so the green-apply condition of the CLI can hold

#### Scenario: User has not decided or rejects
- **GIVEN** the same failing test and no explicit acceptance, or an explicit rejection
- **WHEN** the session ends
- **THEN** the last box is unticked, `## Blocked` names the test, and Done contains `tests: red (see Blocked)`

### Requirement: Resource limits narrow the run, never skip it silently

When a project resource rule or a busy machine forbids the full run, the implementer SHALL narrow it (the specs of the changed files, or `--maxWorkers=1`) and record what was narrowed in Done. A run MUST NOT be skipped without a record. When not even a narrowed run is possible, the last box stays unticked.

#### Scenario: Narrowed green run
- **GIVEN** a project rule allows only a narrow test run and it exits 0
- **WHEN** the test step runs
- **THEN** only the narrowed command runs, Done reads `tests: 12/12 (narrowed: <what>)` and the last box is ticked

#### Scenario: Nothing can run
- **GIVEN** the machine is too busy for any test run
- **WHEN** the session ends
- **THEN** Done contains `tests: not run (<reason>)`, the reason is repeated in `## Blocked` and the last box is unticked

### Requirement: Done carries a tests line in every apply session

Every apply session SHALL end with exactly one `tests:` line in `## Done`: `tests: <passed>/<total>` for a green run, `tests: green (exit 0)` when the runner prints no counts, or the form named by the skip, narrowed, red, accepted or not-run requirement. A session that ends while more than one task is pending writes `tests: not run (paused: <k> tasks pending)`, which is not a blocker.

#### Scenario: Green run with counts
- **WHEN** the runner prints 217 passed of 217
- **THEN** Done contains `tests: 217/217`

#### Scenario: Green run without counts
- **WHEN** the runner exits 0 and prints no counts
- **THEN** Done contains `tests: green (exit 0)`

#### Scenario: Early pause
- **GIVEN** 3 tasks are still pending when the session ends
- **WHEN** the implementer writes Done
- **THEN** Done contains `tests: not run (paused: 3 tasks pending)` and `## Blocked` is not changed for it

### Requirement: Test results are not a gate

The kit SHALL NOT enforce test results: `handoff`, `archive` and every `gate-check` mode MUST NOT read the `tests:` line or run the test command, and no archive gate SHALL depend on `metrics.json` for test state. The apply step is an instruction to the implementer only.

#### Scenario: CLI ignores the line
- **GIVEN** a change whose Done has no `tests:` line and all tasks are ticked
- **WHEN** `handoff <name>` and `archive <name> --sync` run
- **THEN** both behave exactly as they did before this change

#### Scenario: Always-apply budgets untouched
- **WHEN** the change is applied
- **THEN** no always-apply rule file and not `templates/AGENTS.md` is edited
