## Purpose

Provide opt-in, capability-aware local hook automation that delivers agent context and records technical recovery facts without replacing the existing OpenSpec workflow.

## ADDED Requirements

### Requirement: Hook installation preserves existing integrations

The kit SHALL install hooks only by explicit client opt-in, default to observe mode, and remove or refresh only unchanged kit-owned entries. Existing foreign configuration, spend hooks, Git hooks, and disabled-client behavior MUST be preserved. Runtime events MUST use locally installed code without network installation.

#### Scenario: Repeat installation and removal
- **GIVEN** Claude, Cursor, or Amp has user hooks and Cursor spend integration
- **WHEN** hooks are enabled twice and then disabled
- **THEN** there is one owned installation per client, foreign entries and spend hooks retain their behavior, and Git hooks are untouched
- **AND** no global client settings are changed
- **AND** `hooks status` labels agent hooks distinctly from the unchanged Git pre-commit `hooks-setup`/`init --hooks` gate

#### Scenario: Conflicting installation
- **WHEN** configuration is malformed or an owned file has user edits
- **THEN** setup reports the conflict and preserves the original bytes
- **AND** an absent runtime produces a manual-workflow diagnostic without downloading packages

### Requirement: Ownership manifest is explicit and portable

The kit SHALL record owned hook entries with exact IDs/commands and content digests in a git-tracked `.agents/hooks/ownership.json` manifest. Enable, update, and disable MUST operate from that manifest. A clone or worktree with kit-shaped committed entries but no local manifest MUST adopt an entry only after exact digest verification against the expected owned entry, and MUST report non-matching kit-shaped entries as conflicts without rewriting them.

#### Scenario: Adoption after clone
- **GIVEN** a clone contains committed kit-owned entries and no local ownership manifest
- **WHEN** hooks are enabled or status is read
- **THEN** entries matching the recomputed expected owned digests are adopted into the manifest with a reported diagnostic
- **AND** enable and disable then manage them like any owned entry

#### Scenario: Unmanifested modified entry is a conflict
- **GIVEN** a kit-shaped committed entry differs from the expected owned content
- **WHEN** hooks are enabled, updated, or disabled
- **THEN** the entry is reported as a conflict, its bytes stay unchanged, and disable does not remove it

### Requirement: Adapters disclose verified capabilities

Each adapter SHALL normalize only version-tested native events and expose event-specific delivery, denial, and followup capabilities with reasons for unsupported behavior. Unknown versions, absent events, and cloud/subagent limitations MUST yield explicit fallback diagnostics rather than invented parity. Lifecycle events MUST retain their native meaning.

#### Scenario: Platform differences are visible
- **WHEN** status is read for supported Claude, Cursor, and Amp fixtures
- **THEN** Claude SubagentStart can deliver context but cannot deny spawning, Cursor subagentStart cannot inject context, Cursor cloud lacks sessionStart/sessionEnd, and Amp agent.end is not session.end
- **AND** unsupported context delivery supplies a manual read/briefing route

#### Scenario: Runtime version drift
- **WHEN** the installed version or payload does not match a recorded schema fixture/range
- **THEN** unsupported capabilities are diagnosed and only verified operations run
- **AND** no guessed response fields or synthetic session-end event are emitted

### Requirement: Policies share a versioned event and store contract

The runtime SHALL expose EventV1, CapabilitiesV1, PolicyV1, ResultV1, dispatch, and scoped stores under a versioned contract. Policies MUST register separately from adapters, use per-policy config, and return context/findings/decisions. Observe mode MUST neutralize deny/followup; unknown versions MUST NOT mutate state. Store levels SHALL be worktree, change, session, agent; hierarchy worktree→session→agent, change orthogonal; a null required id quarantines writes, never silent coarsening.

#### Scenario: Additive policy extension
- **WHEN** a fixture policy is added to the static policy registry with its own hooks.policies entry
- **THEN** it receives normalized events, scoped store access and capabilities without changes to adapters
- **AND** its deny/followup result becomes an advisory finding with an allowed operation in observe mode

#### Scenario: Generic decision arbitration remains opt-in
- **WHEN** a fixture policy requests deny or followup
- **THEN** it can be honored only with enabled policy, explicit global and per-policy enforce modes, and matching native capability
- **AND** user cancellation always permits exit, and the first delivery's built-in policies contain no workflow blockers

