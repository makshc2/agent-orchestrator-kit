#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Posts spec verifier verdict as a GitLab MR comment.
#
# Installed by agent-orchestrator-kit (init --ci gitlab --spec-verify).
#
# Usage:  ./scripts/post-mr-verdict.sh
# Env:    CI_API_V4_URL, CI_PROJECT_ID, CI_MERGE_REQUEST_IID,
#         GITLAB_VERIFIER_TOKEN (CI/CD variable, masked)
#
# Security: GITLAB_VERIFIER_TOKEN is a project access token with
# api scope. It is NEVER logged or echoed.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERDICT_FILE="$ROOT/artifacts/verdict.json"

if [ ! -f "$VERDICT_FILE" ]; then
  echo "No verdict file found — skipping MR comment."
  exit 0
fi

if [ -z "${CI_API_V4_URL:-}" ] || [ -z "${CI_PROJECT_ID:-}" ] || [ -z "${CI_MERGE_REQUEST_IID:-}" ]; then
  echo "Not running in MR context — skipping MR comment."
  exit 0
fi

if [ -z "${GITLAB_VERIFIER_TOKEN:-}" ]; then
  echo "GITLAB_VERIFIER_TOKEN not set — skipping MR comment."
  exit 0
fi

# Parse verdict
PASS=$(python3 -c "import json,sys; v=json.load(open('$VERDICT_FILE')); print(str(v.get('pass',True)).lower())")
SCORE=$(python3 -c "import json,sys; v=json.load(open('$VERDICT_FILE')); print(v.get('score',0))")
SUMMARY=$(python3 -c "import json,sys; v=json.load(open('$VERDICT_FILE')); print(v.get('summary',''))")
SKIPPED=$(python3 -c "import json,sys; v=json.load(open('$VERDICT_FILE')); print(str(v.get('skipped',False)).lower())")

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
_AI Spec Verifier • agent-orchestrator-kit • Pipeline: ${CI_PIPELINE_ID:-local}_"

# Escape for JSON
COMMENT_JSON=$(python3 -c "
import json, sys
body = sys.stdin.read()
print(json.dumps({'body': body}))
" <<< "$COMMENT_BODY")

# Post to GitLab API
# Security: token is passed via header, never logged
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --request POST \
  --header "PRIVATE-TOKEN: ${GITLAB_VERIFIER_TOKEN}" \
  --header "Content-Type: application/json" \
  --data "$COMMENT_JSON" \
  "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/notes")

if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 300 ]; then
  echo "MR comment posted successfully (HTTP $HTTP_STATUS)"
else
  echo "Failed to post MR comment (HTTP $HTTP_STATUS)"
fi
