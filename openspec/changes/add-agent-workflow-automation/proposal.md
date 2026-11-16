## Why

Agents currently repeat checks, rely on self-reported test freshness, and require a separate IDE sync after updates. The hook runtime proposed in `add-agent-hook-runtime` provides a shared integration point; workflow handlers can use it to reduce routine work without changing default gates or granting agents new authority.

## What Changes

- Record configured verification commands with working-tree fingerprints, outcomes and explicit exceptions; reuse only fresh evidence.
- Add opt-in completion and phase/scope checks covering the conductor and subagents (with a narrow parent progress-write allowance), with bounded follow-up (one per work epoch, two per intent) and an unconditional manual-stop escape.
- Debounce configured scoped formatting/checks and serialize them with owned-file synchronization.
- Add `update --sync` and `sync --owned` to synchronize managed IDE files while preserving foreign content.
- Report blocked/completed/repeated-error events locally through the runtime audit channel; reuse existing opt-in after-merge archive CI.
- Configure every workflow policy through the frozen `hooks.policies.<id>` entry (`enabled`, `mode`, policy-owned file-backed `options`); all six policies guard effects on global/per-policy enablement and decisions act only under global `hooks.mode: enforce`, per-policy `mode: enforce` and client capability `deny`/`followup`, otherwise they are an advisory finding.

## Capabilities

### New Capabilities

- `agent-workflow-automation`: Evidence capture, bounded completion/scope policy, scoped checks, owned sync and local notifications built on the shared runtime.

### Modified Capabilities

- `apply-test-discipline`: Permit explicitly enabled completion-hook enforcement while retaining existing CLI gate exclusions, default instruction-only behavior and manual test exceptions.

## Non-goals

No second hook dispatcher, adapter installation system, skill loader or session snapshot implementation, and no rename or extension of the frozen v1 runtime contract (EventV1/ResultV1 fields, store levels, `ctx` fields, capability names). No auto-approve, auto-commit, publishing, autonomous task ticking, merges, fleet rollout, Phase 4 (hosted orchestration, dashboards, RBAC, sandbox) or external messages. No full test suite after every edit or guarantee that hooks intercept every shell/MCP write. No changes to legacy unflagged sync deletion semantics or the existing after-merge CI pipeline.

## Acceptance criteria

1. Evidence distinguishes stale, narrowed, skipped-no-command and explicitly user-accepted failures; staged, unstaged, relevant untracked and verification-input changes invalidate freshness.
2. Disabled behavior remains unchanged; observe mode never blocks. A decision takes effect only with `hooks.mode: enforce`, the policy's `enabled: true` and `mode: enforce`, and a client capability `deny` (tool.before) or `followup` (agent.end); otherwise the runtime downgrades it to a finding. Enforce mode checks genuine completion only and cannot trap pauses, errors or user cancellation in a retry loop.
3. Scope checks use explicit task/role/change identity and live committed APPROVE (including design-brief currency and review-only revocation), while the parent (direct `implementer`/`conductor`/`implementation` bind) keeps a narrow allowance to tick checkboxes and write handoff.md for its bound change only; unsupported event capabilities are reported honestly.
4. Edits only invalidate full verification evidence and schedule explicitly configured scoped checks; full tests run only through `hooks verify`. Identity-separated jobs use atomic startup and a shared owner-token lease without self-deadlock. Completion confirms semantic handoff explicitly and revalidates current inputs outside dispatch with bounded follow-ups. Persisted producer outcomes feed local sanitized notifications. Scoped checks coalesce edits without recursive hooks or writes outside owned scope. Owned sync preserves foreign files and detects conflicting local modifications.
5. Tests cover contract compatibility, evidence invalidation, bounded retries, worktree-lease mutual exclusion (including events without a session) and sync ownership on every profile (generic, mvp, node, vue3) and every client with its real gaps (Amp without compaction events, Cursor without resume/reset, Claude without file.changed and without agent.end followup); existing tests remain green.

## Impact

`add-agent-hook-runtime` is implemented, merged and archived (`openspec/changes/archive/2026-11-16-add-agent-hook-runtime/`); its v1 contract is frozen in `docs/agent-hooks.md` section "Extension contract" and this change adds handlers on top without altering it. Adds workflow modules and tests; extends CLI options and generated apply guidance through canonical templates. No new external service or required network access.
