# Verification — add-agent-workflow-automation

Local opt-in only. Shipped profiles keep `hooks.enabled: false` and `hooks.mode: observe`. Enforcement is an explicit config change. Merging a pull request, publishing the package, and rolling the kit out to other repositories are separate actions. The existing opt-in after-merge archive jobs (`templates/.github/workflows/agent-verify.yml`, `templates/.gitlab/agent-verify.yml`) still run `archive <name> --sync --if-ready`. This change does not edit those workflows.

## Commands

```bash
npx agent-orchestrator-kit hooks verify --change <name> --session <id> [--agent <id>] [--narrow-command <command> --reason <text>]
npx agent-orchestrator-kit hooks complete --change <name> --session <id> [--agent <id>] [--task <id>] [--confirm-handoff]
npx agent-orchestrator-kit sync --owned [--target cursor|claude|amp|all]
npx agent-orchestrator-kit update --sync [--target cursor|claude|amp|all]
```

`hooks verify` is the only full test run. A file write marks change-level evidence stale and does not spawn `verifier.test_command`. Evidence fingerprints omit `openspec/changes/<id>/{handoff.md,checkpoint.json,metrics.json,decisions.md}` after checkbox normalization of `tasks.md`. A reusable record must be a stable full, narrowed, or skipped-no-command result whose input digest still matches. Timeout, drift, and a missing command are not success.

`hooks complete` without `--confirm-handoff` does not mint a receipt. `--confirm-handoff` is the explicit semantic confirmation. A later verification outcome invalidates that receipt. An agent end stays pending until the worker repeats the fingerprint check; a previous CLI snapshot is not success. One follow-up is allowed per work epoch and two for the same intent. Pause, error, cancel, and `user_cancelled` drop pending correction. Claude has no parent Stop follow-up, so the CLI prints that manual fallback.

`sync --owned` and `update --sync` copy owned IDE files and exit nonzero on a conflict. `update` without `--sync` still prints `Run ./scripts/sync-local-agent-skills.sh to sync to local IDE`. `templates/scripts/sync-local-agent-skills.sh --owned` uses the installed local CLI and does not download a package.

## Configuration

Policy `options` are one single-line JSON object. Invalid options produce `hooks.policy.config.invalid` and force that policy off. Defaults stay disabled and observe. Timeouts are integers from 1 to 300000, debounce from 0 to 5000, and notification dedup from 1 to 300000.

The worker starts only from enqueue, an enabled workflow event, a normal CLI lease release, or `hooks worker --recover`. A startup reservation lasts 5 seconds and is renewed while the worker runs. Each job envelope expires within five minutes. There is no timer that recovers a dead worker without one of those triggers.

## Clients

| Client | Fixture used in tests | Enforced gap |
| --- | --- | --- |
| Claude | command hook, no version pin | `file.changed` is unsupported and `agent.end` cannot follow up |
| Cursor | `cursor_version` `3.22.12` | no `session.resume` and no `context.reset` |
| Amp | plugin API, no compaction events | no compaction events and no `file.changed` |

Unverified payloads downgrade deny and follow-up. No lifecycle fixture turns on user authorization. Cursor and Amp can carry a follow-up only when the verified capability says so.

## Local outcomes

Notices are sanitized diagnostics. Stored fields are the diagnostics allowlist: status, digest, durationMs, eventId, identity ids, a stable code, and a fixed message. Freshness, scope, conflict, command text, and secrets are not separate fields. Narrowed verification uses the narrowed message. A conflict is a nonblocking finding. Disable leaves the bounded outcome queue in place until the 24 hour / 256 entry retention drops it.

## This run

- `npm test -- --test-concurrency=1` at load 2.40 and 17782 MiB available: 652 passed, 0 failed, `duration_ms` 113715. The handler budget in `test/hooks-workflow-policy-wiring.test.js` was the 200 ms limit because load was under half of the 12 cores.
- Profile and client integration: 19976 ms. Completion cancel and drift: 3694 ms. Outcome delivery: 1875 ms. Policy wiring: 1898 ms. Lease loss and owned sync: 7643 ms, including the 5 second wait while another owner held the lease.
- `npm pack --dry-run`: `agent-orchestrator-kit@0.22.1`, 116 files, packed 284.5 kB.
- `npx --no-install openspec validate add-agent-workflow-automation --strict --type change`: valid.
