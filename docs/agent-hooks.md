# Agent hook runtime (opt-in)

The **agent hook runtime** connects Claude Code, Cursor and Amp lifecycle events to a small local dispatcher. It delivers stack skills, gives an advisory recovery briefing and keeps a local audit. It is **off by default** (`hooks.enabled: false`, `hooks.mode: observe` in every profile).

It is separate from the **Git pre-commit gate** (`hooks-setup` / `init --hooks`). That gate does not change, and enabling or disabling one never touches the other.

## Walkthrough: enable to disable (local, offline)

```bash
# 1. opt in for this project
#    .agents/orchestrator.yaml:
#      hooks:
#        enabled: true
#        mode: observe
npx agent-orchestrator-kit hooks enable --client claude    # or cursor | amp
npx agent-orchestrator-kit hooks status                    # per-client state, conflicts, state root

# 2. start a session; the injected start context shows
#    [aok-hooks] native session id: <id> (claude session_id)
npx agent-orchestrator-kit hooks bind --change <name> --role implementer --task 1.2 --session <id>
#    → prints a single-use binding token (expires within 1 hour)
#    pass it in each child spawn prompt; the child links with its events or:
npx agent-orchestrator-kit hooks bind --token <token> --session <id> --agent <child-id>

# 3. optional technical snapshot (HEAD, changed paths, bound task, artifact digests)
npx agent-orchestrator-kit hooks snapshot --session <id>

# 4. inspect, update, roll back
npx agent-orchestrator-kit hooks status --json             # includes recently seen native session ids (advisory)
npx agent-orchestrator-kit update                          # refreshes owned hook assets, never enables hooks
npx agent-orchestrator-kit hooks disable --client claude   # removes only kit-owned entries
```

The launcher (`scripts/agent-hook-launcher.cjs`) resolves the locally installed kit package. It never runs network `npx`, never installs anything and never blocks a session. If the runtime is missing you get a diagnostic on stderr, and the manual workflow applies.

## What it does

| Behavior | Detail |
|---|---|
| Skill delivery | Full stack-skill files (no truncation), within a 32 KiB budget per event, only for an explicitly bound change/role/task. |
| Receipts | A receipt is written only after a valid response is emitted, and it records path, digest, session, agent, epoch and source. A content change or context reset invalidates it. Children never reuse parent receipts. |
| Submission is not compliance | `injected` means the content was submitted, not that the model read or followed it. Agent-reported reads stay `reported`. Partial or failed reads are not counted. |
| Overflow / unsupported events | The skill stays undelivered with a manual Read path. It is never labeled missing. |
| Recovery briefing | Reuses the `handoff --restore` sources with the same 4096-byte / 40-line bound. **No metrics are recorded.** It does not replace the canonical once-per-session restore and persist. |
| Snapshots | Technical observations in local hook storage, shown later as stale observations. `checkpoint.json`, `handoff.md`, `decisions.md`, `tasks.md` and `metrics.json` are never written. |
| Audit and retention | Local only, under `<git-dir>/aok-hooks/v1`, pruned by age and size. Only `.agents/hooks/ownership.json` is git-tracked. |

Manual fallback, which always applies: if hooks are disabled, the identity is unknown, the platform has no context-capable event, or there is no current same-context receipt, the agent manually Reads every resolved skill path and reports `Skills:` as read, injected or missing.

## Capability matrix (fixture-backed)

| Event | Claude Code | Cursor | Amp |
|---|---|---|---|
| session start | inject | inject (not cloud) | observe only |
| resume | inject (`source=resume`) | — | — |
| context reset | inject (`clear`/`compact`, PostCompact) | — | — |
| compacting | observe | observe | — |
| subagent start | inject | permission only | inject (`agent.start` message) |
| subagent end | inject (still observation) | followup | followup |
| tool before / after | deny / observe | allow/deny / observe | reject / observe |
| file changed | — | observe (`afterFileEdit`) | — |

`—` means unsupported. The runtime reports the gap, and the manual workflow covers it. Cloud agents and unlinked subagents get no injected content. An unverified payload shape is downgraded to observation.

## Extension contract (v1, frozen for `add-agent-workflow-automation`)

- **EventV1**: `{ schemaVersion: 1, kind, eventId, occurredAt, scope: { repoId, worktreeId, changeId, sessionId, agentId }, contextEpoch, source, data: { role, taskId, files, tool, outcome, stopReason } }`. `kind` is one of `session.start|resume|end`, `context.compacting|reset`, `agent.start|end`, `tool.before|after`, `file.changed`.
- **PolicyV1**: `{ id, events?, evaluate(event, ctx) }` → **ResultV1** `{ context[], findings[], decision }`, where decision is `allow|deny|followup|null`.
- **CapabilitiesV1**: `{ schemaVersion, client, clientVersion, runtime, events: { [kind]: { supported, injectContext, deny, followup, reason } } }`.
- **dispatch(event, { capabilities, store, config, policies, signal })**: 256 KiB input limit, 32 KiB context budget, 1500 ms deadline. Decisions take effect only with `hooks.mode: enforce`, `hooks.policies.<id>.enabled: true` and `mode: enforce`, and the client capability. Otherwise they are downgraded to an advisory finding.
- **Scoped store** (`ctx.store`, `ctx.storeFor(level)`): the levels form the hierarchy `worktree → session → agent`, and `change` is orthogonal to it.
  - `worktree` is one shared namespace for every writer, including null-session events.
  - A `session` or `agent` level whose id is null is quarantined by event id, with a diagnostic.
  - `change` requires an explicit binding.
- **`hooks.policies`** is reserved configuration for the second change.

## Rollout

1. Pilot in one isolated consumer project: `update`, then `hooks enable` for one client.
2. Watch `hooks status` and the local audit for a few sessions.
3. To roll back, run `hooks disable` and set `hooks.enabled: false`. Nothing else changes.

This change works on its own. The numbered roadmap phases stay unchanged, and external Phase 4 (hosted orchestration, dashboards, RBAC, sandbox) is out of scope. `add-agent-workflow-automation` may be planned now, but its apply requires this change to be merged and archived first. That change owns workflow guards, test/format automation, update/sync and post-merge archive. Fleet rollout is deferred. The runtime never prescribes auto approval, auto commit or publication.
