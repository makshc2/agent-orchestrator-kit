## 1. Dependency and policy registration

- [ ] 1.1 Verify the shipped runtime and register disabled workflow policies
  Files: bin/, profiles/, new file: bin/hooks/policies/workflow.js, new file: test/hook-workflow-contract.test.js, new file: openspec/changes/add-agent-workflow-automation/verification.md
  Do: First verify add-agent-hook-runtime is merged and archived, then compare its shipped API with this change's design.md section 1; stop for plan amendment on drift. In dependency-provided bin/hooks/policies/index.js register verification/completion/scope/checks/owned-sync/workflow-notifications PolicyV1 modules using the shipped dispatcher arbitration: decisions require global hooks.mode and enabled policy mode explicitly enforce plus event capability support; cancellation always bypasses continuation. Add disabled observe defaults to all profile configs without changing adapters or built-in context delivery.
  Done-when: node --test test/hook-workflow-contract.test.js verifies API v1, unchanged off/observe behavior, explicit dual opt-in, capability downgrade and cancellation; dependency merge/archive evidence is recorded in this change's verification.md before implementation continues.

## 2. Verified execution and bounded completion

- [ ] 2.1 Capture verification commands and stable working-tree evidence
  Files: new file: bin/hooks/workflow/evidence.js, new file: bin/hooks/workflow/fingerprint.js, new file: test/hook-verification-evidence.test.js
  Do: Implement the configured-command runner from project root with real exit/signal/timeout and pre/post/current fingerprints of tracked index and working-tree bytes, all nonignored untracked files by default, explicit ignored inputs, command/config/lockfiles, declared environment digests and tool identity. Record command references/digests, actual scope and observed counts; exclude hook state/declared generated outputs and explicitly listed active-change progress artifacts, normalize task checkboxes while retaining contract text, retain separate raw handoff/task hashes for completion, reject unstable reads, and never use HEAD alone or persist environment secrets. Perform hashing/execution outside dispatch and reject reuse after any relevant input or command change.
  Done-when: node --test test/hook-verification-evidence.test.js passes staged/unstaged/untracked/config/lock/env invalidation, equal unchanged-input reuse, final-task/handoff progress without a rerun loop, concurrent-write detection and timeout cases with unchanged HEAD.

- [ ] 2.2 Preserve test exceptions with verifiable user acceptance
  Files: new file: bin/hooks/workflow/test-outcomes.js, new file: bin/hooks/workflow/user-authorization.js, new file: test/hook-test-outcomes.test.js
  Do: Model full/narrowed/skipped-no-command/not-run/failed/accepted-preexisting-failure results. Never infer a command; record narrowed command, scope and resource reason. Accept a pre-existing failure only with baseline evidence plus a matching named failure and explicit observed user-role authorization from a supported host transcript/API; store an ID/digest receipt, not transcript text. Agent flags and unverified claims are rejected; unsupported provenance reports manual resolution required without changing the real failed exit.
  Done-when: node --test test/hook-test-outcomes.test.js covers missing commands, narrowed green outcomes, real authorized baseline failure, agent self-approval rejection and unsupported provenance; statuses remain compatible with existing apply-test-discipline scenarios.

- [ ] 2.3 Verify genuine completion and semantic handoff with bounded follow-up
  Files: new file: bin/hooks/workflow/completion.js, new file: test/hook-completion.test.js
  Do: Store explicit completion intent bound to change/session/agent/task with current handoff/tasks/input digests and post-work semantic handoff receipt; technical snapshots or mtime alone cannot satisfy it. At supported completed end events check current evidence and handoff; observe reports, enforce requests at most one follow-up per intent/fingerprint, then releases control with unresolved status. Repeated unchanged intents share the budget; bypass discussion, partial progress, pause, cancellation, errors and unknown stop reasons, and never tick tasks or run tests through handoff/archive/gate-check.
  Done-when: node --test test/hook-completion.test.js verifies stale/current handoff and evidence, preserved skip/narrowed/authorized-failure outcomes, duplicate intent limits, unsupported capabilities and unconditional user-stop escape.

## 3. Scope and local work scheduling

- [ ] 3.1 Check explicit task scope and approval revision before visible edits
  Files: new file: bin/hooks/workflow/scope.js, new file: test/hook-scope.test.js
  Do: Consume explicit hooks bind identity and task Files for both conductor and child agents; canonicalize allowed roots/paths, role and current approval content revision using existing review-currency rules, ignoring checkbox-only progress when hashing task contracts. Observe reports and enforce denies visible unbound/outside-scope/stale-approval writes; honor review-disabled profiles. Never choose a change by mtime or invoke gate-check --staged as pre-edit authorization; diagnose shell/MCP coverage gaps and reconcile observed paths without rollback.
  Done-when: node --test test/hook-scope.test.js covers parent/child bindings, stale artifact approval, checkbox progress, path/symlink escapes, mvp review-disabled behavior and unknown shell writes without fabricated compliance.

