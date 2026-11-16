## Context

Apply is parent-driven (`templates/.agents/commands/opsx-apply.md`); subagent-only guards would miss most edits. `apply-test-discipline` explicitly excludes CLI test gates and permits disclosed narrowed runs, empty commands and user-accepted existing failures. `gate-check --staged` uses staged diffs and implicit change discovery, so it cannot serve as a pre-edit authorization primitive. Update generates mirrors/wrappers but asks users to run a separate shell sync. Legacy sync uses broad deletion, including whole Claude command directories. Existing GitHub/GitLab workflows already offer opt-in after-merge archive.

## Goals / Non-Goals

**Goals:** verifiable freshness, bounded optional workflow enforcement, scoped background checks, safe automatic IDE delivery and actionable local outcomes.

**Non-Goals:** another runtime, adapter protocol, semantic snapshot writer, approval source or CI archive implementation. No task ticks, automatic commits/merge/publish, external messages or fleet rollout. Legacy unflagged sync retains its existing contract.

## Decisions

### 1. Extend the shipped runtime; separate planning from execution

`add-agent-hook-runtime` must be merged and archived before apply. Read its archived design and shipped `bin/hooks/index.js`, `bin/hooks/policies/index.js`, configuration and capability fixtures in preflight. Stop for a plan amendment on interface drift. Its version-1 contract supplies `dispatch(event,{capabilities,policies,store,config,signal})`, `PolicyV1={id,events,evaluate(event,ctx)}`, `createStore({projectDir,scope})` with async `read/transact/append`, `ctx.notify`, a default `ctx` store derived from the event identity chain (agent level when session and agent ids are non-null, session level when only the session id is non-null, quarantined and keyed by the event id when the session id is null), `ctx.storeFor(level)` re-scoping — where the worktree level is one shared namespace for every writer in the worktree, including events with a null session id, so worktree-level leases stay mutual-exclusion domains — and `ResultV1` with context/findings/allow|deny|followup decision. Register workflow policies in `builtinPolicies`; do not replace adapters.

Use existing events `tool.before`, `tool.after`, `file.changed`, `agent.end`, `session.end`. Event scope is repo/worktree/session/agent/change; `data` carries role/taskId/files/tool/outcome/stopReason. Explicit `hooks bind` supplies task identity; missing identity remains unknown. Workflow-specific completion intent, approval revision, jobs and evidence live in separate store namespaces rather than invented event fields. Only exact mapped events with capability `deny` or `followup` can enforce. `stopReason:completed` alone does not establish apply completion, and unknown/cancelled/error stops always bypass completion continuation.

Configuration uses `hooks.policies.<verification|completion|scope|checks|owned-sync|workflow-notifications>={enabled:false,mode:observe,options:{}}`. Use the shipped generic arbitration: explicit global `hooks.mode:enforce` together with enabled per-policy `mode:enforce`; observe remains the default and workflow-specific policies supply the decisions. Unsupported capabilities produce findings, never a claim of enforcement. Fast hooks enqueue work; verification and checks run outside the 1500ms dispatch budget. CLI operations use the installed package, never per-event network npx.

### 2. Command evidence describes a real execution

Add `hooks verify --change <name> --session <id> [--agent <id>] [--narrow-command <command> --reason <text>]`. The base command is exactly `verifier.test_command`; no package-manager guess. Narrowing must record a resource restriction and actual scope. Runner invokes configured commands from the project root with timeout and captured exit/signal, retaining at most the last 20 output lines for immediate reporting. Persistent audit stores IDs, command digests and status, not raw command arguments/output. A local evidence record may store the configured/actual command text only as a reference to local configuration plus digest; secret-bearing overrides require redacted display and digest-only storage.

Fingerprint sorted path/type/mode/index-stage+blob/content digests for every tracked file and nonignored untracked file by default, plus explicit ignored inputs. Always include verifier config, command definitions, relevant lockfiles and config files. Include declared environment-variable digests (not values), Node/tool versions, platform and worktree identity. Exclude hook state, declared generated outputs, and explicitly listed active-change progress artifacts (handoff/checkpoint/metrics/decisions) from test inputs; hash the task contract with checkbox state normalized. Keep separate raw task/handoff digests for completion freshness. Code, configs, locks and task contract text cannot be excluded by this progress rule. Exclusion changes invalidate evidence and are disclosed, so writing the required handoff or ticking the final task does not force an endless test rerun. Narrow execution never silently narrows the input fingerprint. Record pre and post hashes using a retry-bounded stable enumeration/read; mismatch, read error, timeout or concurrent mutation makes evidence nonreusable. Before reuse recompute current inputs, command and execution scope; HEAD is metadata only. A change during a run remains a possible race, so immutable stable-snapshot execution is available for configured commands that tolerate it; hooks do not claim transactional isolation of external writers.

Evidence status separates success/failure/narrowed/skipped-no-command/not-run/accepted-preexisting-failure. Store base and actual command digests, scope, timing, counts only when observed, and reason. No-command skip remains acceptable with warning. Accepted failure retains the real nonzero exit, named failure, baseline evidence and authorization receipt. Validate the receipt against an actual user-role message from a supported host's local transcript or user-channel API, binding its ID/digest to the named baseline failure. Never trust an agent-supplied boolean or an unverified acceptance string. Unsupported provenance leaves automated acceptance unresolved and directs the existing manual workflow; it never fabricates authority.

### 3. Completion intent and handoff freshness

Add `hooks complete --change <name> --session <id> [--agent <id>]` to register a genuine completion intent after the conductor has written its semantic handoff. This is an assertion to verify, not permission to mark tasks. Capture handoff content digest, tasks content digest and relevant working-tree fingerprint; semantic freshness requires those digests to match current state and a handoff written/confirmed for this bound session after its last substantive task/evidence outcome. A matching old file mtime is insufficient. The runtime technical snapshot cannot substitute for handoff.md.

