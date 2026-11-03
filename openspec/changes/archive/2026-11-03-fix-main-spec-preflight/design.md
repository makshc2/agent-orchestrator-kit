# Design

Reuse `planSpecSync` to build the exact contents archive writes. After change validation and sync conflict checks pass, `validateProjectedSpecs` copies all current main specs into a temporary OpenSpec root and overlays the plan. It runs the consumer CLI with `--no-install`, offline npm resolution, telemetry disabled, a timeout, and a bounded output buffer. A node_modules junction exposes the local or hoisted consumer installation without copying dependencies.

The helper requires a complete JSON report covering every expected spec exactly once. ERROR and WARNING are blocking; INFO is returned for human-readable diagnostics. The existing `{pass, errors}` JSON contract stays unchanged. Diagnostics distinguish files after delta sync from unchanged files outside the change. Missing CLI, process failure, malformed JSON, and filesystem failure fail closed. Cleanup is in `finally` and never follows the dependency junction.

Skip the preview when change validation or heading reconciliation already fails: that projection is not a valid candidate for archive. Other task/proposal errors do not suppress the preview. Archive keeps its final all-items strict check and rollback. New-capability Purpose text must itself satisfy the validator's minimum length, including for one-character names.

Do not implement a second Markdown parser or hardcode INFO/WARNING based on version. Keep the repository's current 1.4.1 development baseline exactly pinned rather than silently adopting 1.14.1 and forcing a migration of all existing specs. Run the new regression suite separately against both actual CLI installations. New authoring instructions explain the limit regardless of installed version. Existing long specs are a separately scoped migration, as requested by the user.

Mutation evals retain their frozen fixture data and real validator. Their narrow launcher additionally accepts exactly the projected-main-spec validation invocation. Existing stub-based tests return the requested spec JSON rather than text for this invocation.
