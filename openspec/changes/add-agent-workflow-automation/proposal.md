## Why

Agents currently repeat checks, rely on self-reported test freshness, and require a separate IDE sync after updates. The hook runtime proposed in `add-agent-hook-runtime` provides a shared integration point; workflow handlers can use it to reduce routine work without changing default gates or granting agents new authority.

## What Changes

- Record configured verification commands with working-tree fingerprints, outcomes and explicit exceptions; reuse only fresh evidence.
- Add opt-in completion and phase/scope checks covering the conductor and subagents, with bounded follow-up and an unconditional manual-stop escape.
- Debounce configured scoped formatting/checks and serialize them with owned-file synchronization.
- Add `update --sync` and `sync --owned` to synchronize managed IDE files while preserving foreign content.
- Report blocked/completed/repeated-error events locally through the runtime audit channel; reuse existing opt-in after-merge archive CI.

## Capabilities

### New Capabilities

- `agent-workflow-automation`: Evidence capture, bounded completion/scope policy, scoped checks, owned sync and local notifications built on the shared runtime.

### Modified Capabilities

- `apply-test-discipline`: Permit explicitly enabled completion-hook enforcement while retaining existing CLI gate exclusions, default instruction-only behavior and manual test exceptions.

## Non-goals

No second hook dispatcher, adapter installation system, skill loader or session snapshot implementation. No autonomous task ticking, approvals, commits, merges, publishing, fleet updates or external messages. No full test suite after every edit or guarantee that hooks intercept every shell/MCP write. No changes to legacy unflagged sync deletion semantics or the existing after-merge CI pipeline.

## Acceptance criteria

1. Evidence distinguishes stale, narrowed, skipped-no-command and explicitly user-accepted failures; staged, unstaged, relevant untracked and verification-input changes invalidate freshness.
2. Disabled behavior remains unchanged; observe mode never blocks. Explicit enforce mode checks genuine completion only and cannot trap pauses, errors or user cancellation in a retry loop.
3. Scope checks use explicit task/role/change identity and the approved artifact revision; unsupported event capabilities are reported honestly.
4. Scoped checks coalesce edits without recursive hooks or writes outside owned scope. Owned sync preserves foreign files and detects conflicting local modifications.
5. Tests cover dependency compatibility, evidence invalidation, bounded retries, concurrency and sync ownership across all supported profiles; existing tests remain green.

## Impact

Depends on `add-agent-hook-runtime` being implemented, merged and archived before this change is applied. The runtime remains independently useful. Adds workflow modules and tests; extends CLI options and generated apply guidance through canonical templates. No new external service or required network access. Review can occur while the dependency is proposed, but apply must recheck its shipped interface and amend this plan if it differs.
