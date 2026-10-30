# Spec Review: spec-verify-conformance-report

Verdict: APPROVE

**Source:** Tier 2 (spec-reviewer role, template body from `templates/.agents/subagents/spec-reviewer.md`; the kit root is not an install, so there is no `.claude/agents`). Review cycle 3.

Tier 1 already passed (`gate-check --review` `pass: true`, `gate-check --tasks` ok, strict validate ok for the change and `--all`); Tier 1 classes are not re-checked here. All cycle-2 items (M8, m1-m6) are closed in the current files and were reproduced empirically in `/tmp/rv3` (scratch, outside the repo). No Blocker and no Major remain; six Minor notes and one accepted trade-off are listed below, none blocks apply.

## Checklist

- ✓ proposal ↔ design ↔ specs ↔ tasks consistency: AC1-AC7 (`proposal.md:43-49`) map to 2.1 (AC1-AC3, `tasks.md:10-13`), 2.1/2.2 (AC4, `:10-18`), 3.1 (AC5-AC6, `:22-25`), 4.2 (AC7, `:34-37`). The GitLab file transport appears in proposal `:13` and `:47`, design `:126`/`:140`, delta `specs/spec-verify-consumer/spec.md:184-189`, tasks 1.1 `:5`, 3.1(h) `:24`, 4.1 `:31`. The marker `"inconclusive": true`, the four labels (U+2014), heading order, escaping and `file:line` rules are identical in proposal, design §5, both deltas and 3.1.
- ✓ design behaviour ↔ delta requirement: each design behaviour has a requirement or scenario; two are covered only by a generic requirement line (m11).
- ✓ conflicts with main specs: both MODIFIED blocks keep every old scenario (measured: `spec-verify-consumer` 2/2 and `github-spec-verify` 3/3 old scenarios are present as exact text blocks, headings byte-exact); the other requirements of both main specs (`Spec verify CI fragment is blocking by default`, `update refreshes…`, the GitHub workflow requirement) are untouched; no other main spec (checked with `grep -n '^### Requirement:'` over all 20 capabilities) describes comment bodies or the verifier prompt. The CI `pass` evaluation (`templates/.gitlab/spec-verify.yml:21-26`, `templates/.github/workflows/spec-verify.yml:77-80`) and the artifact list are unchanged; `amp-response.txt` is removed before the job ends, so it never reaches `artifacts:` paths.
- ✓ no overlap with `fix-main-spec-preflight`: its deltas touch `artifact-mutation-evals` (MODIFIED) and the new `spec-preflight` (ADDED, 4 requirements); this change touches `spec-verify-consumer` and `github-spec-verify` only.
- ✓ requirement bodies ≤ 500 chars (measured): 356 / 402 / 395 / 363 / 424 / 356 / 309 (`spec-verify-consumer`), 315 (`github-spec-verify`). The new GitLab scenario sits in `Provider comments present compatible conformance groups` (`spec.md:155`, body unchanged at 356). No migration of old long main specs; strict is not weakened.
- ✓ Non-goals respected (`proposal.md:34-39`): no new gate, no CI/auth change, `init`/`update` already ship all three scripts (`bin/agent-orchestrator.js:53-62`); `test/smoke.test.js:671-687` stays green as long as no `echo … $AMP_API_KEY` / `echo … $GITLAB_VERIFIER_TOKEN` line appears.
- ✓ task self-sufficiency: every `Do:` carries its verbatim prompt lines, label table, escape and `file:line` rules, fixture list and shell shapes without `design.md`. Small gaps only in m7, m10.
- ✓ referenced paths exist: `docs/course-derived-plan-2026-10-29.md` (item 1, `:25`), `test/smoke.test.js`, `templates/scripts/*.sh`, `README.md` spec-verify sections (`:435-456`), `CHANGELOG.md` `## [Unreleased]` (`:5`); `validation.md` and the new test file are correctly `new file:`.
- ✓ new-defect scan (Do-step not executable, behaviour without delta requirement, drift, nonexistent paths): nothing blocking; see Minor m7-m12.

