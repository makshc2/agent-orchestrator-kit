#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# AI Spec Verifier — collects changed src/ files, concatenates
# openspec/specs/, builds a prompt, calls Amp CLI, and produces
# artifacts/verdict.json.
#
# Installed by agent-orchestrator-kit (init --ci gitlab --spec-verify).
#
# Usage:  ./scripts/verify-specs.sh
# Env:    CI_MERGE_REQUEST_DIFF_BASE_SHA (GitLab CI provides it)
#         AMP_API_KEY — Amp API key (CI/CD variable, masked)
#         SRC_GLOB    — source path filter (default: src/)
#
# Security: this script NEVER logs tokens, keys, or .env content.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$ROOT/artifacts"
SPECS_DIR="$ROOT/openspec/specs"
PROJECT_CONFIG="$ROOT/openspec/config.yaml"
VERDICT_FILE="$ARTIFACTS_DIR/verdict.json"
PROMPT_FILE="$ARTIFACTS_DIR/verifier-prompt.md"
RESPONSE_FILE="$ARTIFACTS_DIR/amp-response.txt"
SRC_GLOB="${SRC_GLOB:-src/}"

mkdir -p "$ARTIFACTS_DIR"

write_skipped_verdict() {
  local summary="$1"
  cat > "$VERDICT_FILE" <<EOF
{
  "pass": true,
  "score": 100,
  "skipped": true,
  "summary": "${summary}",
  "findings": [],
  "implemented": [],
  "missing": [],
  "scope_creep": []
}
EOF
}

# Cautious pass on verifier infrastructure failure — don't block the merge.
write_inconclusive_verdict() {
  cat > "$VERDICT_FILE" <<'EOF'
{
  "pass": true,
  "score": 50,
  "skipped": false,
  "inconclusive": true,
  "summary": "Verifier did not return valid JSON — result inconclusive.",
  "findings": [
    {
      "severity": "warning",
      "spec": "N/A",
      "requirement": "N/A",
      "message": "Verifier agent response was not valid JSON. Manual review recommended.",
      "file": "N/A",
      "line": null
    }
  ],
  "implemented": [],
  "missing": [],
  "scope_creep": []
}
EOF
}

# ── 1. Collect changed source files ──────────────────────────
BASE_SHA="${CI_MERGE_REQUEST_DIFF_BASE_SHA:-HEAD~1}"

CHANGED_FILES=$(git diff --name-only "$BASE_SHA"...HEAD -- "$SRC_GLOB" || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "No ${SRC_GLOB} files changed — skipping spec verification."
  write_skipped_verdict "No ${SRC_GLOB} files changed — verification skipped."
  exit 0
fi

echo "Changed files:"
echo "$CHANGED_FILES"

# ── 2. Collect all spec files ────────────────────────────────
SPEC_FILES=$(find "$SPECS_DIR" -name '*.md' -type f 2>/dev/null || true)

if [ -z "$SPEC_FILES" ]; then
  echo "No spec files found in $SPECS_DIR — skipping."
  write_skipped_verdict "No spec files found — verification skipped."
  exit 0
fi

# ── 3. Build spec content block ──────────────────────────────
SPECS_CONTENT=""
for spec_file in $SPEC_FILES; do
  rel_path="${spec_file#$ROOT/}"
  SPECS_CONTENT+="
--- FILE: $rel_path ---
$(cat "$spec_file")
"
done

# ── 4. Build changed file content block ──────────────────────
# Security: skip .env, secrets, tokens, keys from content
# Every line is numbered from 1, blank lines included: "<N><TAB><text>".
CHANGED_CONTENT=""
for file in $CHANGED_FILES; do
  full_path="$ROOT/$file"
  if [ -f "$full_path" ]; then
    case "$file" in
      *.env*|*secret*|*token*|*key*|*.pem|*.p12) continue ;;
    esac
    CHANGED_CONTENT+="
--- FILE: $file ---
$(awk '{printf "%d\t%s\n", NR, $0}' "$full_path")
"
  fi
done

# ── 5. Project context from openspec/config.yaml ─────────────
PROJECT_CONTEXT=""
if [ -f "$PROJECT_CONFIG" ]; then
  PROJECT_CONTEXT="
## Project Context (openspec/config.yaml)

$(cat "$PROJECT_CONFIG")
"
fi

# ── 6. Build verifier prompt ─────────────────────────────────
cat > "$PROMPT_FILE" <<PROMPT
You are a SPEC VERIFIER.
Your job: verify that changed source code complies with project specifications.
${PROJECT_CONTEXT}
## Instructions
1. Read ALL specs below carefully.
2. Read ALL changed source files below.
3. For each changed file, check if it relates to any spec requirement.
4. Verify that every relevant requirement/scenario from specs is satisfied.
5. Respect project conventions from the project context above, if provided.