#### Scenario: Deliberately coarse worktree lease
- **WHEN** a policy opens `ctx.storeFor('worktree')` while another session's policy uses its own event-scoped store
- **THEN** both address the same worktree-level namespace for a jobs lease while their session/agent records stay isolated
- **AND** an event with a null session id addresses that same worktree namespace through `ctx.storeFor('worktree')`, contending on the lease instead of forking it, while its default store stays quarantined

#### Scenario: Unbound session keeps its own namespace
- **GIVEN** an event whose session has a native id but no bound change and no agent id
- **WHEN** its policy reads and writes the default `ctx` store before any `hooks bind`
- **THEN** records stay in a session namespace shared with no other session, and binding a change later does not move that namespace
- **AND** an event that also carries an agent id gets an agent-level default namespace isolated per agent

#### Scenario: Null session identity writes are quarantined
- **GIVEN** an event whose session id is null
- **WHEN** its policy uses the default `ctx` store or requests `storeFor('session')` or `storeFor('agent')`
- **THEN** writes land in a quarantined namespace keyed by the event id with a diagnostic and no later event can claim them
- **AND** `storeFor('worktree')` from the same event still addresses the real shared worktree namespace, and `storeFor('change')` works whenever a change is bound, so coarse leases keep mutual exclusion for null-session writers

#### Scenario: Unattributed work
- **WHEN** session, task, child-agent linkage, or change identity is unavailable
- **THEN** the corresponding field is null with a diagnostic and no other agent's binding or records are selected
- **AND** shell operations with unknown affected paths remain explicitly unknown

### Requirement: Binding identity is handed off per client

The runtime SHALL echo the native session identifier (Claude `session_id`, Cursor `conversationId`, Amp thread id) in injected start context and status, and parent/child linkage SHALL use a binding token passed in the spawn prompt or confirmed via injectable start context. When no native id is available, identity fields MUST stay null with a diagnostic, no cross-event claims are made, and the manual skill/briefing workflow applies.

#### Scenario: Parent binds with the echoed native id
- **WHEN** a session starts on a supported client
- **THEN** the injected start context or status echoes the native session identifier and `hooks bind` records it as sessionId
- **AND** receipts and dedup for that session stay session-scoped

#### Scenario: Child linkage via binding token
- **GIVEN** a parent binding exists and the parent passes its binding token in the child spawn prompt
- **WHEN** the child's events or an explicit child `hooks bind --token` present the token
- **THEN** the child's own native identifier is linked to the parent binding and change-level context may be inherited
- **AND** an unlinked child inherits no change-level context and keeps its own delivery state

#### Scenario: Identity unavailable
- **WHEN** hooks are disabled, the runtime is cloud, or a payload carries no native identifier
- **THEN** sessionId/agentId remain null with a diagnostic while change/role/task may still be bound
- **AND** no cross-event delivery or dedup claims are made and the manual Read/briefing fallback applies

### Requirement: Hook state is isolated, atomic, and replay-safe

The runtime SHALL isolate records by repository, worktree, session, agent, and change; deduplicate identified occurrences/effects; and atomically persist state with bounded locks. Concurrent writes and interruption MUST preserve valid last-good records. It MUST NOT treat identical tool arguments as an occurrence ID or use local state as durable cloud handoff.

#### Scenario: Concurrent agents and retries
- **WHEN** two agents update records concurrently and one native occurrence is retried
- **THEN** neither loses the other's records, the retry does not duplicate its committed effects, and each context receipt remains agent-specific
- **AND** two separate reads with identical arguments remain distinct observed occurrences

#### Scenario: Interrupted write and worktree separation
- **WHEN** one write fails before rename and another worktree resumes
- **THEN** the prior valid record remains readable and the other worktree cannot inherit its binding
- **AND** corrupt/expired state is diagnosed without modifying semantic checkpoint or handoff files

### Requirement: Hook execution and diagnostics are bounded and local

Hooks SHALL cap input at 256 KiB, dispatch at 1500 ms, context at 32 KiB, and local retention at 30 days or 10 MiB per worktree. Invalid input, timeout, or storage failure MUST be visible and nonblocking in observe mode. Audit/notifications MUST use allowlisted metadata, remain local, and exclude transcripts, secrets and command arguments.

#### Scenario: Oversized or timed-out hook
- **WHEN** an event exceeds the input limit or a policy exceeds the deadline
- **THEN** the adapter returns its valid nonblocking fallback and reports a bounded diagnostic
- **AND** partial context is not marked delivered and the previous good state remains intact

#### Scenario: Retention and secret-bearing data
- **WHEN** audit reaches its retention bound or a payload contains environment values and tool output
- **THEN** old records are pruned with an eviction notice and only allowlisted metadata is stored
- **AND** there is no network/LLM call, outgoing message, or shell interpolation of payload text

