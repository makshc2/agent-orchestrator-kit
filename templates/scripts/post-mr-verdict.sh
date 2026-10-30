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
PASS=$(python3 -c "import json,sys; sys.stdout.reconfigure(errors='replace'); v=json.load(open('$VERDICT_FILE')); print(str(v.get('pass',True)).lower())")
SCORE=$(python3 -c "import json,sys; sys.stdout.reconfigure(errors='replace'); v=json.load(open('$VERDICT_FILE')); print(v.get('score',0))")
SUMMARY=$(python3 -c "import json,sys; sys.stdout.reconfigure(errors='replace'); v=json.load(open('$VERDICT_FILE')); print(v.get('summary',''))")
SKIPPED=$(python3 -c "import json,sys; sys.stdout.reconfigure(errors='replace'); v=json.load(open('$VERDICT_FILE')); print(str(v.get('skipped',False)).lower())")

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

# Render one comment section from the verdict: findings, implemented, missing
# or scope_creep. Malformed entries never raise; cells keep the table intact.
render_section() {
  python3 - "$VERDICT_FILE" "$1" <<'PYEOF'
import json, sys
sys.stdout.reconfigure(errors="replace")

with open(sys.argv[1]) as f:
    v = json.load(f)
section = sys.argv[2]


def cell(value):
    if value is None:
        return "—"
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    value = value.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    return value.replace("|", "\\|")


def file_cell(item):
    file = item.get("file")
    if not isinstance(file, str) or not file:
        return "—"
    line = item.get("line")
    if type(line) is int and line > 0:
        file = f"{file}:{line}"
    return cell(file)


def objects(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


if section == "findings":
    findings = objects(v.get("findings"))
    if not findings:
        print("_No findings._")
        sys.exit(0)
    severity_icons = {"error": "🔴", "warning": "🟡", "info": "🔵"}
    print("| | Severity | Spec | Requirement | Message | File |")
    print("|---|----------|------|-------------|---------|------|")
    for f in findings:
        sev = f.get("severity")
        icon = severity_icons.get(sev, "⚪") if isinstance(sev, str) else "⚪"
        print(f"| {icon} | {cell(sev)} | {cell(f.get('spec'))} | {cell(f.get('requirement'))} | {cell(f.get('message'))} | {file_cell(f)} |")
    sys.exit(0)

# Group labels: first match wins; skipped/inconclusive count only as JSON true.
items = v.get(section)
if v.get("skipped") is True:
    print("_Not checked — verification skipped._")
elif v.get("inconclusive") is True:
    print("_Not checked — verifier response was inconclusive._")
elif not isinstance(items, list) or (items and not objects(items)):
    print("_Not reported by this verifier._")
elif not items:
    print("_None reported._")
else:
    print("| Spec | Requirement | Evidence | File |")
    print("|------|-------------|----------|------|")
    for item in objects(items):
        print(f"| {cell(item.get('spec'))} | {cell(item.get('requirement'))} | {cell(item.get('message'))} | {file_cell(item)} |")
PYEOF
}

FINDINGS_TABLE=$(render_section findings)
IMPLEMENTED_TABLE=$(render_section implemented)
MISSING_TABLE=$(render_section missing)
SCOPE_CREEP_TABLE=$(render_section scope_creep)

# Build comment body
COMMENT_BODY="## ${ICON} Spec Verifier — ${STATUS}

**Score:** ${SCORE}/100
**Verdict:** ${STATUS}

### Summary
${SUMMARY}

### Findings
${FINDINGS_TABLE}

### Implemented
${IMPLEMENTED_TABLE}

### Missing
${MISSING_TABLE}

### Scope creep
${SCOPE_CREEP_TABLE}

---
_AI Spec Verifier • agent-orchestrator-kit • Pipeline: ${CI_PIPELINE_ID:-local}_"

# Escape for JSON into a temp file: a single argument above 131072 bytes
# (MAX_ARG_STRLEN) fails with E2BIG, so the payload never goes through argv.
PAYLOAD_FILE=$(mktemp)
trap 'rm -f "$PAYLOAD_FILE"' EXIT
python3 -c "
import json, sys
body = sys.stdin.read()
with open(sys.argv[1], 'w') as f:
    f.write(json.dumps({'body': body}))
" "$PAYLOAD_FILE" <<< "$COMMENT_BODY"

# Post to GitLab API
# Security: token is passed via header, never logged
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --request POST \
  --header "PRIVATE-TOKEN: ${GITLAB_VERIFIER_TOKEN}" \
  --header "Content-Type: application/json" \
  --data-binary @"$PAYLOAD_FILE" \
  "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/notes")

if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 300 ]; then
  echo "MR comment posted successfully (HTTP $HTTP_STATUS)"
else
  echo "Failed to post MR comment (HTTP $HTTP_STATUS)"
fi
