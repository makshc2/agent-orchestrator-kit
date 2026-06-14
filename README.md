# agent-orchestrator-kit

Universal AI agent orchestration kit for **Cursor**, **Claude Code**, and **Amp Code** — spec-driven pipeline built on [OpenSpec](https://github.com/fission-ai/openspec).

[![npm version](https://img.shields.io/npm/v/agent-orchestrator-kit)](https://www.npmjs.com/package/agent-orchestrator-kit)
[![license](https://img.shields.io/npm/l/agent-orchestrator-kit)](LICENSE)

## What It Is

A portable kit that installs a **5-role AI pipeline** into any project:

```
explore → propose → review → apply → verify → archive
```

Each role runs in a **separate agent session** with dedicated permissions, model hints, and handoff gates. The `openspec/changes/` folder acts as the **contract between agents** — no shared memory between sessions, only files.

Works with:
- [Cursor](https://cursor.sh) — via `.cursor/rules/` + `.cursor/skills/`
- [Claude Code](https://code.claude.com) — via `CLAUDE.md` + `.claude/skills/`
- [Amp Code](https://ampcode.com) — via `AGENTS.md` + `.agents/skills/` (native, no sync needed)

## Why

Without role separation, AI agents tend to mix thinking with implementation, skip spec review, and accumulate context debt across one long chat. This kit enforces the discipline at the filesystem level: each role has explicit allowed files, a checklist, and a handoff gate before the next role starts.

The `AGENTS.md` / `CLAUDE.md` files tell each IDE exactly what the roles are, so you don't repeat yourself every session.

## Installation

### Prerequisites

- Node.js ≥ 18
- [OpenSpec](https://github.com/fission-ai/openspec) installed in the project:

```bash
npm i -D @fission-ai/openspec
npx openspec init
```

> **Important:** `agent-orchestrator-kit init` does **not** install OpenSpec automatically. Install OpenSpec first (or ensure it exists in the repo), then run kit init.

### Install the kit

```bash
npx agent-orchestrator-kit init
```

With a stack profile:

```bash
npx agent-orchestrator-kit init --profile vue3
npx agent-orchestrator-kit init --profile node
npx agent-orchestrator-kit init --profile generic
npx agent-orchestrator-kit init --profile mvp    # demos / spikes — no review gate
```

With options:

```bash
npx agent-orchestrator-kit init \
  --profile vue3 \
  --name "My Project" \
  --lang uk
```

### Sync to local IDEs

After init (and after every update):

```bash
./scripts/sync-local-agent-skills.sh
```

This copies `.agents/` to your local IDE directories (not committed to git).

## What Gets Installed

```
your-project/
├── AGENTS.md
├── CLAUDE.md
├── .github/workflows/agent-verify.yml   # CI: openspec validate + lint + build
├── .agents/
│   ├── orchestrator.yaml
│   ├── mcp.json.example                 # Cursor MCP template
│   ├── amp.settings.json.example        # Amp MCP template
│   ├── commands/                        # 6 /opsx:* commands
│   ├── rules/                           # 3 auto-applied rules
│   └── skills/
│       ├── agent-orchestration/         # Pipeline orchestration
│       ├── openspec-howto/
│       ├── openspec-explore/
│       ├── openspec-propose/
│       ├── openspec-apply-change/
│       ├── openspec-archive-change/
│       ├── openspec-sync-specs/
│       └── spec-workflow-openspec/
└── scripts/sync-local-agent-skills.sh
```

### Included in kit

| Category | Contents |
|----------|----------|
| Orchestration | 5-role pipeline, `AGENTS.md`, `orchestrator.yaml`, review command |
| OpenSpec skills | All 7 skills for `/opsx:*` workflow |
| IDE sync | Cursor + Claude Code sync script |
| CI | `agent-verify.yml` (openspec validate, lint, build, test) |
| MCP templates | Memory MCP for Cursor and Amp |

### Not included (install separately)

| What | How |
|------|-----|
| OpenSpec CLI | `npm i -D @fission-ai/openspec && npx openspec init` |
| Stack skills (Vue, JS, Vite) | `npx frontend-agent-skills install` for vue3 profile |
| Project conventions | Create `.agents/project-conventions/SKILL.md` manually |
| Domain specs | Live in `openspec/specs/` per project |

Git-committed: `.agents/` + `AGENTS.md` + `CLAUDE.md` + `scripts/` + `.github/`
Local only (not committed): `.cursor/` `.claude/` `.amp/`

## IDE Integration

### Amp Code (primary — zero config)

Amp reads `.agents/skills/` and `AGENTS.md` **natively** — no sync needed.

1. Install the kit → `AGENTS.md` is created automatically.
2. Amp picks up skills from `.agents/skills/` on session start.
3. Copy Amp MCP config (on first sync):

```bash
cp .agents/amp.settings.json.example .amp/settings.json
```

Or run `./scripts/sync-local-agent-skills.sh` — it creates `.amp/settings.json` automatically.

4. Use commands directly:

```
/opsx:explore
/opsx:propose add-feature-name
/opsx:review add-feature-name
/opsx:apply add-feature-name
/opsx:archive
```

**Model hints per role** (Amp modes):

| Role | Recommended Amp mode |
|------|---------------------|
| explore | `rush` |
| propose | `smart` or `deep` |
| review | `smart` |
| apply (complex) | `smart` or `deep` |
| apply (simple task) | `rush` |

Switch modes in Amp CLI: `Ctrl+O` → `mode`.

### Claude Code

1. Run sync: `./scripts/sync-local-agent-skills.sh`
2. This creates:
   - `.claude/CLAUDE.md` — project context
   - `.claude/skills/` — all skills from `.agents/skills/`
3. Skills are auto-loaded by Claude Code from `.claude/skills/`.
4. Invoke directly: `/agent-orchestration`, `/openspec-howto`, etc.

**CLAUDE.md tiers used:**
- Project level: `.claude/CLAUDE.md` (synced from `CLAUDE.md`)
- Personal (optional): `~/.claude/CLAUDE.md` for preferences

**Claude Code subagent config** (optional, in skill frontmatter):

```yaml
---
name: openspec-explore
context: fork
agent: Explore
allowed-tools: Read, Bash
---
```

You can add `context: fork` to explore/review skills for isolated subagent sessions.

### Cursor

1. Run sync: `./scripts/sync-local-agent-skills.sh`
2. Creates:
   - `.cursor/skills/` — all skills
   - `.cursor/rules/` — `.mdc` rule files
   - `.mcp.json` — from `mcp.json.example` (if not present)
3. Rules are applied automatically per `alwaysApply: true`.

**Memory MCP for Cursor** (`.mcp.json`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": { "MEMORY_FILE_PATH": ".cursor/memory.json" }
    }
  }
}
```

## The Pipeline in Detail

### Role 1: Explorer — `/opsx:explore`

**Mode:** read-only. Cannot edit any files.
**Model:** fast/cheap.
**Purpose:** Understand the problem. Surface options. Choose a direction.

**Exit criteria (before starting Architect):**
- Problem stated in 3–5 sentences
- 2–3 solution options + recommendation
- kebab-case change name chosen
- Non-goals listed

```
/opsx:explore How should we handle bulk camera export?
```

---

### Role 2: Architect — `/opsx:propose <name>`

**Mode:** writes `openspec/changes/<name>/` only. Cannot touch `src/`.
**Model:** strong reasoning.
**Purpose:** Create all change artifacts: proposal, design, tasks, delta specs.

**Exit gate:**
```bash
openspec validate <name> --strict --type change  # must be ✓
```

```
/opsx:propose add-bulk-camera-export
```

---

### Role 3: Spec Reviewer — `/opsx:review <name>`

**Mode:** read-only. No code edits.
**Model:** medium or strong.
**Purpose:** Review artifacts. Output **Approve ✓** or **Request Changes ✗**.

Checks:
- Acceptance criteria are testable
- Tasks ≤ ~2 hours each
- No scope creep vs Non-goals
- No conflicts with existing domain specs

```
/opsx:review add-bulk-camera-export
```

**Only after explicit APPROVE can apply start.**

---

### Role 4: Implementer — `/opsx:apply <name>`

**Mode:** writes `src/`. Marks `tasks.md [x]`.
**Model:** strong. Use fast for simple mechanical tasks.
**Purpose:** Implement tasks. One session = 1–3 tasks (not all 15 at once).

**Exit gate:**
```bash
npm run build   # must pass
npm run lint    # must pass
```

```
/opsx:apply add-bulk-camera-export
```

---

### Role 5: Verifier — CI (automatic)

Installed at `.github/workflows/agent-verify.yml`:

```yaml
- run: npx openspec validate --all --strict
- run: npm run lint --if-present
- run: npm run build --if-present
- run: npm test --if-present
```

Blocks merge if any gate fails.

---

### Archive — `/opsx:archive`

After PR merged + CI green:
```
/opsx:archive add-bulk-camera-export
```

Merges delta specs into `openspec/specs/` and moves change to `archive/`.

## Configuration

Edit `.agents/orchestrator.yaml` after init:

```yaml
project:
  name: "My Project"
  agent_language: uk      # response language for agents

pipeline:
  require_spec_review: true
  max_active_changes: 1
  archive_after_merge: true

verifier:
  lint_command: "npm run lint"
  build_command: "npm run build"
  test_command: "npm test"   # optional
```

## Update

When a new version of the kit is released:

```bash
npx agent-orchestrator-kit update
./scripts/sync-local-agent-skills.sh
```

`update` only touches kit-managed files (commands, rules, skills). It never overwrites:
- `orchestrator.yaml`
- `openspec/config.yaml`
- `openspec/specs/`
- `openspec/changes/`
- Any project-conventions skills

## Profiles

| Profile | Stack | Extra (separate install) |
|---------|-------|--------------------------|
| `generic` | Any | Orchestration + OpenSpec skills only |
| `vue3` | Vue 3 + Vite + JS | + `npx frontend-agent-skills install` |
| `node` | Node.js | + `npx frontend-agent-skills install --category javascript` |
| `mvp` | Vue 3 demo/spike | + frontend-agent-skills; use `/opsx:quick`, no review gate |

For `vue3`, after kit init also run:

```bash
# Amp (primary — installs directly to .agents/skills/)
npx frontend-agent-skills install --agent amp --yes

# Cursor + Claude Code users — sync local IDE dirs
./scripts/sync-local-agent-skills.sh
```

Or install for all IDEs at once:

```bash
npx frontend-agent-skills install --agent all --yes
```

> **Migrating from `vue-cursor-skills`?** Renamed to `frontend-agent-skills` v2 — same package, old CLI alias still works.

## Memory MCP — Shared State Between Sessions

Each role starts a fresh session. Memory MCP persists orchestration state across sessions so you don't re-explain context every time.

**Standard entities to save:**

```
Change:add-bulk-export     status: spec-approved, tasks: 0/7
Decision:export-format     chosen: xlsx, reason: matches existing reports
Convention:api-errors      use ApiError class, not raw Error
Handoff:add-bulk-export    next_role: implementer, session_count: 1
```

At the start of each implementer/reviewer session, read relevant memory:
```
What do we know about Change:add-bulk-export?
```

## Amp Code — Deep Integration Notes

Amp is the **primary target** of this kit. It reads `.agents/skills/` and `AGENTS.md` without any sync step — your team commits `.agents/` and everyone gets the same orchestration behavior automatically.

**Amp-specific features used:**

| Feature | How the kit uses it |
|---------|-------------------|
| `AGENTS.md` subtree loading | Per-domain AGENTS.md in `openspec/` subtree |
| `.agents/skills/` | All orchestration + domain skills |
| `mcp.json` in skill dir | Lazy MCP loading (Memory only when needed) |
| Subagents | Explore and Review skills use forked subagents |
| Amp modes (rush/smart/deep) | Per-role model hints in AGENTS.md |

**Amp subagent in skill** (`.agents/skills/openspec-explore/SKILL.md`):

```yaml
---
name: openspec-explore
description: Enter explore mode — read-only thinking partner
disable-model-invocation: false
allowed-tools: Read, Bash
---
```

Amp will run this skill as a subagent when invoked.

**Team workflow with Amp:**

1. Commit `.agents/` to git.
2. Team members clone — skills available immediately.
3. No `sync-local-agent-skills.sh` needed for Amp users.
4. Cursor/Claude Code users run sync once after clone.

## CLI Reference

```bash
npx agent-orchestrator-kit init [options]
  --profile <name>   Stack profile: generic | vue3 | node | mvp
  --lang <code>      Agent language: en | uk | ...
  --name <name>      Project name (default: directory name)
  --force            Overwrite existing files

npx agent-orchestrator-kit update
  Updates kit-managed files, preserves project overlay

npx agent-orchestrator-kit sync [options]
  --target <ide>     cursor | claude | all (default: all)
  Copies .agents/ to local IDE directories
```

## Directory Reference

```
.agents/                 # Committed — source of truth for all IDEs
  commands/              # /opsx:* command definitions
  rules/                 # Auto-applied rules for Cursor
  skills/                # Skills for Cursor, Claude Code, Amp
  orchestrator.yaml      # Project pipeline config

.cursor/                 # Local only — Cursor IDE runtime
  skills/                # Synced from .agents/skills/
  rules/                 # Synced from .agents/rules/
  memory.json            # Memory MCP data

.claude/                 # Local only — Claude Code runtime
  skills/                # Synced from .agents/skills/
  CLAUDE.md              # Synced from root CLAUDE.md

.amp/                    # Local only — Amp config
  settings.json          # MCP servers (manual or via amp mcp add)

AGENTS.md                # Committed — Amp + Claude (AGENT.md fallback)
CLAUDE.md                # Committed — synced to .claude/CLAUDE.md
openspec/                # Committed — spec-driven workflow
  config.yaml            # Project context for AI
  specs/                 # Source of truth after archive
  changes/               # Active work
```

## Changelog

### 0.1.3
- Fix gitignore dedup (exact line match, not substring)
- Add `.claude` to gitignore on init
- `sync --target amp` — explicit Amp handling + settings.json bootstrap
- OpenSpec + frontend-agent-skills hints in init next steps
- Profile validation with warning for unknown profiles
- CI workflow: auto-detect npm / yarn / pnpm
- Package manager detection → updates verifier commands in orchestrator.yaml
- `openspec/config.yaml.example` from vue3/mvp profiles
- Review gate: `review.md` + apply checks `require_spec_review`
- Vue 3 checklist in `/opsx:review`
- New `/opsx:quick` command and **mvp** profile for demos/spikes

### 0.1.2
- Fix CLI: executable bit on `bin/agent-orchestrator.js` (`agent-orchestrator: not found`)
- Add `agent-orchestrator-kit` bin alias (matches package name for npx)

### 0.1.1
- Added all OpenSpec skills (`openspec-*`, `spec-workflow-openspec`)
- Added CI workflow template `.github/workflows/agent-verify.yml`
- Added `.agents/amp.settings.json.example` for Amp Code MCP
- `update` command now refreshes all kit-managed skills and CI
- Sync script auto-creates `.amp/settings.json` from example
- Removed unused `prompts` dependency

### 0.1.0
- Initial release: orchestration pipeline, `/opsx:*` commands, IDE sync

## License

MIT © [Maksim Shevyakov](https://github.com/makshc2)