At a supported end event with explicit intent and completed reason, evaluate evidence and handoff. Observe emits findings. Enforce can issue one follow-up per intent; retry exhaustion records unresolved completion and returns control. Repeated complete commands with unchanged session/change/fingerprint share that budget. A substantive changed fingerprint permits a new intent only after an actual user/agent work turn, never a hook-only loop. User cancellation/manual stop/error clears pending continuation. Partial work and discussion do not create intent. If no safe interception exists, `hooks complete` prints findings for manual action; it does not launch turns itself. Existing handoff/archive/gate-check do not read test evidence or execute tests.

### 4. Explicit scope and approval currency

Scope policy reads exact bound change/task Files and role, canonicalizes planned file paths under allowed edit roots, and compares proposal/design/specs/task-contract content against the revision covered by approval. Reuse existing review-currency hashing semantics; checkbox changes are task progress, not silently new approved task contracts. Store normalized contract/revision when binding. Parent and child need their own bindings; explicit parent-child context inheritance does not grant task ownership. Review-disabled profiles continue to allow their normal phase flow.

For visible write paths enforce denies unbound/unknown scope, stale approval or forbidden role/path with an actionable reason; observe only reports. Never infer the newest change by mtime or call staged gate-check as authorization. Shell/MCP paths may be unknowable: record a coverage gap and reconcile observed changed paths afterward without destructive rollback. Git/CI remains independent. This is workflow assistance, not a sandbox.

### 5. One bounded worktree mutation queue

Checks options list explicit command IDs, executable/arguments, applicable globs, debounce (default 500ms), timeout (default 30s), and writable task paths; no inferred command. The worker holds a renewable worktree-wide lease using atomic `store.transact('jobs',...)` on the deliberately worktree-scoped store from `ctx.storeFor('worktree')` — one shared namespace for every writer in the worktree including null-session events, so a null-session writer can neither bypass nor fork the lease — with expiry/owner validation and bounded recovery. It serializes formatter/sync jobs; a shared read lease or queued barrier isolates verification from managed writes. Hold at most one pending successor per task; merge new paths and tag origin job IDs so worker events cannot re-enqueue themselves.

Run read-only checks without mutation. Formatters whose scope is not guaranteed run in a disposable working copy populated from the current tree (including uncommitted/untracked inputs); inspect their patch and import only permitted task-file changes if source fingerprints still match. On conflicting edits report and discard that import, never overwrite another agent's work. No full suite per write. A command not configured produces a visible skip, not an invented npm invocation.

### 6. Owned sync is an additive safe path

Add `sync --owned --target <cursor|claude|amp|all>` and `update --sync [--target ...]`. Both use one service and worktree mutation lease; an optional owned-sync policy enqueues it after managed-source edits. Generate instruction mirrors/Amp wrappers through existing generators, then create a planned destination mapping for native agents, skills, rules, namespaced commands and owned Amp settings entries. No broad rsync --delete or whole-directory removal in this path.

Manifest entries record source, destination and last delivered digest. First run adopts byte-identical counterparts or verifiably kit-generated files; unrecorded conflicts remain untouched. Delete only stale manifest-owned destinations still matching their delivered digest. Preserve user-modified owned files and foreign files, report conflicts and exit nonzero for an explicit CLI invocation; hooks report a nonblocking finding. Stage writes, use atomic renames and journal manifest transitions so crashes are recoverable. Symlink/path escape is rejected. Preserve foreign IDE JSON keys and spend-hook configuration. Legacy unflagged CLI/shell sync remains available and documented as the older mirror-all behavior; automation never invokes it. Optional `--owned` shell entry delegates locally to the safe CLI without downloads. No consumers are updated merely by implementing this feature.

### 7. Outcomes use existing local diagnostics

Use scoped `store.append('audit', record)` and `ctx.notify({code,message})`; no second telemetry store or service. Allowlist outcome, evidence ID/freshness, duration, duplicate/recursion suppression and conflict reason, avoiding environment values and transcripts. Coalesce blocked/completed/repeated-error notices by session/change/reason. Completed means verified scope, including disclosed narrowed outcomes. Document existing `pipeline.archive_after_merge` and installed CI workflows without altering their authority, execution or publication behavior.

## Risks / Trade-offs

- Fingerprinting large trees costs time → perform hashing outside dispatch, cache only with verified stat/content inputs and invalidate uncertain reads; report measured overhead.
- External writes can race jobs → leases cover kit work only; stable pre/post hashes and conditional patch import detect conflicts, and no universal isolation is claimed.
- Acceptance provenance varies by host → unsupported sources fall back to the existing explicit user workflow without self-approval.
- Safe sync cannot infer ownership of every old file → preserve ambiguous files and report first-run conflicts instead of deleting them.
- Enforcement can inconvenience users → off/observe defaults, one follow-up, capability checks and unconditional cancel bypass.

## Migration Plan

Apply only after runtime merge/archive and compatibility checks. Ship disabled policies and owned sync flags; validate in isolated fixtures for generic/mvp/node/vue3. Explicitly trial observe mode in a consumer before opting into supported enforcement. Roll back by disabling policies; retain evidence/audit for diagnosis, and remove only owned generated content through runtime lifecycle tooling. Existing manual commands and opt-in after-merge CI continue. Twelve-project rollout requires a separate user action.

## Open Questions

No product decision blocks proposal. Supported user-message provenance and platform enforcement variants must be pinned to tested host fixtures during implementation; unsupported variants remain manual.
