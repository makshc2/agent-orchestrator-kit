# Session Handoff

## Closed role
Implementer

## Change
- name: add-agent-workflow-automation
- status: applied
- tasks: 15/15
- review: APPROVE
- last_role: Implementer

## Done
- All 15 tasks are checked. The hook runtime stays opt-in: shipped profiles keep hooks disabled and observe, and enforcement is an explicit config change.
- Verification runs only from `hooks verify`. A write marks evidence stale and does not spawn `verifier.test_command`. Evidence omits handoff, checkpoint, metrics, and decisions, and stores no command text or output.
- `hooks complete --confirm-handoff` is the only receipt. A later verification outcome invalidates it. Agent end stays pending until the worker rechecks the fingerprint. One follow-up per work epoch and two per intent. `user_cancelled` drops pending correction. Claude prints the manual CLI fallback.
- Scope allows checkbox-only `tasks.md` and `handoff.md` for a direct explicit bind of implementer, conductor, or implementation on the bound change. Token-linked children and other roles stay denied. The hook does not tick tasks.
- Owned sync renders into staging, preserves conflicts, and is reached by `sync --owned` and `update --sync`. Unflagged sync and the update hint line stay. The worker starts from enqueue, an enabled event, lease release, or `hooks worker --recover`.
- `npm test -- --test-concurrency=1` passed 652/652. `npm pack --dry-run` packed `agent-orchestrator-kit@0.22.1` (116 files). Strict OpenSpec validation of this change passed. Results are in `verification.md`.

## Decisions
- A completion receipt is written only with `--confirm-handoff`. Verification outcomes advance the sequence that invalidates it; completion outcomes do not, so persisting validation does not immediately stale the receipt.
- The follow-up budget is one store record per intent: one claim per work epoch and two claims total. `user_cancelled` is a stop bypass and cancels pending completion work.
- Owned sync compares staged bytes and never calls the legacy live-tree sync. Conflicts stay on disk and the CLI exits nonzero.
- No lifecycle fixture or config switch enables user authorization. Unverified payloads keep deny and follow-up downgraded.
- Policy `options` stay a single-line JSON object. Invalid options disable that policy.

## Blocked
none

## Next command
`npx agent-orchestrator-kit archive add-agent-workflow-automation --sync`

## Next role
none

## Attach
- `openspec/changes/add-agent-workflow-automation/tasks.md`
- `openspec/changes/add-agent-workflow-automation/verification.md`
- `openspec/changes/add-agent-workflow-automation/apply-notes.md`

## Subagents to spawn
- none

## Constraints
- language: en
- do not mix phases; the archive command runs in a terminal after the PR is merged
- retain frozen v1 contract; no auto-approve, auto-commit, publishing, fleet rollout, or Phase 4
- archive and CI templates were not modified

## Runtime
- runtime: local
- agent_id: none

## Prompt

```text
npx agent-orchestrator-kit archive add-agent-workflow-automation --sync
```
