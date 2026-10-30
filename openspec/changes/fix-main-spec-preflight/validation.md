# Validation — 2026-10-30

- `node --test --test-concurrency=1 test/*.test.js`: 365 tests executed; 363 passed, two failed because the expanded always-apply rule exceeded the existing 12,000-character budget. Condensed repeated workflow text without increasing the budget; the final total is 11,976 characters.
- `node --test --test-concurrency=1 --test-name-pattern='always-apply|templates: rules and AGENTS.md' test/smoke.test.js test/archive-from-terminal.test.js`: both previously failing checks passed after the correction. The full suite was not rerun after this text-only correction.
- Final `node --test --test-concurrency=1 test/spec-preflight.test.js` with local OpenSpec 1.4.1: 7/7 passed.
- Final preflight suite with a separately installed OpenSpec 1.14.1 via `AOK_TEST_OPENSPEC_MODULES`: 7/7 passed. No repository dependency was upgraded. Tests never install packages themselves.
- Real-CLI tests cover 500/501 characters, long scenarios, MODIFIED passing delta validation but failing projected main validation on 1.14.1, unchanged structural/length blockers, removal, rename-plus-modification, hidden directories, short new capability names, original file preservation, complete JSON reports, failed CLI execution, and temporary-file cleanup.
- Strict validation of `fix-main-spec-preflight`: passed using the pinned local OpenSpec.
- `node bin/agent-orchestrator.js gate-check --review fix-main-spec-preflight --json`: `{ "pass": true, "errors": [] }` using the pinned local OpenSpec. Existing long requirements remain INFO under 1.4.1; this does not claim that the repository passes 1.14.1 main-spec strict validation.
- All three profile/fallback config examples parse the new 500-character rule as a YAML string.
- `npm pack --dry-run --json`: passed; package includes `bin/spec-preflight.js`. No package was published.
- `git diff --check`: passed.

Existing main specs and archived changes were not migrated. The user chose to retain strict and handle legacy requirements in a separate migration. Implementation is local and uncommitted; no independent spec-review approval or archive is claimed.
