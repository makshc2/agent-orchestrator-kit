# Validation: spec-verify-conformance-report

Date: 2026-10-30. Environment: Linux, Node v22.22.0, Python 3.14.4, mawk 1.3.4, OpenSpec 1.4.1 (local `node_modules`).

| # | Command | Result |
|---|---------|--------|
| 1 | `node --test --test-concurrency=1 test/spec-verify-conformance-report.test.js` | exit 0; tests 38, pass 38, fail 0 |
| 2 | `node --test --test-concurrency=1 test/*.test.js` | exit 0; tests 403, pass 403, fail 0, cancelled 0, skipped 0 (includes the existing `test/smoke.test.js` init/update opt-in delivery scenarios) |
| 3 | `bash -n templates/scripts/verify-specs.sh templates/scripts/post-pr-verdict-github.sh templates/scripts/post-mr-verdict.sh` | exit 0. With several operands `bash -n` parses only the first file, so each script was also checked separately: `bash -n <script>` exit 0 for all three |
| 4 | `git diff --check` | exit 0, no output |
| 5 | `npx openspec validate spec-verify-conformance-report --strict` | exit 0; `Change 'spec-verify-conformance-report' is valid` |
| 6 | `npx openspec validate --all --strict` | exit 0; `Totals: 21 passed, 0 failed (21 items)` |
| 7 | `git diff --exit-code -- templates/.github templates/.gitlab` | exit 0; workflows and the blocking policy are unchanged |
| 8 | `node bin/agent-orchestrator.js gate-check --review spec-verify-conformance-report --json` | exit 0; `{"pass": true, "errors": []}` |

Task Done-when filters (same suite): `--test-name-pattern=legacy` 8/8 on the original scripts before any change and after all changes; `'prompt|skip|fallback'` 11/11; `'JSON|response'` 11/11; `'comment|legacy'` 21/21.

Mutation check (scratch copy outside the repo, not part of the suite): with the original three scripts 29 of 38 tests fail; each of these mutations fails at least one test: `== True` instead of `is True` for skipped/inconclusive, inline `--data` for the GitLab payload, truthy `line` instead of a positive `int`, `nl -ba` instead of `awk`, no `sys.stdout.reconfigure(errors='replace')` in the `python3 -c` extracts, no `|` escaping.

## Limits of the stub tests

- No LLM is called: a fake `amp` returns fixed fixture text, so the tests check the prompt contract (verbatim lines, output example, numbering, sensitive-file exclusion) and the handling of responses, not the semantic quality of a real verifier's classification, evidence or coordinates.
- No network: fake `gh` and `curl` capture the comment body, payload source and argv and return success (HTTP 201); GitHub's 65 536-character comment limit and GitLab API size limits are not exercised.
- Only sentinel tokens are used; a controlled `PATH` exposes only listed system tools and the fakes, so real Amp, gh and curl are unreachable. HOME/config are isolated per test project.
- No package was published and no real comment was posted.
