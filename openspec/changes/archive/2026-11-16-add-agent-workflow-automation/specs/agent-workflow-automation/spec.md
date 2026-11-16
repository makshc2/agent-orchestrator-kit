## ADDED Requirements

### Requirement: Workflow handlers extend the installed shared runtime

Workflow automation SHALL be registered as PolicyV1 modules in the shipped `builtinPolicies` registry and use the frozen v1 contract (EventV1, ResultV1, `ctx.store`, `ctx.storeFor`, `ctx.notify`) without renaming or extending it. Each policy MUST be configured by `hooks.policies.<id>` with `enabled` (default false) and `mode` (default observe).

#### Scenario: Independent opt-in
- **WHEN** runtime context delivery is enabled but workflow policies are absent or disabled
- **THEN** existing skill/recovery behavior continues without verification processes or enforcement

#### Scenario: Contract drift
- **WHEN** implementation preflight finds a v1 export or `ctx` field missing
- **THEN** apply stops with the precise gap instead of adding a competing dispatcher or renaming the contract

#### Scenario: Out-of-scope authority
- **WHEN** any workflow policy runs in any mode
- **THEN** it never approves a change, commits, publishes, ticks a task or starts fleet rollout, and Phase 4 features are not provided

### Requirement: Decisions require enforce mode and client capability

A workflow decision SHALL take effect only when global `hooks.mode` is `enforce`, `hooks.policies.<id>.enabled` is true, that policy's `mode` is `enforce`, and the client capability for the event kind allows `deny` (tool.before) or `followup` (agent.end). In every other case the decision MUST remain an advisory finding.

#### Scenario: Gate conditions
- **WHEN** an enabled scope policy returns deny while global mode is observe or the policy mode is observe
- **THEN** dispatch returns no decision and a `policy.decision.downgraded` finding