- [ ] 3.2 Queue debounced scoped commands under a worktree lease
  Files: new file: bin/hooks/workflow/jobs.js, new file: bin/hooks/workflow/checks.js, new file: test/hook-scoped-jobs.test.js
  Do: Use the runtime store's atomic transact operation on `ctx.storeFor('worktree')` for a deliberately worktree-scoped jobs lease (one shared namespace for every writer in the worktree, including null-session events) with owner/expiry/recovery; serialize mutating jobs and coordinate verification with a queue barrier. Execute only configured formatter/check command IDs with globs, 500ms default debounce and 30s default timeout; coalesce bursts and at most one successor, suppress own-origin events, and never launch a full suite per write. Run unsafe-to-scope formatters in a disposable current-tree copy and import only owned task-file patches after unchanged-source checks; discard conflicting imports.
  Done-when: node --test test/hook-scoped-jobs.test.js proves coalescing, no recursive jobs, bounded timeout/crash recovery, formatter-versus-verification serialization, lease contention by a null-session writer on the same worktree namespace, and no outside-scope or concurrent-user-change overwrites.

## 4. Owned synchronization and local outcomes

- [ ] 4.1 Implement ownership-aware generation and IDE delivery
  Files: bin/agent-orchestrator.js, new file: bin/hooks/workflow/owned-sync.js, new file: test/hook-owned-sync.test.js
  Do: Reuse or export current instruction-mirror/Amp-wrapper generators and destination mappings without invoking legacy mirror-all sync. Under the jobs lease, maintain a source/destination/delivered-digest manifest; adopt identical or verifiably generated counterparts, atomically copy managed destinations, and delete only unchanged owned stale files. Preserve foreign files/JSON keys/spend hooks and modified-owned conflicts, reject path escapes, journal manifest transitions, and report conflicts as nonzero for explicit CLI calls and findings for event handlers.
  Done-when: node --test test/hook-owned-sync.test.js covers initial adoption, unknown/modified files, stale-owned deletion, namespaced commands, Amp wrappers, concurrent sync, interrupted writes and preservation of unrelated IDE configuration across generic/mvp/node/vue3 fixtures.

- [ ] 4.2 Expose safe CLI entry points and local workflow notifications
  Files: bin/agent-orchestrator.js, templates/scripts/sync-local-agent-skills.sh, new file: bin/hooks/workflow/notifications.js, new file: test/hook-workflow-cli.test.js
  Do: Add hooks verify/complete bound to explicit change/session and optional agent, with disclosed narrowed-command/reason options; add sync --owned and update --sync with target selection using the shared owned-sync service. Add an optional shell --owned entry that resolves the installed CLI locally, while preserving unflagged legacy behavior. Wire managed-source events to the queue and blocked/completed/repeated-error outcomes to runtime audit/notify with deduplication, freshness/scope/duration/conflict metadata and no raw transcripts/environment values or external delivery.
  Done-when: node --test test/hook-workflow-cli.test.js verifies one-command update and native/Amp synchronization without a shell follow-up, command scope binding, legacy sync compatibility, locally coalesced notices and no network package lookup.

## 5. Guidance, integration checks and rollout documentation

- [ ] 5.1 Update canonical apply guidance and regenerate its mirrors
  Files: templates/.agents/commands/opsx-apply.md, templates/.agents/skills/openspec-apply-change/SKILL.md, test/apply-test-run-discipline.test.js, test/instruction-mirrors.test.js
  Do: Extend the canonical apply instruction with opt-in hooks verify evidence reuse and hooks complete intent after semantic handoff, while retaining the manual path, existing tests line forms, narrow/skip/user-acceptance rules and parent ownership of checkboxes. Reference installed policy configuration and explicit session/change binding. Regenerate skill mirror blocks through the kit generator rather than editing generated text; do not edit always-apply rules or templates/AGENTS.md.
  Done-when: node --test test/apply-test-run-discipline.test.js test/instruction-mirrors.test.js proves canonical/generated wording parity and unchanged default/manual test behavior.

- [ ] 5.2 Verify cross-policy races and platform capability fallbacks
  Files: new file: test/hook-workflow-integration.test.js
  Do: Add meaningful end-to-end fixtures using shipped runtime adapters for conductor and child events: edit invalidates evidence, formatter queues safely, sync preserves foreign content, completion needs a refreshed semantic handoff, and user cancel interrupts pending correction. Exercise multiple worktrees/sessions, malformed or missing identity, explicit enforce versus observe, supported user-message provenance and unsupported adapter capabilities without pretending every platform can block.
  Done-when: node --test test/hook-workflow-integration.test.js passes race/cancellation/isolation cases and records which host fixture/version supports each enforced event.

- [ ] 5.3 Document opt-in operation, existing archive CI and validation
  Files: README.md, new file: openspec/changes/add-agent-workflow-automation/verification.md
  Do: Document disabled/observe/enforce configuration, exact verify/complete/sync commands, evidence exclusions and freshness, acceptance provenance limits, manual-stop behavior, ownership conflicts, local audit and rollback. Point to existing opt-in after-merge GitHub/GitLab archive workflows without changing them; state that merge/publish/fleet rollout remain separate actions. Run npm test, npm pack --dry-run and strict OpenSpec validation; record platform fixture versions, dispatch/worker timings, dependency merge/archive evidence and results in verification.md.
  Done-when: npm test, npm pack --dry-run and npx --no-install openspec validate add-agent-workflow-automation --strict pass; README includes an executable local observe-mode trial and safe disable instructions, with no claim that twelve consumers were updated.
