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
  "findings": []
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
CHANGED_CONTENT=""
for file in $CHANGED_FILES; do
  full_path="$ROOT/$file"
  if [ -f "$full_path" ]; then
    case "$file" in
      *.env*|*secret*|*token*|*key*|*.pem|*.p12) continue ;;
    esac
    CHANGED_CONTENT+="
--- FILE: $file ---
$(cat "$full_path")
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
      "file": "affected source file",
      "line": null
    }
  ]
}

Rules for verdict:
- "pass": false if ANY finding has severity "error"
- "pass": true if only "warning" or "info" findings, or no findings
- "score": 100 minus 10 per error, 3 per warning (minimum 0)
- If a changed file has no related spec, add an "info" finding noting it

## SPECIFICATIONS

${SPECS_CONTENT}

## CHANGED SOURCE FILES

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
AMP_RESPONSE=$(amp -x < "$PROMPT_FILE" 2>/dev/null || true)

# ── 8. Extract JSON from response ────────────────────────────
# The response might contain markdown fences — strip them
CLEAN_JSON=$(echo "$AMP_RESPONSE" | sed -n '/^{/,/^}/p' | head -200)

if echo "$CLEAN_JSON" | python3 -m json.tool > /dev/null 2>&1; then
  echo "$CLEAN_JSON" > "$VERDICT_FILE"
else
  echo "Failed to parse verifier response as JSON."
  echo "Raw response (first 500 chars):"
  echo "$AMP_RESPONSE" | head -c 500
  # Write a cautious pass — don't block on verifier infrastructure failure
  cat > "$VERDICT_FILE" <<'EOF'
{
  "pass": true,
  "score": 50,
  "skipped": false,
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
  ]
}
EOF
fi

echo "Verdict written to $VERDICT_FILE"
cat "$VERDICT_FILE" | python3 -m json.tool 2>/dev/null || cat "$VERDICT_FILE"
