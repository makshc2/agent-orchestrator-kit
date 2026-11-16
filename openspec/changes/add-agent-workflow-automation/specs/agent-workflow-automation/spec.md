## ADDED Requirements

### Requirement: Workflow handlers extend the installed shared runtime

Workflow automation SHALL use the versioned handler, configuration, audit and lock contracts of `add-agent-hook-runtime`. It MUST remain off by default, support nonblocking observe mode, and reject incompatible runtime APIs before enabling effects. Apply MUST wait for the dependency to be merged and archived.

#### Scenario: Independent opt-in
- **WHEN** runtime context delivery is enabled but workflow handlers are absent or off
- **THEN** existing skill/recovery behavior continues without verification processes or enforcement

#### Scenario: Dependency not shipped
- **WHEN** implementation preflight finds only a proposed runtime or an incompatible extension version
- **THEN** apply stops with the precise dependency gap instead of implementing a competing dispatcher

### Requirement: Verification evidence records actual commands and inputs

The evidence runner SHALL record configured command, actual invocation, execution scope, exit/signal/timeout, and pre/post fingerprints of relevant tracked index/working-tree contents, untracked files, config, lockfiles and environment identity. Only equal stable pre/post/current fingerprints with the same command and scope SHALL count as fresh; HEAD alone MUST NOT suffice.

#### Scenario: Dirty tree is verified
- **WHEN** tests run against staged and unstaged changes plus an untracked relevant module
- **THEN** evidence identifies those exact inputs and can be reused while they remain unchanged

#### Scenario: Relevant inputs change
- **WHEN** staged content, working-tree content, an included untracked path, a lockfile, command configuration or declared environment identity changes
- **THEN** earlier evidence is stale even if HEAD is unchanged

#### Scenario: Progress records do not cause a verification loop
- **WHEN** only the final task checkbox or declared semantic progress artifacts change after successful tests
- **THEN** test evidence remains reusable under its disclosed input exclusions while separate raw task/handoff digests must be refreshed for completion
- **AND** task-contract text, code, configuration and lockfile changes still invalidate evidence

#### Scenario: Concurrent write or unstable input
- **WHEN** inputs change during execution or cannot be read consistently
- **THEN** the outcome is recorded but is not reusable as fresh evidence

### Requirement: Existing manual testing exceptions retain their meaning

Evidence SHALL distinguish full, narrowed, skipped-no-command, not-run, failed and accepted-preexisting-failure outcomes. It MUST NOT infer missing commands, turn narrowed success into full-suite success, or accept agent self-approval. Failure acceptance MUST reference an observed explicit user authorization scoped to the named failure and baseline; without trustworthy provenance enforcement remains unresolved.

#### Scenario: Missing command
- **WHEN** verifier configuration is absent or its command is empty
- **THEN** no process runs and evidence records `skipped (no test_command)`, which completion accepts with a warning

#### Scenario: Resource-constrained run
- **WHEN** a resource rule requires a narrowed command and it succeeds
- **THEN** evidence includes the original command, actual narrowed command, scope and reason and completion accepts that disclosed outcome

#### Scenario: Explicit acceptance
- **WHEN** an observed user message accepts the same named failure reproduced on unchanged baseline code
- **THEN** acceptance references that message and baseline result without changing the failed exit code
- **AND** an agent-written acceptance flag alone cannot satisfy completion enforcement

### Requirement: Completion checks are explicit and bounded

Completion enforcement SHALL apply only to an explicit genuine apply-completion intent bound to change/session/task identity. It SHALL check fresh verification evidence and a current semantic handoff receipt, never mark tasks, and request at most one corrective follow-up per intent. It MUST bypass discussion, partial progress, pauses, cancellation, errors and manual stop; observe mode only reports findings.

#### Scenario: Stale evidence at completion
- **WHEN** enforce mode receives explicit completion intent with stale evidence or handoff
- **THEN** a supported adapter requests one corrective follow-up explaining the missing evidence
- **AND** a repeated failure reports unresolved completion and releases control without another automatic turn

#### Scenario: Ordinary conversation or user interruption
- **WHEN** a tool stop or agent end has no completion intent, or the user pauses/cancels/stops
- **THEN** the hook neither blocks termination nor starts work