### Do-steps against the real scripts (reproduced in `/tmp/rv3`)

| Step | Result |
|---|---|
| E2BIG on the old transport (M8) | Real original `post-mr-verdict.sh` with a bash fake curl on PATH: verdict with one 22 000-letter Cyrillic `message` → `Argument list too long`, exit 126 (`post-mr-verdict.sh:105-110`, `set -euo pipefail` at `:14`); 21 000 letters (payload 126 KB) → exit 0. The fixture of `tasks.md:24(i)` (≈ 25 000 letters) gives a 150 012-byte `json.dumps` payload (6 bytes per letter, `ensure_ascii` default), so it triggers E2BIG on the old transport with margin (threshold ≈ 21 850 letters). The fake being a bash script does not avoid the limit: `execve` itself fails. |
| New transport (M8) | Same script patched as specified (`PAYLOAD_FILE=$(mktemp)`, `trap 'rm -f "$PAYLOAD_FILE"' EXIT`, `python3 -c "…" "$PAYLOAD_FILE" <<< "$COMMENT_BODY"`, `--data-binary @"$PAYLOAD_FILE"`): 22 000 and 25 000 letters → `MR comment posted successfully (HTTP 201)`, exit 0, capture source `file`, payload 150 361 bytes parses as JSON with `body` ending at the footer; temp file removed by the trap. A 9 MB payload through the here-string also works (no argv, no deadlock). The fake copying `@FILE` during the call is consistent with the trap deleting at script exit (the cap is read after exit, from the copy). |
| Payload writing step | `python3 -c "…" "$PAYLOAD_FILE" <<< "$COMMENT_BODY"` is executable as specified: `sys.argv[1]` is the path, body via stdin. The `python3 - path <<'PYEOF'` shape cannot also carry the body through stdin, but the existing `-c … <<< "$COMMENT_BODY"` shape (`post-mr-verdict.sh:97-101`) is the natural reading. |
| `errors='replace'` (m1) | Inside `python3 -c "…"`, `sys.stdout.reconfigure(errors='replace')` does not break the double-quoted shell string (tested literally as in the scripts). With `{"summary":"x\ud800y"}`: strict → `UnicodeEncodeError`, exit 1 (the old MR script aborts); with the fix → `x?y` in `$(…)`, through a pipe, in the `C` locale and with `PYTHONIOENCODING=ascii`. The heredoc form `errors="replace"` also works. |
| Extraction shape (m3) | `if ! python3 - "$R" "$V" <<'PY'` / body / `PY` / `then` under `set -euo pipefail`: fenced, compact, indented-with-trailing-text, 630 KB pretty objects extract (raw slice kept, 1500 items intact); same-line prefix, invalid first candidate, non-object, empty response, missing `python3` → fallback branch, script continues, rc 0; with `try/except Exception → sys.exit(1)` stderr is empty (no traceback). |
| Unquoted `<<PROMPT` (m4/m5) | All 8 verbatim prompt blocks of `design.md:35-39`, `:60-61` and the numbering sentence (`:68`) contain no backtick, `$` or backslash; passed through an unquoted heredoc they round-trip byte-identical (`"` and `->` are harmless). All 13 `«…»` quotes in `tasks.md` are clean, and every one except the absence-assertion «без подвійного штрафу» occurs verbatim in `design.md`. |
| Numbering | `$(awk '{printf "%d\t%s\n", NR, $0}' "$full_path")` inside `CHANGED_CONTENT+="…"` under `set -euo pipefail` on mawk 1.3.4: `\:\:\:`, `\:`, a blank line and a last line without `\n` are numbered 1..5 without resets. |

## Findings

### Blocker

none

### Major

none

### Minor

