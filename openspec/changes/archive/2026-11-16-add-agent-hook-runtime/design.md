## Context

`opsx-apply.md` uses parent-driven implementation, so subagent-only delivery misses the main writer. Writer prompts now name skill files, but fresh contexts and platform differences still require an explicit delivery path. Existing `skills.stack` provides inventory, not file scopes. `ensureCursorSpendHook` already merges Cursor configuration; pre-commit setup remains separate. `collectRecoverySources` and `buildRecoveryBriefing` are reusable read-only helpers. CLI restore also records metrics; repeated hooks must not call that side effect. `checkpoint` replaces omitted fields, so automatic bare checkpoint calls would erase semantic progress.

## Goals / Non-Goals

**Goals:** independently useful opt-in context delivery, portable local lifecycle facts, observable compatibility, safe installation, and a small reusable extension boundary.

**Non-Goals:** enforcing completion/scope, tests/evidence, formatting, update synchronization, semantic handoff authoring, task checkboxes, remote notifications, external orchestration, or fleet rollout. `add-agent-workflow-automation` uses the extension boundary only after this change is merged and archived. Neither proposal changes the existing phase/role pipeline or launches roadmap Phase 4. Both hook changes are follow-on enhancements outside the numbered roadmap phases; the core workflow keeps Cursor, Claude Code, and Amp Code parity via manual fallbacks whether or not they are installed.

## Decisions

### 1. One local runtime, capability-aware adapters

Add packaged ESM modules under `bin/hooks/`. CLI `hooks enable --client <claude|cursor|amp>`, `hooks disable --client ...`, and `hooks status --json` manage opt-in installation and diagnostics; status labels this agent hook runtime distinctly from the existing Git pre-commit `hooks-setup`/`init --hooks` gate, which stays unchanged. A managed launcher resolves the installed package locally; never use network `npx` on an event. Keep the last working installation until replacement validates. Missing runtime means a visible diagnostic and manual workflow, not an installation attempt.

Add `hooks.enabled: false`, `hooks.mode: observe`, and reserved `hooks.policies: {}` defaults to templates and all profiles. Enable opts a client into context delivery and local recording; it does not enable enforcement. Store client install ownership and detected version/capabilities separately from user configuration; version/capability status is machine-local and lives in local hook state under the per-worktree hook-state directory (`aok-hooks/v1`), never in the git-tracked ownership manifest, so clones do not churn committed bytes. Setup discovers the client version from supported local metadata or a bounded version command; runtime events can refine detection with protocol fields. A version is supported only by a recorded official-schema fixture/range; unknown or unverified combinations expose only verified capabilities and explain others as unsupported. Never equate a detected executable with complete hook support.

Install Claude entries in project `.claude/settings.json`, Cursor entries in `.cursor/hooks.json`, and the Amp project plugin `.amp/plugins/agent-orchestrator.ts`; `hooks enable --client cursor` merges `.cursor/hooks.json` with the owned-entry merge code only and never calls `ensureCursorSpendHook` (main spec change-metrics restricts it to init/update/sync/mcp-setup). Preserve unrelated keys/entries, spending hooks, and Git hooks. Ownership lives in a git-tracked `.agents/hooks/ownership.json` manifest (schema: `schemaVersion` plus per-client owned entries with exact IDs/commands, target files, and content digests); enable/update rewrite it atomically with the client files, and the manifest is committed so clones and worktrees share ownership proof. A clone or worktree that finds kit-shaped entries in committed client files without a local manifest adopts an entry only after recomputing the expected owned entry for this project and verifying an exact digest match (adoption is reported); kit-shaped entries that do not match are conflicts — reported, left byte-identical, never removed by disable. Do not substring-delete foreign hooks. Malformed configs or user-modified owned files produce a conflict report and no destructive rewrite. Disable removes only unchanged owned entries/files and leaves diagnostics/state available. No global IDE configuration writes.