#### Scenario: Platform cannot continue safely
- **WHEN** the adapter cannot distinguish completion from cancellation or cannot return a bounded follow-up
- **THEN** it reports manual verification required and never claims enforced completion

### Requirement: Pre-edit scope checks use explicit approved context

The scope handler SHALL validate intercepted edit paths against explicit change, task, role and allowed roots plus the content revision covered by approval. It MUST cover conductor and subagents, respect review-disabled profiles, and never select a change by mtime or use `gate-check --staged` as its pre-edit primitive. Unknown context or unsupported writes SHALL be reported as incomplete coverage.

#### Scenario: Approved task edit
- **WHEN** an edit belongs to the bound task's Files and role with a current approved artifact revision
- **THEN** the handler permits it, including a parent implementer writing code directly

#### Scenario: Drift or scope escape
- **WHEN** a visible proposed edit escapes allowed roots, belongs to another task, or uses stale approval
- **THEN** enforce mode denies that intercepted edit and observe mode records the violation

#### Scenario: Review-disabled profile and invisible writes
- **WHEN** review is explicitly disabled, or shell/MCP writes cannot be inspected before execution
- **THEN** disabled review is not fabricated as a failure and unsupported coverage is diagnosed
- **AND** post-edit reconciliation and existing Git/CI checks remain backstops, without a claim of sandboxing

### Requirement: Scoped checks coalesce writes without recursive automation

Only explicitly configured scoped formatter/check commands SHALL run after edits. They MUST be debounced, serialized per worktree, bounded by timeout, limited to owned task files and suppressed for their own events. Full suites MUST NOT run per write. Commands unable to guarantee write scope MUST run in a disposable copy with only permitted patches imported.

#### Scenario: Burst and recursive events
- **WHEN** several edits arrive during one debounce window and formatter output emits more events
- **THEN** one queued job handles the latest scope, at most one successor handles subsequent edits, and formatter events do not recurse

#### Scenario: Outside-scope formatter effect
- **WHEN** a command in the disposable copy modifies a file outside the permitted scope
- **THEN** no outside-scope patch is imported and the violation is reported

### Requirement: Automatic synchronization preserves foreign content

`update --sync`, `sync --owned`, and an explicitly enabled managed-source handler SHALL use one locked ownership-aware synchronization service. It SHALL generate mirrors and Amp wrappers from canonical sources, update only managed destinations, delete only unchanged previously owned stale files, preserve foreign/modified content and report conflicts. Unflagged legacy sync behavior SHALL remain unchanged.

#### Scenario: Update finishes with local IDE delivery
- **WHEN** `update --sync` succeeds without conflicts
- **THEN** Cursor/Claude native agents and applicable skills/commands plus Amp wrappers match canonical sources without a separate shell step

#### Scenario: Initial adoption and deletion
- **WHEN** the destination has an unrecorded custom file, an identical generated counterpart, and a modified previously managed file
- **THEN** the custom file is preserved, the identical counterpart can be adopted, and the modified file is preserved with a conflict
- **AND** later deletion of a source removes only its unchanged owned counterpart

#### Scenario: Concurrent synchronization
- **WHEN** update and a managed-source event overlap
- **THEN** one worktree mutation lock serializes generation and copy operations, and failed writes retain recoverable ownership state

### Requirement: Workflow outcomes are local and auditable

Workflow handlers SHALL emit bounded local blocked/completed/repeated-error notifications and runtime audit entries with evidence freshness, check duration, suppression and conflict reasons. Notifications MUST be deduplicated and contain no external delivery or raw environment secrets. Documentation SHALL reuse existing opt-in after-merge archive CI without introducing autonomous merge, publish or rollout actions.

#### Scenario: Repeated errors
- **WHEN** one handler fails repeatedly for the same worktree/session/reason
- **THEN** the local summary coalesces repeated notifications and shows actionable diagnostics without sending messages elsewhere

#### Scenario: Completion telemetry
- **WHEN** a completed outcome is supported by current evidence
- **THEN** the local record identifies that outcome and verification scope without claiming full success for a narrowed run
