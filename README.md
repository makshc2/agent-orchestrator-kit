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

## Quickstart

**🆕 New project:**

```bash
npm i -D @fission-ai/openspec && npx openspec init
npx agent-orchestrator-kit@latest init --profile generic --ci gitlab --spec-verify
./scripts/sync-local-agent-skills.sh
```

See [Installation](#installation) for profile/CI options.

**🔄 Already have the kit installed? Get `status` / `gate-check` / GitHub Spec Verifier (v0.1.7+):**

```bash
npx agent-orchestrator-kit@latest update
./scripts/sync-local-agent-skills.sh
npx agent-orchestrator-kit@latest status       # try it right away
```

See [Upgrading an existing project](#upgrading-an-existing-project-to-v017-status--gate-check--github-spec-verifier) for what changes and what stays opt-in.

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

For GitLab-hosted projects (verify via `prebuild` hook — no GitHub Actions):

```bash
npx agent-orchestrator-kit init --ci gitlab
```

This installs `.gitlab/agent-verify.yml`, injects `verify:openspec` and PM-aware `prebuild` into `package.json`. When DevOps runs `npm run build` (or yarn/pnpm build), npm lifecycle runs `prebuild` first → `npx openspec validate --all --strict` executes automatically.

Optional dev-controlled CI before DevOps setup: copy `templates/.gitlab-ci.starter.yml.example` from the kit to `.gitlab-ci.yml` and adjust stages as needed.

Skip CI files entirely:

```bash
npx agent-orchestrator-kit init --ci none
```

Default remains GitHub Actions (`--ci github`).

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
├── .github/workflows/agent-verify.yml   # CI (default --ci github)
├── .github/workflows/spec-verify.yml    # AI Spec Verifier (--ci github --spec-verify, opt-in)
├── .gitlab/agent-verify.yml             # CI fragment (--ci gitlab)
├── .gitlab/spec-verify.yml              # AI Spec Verifier (--ci gitlab --spec-verify, opt-in)
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
├── scripts/sync-local-agent-skills.sh
└── scripts/verify-specs.sh + post-mr-verdict.sh / post-pr-verdict-github.sh   # (--spec-verify, opt-in)
```

### Included in kit

| Category | Contents |
|----------|----------|
| Orchestration | 5-role pipeline, `AGENTS.md`, `orchestrator.yaml`, review command |
| OpenSpec skills | All 7 skills for `/opsx:*` workflow |
| IDE sync | Cursor + Claude Code sync script (`--delete` semantics — removes stale skills) |
| CLI gates | `agent-orchestrator status` / `gate-check` — deterministic review-gate checks |
| CI | `agent-verify.yml` — GitHub (default) or GitLab fragment + `prebuild` hook, both run `gate-check` |
| AI Spec Verifier | `spec-verify.yml` + verifier scripts — GitLab or GitHub, opt-in (`--spec-verify`) |
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

**GitHub (default `--ci github`):** installed at `.github/workflows/agent-verify.yml`:

```yaml
- run: npx openspec validate --all --strict
- run: npm run lint --if-present
- run: npm run build --if-present
- run: npm test --if-present
```

**GitLab (`--ci gitlab`):** verify runs through the package manager build lifecycle — no GitHub Actions:

```json
"verify:openspec": "npx openspec validate --all --strict",
"prebuild": "npm run verify:openspec"
```

When CI or a developer runs `npm run build`, npm executes `prebuild` first. DevOps pipelines that already call `npm run build` get OpenSpec validate with zero config changes.

Optional: include `.gitlab/agent-verify.yml` in `.gitlab-ci.yml` for full lint/build/test verify before DevOps owns the root CI file. See kit `templates/.gitlab-ci.starter.yml.example`.

Blocks merge if any gate fails.

Every CI fragment (`agent-verify.yml`, GitHub and GitLab) also runs `npx agent-orchestrator-kit gate-check` — see [Deterministic gates](#deterministic-gates-status--gate-check) below. It never fails the pipeline for projects without `.agents/orchestrator.yaml`.

#### AI Spec Verifier (GitLab or GitHub, opt-in)

```bash
npx agent-orchestrator-kit init --ci gitlab --spec-verify
npx agent-orchestrator-kit init --ci github --spec-verify
```

Installs an AI verification layer on top of the deterministic gates: on every merge/pull request that changes `src/`, an Amp agent reads `openspec/specs/`, checks the changed code against every relevant requirement, posts a **PASS / BLOCKED** comment to the MR/PR, and **fails the pipeline on BLOCKED** — specs become an enforceable merge contract, not just documentation.

Installed files (GitLab):

| File | Purpose |
|------|---------|
| `.gitlab/spec-verify.yml` | CI fragment — hidden `.spec-verify-base` + blocking `spec-verify` job (MR + `src/**/*` only) |
| `scripts/verify-specs.sh` | Collects changed files + specs, builds prompt (project context from `openspec/config.yaml`), calls `amp -x`, writes `artifacts/verdict.json` |
| `scripts/post-mr-verdict.sh` | Posts the verdict as an MR comment via GitLab API |

Installed files (GitHub):

| File | Purpose |
|------|---------|
| `.github/workflows/spec-verify.yml` | Workflow triggered on `pull_request` for `src/**` — same verdict evaluation, `permissions: pull-requests: write` |
| `scripts/verify-specs.sh` | Same script as GitLab — stack-agnostic, reused as-is |
| `scripts/post-pr-verdict-github.sh` | Posts the verdict as a PR comment via `gh pr comment` |

The flag also adds `spec-verify-blocking` to `roles.verifier.gates` in `.agents/orchestrator.yaml`.

Setup after install (GitLab):

1. Include the fragment from `.gitlab-ci.yml`:

```yaml
include:
  - local: '.gitlab/spec-verify.yml'
```

2. Add CI/CD variables (Settings → CI/CD → Variables, masked): `AMP_API_KEY`, `GITLAB_VERIFIER_TOKEN` (project access token with `api` scope).

Setup after install (GitHub): the workflow runs automatically on `pull_request` — just add the repo secret `AMP_API_KEY` (Settings → Secrets and variables → Actions). `GITHUB_TOKEN` is provided by Actions automatically.

Verdict schema (`artifacts/verdict.json`): `pass`, `score` (0–100), `summary`, `findings[]` with `severity` (`error` fails the job), `spec`, `requirement`, `message`, `file`. The script degrades gracefully — no `src/` changes, no specs, missing `amp` CLI, or missing `AMP_API_KEY` produce a skipped passing verdict and never block the pipeline. Secrets are never logged; `.env`/key/token files are excluded from prompts.

**Warning-only rollout (Phase 1):** uncomment `allow_failure: true` (GitLab) or `continue-on-error: true` (GitHub) to keep the pipeline green while the team builds trust in verdicts, then remove it to enforce blocking (Phase 2).

`update` refreshes the spec-verify files only in projects that already installed them — the feature stays opt-in.

---

### Deterministic gates: `status` / `gate-check`

Orchestration hard rules (review approval, one active change) used to rely entirely on the agent remembering to check them in chat. Two CLI commands make them checkable and CI-enforceable:

```bash
npx agent-orchestrator-kit status
```

Prints every active OpenSpec change with task progress (`N/M tasks`), review verdict (`APPROVE` / `REQUEST CHANGES` / `none`), and a `ready to archive` flag once all tasks are `[x]` — no more running `openspec status` per change by hand.

```bash
npx agent-orchestrator-kit gate-check [change-name] [--src-glob src/] [--base HEAD~1]
```

Fails (non-zero exit) when `pipeline.require_spec_review: true`, the diff against `--base` touches `--src-glob`, and the active change has no `review.md` with `Verdict: APPROVE`. It degrades gracefully to exit 0 (with a message, not silently) when: `.agents/orchestrator.yaml` is missing, review isn't required, the diff can't be computed (e.g. shallow clone), or nothing under `--src-glob` changed. It also warns (never fails) when active changes exceed `pipeline.max_active_changes`. Both `agent-verify.yml` fragments (GitHub and GitLab) call `gate-check` automatically.

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

### Upgrading an existing project to v0.1.7 (status / gate-check / GitHub Spec Verifier)

If the kit is already installed and you just want the new deterministic gates, no re-`init` needed:

```bash
npx agent-orchestrator-kit@latest update
./scripts/sync-local-agent-skills.sh
```

What this gets you automatically:
- `.github/workflows/agent-verify.yml` / `.gitlab/agent-verify.yml` refreshed with a `gate-check` step (fails CI if `src/` changed without an approved `review.md`)
- `sync` (both the CLI command and the shell script) starts removing skills that no longer exist in `.agents/skills/`
- `agent-orchestrator status` and `agent-orchestrator gate-check` are available immediately (they ship inside `bin/`, not as opt-in templates) — try `npx agent-orchestrator-kit@latest status` right away

Two things `update` will **not** do for you (by design — opt-in, and it never touches your CI root file):

1. **GitLab-only projects that already had `--spec-verify`** — `update` refreshes `.gitlab/spec-verify.yml` and the scripts automatically (only because they already exist in your project).
2. **Adding GitHub Spec Verifier where you didn't have it before** — that's a new opt-in, run it once:
   ```bash
   npx agent-orchestrator-kit@latest init --ci github --spec-verify
   ```
   then add the `AMP_API_KEY` repo secret (Settings → Secrets and variables → Actions).

Nothing about `update` retroactively edits your `.gitlab-ci.yml` / already-included workflows — if `gate-check` doesn't seem to run, check that your `.gitlab-ci.yml` still `include`s `.gitlab/agent-verify.yml` (GitHub Actions picks up `.github/workflows/*.yml` automatically, no include step needed).

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
  --ci <provider>    CI provider: gitlab | github | none (default: github)
  --spec-verify      Install AI Spec Verifier blocking gate (GitLab or GitHub)
  --force            Overwrite existing files

npx agent-orchestrator-kit update
  Updates kit-managed files, preserves project overlay

npx agent-orchestrator-kit sync [options]
  --target <ide>     cursor | claude | amp | all (default: all)
  Copies .agents/ to local IDE directories, removing skills/rules no longer
  present in .agents/ (does not touch memory.json, .mcp.json, CLAUDE.md, etc.)

npx agent-orchestrator-kit status
  Show progress, review verdict, and archive-readiness for active changes

npx agent-orchestrator-kit gate-check [change-name] [options]
  --src-glob <glob>  Source path filter used to detect code changes (default: src/)
  --base <ref>       Git ref to diff against (default: HEAD~1)
  Exit non-zero when require_spec_review is true, src/ changed, and the
  active change has no review.md with Verdict: APPROVE. Graceful no-op
  otherwise (missing config, review not required, no relevant diff).
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

### 0.1.8
- README — Quickstart (new vs existing project) and upgrade guide for adopting `status`, `gate-check`, and GitHub Spec Verifier

### 0.1.7
- `agent-orchestrator status` — dashboard for active OpenSpec changes: task progress, review verdict, archive readiness
- `agent-orchestrator gate-check` — deterministic review-gate check (exit non-zero without an approved `review.md`); wired into both `agent-verify.yml` CI fragments
- `init --ci github --spec-verify` — GitHub parity for the AI Spec Verifier (`.github/workflows/spec-verify.yml`, `scripts/post-pr-verdict-github.sh`), reusing the existing stack-agnostic `verify-specs.sh`
- `sync` (CLI) now removes skills/rules that no longer exist in `.agents/` — matches `sync-local-agent-skills.sh` (`rsync --delete`) behavior; leaves `memory.json`, `.mcp.json`, `CLAUDE.md`, `settings.json` untouched

### 0.1.6
- `init --ci gitlab --spec-verify` — opt-in AI Spec Verifier: blocking MR gate via Amp CLI
- Templates: `.gitlab/spec-verify.yml`, `scripts/verify-specs.sh`, `scripts/post-mr-verdict.sh`
- `spec-verify-blocking` gate auto-added to `roles.verifier.gates`
- `update` refreshes spec-verify files only where already installed

### 0.1.5
- `init --ci gitlab|github|none` — GitLab verify via prebuild hook + CI fragment
- PM-aware `verify:openspec` / `prebuild` injection for GitLab projects
- `.gitlab/agent-verify.yml` template + starter example
- `update` refreshes GitLab fragment; docs for GitLab verifier path

### 0.1.4
- Kit repo CI — `.github/workflows/agent-verify.yml`
- OpenSpec devDependency for local and CI validation

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
