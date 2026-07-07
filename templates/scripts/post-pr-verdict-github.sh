#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Posts spec verifier verdict as a GitHub PR comment via gh CLI.
#
# Installed by agent-orchestrator-kit (init --ci github --spec-verify).
#
# Usage:  ./scripts/post-pr-verdict-github.sh
# Env:    GH_TOKEN / GITHUB_TOKEN — provided by GitHub Actions
#         GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_RUN_ID — Actions runtime
#         PR_NUMBER — optional override, auto-detected from the pull_request event otherwise
#
# Security: GH_TOKEN/GITHUB_TOKEN is never logged or echoed.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERDICT_FILE="$ROOT/artifacts/verdict.json"

if [ ! -f "$VERDICT_FILE" ]; then
  echo "No verdict file found — skipping PR comment."
  exit 0
fi

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "GH_TOKEN/GITHUB_TOKEN not set — skipping PR comment."
  exit 0
fi

if ! command -v gh &>/dev/null; then
  echo "gh CLI not found — skipping PR comment."
  exit 0
fi

PR_NUMBER="${PR_NUMBER:-}"
if [ -z "$PR_NUMBER" ] && [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "$GITHUB_EVENT_PATH" ]; then
  PR_NUMBER=$(python3 -c "
import json
try:
    data = json.load(open('$GITHUB_EVENT_PATH'))
    print(data.get('pull_request', {}).get('number', ''))
except Exception:
    print('')
" 2>/dev/null || true)
fi

if [ -z "$PR_NUMBER" ]; then
  echo "Not running in a pull_request context — skipping PR comment."
  exit 0
fi

export GH_TOKEN="$TOKEN"

PASS=$(python3 -c "import json; v=json.load(open('$VERDICT_FILE')); print(str(v.get('pass',True)).lower())")
SCORE=$(python3 -c "import json; v=json.load(open('$VERDICT_FILE')); print(v.get('score',0))")
SUMMARY=$(python3 -c "import json; v=json.load(open('$VERDICT_FILE')); print(v.get('summary',''))")
SKIPPED=$(python3 -c "import json; v=json.load(open('$VERDICT_FILE')); print(str(v.get('skipped',False)).lower())")

if [ "$SKIPPED" = "true" ]; then
  ICON="⏭️"
  STATUS="SKIPPED"
elif [ "$PASS" = "true" ]; then
  ICON="✅"
  STATUS="PASS"
else
  ICON="❌"
  STATUS="BLOCKED"
fi

# Build findings table
FINDINGS_TABLE=$(python3 <<'PYEOF'
import json, sys

with open("artifacts/verdict.json") as f:
    v = json.load(f)

findings = v.get("findings", [])
if not findings:
    print("_No findings._")
    sys.exit(0)

severity_icons = {"error": "🔴", "warning": "🟡", "info": "🔵"}

print("| | Severity | Spec | Requirement | Message | File |")
print("|---|----------|------|-------------|---------|------|")
for f in findings:
    icon = severity_icons.get(f.get("severity", "info"), "⚪")
    sev = f.get("severity", "—")
    spec = f.get("spec", "—")
    req = f.get("requirement", "—")
    msg = f.get("message", "—")
    file = f.get("file", "—")
    line = f.get("line")
    if line:
        file = f"{file}:{line}"
    print(f"| {icon} | {sev} | {spec} | {req} | {msg} | {file} |")
PYEOF
)

# Build comment body
COMMENT_BODY="## ${ICON} Spec Verifier — ${STATUS}

**Score:** ${SCORE}/100
**Verdict:** ${STATUS}

### Summary
${SUMMARY}

### Findings
${FINDINGS_TABLE}

---
_AI Spec Verifier • agent-orchestrator-kit • Run: ${GITHUB_RUN_ID:-local}_"

TMP_BODY_FILE=$(mktemp)
trap 'rm -f "$TMP_BODY_FILE"' EXIT
echo "$COMMENT_BODY" > "$TMP_BODY_FILE"

GH_REPO_FLAG=()
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  GH_REPO_FLAG=(--repo "$GITHUB_REPOSITORY")
fi

# Security: token is passed via GH_TOKEN env var, never logged
if gh pr comment "$PR_NUMBER" "${GH_REPO_FLAG[@]}" --body-file "$TMP_BODY_FILE" >/dev/null 2>&1; then
  echo "PR comment posted successfully"
else
  echo "Failed to post PR comment"
fi