- **m7. `tasks.md:5-6` (1.1) Done-when is partly unverifiable on the original scripts.** The baseline `legacy` tests run on the original scripts, whose GitLab transport is inline `--data` (`post-mr-verdict.sh:109`), yet Done-when says the capture shows the payload "read from file/stdin". On the originals only `inline` can be observed; the file/stdin branches of the fake are first exercised in 3.1. Read as "the fake supports file/stdin" it is satisfiable by a self-test of the fake; read as an assertion on the original scripts it fails. Also: the original render blocks read the relative `artifacts/verdict.json` (`post-pr-verdict-github.sh:74`, `post-mr-verdict.sh:55`), so baseline tests must run with cwd = project root (not stated); and "the script removes the temp file after curl" (`:5`, `design.md:132`) is imprecise (the trap removes it at exit; harmless for the copy-during-call fake). Suggest rewording Done-when and adding cwd = root.
- **m8. `tasks.md:32` (4.1) Done-when counts "three limitations" while Do lists four** (`:31`: same-line prefix, GitHub 65 536 / print-only failure, GitLab file transport and non-fatal API refusal, `pass`-less verdict stays PASS). The GitLab file transport (a closure item of M8) could be dropped without failing a literal "three". Suggest "all four limitations, including the GitLab file transport".
- **m9. `skipped` / `inconclusive` "JSON true" has no stated test.** `design.md:98-105`, `:122`, `tasks.md:24(b)`. In Python `1 == True`, so an implementation using `== True` would label `{"skipped": 1}` as skipped while `STATUS` (`str(1).lower() == "true"`) says not skipped. Pin `is True` (as `type(line) is int` is pinned for `line`) and optionally add `{"skipped": 1}` to the fixtures.
- **m10. Prompt-test and ordering-test assertions need scoping.** `tasks.md:12(g)`: "added text contains no backticks/`$`" cannot be checked on the whole generated prompt (the template already has `${…}`, and the numbering fixture contains `\:\:\:`); assert on the added template segment or use a clean fixture. "Output example contains … and `"line": null` is absent" must be scoped to the JSON example block, because the verbatim paragraphs also mention the same words. `tasks.md:24(i)`: a free-text multi-line Summary may legitimately contain a standalone `---` line; the ordering test must locate the last `---` (footer), after `### Scope creep`.
- **m11. Two design behaviours are covered only by generic delta wording.** The lone-surrogate output rule (`design.md:124`) falls under `Некоректні дані MUST NOT піднімати виняток` (`spec.md:208`) with no scenario; the accepted `"skipped": "true"` mismatch (`design.md:122`, `tasks.md:24(b)`) is only in design/tasks. Both are asserted by task 3.1 tests and Done-when, so behaviour is pinned; an extra delta scenario for the surrogate would be tidy but is optional.
- **m12. Accepted trade-off: `Files:` keeps the `new file:` prefix for `test/spec-verify-conformance-report.test.js` in 2.1, 2.2 and 3.1** (`tasks.md:11`, `:16`, `:23`). The linter (`bin/agent-orchestrator.js:3560-3564`) only skips the existence check for `new file:` entries and errors on a plain path that does not exist yet; the file does not exist before 1.1, so the prefix is needed to keep `gate-check --tasks` green pre-apply, and it stays valid after 1.1 (the entry is skipped regardless). The `Do:` of each task says "extend the suite from 1.1, keep the baseline `legacy` tests" (`:12`, `:17`, `:24`), so there is no misreading risk. No action.
- Carried over, cosmetic: the `spec-verify-consumer` delta mixes an English MODIFIED block (forced by the English main heading) with Ukrainian ADDED blocks. Task 3.1 (`tasks.md:24`) is a single ≈ 8 KB line with nine sub-steps; Tier 1 budget passed, but the implementer should work through (a)-(i) as a checklist.

## Required Before Apply

none

## Previous findings

Cycle-2 Required Before Apply: RBA 1 = M8; RBA 2 = Minor items m1-m6.

