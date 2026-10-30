# Apply notes: spec-verify-conformance-report

Critical constraints
- Prompt text added to `templates/scripts/verify-specs.sh` lives in an unquoted heredoc (`<<PROMPT`, line 101): no backticks, `$` or backslash in added text; keep `SPEC VERIFIER`; never `echo` `$AMP_API_KEY` / `$GITLAB_VERIFIER_TOKEN` (smoke asserts it).
- Under `set -euo pipefail`: Python extraction as `if ! python3 - "$RESPONSE_FILE" "$VERDICT_FILE" <<'PY'` / body / `PY` alone on its line / `then` next line; `sys.exit(1)` without traceback.
- GitLab: payload via `PAYLOAD_FILE=$(mktemp)` + EXIT trap + `python3 -c "…" "$PAYLOAD_FILE" <<< "$COMMENT_BODY"` + `--data-binary @"$PAYLOAD_FILE"`; never `--data "$COMMENT_JSON"` (E2BIG at 131 072 bytes, exit 126; reproduced).
- Every Python call that prints verdict text: `sys.stdout.reconfigure(errors='replace')` (single quotes inside `python3 -c "…"`, plus `import sys`).
- `skipped` / `inconclusive` label checks use `is True` (not `== True`); `type(line) is int and line > 0`; status derivation of `STATUS` stays `str(v.get('skipped',False)).lower() == "true"`.

Pitfalls
- Baseline `legacy` tests (1.1) run on the original scripts: inline `--data`, relative `artifacts/verdict.json`, so cwd = project root; assert invariants only, never the full body.
- Scope prompt-test assertions (output-example block, added text) and find the last `---` line for the ordering test (a Summary may contain `---`).
- Task 4.1 Done-when says "three limitations" but Do lists four; document all four, including the GitLab file transport.

Do NOT touch
- `templates/.github`, `templates/.gitlab` (verify with `git diff --exit-code`), `fix-main-spec-preflight`, main specs under `openspec/specs/`, other change files; no package publish, no real comments.

Verification
- `node --test --test-concurrency=1 test/spec-verify-conformance-report.test.js`; `node --test --test-concurrency=1 test/*.test.js`; `bash -n` on the three scripts; `git diff --check`; `npx openspec validate --all --strict`; `node bin/agent-orchestrator.js gate-check --review spec-verify-conformance-report --json`.