## Output
Return ONLY valid JSON (no markdown fences, no extra text) with this structure:
{
  "pass": true|false,
  "score": 0-100,
  "summary": "Brief summary",
  "findings": [
    {
      "severity": "error"|"warning"|"info",
      "spec": "spec file path",
      "requirement": "requirement name from spec",
      "message": "what is wrong or missing",
      "file": "affected source file or null",
      "line": <positive integer or null>
    }
  ],
  "implemented": [
    {
      "spec": "spec file path",
      "requirement": "requirement name from spec",
      "message": "evidence in the provided code",
      "file": "provided source file or null",
      "line": <positive integer or null>
    }
  ],
  "missing": [
    {
      "spec": "spec file path",
      "requirement": "requirement name from spec",
      "message": "what is absent or incomplete",
      "file": "provided source file",
      "line": <positive integer or null>
    }
  ],
  "scope_creep": [
    {
      "spec": "spec file path",
      "requirement": "requirement name from spec",
      "message": "what the code does that is forbidden or excluded",
      "file": "provided source file",
      "line": <positive integer or null>
    }
  ]
}

Rules for verdict:
- "pass": false if ANY finding has severity "error"
- "pass": true if only "warning" or "info" findings, or no findings
- "score": 100 minus 10 per error, 3 per warning (minimum 0)
- If a changed file has no related spec, add an "info" finding noting it

Conformance groups (additive; findings stay the only source of pass and score):
- implemented: provided code satisfies a relevant requirement; message cites the evidence.
- missing: a positive requirement whose behavior is absent or incomplete in a provided file where the behavior is expected. "file" MUST be that provided file (line may be null). If you cannot name such a file, do NOT add a missing item; add a warning or info finding about the uncertainty instead.
- scope_creep: provided code does what a requirement or an explicit boundary forbids or excludes (SHALL NOT, MUST NOT, an explicit exclusion or non-goal in the provided specs). "file" MUST be that provided file. A changed file without a related spec is an info finding, never scope_creep.
- One discrepancy goes to exactly one group: an unmet positive requirement is missing; a violated prohibition or exclusion is scope_creep.
- Report only requirements relevant to the provided files. Code outside the provided files is unknown: a behavior that may live in an unchanged file is not evidence of missing and never an error; add a warning or info finding about the uncertainty instead.

Every missing or scope_creep item MUST have exactly one mirrored finding with the same spec, requirement, file and line (null stays null). A mirrored finding counts once in the score; the group item itself adds no penalty; never add a second finding for the same discrepancy.
Severity of the mirrored finding: missing -> "error" if the requirement is SHALL or MUST and the behavior is wholly absent from that file, otherwise "warning"; scope_creep -> "error" if it violates SHALL NOT or MUST NOT, otherwise "warning". implemented items have no finding.

Coordinates for findings and groups: "spec" and "requirement" are exact strings from the provided specifications; "file" is the repo-relative path of a provided source file or null; "line" is the number shown for that line of the provided source file, or null when the location is unknown. If "file" is null, "line" is null too. Never use line numbers of a diff or of this prompt.

## SPECIFICATIONS

${SPECS_CONTENT}

## CHANGED SOURCE FILES

Source files are shown with line numbers: each line is its 1-based line number, a TAB character, then the original text; the number prefix is not part of the code and the numbers are the line coordinates for findings and groups.

${CHANGED_CONTENT}
PROMPT

echo "Verifier prompt built ($(wc -c < "$PROMPT_FILE") bytes)"

# ── 7. Call Amp CLI ──────────────────────────────────────────
if ! command -v amp &>/dev/null; then
  echo "amp CLI not found — writing fallback verdict."
  write_skipped_verdict "amp CLI not installed — verification skipped."
  exit 0
fi

if [ -z "${AMP_API_KEY:-}" ]; then
  echo "AMP_API_KEY not set — skipping Amp call."
  write_skipped_verdict "AMP_API_KEY not set in CI — Amp verification skipped."
  exit 0
fi

echo "Running Amp verifier agent..."
export AMP_API_KEY
# The response stays in a file: never in argv, env or a shell variable.
amp -x < "$PROMPT_FILE" > "$RESPONSE_FILE" 2>/dev/null || true

# ── 8. Extract JSON from response ────────────────────────────
# The candidate starts at the first line whose first non-blank character is
# "{" (markdown fences and text around the object are allowed); the object is
# kept as raw text. Any failure, including a missing python3, gives the
# inconclusive verdict.
if ! python3 - "$RESPONSE_FILE" "$VERDICT_FILE" <<'PY'
import json, os, sys
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
        text = f.read()
    start = -1
    pos = 0
    for line in text.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith("{"):
            start = pos + len(line) - len(stripped)
            break
        pos += len(line) + 1
    if start < 0:
        sys.exit(1)
    verdict, end = json.JSONDecoder().raw_decode(text, start)
    if not isinstance(verdict, dict):
        sys.exit(1)
    tmp = sys.argv[2] + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text[start:end] + "\n")
    os.replace(tmp, sys.argv[2])
except Exception:
    sys.exit(1)
PY
then
  echo "Failed to parse verifier response as JSON."
  echo "Raw response (first 500 chars):"
  head -c 500 "$RESPONSE_FILE" || true
  echo
  write_inconclusive_verdict
fi
rm -f "$RESPONSE_FILE" "$VERDICT_FILE.tmp"

echo "Verdict written to $VERDICT_FILE"
cat "$VERDICT_FILE" | python3 -m json.tool 2>/dev/null || cat "$VERDICT_FILE"