| ID | Status | Evidence |
|---|---|---|
| M8 (RBA 1) GitLab payload from file/stdin, E2BIG | resolved | Transport `--data-binary @"$PAYLOAD_FILE"` (`@-` allowed), `mktemp` + EXIT trap, body via stdin: `design.md:126`, Risks `:140`, `tasks.md:24(h)`; fake curl contract `design.md:132` = `tasks.md:5` (file copy during the call, stdin, `inline` only for baseline `legacy`); fixture `tasks.md:24(i)` and Done-when `:25`; delta scenario `specs/spec-verify-consumer/spec.md:184-189` (requirement body still 356 chars); `design.md:140` no longer claims GitLab is always non-fatal; proposal `:13`, `:47`; README `tasks.md:31`. Reproduced: old script exit 126 at 22 000 letters, new transport HTTP 201 / exit 0 at 22 000 and 25 000. |
| m1 lone surrogate (RBA 2) | resolved | `design.md:124`, `tasks.md:24(g)` (`errors='replace'` single-quoted inside `python3 -c "…"`, `import sys`, all verdict-text calls incl. SUMMARY/STATUS/SCORE), fixture `"x\ud800y"` `:24(i)`, Done-when `:25`. Reproduced: no `UnicodeEncodeError`, quoting intact. |
| m2 single `skipped` definition (RBA 2) | resolved | `design.md:122` and `tasks.md:24(b)`: status unchanged, labels by JSON `true`, `"skipped": "true"` mismatch accepted, fixture `:24(i)`, Done-when `:25` (residual: m9). |
| m3 heredoc shape (RBA 2) | resolved | `design.md:78-88` and `tasks.md:17(b)`: `PY` alone on its line, `then` next line, `try/except Exception → sys.exit(1)`, invalid-first-candidate fixture and Done-when `:18`. Reproduced under `set -euo pipefail`. |
| m4 unquoted `<<PROMPT` (RBA 2) | resolved | No backtick/`$`/backslash rule `design.md:68`, `tasks.md:12(a)(e)`; numbering format written in words, sentence asserted verbatim `:12(g)`, Done-when `:13`; verified clean and round-trips (residual: m10 on test scoping). |
| m5 AC1 output example (RBA 2) | resolved | `tasks.md:12(a)` (three arrays, five fields, "positive integer or null" replaces `"line": null` at `verify-specs.sh:125`, no `inconclusive`), asserted in `(g)` and Done-when `:13`; `design.md:134`. |
| m6 test file "new file:" in four tasks (RBA 2) | resolved | "extend the suite from 1.1, keep the baseline `legacy` tests" in `tasks.md:12(g)`, `:17(g)`, `:24(i)`; the `new file:` prefix kept for the linter, accepted (m12). |
| B1 SKIPPED/inconclusive rendering | resolved | Marker `"inconclusive": true` and writer `design.md:76`, first-match label table `:96-107`, delta `specs/spec-verify-consumer/spec.md:164-182`, `tasks.md:12(f)`, `:24(b)`, proposal `:11`, `:46`, `:48`. |
| M1 no discriminator | resolved | Polarity rule `design.md:25-30`, verbatim prompt `:34-40`, delta `spec.md:31-56`, `tasks.md:12(b)`, proposal `:3`, `:8`, `:44`. |
| M2 severity undefined | resolved | Severity table `design.md:50-62`, delta `spec.md:62-73`, `tasks.md:12(c)`, proposal `:45`. |
| M3 findings robustness | resolved | `design.md:116-120`, delta `spec.md:206-236`, `tasks.md:24(d)-(f)`, fixtures `:24(i)`. |
| M4 transport to Python | resolved | `design.md:77-88`, `tasks.md:17(a)-(g)`, delta `spec.md:112-151` (above-limit response, same-line prefix, Python failure). |
| M5 output contract | resolved | `design.md:94-122`, `tasks.md:24(a)(c)(e)`, delta `spec.md:153-162`, `:206-236`, `specs/github-spec-verify/spec.md:5`, `:23-35`. |
| M6 `nl -ba` | resolved | `awk` with `NR` in `design.md:68`, `tasks.md:12(e)`, delta `spec.md:89-105`; reproduced on mawk 1.3.4. |
| M7 task 4.2 | resolved | `tasks.md:34-37`: eight named commands, `git diff --exit-code -- templates/.github templates/.gitlab`, `Files:` lists only `validation.md` (in Impact, `proposal.md:30`). |
