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
