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

# ── Amp subagent skill wrappers ────────────────────────────────────────
# Amp has no file-based subagents; it loads skills from .agents/skills/.
# Generate a skill wrapper per subagent so they work in Amp too.
if [ -d .agents/subagents ]; then
  echo ""
  info "Generating Amp skill wrappers from .agents/subagents/"

  for old in .agents/skills/subagent-*; do
    [ -d "$old" ] && rm -rf "$old"
  done

  for sub in .agents/subagents/*.md; do
    [ -f "$sub" ] || continue
    NAME="$(awk '/^---$/{c++; next} c==1 && /^name:/{sub(/^name:[ \t]*/,""); print; exit}' "$sub")"
    DESC="$(awk '/^---$/{c++; next} c==1 && /^description:/{sub(/^description:[ \t]*/,""); print; exit}' "$sub")"
    if [ -z "$NAME" ] || [ -z "$DESC" ]; then
      warn "skip (no name/description): $sub"
      continue
    fi
    DIR=".agents/skills/subagent-${NAME}"
    mkdir -p "$DIR"
    {
      echo "---"
      echo "name: subagent-${NAME}"
      echo "description: ${DESC}"
      echo "---"
      echo ""
      echo "<!-- AUTO-GENERATED from ${sub} — edit the source file, then re-run this script -->"
      echo ""
      awk '/^---$/{c++; next} c>=2{print}' "$sub"
    } > "$DIR/SKILL.md"
    ok "$DIR/SKILL.md"
  done
fi

# ── Cursor ─────────────────────────────────────────────────────────────
echo ""
info "Syncing → .cursor/ (Cursor)"
mkdir -p .cursor/skills .cursor/rules .cursor/agents

rsync -a --delete --exclude 'subagent-*' .agents/skills/ .cursor/skills/
rm -rf .cursor/skills/subagent-*
ok ".cursor/skills/"

for rule in .agents/rules/*.mdc; do
  [ -f "$rule" ] && cp "$rule" .cursor/rules/ && ok ".cursor/rules/$(basename "$rule")"
done

if [ -d .agents/subagents ]; then
  rsync -a --delete .agents/subagents/ .cursor/agents/
  ok ".cursor/agents/"
fi

if [ ! -f .mcp.json ] && [ -f .agents/mcp.json.example ]; then
  cp .agents/mcp.json.example .mcp.json
  ok ".mcp.json created from example"
elif [ ! -f .mcp.json ]; then
  warn ".mcp.json missing — create it manually (see README)"
fi

# ── Claude Code ────────────────────────────────────────────────────────
echo ""
info "Syncing → .claude/ (Claude Code)"
mkdir -p .claude/skills .claude/agents

rsync -a --delete --exclude 'subagent-*' .agents/skills/ .claude/skills/
rm -rf .claude/skills/subagent-*
ok ".claude/skills/"

if [ -d .agents/subagents ]; then
  rsync -a --delete .agents/subagents/ .claude/agents/
  ok ".claude/agents/"
fi

if [ -f CLAUDE.md ]; then
  cp CLAUDE.md .claude/CLAUDE.md
  ok ".claude/CLAUDE.md"
fi

# ── Amp Code ───────────────────────────────────────────────────────────
echo ""
info "Amp Code reads .agents/ directly — subagents exposed via skill wrappers"
mkdir -p .amp
if [ ! -f .amp/settings.json ] && [ -f .agents/amp.settings.json.example ]; then
  cp .agents/amp.settings.json.example .amp/settings.json
  ok ".amp/settings.json created from example"
elif [ ! -f .amp/settings.json ]; then
  warn ".amp/settings.json missing — copy from .agents/amp.settings.json.example"
fi

# ── .gitignore check ───────────────────────────────────────────────────
echo ""
info "Checking .gitignore"
GITIGNORE=".gitignore"
CHANGED=0

for line in ".cursor" ".cursor/memory.json" ".amp/settings.json" ".claude"; do
  if ! grep -qxF "$line" "$GITIGNORE" 2>/dev/null; then
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
