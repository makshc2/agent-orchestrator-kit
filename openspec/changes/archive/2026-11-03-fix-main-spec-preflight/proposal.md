# Early validation of resulting main specs

## Why

Change validation can accept a long MODIFIED requirement that fails strict main-spec validation only after archive sync. Existing main-spec blockers can also fail an unrelated archive. Agents are not told the 500-character description boundary, and different OpenSpec versions classify the finding differently.

## What Changes

- Preview all resulting main specs during Tier 1, using the consumer's installed OpenSpec and preserving strict severity.
- Identify existing blockers outside the change; preserve working specs and clean up the temporary preview.
- Teach the authoring boundary and preserve existing behavior when planning a separate migration.
- Pin the kit's current development OpenSpec version; document consumer version/lockfile consistency.

## Non-goals

- Migrate existing long main specs, alter archived changes, upgrade consumer dependencies, or disable strict.
- Change the archive rollback/final validation contract or validate other active changes in the preview.
- Commit, publish, or archive this implementation automatically.

## Acceptance criteria

1. A MODIFIED description of 501 characters is caught before apply with OpenSpec 1.14.1; 500 characters and long scenarios pass.
2. The preview includes unchanged main specs and names blockers outside this change.
3. REMOVED and RENAMED/MODIFIED operations are validated after sync, without modifying original files.
4. Invalid, incomplete, or failed CLI output cannot produce a green gate; temporary files are removed.
5. OpenSpec 1.4.1 INFO remains advisory; 1.14.1 WARNING remains blocking under strict.
6. The existing test suite and compatibility tests pass; generated instructions explain separate legacy migration.
