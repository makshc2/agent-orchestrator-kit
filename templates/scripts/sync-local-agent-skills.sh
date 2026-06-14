#!/usr/bin/env sh
# sync-local-agent-skills.sh
# Syncs .agents/ (committed) to local IDE directories (not committed)
# Run after: init, update, adding new skills
# Works with: Cursor, Claude Code, Amp Code (via VS Code settings)

set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()   { printf "${GREEN}  ✓${RESET} %s\n" "$1"; }
info() { printf "${CYAN}  →${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}  !${RESET} %s\n" "$1"; }

echo ""
echo "sync-local-agent-skills"
echo "-----------------------"

# ── Cursor ─────────────────────────────────────────────────────────────
echo ""
info "Syncing → .cursor/ (Cursor)"
mkdir -p .cursor/skills .cursor/rules

rsync -a --delete .agents/skills/ .cursor/skills/
ok ".cursor/skills/"

for rule in .agents/rules/*.mdc; do
  [ -f "$rule" ] && cp "$rule" .cursor/rules/ && ok ".cursor/rules/$(basename "$rule")"
done

if [ ! -f .mcp.json ] && [ -f .agents/mcp.json.example ]; then
  cp .agents/mcp.json.example .mcp.json
  ok ".mcp.json created from example"
elif [ ! -f .mcp.json ]; then
  warn ".mcp.json missing — create it manually (see README)"
fi

# ── Claude Code ────────────────────────────────────────────────────────
echo ""
info "Syncing → .claude/ (Claude Code)"
mkdir -p .claude/skills

rsync -a --delete .agents/skills/ .claude/skills/
ok ".claude/skills/"

if [ -f CLAUDE.md ]; then
  cp CLAUDE.md .claude/CLAUDE.md
  ok ".claude/CLAUDE.md"
fi

# ── Amp Code ───────────────────────────────────────────────────────────
echo ""
info "Amp Code reads .agents/ directly — no sync needed"
if [ ! -f .amp/settings.json ]; then
  warn ".amp/settings.json missing — add Memory MCP manually (see README)"
  warn "  {\"amp.mcpServers\":{\"memory\":{\"command\":\"npx\",\"args\":[\"-y\",\"@modelcontextprotocol/server-memory\"],\"env\":{\"MEMORY_FILE_PATH\":\".cursor/memory.json\"}}}}"
fi

# ── .gitignore check ───────────────────────────────────────────────────
echo ""
info "Checking .gitignore"
GITIGNORE=".gitignore"
CHANGED=0

for line in ".cursor" ".cursor/memory.json" ".amp/settings.json" ".claude"; do
  if ! grep -qF "$line" "$GITIGNORE" 2>/dev/null; then
    echo "$line" >> "$GITIGNORE"
    ok "Added '$line' to .gitignore"
    CHANGED=1
  fi
done

[ "$CHANGED" -eq 0 ] && ok ".gitignore OK"

echo ""
ok "Sync complete"
echo ""
printf "  Committed to git: ${CYAN}.agents/${RESET} — skills, rules, commands\n"
printf "  Local only:       ${YELLOW}.cursor/ .claude/ .amp/${RESET} — IDE runtime\n"
echo ""