### Requirement: Skills are selected for parent and subagent work

The resolver SHALL combine project.stack, skills.stack, explicit role/task Files, and first eligible file access/edit with data-only scope mappings. It MUST cover the conductor and independently scoped subagents, preserve Vue writer/testing scopes, conservatively load uncertain installed matches, and use installed equivalents for generic/Node. Missing files MUST be reported without blocking.

#### Scenario: Parent and child Vue work
- **WHEN** a parent implements a Vue task and its test-writer child has a separate testing task
- **THEN** parent selection includes javascript-core/vue-core plus matched store, API, router, composable, or Vite skills
- **AND** child selection includes javascript-core/vue-testing with independent delivery state
- **AND** a newly accessed router path adds the router skill even if absent from the original task Files

#### Scenario: Other stacks or missing skills
- **WHEN** generic/Node inventory has installed skills or a Vue mapping names an absent file
- **THEN** only the applicable stack's inventory/scopes are used and the missing path is reported nonblockingly
- **AND** unscoped installed stack entries are conservatively included for implementation/testing

### Requirement: Skill audit distinguishes delivery from compliance

The runtime SHALL distinguish full successful reads, full-content injection, and missing paths by digest and agent/context epoch. Queueing, truncation, unsupported injection, or attempted reads MUST NOT count as delivered. A current full-content receipt MAY replace duplicate reading, but no receipt SHALL claim model compliance. Changed content or reset context invalidates deduplication.

#### Scenario: Full-content delivery and reset
- **WHEN** a skill fits a supported context response and the same agent requests it again in the same epoch
- **THEN** an injected receipt identifies path/digest/source and prevents redundant delivery
- **AND** a different agent, changed digest, or observed compaction causes fresh loading
- **AND** without platform acknowledgment the audit describes submitted delivery, not confirmed model consumption

#### Scenario: Missing delivery or partial read
- **WHEN** a skill exceeds available context, an adapter cannot inject at this event, or a read returns only part of the file
- **THEN** the receipt is not read/injected, the skill remains pending for a supported boundary, and manual Read paths are exposed
- **AND** an existing file is not mislabeled missing

### Requirement: Automatic briefing is metrics-neutral and bounded

Session/resume and supported context-reset hooks SHALL reuse local recovery sources and the existing provenance-aware briefing, capped at 4096 bytes and 40 lines. They MUST NOT invoke metrics-producing restore, choose an ambiguous change, or invent decisions. Unsupported reset/start events MUST retain an explicit manual restore fallback.

#### Scenario: Resume and compaction repeat
- **WHEN** startup, resume, and compaction delivery occur repeatedly for a bound change
- **THEN** briefing context is restored where supported and metrics pending/start/session counts stay unchanged
- **AND** handoff/checkpoint decisions and contradictions retain their provenance

#### Scenario: Ambiguous or unavailable context
- **WHEN** no change is bound or local cloud state is gone
- **THEN** the briefing reports the gap without selecting a change by recency or treating missing state as a clean session
- **AND** canonical git-tracked artifacts remain authoritative

#### Scenario: Session rule separates automatic briefing from canonical restore
- **WHEN** the always-apply session rule is read after this change
- **THEN** it distinguishes the automatic metrics-neutral briefing from the canonical once-per-session restore/persist without weakening that protocol
- **AND** its text still contains no `checkpoint` wording and the canonical protocol keeps its authority

### Requirement: Automatic snapshots preserve semantic progress

Observed file changes, agent returns, pre-compaction, and explicit snapshot requests SHALL persist technical facts separately from checkpoint.json. Snapshots MUST record source/time/identity and distinguish observations from current state; they MUST NOT write semantic progress, decisions, task completion, test success claims, or metrics. Recovery MUST report stale or absent observations honestly.

#### Scenario: Pre-compaction snapshot
- **GIVEN** checkpoint.json contains done, next, and unrecorded decisions
- **WHEN** a pre-compaction event writes a technical snapshot
- **THEN** HEAD, changed paths, bound task, source digests, and available outcome references are recorded atomically
- **AND** checkpoint.json, handoff.md, decisions.md, tasks.md, and metrics.json are byte-identical

#### Scenario: Resume after interruption
- **WHEN** the last technical observation predates current files or the latest write was interrupted
- **THEN** recovery uses only valid sourced records, labels their age, and reports uncertainty
- **AND** it does not infer passing tests or completed work from an agent-end event