#### Scenario: Honest client gaps
- **WHEN** completion followup is evaluated for Claude (no agent.end followup and no parent Stop mapping, so the conductor's completion is unobserved), edit checks for Claude (no file.changed), resume handling for Cursor (no resume/reset) or compaction handling for Amp (no compaction)
- **THEN** the gap is reported as a finding with a manual fallback and no enforcement is claimed

#### Scenario: Every profile
- **WHEN** the same fixtures run against generic, mvp, node and vue3 profile configuration
- **THEN** disabled defaults, observe behavior and enforce gating are identical except for documented profile differences such as review-disabled mvp

### Requirement: Worktree lease jobs are mutually exclusive

Mutating workflow jobs (formatters, owned sync) SHALL hold one renewable lease taken by atomic transact on `ctx.storeFor('worktree')`, so at most one job holder exists per worktree at a time, including when the contending events carry no session id. Expired or crashed owners MUST be recoverable within a bounded time.

#### Scenario: Null-session contender
- **WHEN** a session-less event and a session-bound event request the lease concurrently
- **THEN** exactly one runs and the other queues or reports contention, because both address the same worktree namespace

#### Scenario: Verification and managed writes do not overlap
- **WHEN** a verification run holds the lease while a formatter or sync job is requested
- **THEN** the write job waits for release and no managed write happens during the run

#### Scenario: Crashed owner
- **WHEN** the lease owner stops renewing and the lease expires
- **THEN** the next job recovers it without overwriting the previous owner's completed result

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

Completion enforcement SHALL apply only to an explicit genuine apply-completion intent bound to change/session/agent/task identity, where the task id is read from the exact session/agent binding. It SHALL check fresh verification evidence and a current semantic handoff receipt, never mark tasks, and request corrective follow-ups bounded by the retry limits of the completion retry requirement (one per work epoch, two per intent). It MUST bypass discussion, partial progress, pauses, cancellation, errors and manual stop; observe mode only reports findings.

#### Scenario: Stale evidence at completion
- **WHEN** enforce mode receives explicit completion intent with stale evidence or handoff
- **THEN** a supported adapter requests one corrective follow-up explaining the missing evidence
- **AND** a repeated failure in the same work epoch reports unresolved completion and releases control without another automatic turn
- **AND** only a qualifying substantive edit that advances the epoch of the same intent permits one more follow-up

#### Scenario: Ordinary conversation or user interruption
- **WHEN** a tool stop or agent end has no completion intent, or the user pauses/cancels/stops
- **THEN** the hook neither blocks termination nor starts work

#### Scenario: Task identity comes from the binding
- **WHEN** `hooks complete` runs for a session with an explicit binding, with or without `--task`
- **THEN** the intent key uses the bound task id, and a `--task` that differs from the binding or a missing binding is rejected without recording intent

#### Scenario: Platform cannot continue safely
- **WHEN** the adapter cannot distinguish completion from cancellation or cannot return a bounded follow-up
- **THEN** it reports manual verification required and never claims enforced completion

### Requirement: Pre-edit scope checks use explicit approved context

The scope handler SHALL validate intercepted edit paths against explicit change, task, role and allowed roots plus the content revision covered by approval. It MUST cover conductor and subagents, respect review-disabled profiles, and never select a change by mtime or use `gate-check --staged` as its pre-edit primitive. Unknown context or unsupported writes SHALL be reported as incomplete coverage.

#### Scenario: Approved task edit
- **WHEN** an edit belongs to the bound task's Files and role with a current approved artifact revision
- **THEN** the handler permits it, including a parent implementer writing code directly

#### Scenario: Approval revision definition
- **WHEN** a session is bound with a clean committed APPROVE whose planning content is current
- **THEN** the binding stores review commit/content plus normalized proposal, design, optional design-brief, specs and task-contract digests, ignoring checkbox state
- **AND** every intercepted edit requires current APPROVE and matching review/planning identity; review-only rejection, deletion or modification revokes approval, and a new review commit requires rebinding

#### Scenario: Drift or scope escape
- **WHEN** a visible proposed edit escapes allowed roots, belongs to another task, or uses stale approval
- **THEN** enforce mode denies that intercepted edit and observe mode records the violation

#### Scenario: Review-disabled profile and invisible writes
- **WHEN** review is explicitly disabled, or shell/MCP writes cannot be inspected before execution
- **THEN** disabled review is not fabricated as a failure and unsupported coverage is diagnosed
- **AND** post-edit reconciliation and existing Git/CI checks remain backstops, without a claim of sandboxing

### Requirement: Conductor progress writes are narrowly authorized

Under enforced scope the handler SHALL permit a parent binding (direct bind, via explicit, with role implementer, conductor or implementation, no child token) to edit only the bound change's tasks.md (checkbox toggles) and handoff.md. It MUST deny the same writes for child bindings, any other change, other artifacts of the bound change and path escapes, and MUST NOT add a blanket openspec exemption.

#### Scenario: Normal edit then progress writes
- **WHEN** a parent bound with the role the apply command binds (implementer) to task 2.1 edits a file in that task's Files, then ticks its checkbox in tasks.md and writes handoff.md under enforce mode
- **THEN** all three intercepted writes are allowed and approval stays current because checkbox normalization leaves the approval digest unchanged

#### Scenario: Child and cross-change denial
- **WHEN** a token-linked child, or the parent targeting another change's tasks.md/handoff.md, proposal.md, design.md, specs or review.md of the bound change, or a symlink escape, attempts a progress write
- **THEN** enforce mode denies it and observe mode records the violation

#### Scenario: Non-checkbox tasks.md change
- **WHEN** a permitted tasks.md write changes task-contract text instead of only checkboxes
- **THEN** tool.after reconciliation records a scope violation and the planning digest mismatch makes later edits stale until rebinding

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

#### Scenario: Optional shell entry
- **WHEN** `scripts/sync-local-agent-skills.sh --owned` runs
- **THEN** it delegates to the locally installed `sync --owned` without any download, and the unflagged script keeps its legacy behavior

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

### Requirement: Policy options and review settings are file backed

The shared configuration reader SHALL preserve policy-owned options from orchestrator.yaml and expose the direct pipeline.require_spec_review switch, defaulting true. Unsupported or invalid options MUST produce a finding and disable the affected policy. The dispatcher SHALL interpret only enabled and mode.

#### Scenario: Real configuration round trip
- **WHEN** a checks policy has single-line JSON-flow options containing command arrays, arguments, globs, writable paths and timing values in .agents/orchestrator.yaml
- **THEN** the adapter and worker read the same validated values, and nested enabled/mode keys cannot change global settings

#### Scenario: Review switch defaults
- **WHEN** the direct pipeline flag is absent, invalid, commented or appears only in an unrelated nested section
- **THEN** review remains required; an explicit direct false disables only the approval check

#### Scenario: Invalid options
- **WHEN** an options value is malformed, uses unsupported multiline syntax or fails its policy schema
- **THEN** the policy reports configuration failure without executing commands or silently dropping settings

### Requirement: Disabled workflow policies have no effects

All six workflow policies SHALL check global hooks.enabled and their own enabled flag before any handler effect. Absent entries MUST be disabled. Queued automatic work SHALL recheck these flags before execution. Explicit user CLI operations remain available independently.

#### Scenario: Actual registry and adapters
- **WHEN** verification, completion, scope, checks, owned-sync and workflow-notifications receive real adapter events with the global flag false, their entry absent or their flag false
- **THEN** none invalidates evidence, writes workflow state, queues/spawns work, synchronizes files or notifies, while existing runtime behavior continues

#### Scenario: Disable after enqueue
- **WHEN** a policy is disabled before its queued automatic job starts
- **THEN** the worker cancels the pending job without executing its effect

### Requirement: Jobs retain identity and have bounded startup and drain

Queued jobs SHALL retain exact identity, binding, allowed files, command/options digest and origin metadata. Coalescing MUST separate different identities/scopes. Atomic startup reservation and one reusable owner-token lease SHALL cover workers and CLI services, with bounded drain and trigger-based crash recovery.

#### Scenario: Simultaneous jobs
- **WHEN** two processes enqueue jobs for different changes/tasks or command scopes simultaneously
- **THEN** only one startup reservation wins and starts a worker, each jobId resolves its own envelope, and no identity or writable paths merge across keys

#### Scenario: CLI and worker services share the lease
- **WHEN** checks arrive while CLI sync holds the lease, then a worker invokes owned sync
- **THEN** CLI release wakes pending work and the worker passes its validated owner token without reacquiring its own lease

#### Scenario: Drain and crash bounds
- **WHEN** two generations per key, 16 jobs or 60 seconds exhaust a worker's drain bound
- **THEN** remaining jobs stay queued for an atomically started successor and each envelope expires within five minutes
- **AND** enqueue, enabled event, CLI release or explicit worker --recover can recover a crashed lease/reservation within five seconds of that trigger; without a trigger no autonomous recovery is promised

### Requirement: Full verification requires explicit invocation

Write events SHALL only invalidate full verification evidence and schedule explicitly configured scoped checks or owned synchronization. Only explicit hooks verify SHALL execute verifier.test_command; completion refresh MUST hash inputs without running tests.

#### Scenario: Isolated edit
- **WHEN** one edit occurs with a full verifier.test_command configured and workflow policies enabled
- **THEN** no full-suite job or test process is started, even after the debounce expires
- **AND** a later explicit hooks verify executes that command under the shared lease

### Requirement: Semantic handoff confirmation and completion validation are explicit

Completion SHALL require an identity-bound receipt explicitly confirming semantic handoff after the latest substantive outcome. CLI completion and every genuine end event MUST validate current inputs outside dispatch. A cached CLI snapshot MUST NOT establish current completion; missing, changed or unstable inputs SHALL remain unresolved.

#### Scenario: Old identical prose
- **WHEN** an old handoff has identical bytes but no receipt for the current bound work/outcome
- **THEN** completion rejects it until explicit --confirm-handoff records identity, digests, work epoch and outcome sequence after semantic review; mtime and technical snapshots do not suffice

#### Scenario: Late external edit
- **WHEN** a shell or external editor changes an input after hooks complete and before the end event
- **THEN** that end event reports pending and queues a new fingerprint-only validation, whose mismatch produces blocked rather than completed outcome
- **AND** pre/post validation drift and timeout are unresolved, and success describes only the stable validation interval rather than universal writer isolation

#### Scenario: Unsupported client
- **WHEN** Claude cannot observe parent Stop or provide followup, or another client lacks safe completion continuation
- **THEN** hooks complete prints synchronous receipt/input findings and the manual fallback, and no background process launches a new agent turn

### Requirement: Completion retries cannot reset through automation

One completion intent is keyed by session, agent and bound task and persists across work epochs. Completion SHALL allow at most one corrective followup per work epoch and two per intent (bound task/session). Only a distinct observed non-worker substantive task edit may advance the epoch. Repeated commands, fingerprint changes, generated/progress edits and unknown-origin changes MUST NOT reset the budget; cancellation MUST stop pending continuation.

#### Scenario: Repeated automation
- **WHEN** complete/confirm/verify commands repeat or a formatter changes output after the first followup
- **THEN** the same budget stays consumed and no hook-only retry loop starts

#### Scenario: Actual work resumes
- **WHEN** a deduplicated non-worker tool.after event observes a substantive bound task-file edit after intent
- **THEN** one new epoch may permit correction, but the two-followup task/session cap still releases control when exhausted

#### Scenario: Same intent before and after an edit
- **WHEN** one intent fails at two end events in the same epoch, then a qualifying edit advances the epoch and two more end events fail
- **THEN** exactly one followup is requested per epoch, two in total, the second and fourth failures release control, and no automation advances the epoch

### Requirement: Workflow producers persist outcomes for local consumers

Scope, verification, completion, checks and sync SHALL persist identity-bearing bounded outcomes for notification consumption. End-event and worker consumers MUST use this transport rather than unavailable prior-policy results. Audit metadata SHALL survive the existing sanitizer through allowed fields and bounded messages, with no raw output, commands or secrets.

#### Scenario: Real producer and consumer
- **WHEN** a checks worker fails and a scope tool.before is denied, followed by an end event
- **THEN** the consumer reads their worktree workflow-outcomes records, routes only matching identity and emits deduplicated sanitized local notices
- **AND** a worker finishing after the end event invokes the same guarded drain without requiring another event

#### Scenario: Metadata survives sanitization
- **WHEN** stale evidence, narrowed verification, recursion suppression or a sync conflict is reported
- **THEN** status, digest, durationMs, code, message and identity fields retain those meanings without introducing unsupported audit keys

#### Scenario: Modified Amp generation
- **WHEN** owned generation encounters a modified Amp wrapper or stale directory containing one
- **THEN** staging and ownership checks preserve it as a conflict before any generator overwrite or directory deletion