Capability matrix is explicit, per event and runtime:

| Client | Delivery and lifecycle | Limitations/fallback |
| --- | --- | --- |
| Claude | SessionStart including resume/compact, SubagentStart context, verified pre-tool context, PreCompact facts | SubagentStart cannot deny a spawn; SessionEnd is cleanup, not proof of completion. |
| Cursor | sessionStart context, generic tool/file hooks, subagent observation, stop events | subagentStart has permission output, not context injection; cloud lacks sessionStart/sessionEnd. Use supported later events or manual skills/briefing. |
| Amp | plugin session.start, agent.start context, tool.call/result, agent.end | agent.end is request completion, not session end; no synthetic session.end or unverified subagent/compaction injection. |

Sources: [Claude hooks](https://code.claude.com/docs/en/hooks), [Claude skill preload](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents), [Cursor hooks](https://cursor.com/docs/hooks), [Amp plugin API](https://ampcode.com/docs/plugin-api). Apply must record exact runtime/schema versions tested. Schema drift is a capability downgrade, not guessed API parity. Native static skill preload is an optional delivery source when its full content and current digest can be established; dynamic scopes still use the resolver.

### 2. Version 1 extension contract

`bin/hooks/index.js` exports the following contract. This is the fixed dependency for the second change; adapters must not own policies.

```js
// All fields present; unavailable identifiers/metadata are null, not guessed.
EventV1 = {
  schemaVersion: 1, eventId, occurredAt, kind,
  source: { client, clientVersion, runtime, nativeEvent },
  scope: { repoId, worktreeId, sessionId, agentId, changeId },
  contextEpoch, // rotates after known compaction; unknown => null
  data: { role, taskId, files, tool, outcome, stopReason }
}
// kind: session.start|session.resume|context.compacting|context.reset|agent.start|agent.end|
// tool.before|tool.after|file.changed|session.end
// files: normalized worktree-relative paths; tool: {id,name,operation} or null
// operation: read|write|shell|other; outcome: {status,exitCode} or null
// outcome.status: success|failure|cancelled|unknown
// stopReason: completed|user_cancelled|error|unknown|null
CapabilitiesV1 = {
  schemaVersion: 1, client, clientVersion, runtime,
  events: { [kind]: { supported, injectContext, deny, followup, reason } }
}
PolicyV1 = { id, events, evaluate: async (event, ctx) => ResultV1 }
ResultV1 = {
  context: [{ id, text, sourcePath, contentDigest }],
  findings: [{ code, severity, message, paths }],
  decision: { action: 'allow'|'deny'|'followup', reason } | null
}
dispatch(event, { capabilities, policies, store, config, signal })
// -> {schemaVersion:1, context, findings, decision}; adapters serialize this.
createStore({ projectDir, scope })
// scope = { level: 'worktree'|'change'|'session'|'agent', repoId, worktreeId, changeId?, sessionId?, agentId? }
// The identity hierarchy is worktree -> session -> agent; change is an orthogonal
// namespace attribute (a change spans sessions, and a session may be unbound), so a
// session namespace never includes changeId and binding never moves it. Each level
// namespaces by its own id plus coarser hierarchy ids only:
//   worktree: repoId+worktreeId (change/session/agent ids are below the level, excluded)
//   change:   repoId+worktreeId+changeId (session/agent ids are below the level, excluded)
//   session:  repoId+worktreeId+sessionId (changeId is orthogonal, excluded)
//   agent:    repoId+worktreeId+sessionId+agentId
// A null id the requested level requires (changeId for change, sessionId for session,
// sessionId+agentId for agent) is unresolved identity: the store records a diagnostic
// and writes land in a quarantined namespace keyed by the event id that no later event
// can claim — never a silent coarser scope, never the shared worktree namespace.
// The worktree level never quarantines: every event in the worktree, including events
// with a null session id, addresses one shared worktree namespace, so worktree-level
// leases (the second change's jobs lease) are mutual-exclusion domains for all writers.
// -> read(namespace,key), transact(namespace,key, updater), append(namespace,record)
```

`ctx` supplies `capabilities`, `config`, a default store derived from the event identity chain — agent level when sessionId and agentId are both non-null, session level when only sessionId is non-null (an unbound session with a native id keeps its own session namespace, and a null agentId just means no agent granularity), and a quarantined store keyed by the event id with a diagnostic when sessionId is null (never the shared worktree namespace) — plus `storeFor(level)` re-scoping the same event ids, `signal`, and bounded local `notify({code,message})`. Allowed scope levels are exactly worktree, change, session, and agent; the identity hierarchy is worktree → session → agent, and change is an orthogonal namespace attribute, so a session namespace never includes changeId and binding never moves it. Deliberately coarse scope — for example the worktree-wide jobs lease the second change opens via `ctx.storeFor('worktree')` — is an explicit level choice with no adapter change: `storeFor('worktree')` is available to every event in the worktree, including events with a null session id, and addresses one shared worktree namespace, so worktree-level leases are mutual-exclusion domains for all writers and a null-session writer can neither bypass nor fork one. `storeFor('change')` is available whenever a change is bound (the session id is below that level and excluded), shared by all events bound to that change; `storeFor('session')` and `storeFor('agent')` require their defining session/agent ids. A null id the requested level requires is unresolved identity: the store records a diagnostic and writes land in a quarantined namespace keyed by the event id that no later event can claim (only a replay of the same event id sees them); quarantine never applies to the worktree level and never silently coarsens scope. Store operations are async; `transact` atomically supplies prior JSON or null and commits returned JSON under a per-key lock. Namespaces/keys are validated identifiers, never filesystem paths. `append` is an atomic event record, not an unsafe shared JSONL append. Policy configuration lives under `hooks.policies.<id>` with reserved `enabled`, `mode` (`observe` or a future explicit `enforce`), and `options` fields. Built-in policies register through the exported `builtinPolicies` array in `bin/hooks/policies/index.js`; no untrusted config JS loader or LLM evaluation. The dispatcher defaults to observe and normalizes every deny/followup decision to an advisory finding in that mode. The generic arbitration contract may honor deny/followup only when both global hooks.mode and that policy mode are explicitly enforce, the policy is enabled, and the event capability supports the action; user_cancelled always permits exit. First-change built-in policies return only context/findings, so no workflow guard is enabled by this change. Future workflow policies must use that explicit opt-in. Unknown protocol versions are diagnosed without mutation.

`files` contains only paths established by the adapter or explicit task binding. Shell commands with unknown writes remain `operation:shell` with an empty file list; this is never proof of scope compliance. The second change can add `verification`, `completion`, `scope`, and `checks` policy modules to that registry and `evidence`/`jobs` store namespaces without changing adapters. Long-running jobs execute outside `dispatch`; the hook runtime supplies no heavy test runner in this change. `agent.end` and `session.end` remain observations, never automatic task completion.

Scope derives repository/worktree identity from canonical Git paths plus project path. Bind `changeId`, role, task, and files with CLI `hooks bind --change <name> --role <role> --task <id> --session <id> [--agent <id>]` after the conductor selects a task; read its contracted Files field locally. Missing or ambiguous change/task stays null with a diagnostic; never choose the newest change. Parent bindings do not silently become a child's binding. Adapters require explicit parent/child linkage before inheriting change-level context, and each agent has its own delivery state. Without stable session identity, cross-event dedup/delivery claims are disabled rather than combined across sessions.

Identity hand-off: every adapter echoes its native session identifier — Claude `session_id`, Cursor `conversationId`, Amp thread id — in the context injected at session/agent start and in `hooks status --json` (injected start context is the authoritative source of a session's own identifier; status is advisory when several sessions share one worktree); the conductor copies that identifier into `hooks bind --session`. A parent cannot know a child's identifier before spawn, so parent/child linkage uses a short-lived binding token printed by `hooks bind`: the token is single-use, expires after a bounded TTL of at most one hour or upon first successful linkage, and the parent passes it in the child spawn prompt; the runtime links the child's own native identifier (echoed to the child wherever start context can be injected: Claude SubagentStart, Amp agent.start) once the child's events or an explicit child `hooks bind --token <token> [--agent <id>]` present it. Cursor subagents cannot receive injected context, so their linkage completes only from the prompt token and otherwise stays null. When no native identifier is available (hooks disabled, cloud, unknown payload), `sessionId`/`agentId` stay null with a diagnostic; change/role/task may still be bound, receipts and dedup make no cross-event claims, and the manual skill/briefing workflow applies.

### 3. Bounded state and event execution

Use `<absolute per-worktree git-dir>/aok-hooks/v1/` for local observations, receipts, and snapshots; non-Git projects use gitignored `.agents/.hook-state/v1/` installed with ownership tracking. State is not a durable cloud handoff and cannot satisfy existing git-tracked handoff/checkpoint requirements. Keep separate namespaces scoped by hashed repo/worktree/session/agent/change IDs; unresolved identifiers cannot select another agent's records.

Validate input up to 256 KiB, dispatch within 1500 ms, and cap context output at 32 KiB. Store 30 days or 10 MiB per worktree, pruning oldest terminal audit entries before receipts of live sessions; active receipts/snapshots are bounded to that overall budget with explicit eviction diagnostics. Use unique temporary files, fsync/rename, per-key locking with timeout and stale-lock recovery, and replay-safe event IDs. Dedup uses native stable occurrence IDs, or a persisted adapter invocation ID when available; repeated identical tool arguments alone must not collapse separate tool executions. On uncertain identity process safely and dedup idempotent effects by their own keys. Store and lock failures are visible but nonblocking in observe mode.

No arbitrary shell evaluation from event payloads. Files are canonicalized under the worktree; symlink escapes, traversal and out-of-project content are excluded. Audit only allowlisted event metadata, skill paths/digests, diagnostic codes, durations, and observed result status; never transcripts, file bodies, environment values, command arguments, or secrets. Local CLI status and optional client-native notices expose runtime failure or missing context, with once-per-code/scope notices. No outgoing network or messaging integration.

### 4. Skill selection, delivery, and truthful audit

Add data-only `templates/hook-skill-scopes.json` copied to `.agents/hook-skill-scopes.json`; install/update follows ownership rules. Entries contain stack selectors, role selectors, file globs, and skill names. Resolve `.agents/orchestrator.yaml` project stack and `skills.stack`, then match role/task Files and newly accessed file paths. Built-in Vue mappings retain javascript-core and vue-core for every implementation task; testing uses javascript-core and vue-testing; stores, API/Axios, routing, composables, and Vite match their skill scopes. Ambiguous Vue paths conservatively select the available Vue inventory. Generic/Node use declared installed stack skills and project scopes; no unconditional Vue dependency. Unscoped installed inventory is conservatively selected for implementation/testing instead of guessed by skill name.

Resolve at agent start, explicit binding, first eligible file read/write, and context reset; changed skills invalidate old receipts. For clients without a context-capable current event, queue for the next supported boundary and expose an immediate manual Read list. Do not claim delivery merely because queued. Compaction increments context epoch where observable; otherwise health explicitly marks reinjection coverage unknown and manual recovery remains available.

Full skill text enters the context only when it fits the delivery budget. Never truncate a skill and mark it delivered. Overflow yields paths to read and an `undelivered` finding. A receipt records path, content digest, agent/session/epoch, source (`hook` or confirmed native preload), and `injected` only after a valid context response is emitted; where platform acknowledgment is absent this means submitted delivery, not model consumption. `read` requires a successful observed full-file read of that exact digest, or the existing agent-reported read labeled as reported; partial/error reads are not proof. `missing` means the applicable path does not exist. Unsupported/queued/overflow delivery is neither missing nor injected. Receipts do not certify compliance.

Writer prompts retain mandatory Read fallback, existing Vue scopes, missing-is-nonblocking behavior, and references guidance. A valid receipt accompanying full current content in the same agent context satisfies loading without another identical Read. Source report fields become `Skills: read (paths), injected (paths), or missing (paths)` immediately after Status. Parent apply gets the same resolver/bind/manual fallback protocol, written as one byte-identical instruction block into both apply twins (`templates/.agents/commands/opsx-apply.md` and `templates/.agents/skills/openspec-apply-change/SKILL.md`): hooks disabled or identity unavailable → mandatory manual Read of the resolved skill paths; hooks enabled → bind change/role/task/session before implementing and accept injected content only with a current same-context receipt; platform without context-capable events → manual Read fallback. `/opsx:quick` follows `/opsx:apply` and inherits that wording; it gets no separate hook text or bind step. Regenerate instruction mirrors/native wrappers via existing generation; do not hand-edit generated artifacts.

### 5. Recovery observes facts without replacing meaning

Call `collectRecoverySources` plus `buildRecoveryBriefing` directly for session/resume/context-reset briefings. Preserve their 4096-byte/40-line limit, provenance, contradictions, and unknowns. Do not call metrics-producing `handoff --restore` from hooks; the canonical session protocol still owns its once-per-session restore/persist. Binding and repeated hook briefing never reset pending metrics.

On observed file changes, agent return, pre-compaction (`context.compacting`, distinct from the later `context.reset`), and explicit `hooks snapshot`, write a bounded technical snapshot: event IDs/time, HEAD, changed paths, task identity supplied by binding, source artifact digests, and observed command outcome references. Distinguish old observations from current state after resume. Exclude semantic `done/blocked/next/decisions` fields. Leave checkpoint.json, handoff.md, decisions.md, tasks.md, and metrics.json byte-identical. Store latest valid snapshot atomically, preserving last good state on interruption. Recovery may append a sourced local-facts notice; it cannot infer completed tests, passing validation, decisions, or task completion. Cloud loss of local state is reported as a gap; git artifacts remain authoritative.

## Risks / Trade-offs

- API drift and weaker cloud/subagent support → explicit version fixtures and manual fallback; no fabricated event parity.
- Successful submission cannot prove model attention → distinguish receipts from compliance and defer result enforcement.
- Many skills exceed the context budget → full-content receipts only, with visible paths for manual reads.
- Concurrent agents and crashes → per-worktree namespaces, locked atomic writes, no shared semantic checkpoint mutation.
- Shell writes bypass path hooks → report coverage gaps; Git/CI remain independent checks.
- Hook latency → bounded local work, no network/LLM and no tests on the hook path; benchmark fixture records elapsed dispatch and timeout handling.
- Editing the always-apply session rule follows repo precedent (`f7ee939`) and keeps the enforced `checkpoint` word test green, but a strict archive-time reading of session-checkpoint guidance could still flag the edit; the mitigation is that the rule's canonical restore/persist authority is preserved verbatim.

## Migration Plan

Ship disabled defaults and documentation first. Enable explicitly in an isolated consumer; verify install, context receipts, recovery and capability health, then disable to test rollback. Existing spend hooks continue unchanged. `update` can refresh already owned runtime assets but cannot enable hooks or rewrite foreign entries. Both proposals may exist for planning; execution is sequential: merge/archive this change, then review/apply `add-agent-workflow-automation`. Fleet rollout is a separate user action.

## Open Questions

None requiring a product decision. Exact supported client version ranges are established from locally recorded schema fixtures during implementation and exposed in status; unsupported environments retain manual operations.
