# agent-orchestrator-kit

Universal AI agent orchestration kit for **Cursor**, **Claude Code**, and **Amp Code** — spec-driven OpenSpec pipeline with **cross-IDE custom subagents**.

[![npm version](https://img.shields.io/npm/v/agent-orchestrator-kit)](https://www.npmjs.com/package/agent-orchestrator-kit)
[![license](https://img.shields.io/npm/l/agent-orchestrator-kit)](LICENSE)

## What It Is

A portable kit that installs a **role-separated AI pipeline** into any project:

```
explore → [design] → propose → review → apply → verify → archive
```

Each role runs in a **separate agent session**. The parent `/opsx:*` session is a conductor: it restores state, spawns the routed specialist, verifies its report, and does not perform specialist work itself. OpenSpec files remain the requirements/tasks source of truth; Memory MCP and `openspec/changes/<name>/handoff.md` index phase state and the next command.

**Figma PAT setup (v0.1.11+)** — local `.agents/figma.local.env` + MCP launcher (token never in chat / committed MCP JSON). See [Figma token](#figma-token-optional).

**Custom subagents (v0.1.10+)** ship with the kit and work in all three IDEs:

| Subagent | Role |
|----------|------|
| `openspec-guide` | Pipeline navigator — status, gates, next `/opsx:*` command |
| `code-writer` | Scoped task implementation against stack conventions |
| `code-reviewer` | Spec-compliance + convention review of the resulting code |
| `test-writer` | Automated tests for recently changed code |
| `setup-doctor` | Orchestrator / MCP / sync diagnosis and repair |
| `design-implementer` | Pixel-accurate Figma / screenshot → production UI |
| `codebase-explorer` | Read-only repository investigation for explore |
| `design-intake` | Design source → durable brief + assets |
| `spec-architect` | Proposal, design, delta specs, and tasks |
| `spec-reviewer` | Pre-apply artifact gate + `review.md` |
| `spec-archiver` | Delta merge and completed-change archive |
| `session-handoff` | Restore/persist Memory + `handoff.md` + expanded next-thread prompt |

Delegation is **differentiated per phase** (lean model): thinking-heavy phases spawn a mandatory specialist, apply is parent-driven, archive is a deterministic CLI:

| Phase / signal | Delegation |
|----------------|------------|
| Status / gates / next command | `openspec-guide` |
| Session start restore / session exit persist | parent-driven CLI (`handoff --restore` / `handoff <name>`); `session-handoff` is a fallback only |
| Kit / MCP / sync repair | `setup-doctor` |
| Explore repository research | `codebase-explorer` (mandatory) |
| Design / propose / spec review | `design-intake` / `spec-architect` / `spec-reviewer` (mandatory) |
| Apply | parent implements from `tasks.md` + `apply-notes.md`; `code-writer` / `test-writer` optional for ≥ 2 independent tasks or explicit request; `design-implementer` for design-brief/Figma tasks |
| Pre-PR code review | `code-reviewer` |
| Archive | `npx agent-orchestrator-kit archive <name>` (CLI — no subagent; `spec-archiver` is a fallback when the CLI is unavailable) |

- **Cursor** → `.cursor/agents/` (native subagents)
- **Claude Code** → `.claude/agents/` (native subagents)
- **Amp Code** → auto-generated `subagent-*` skill wrappers in `.agents/skills/`; each wrapper requires the parent to spawn an isolated subagent, never execute it in the main thread

Works with:
- [Cursor](https://cursor.sh) — via `.cursor/rules/` + `.cursor/skills/` + `.cursor/agents/`
- [Claude Code](https://code.claude.com) — via `CLAUDE.md` + `.claude/skills/` + `.claude/agents/`
- [Amp Code](https://ampcode.com) — via `AGENTS.md` + `.agents/skills/` (native, including `subagent-*` wrappers)

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

**🔄 Already have the kit installed? Upgrade to latest (Cursor leftover race + multi-root + per-phase clock in v0.12.0; session attribution + Cursor estimate/dedup in v0.11.0; Cursor fallback estimate + first-class `costUsdEstimated` in v0.10.0; UTC timestamps + Amp stamp parse, Amp billed `$`, Cursor API estimate, archive auto-collect in v0.9.0; locked Amp/Cursor client in v0.8.0; `## Metrics` self-report + opt-in `--collect` in v0.7.0 — **BREAKING:** `--no-collect` is gone; change metrics in v0.5.0+, factory phases 1–3 in v0.4.0+, lean pipeline / archive CLI in v0.3.0+, handoff CLI in v0.1.14+, Figma PAT in v0.1.11+):**

```bash
npx agent-orchestrator-kit@latest update
npx agent-orchestrator-kit@latest sync         # or: ./scripts/sync-local-agent-skills.sh
npx agent-orchestrator-kit@latest mcp-setup    # optional — GitHub/GitLab from origin + browser
npx agent-orchestrator-kit@latest figma-setup  # optional — local Figma token
npx agent-orchestrator-kit@latest hooks-setup  # optional — pre-commit review gate
npx agent-orchestrator-kit@latest status
```

This refreshes kit-managed files, installs `.agents/subagents/`, generates Amp `subagent-*` skill wrappers, and syncs agents into `.cursor/agents/` + `.claude/agents/`. See [Changelog](#changelog) for the full list.

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
│   ├── commands/                        # /opsx:* role commands
│   ├── rules/                           # auto-applied orchestration rules
│   ├── subagents/                       # 12 stage/custom subagents (Cursor/Claude/Amp)
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
| IDE sync | Cursor + Claude Code sync script (`--delete` semantics — removes stale skills/subagents) |
| Subagents | 12 exclusive routes: guide/setup/session-handoff, explore/design/propose/review/archive stage agents, and apply implementation/test/code-review agents — native in Cursor + Claude Code, isolated Amp `subagent-*` wrappers |
| CLI gates | `npx agent-orchestrator-kit status` / `gate-check` / `archive` / `handoff` / `metrics` / `memory-setup` — deterministic review-gate, archive, session-handoff, and change metrics (always via `npx`; see `cli-via-npm.mdc`) |
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

**CLI note:** Amp shells often lack global `openspec` / `agent-orchestrator-kit` on PATH (exit 127). Agents must use `npx …` / `npm run …` — see always-apply rule `.agents/rules/cli-via-npm.mdc`.

1. Install the kit → `AGENTS.md` is created automatically.
2. Amp picks up skills from `.agents/skills/` on session start.
3. Copy Amp MCP config (on first sync):

```bash
cp .agents/amp.settings.json.example .amp/settings.json
```

Or run `./scripts/sync-local-agent-skills.sh` — it creates `.amp/settings.json` automatically.

**Subagents in Amp:** the kit exposes every `.agents/subagents/<name>.md` as an auto-generated `subagent-<name>` skill. The conductor MUST run the wrapper as an isolated subagent with fresh context and MUST NOT execute its body in the main thread. Edit only the source file and re-run `sync` to regenerate wrappers.

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
   - `.claude/skills/` — all skills from `.agents/skills/` (excluding Amp `subagent-*` wrappers)
   - `.claude/agents/` — custom subagents from `.agents/subagents/` (native Claude Code subagents)
3. Skills are auto-loaded by Claude Code from `.claude/skills/`.
4. Invoke `/opsx:*` or the orchestration skill. The conductor delegates using the mandatory phase/signal routing table rather than relying on description-only selection.

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
   - `.cursor/agents/` — all 12 custom/stage subagents
   - `.mcp.json` — from `mcp.json.example` (if not present)
3. Rules are applied automatically per `alwaysApply: true`.
4. `/opsx:*` sessions use the mandatory conductor routing table to spawn subagents. Add project-specific subagents in `.agents/subagents/`, add an exclusive route, and re-run sync.

**Memory + optional Figma MCP for Cursor** (`.mcp.json`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["scripts/memory-mcp-launcher.cjs"]
    },
    "figma": {
      "command": "node",
      "args": ["scripts/figma-mcp-launcher.cjs"]
    }
  }
}
```

Token lives in `.agents/figma.local.env` — see [Figma token](#figma-token-optional).

## The Pipeline in Detail

### Role 1: Explorer — `/opsx:explore`

**Mode:** read-only. Cannot edit any files.
**Model:** fast/cheap.
**Purpose:** Understand the problem. Surface options. Choose a direction.

The conductor spawns `codebase-explorer` for repository investigation and stays read-only.

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

The conductor spawns `spec-architect`; it does not write artifacts in the parent session.

**Exit gate:**
```bash
npx openspec validate <name> --strict --type change  # must be ✓
```

```
/opsx:propose add-bulk-camera-export
```

---

### Role 3: Spec Reviewer — `/opsx:review <name>`

**Mode:** read-only. No code edits.
**Model:** medium or strong.
**Purpose:** Review artifacts. Output **Approve ✓** or **Request Changes ✗**.

Review is **two-tiered**. Tier 1 is deterministic: `npx agent-orchestrator-kit gate-check --review <name>` runs strict OpenSpec validation, the task-contract lint, and structural checks (Non-goals / Acceptance criteria in `proposal.md`, non-empty delta-spec sections). If Tier 1 fails, the verdict is REQUEST CHANGES without spawning anyone. Only on a Tier 1 pass does the conductor spawn `spec-reviewer` (not `code-reviewer`) for Tier 2 judgment and verify its `review.md`. On APPROVE the reviewer also writes `apply-notes.md` (≤ 20 lines of constraints and pitfalls for the implementer).

Tier 2 checks (judgment only — no duplication of Tier 1):
- Consistency proposal ↔ design ↔ tasks
- No scope creep vs Non-goals
- No conflicts with existing domain specs
- Tasks self-sufficient for a blind implementer (Files / Do / Done-when)

```
/opsx:review add-bulk-camera-export
```

**Only after explicit APPROVE can apply start.**

---

### Role 4: Implementer — `/opsx:apply <name>`

**Mode:** conductor; routed specialists write `src/` and tests. Only the conductor marks `tasks.md [x]` after a verified `Status: done` report.
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

Prints every active OpenSpec change with task progress (`N/M tasks`), review verdict (`APPROVE` / `REQUEST CHANGES` / `none`), design brief (`brief: yes/no`), a `ready to archive` flag once all tasks are `[x]`, and an **MCP health** section (launcher / env / live config — never prints token values). VCS tools that do not match `git remote origin` show as `skipped (no origin match)`.

```bash
npx agent-orchestrator-kit gate-check [change-name] [--src-glob src/] [--base HEAD~1] [--staged]
```

Fails (non-zero exit) when `pipeline.require_spec_review: true`, the diff against `--base` (or **staged** files with `--staged`) touches `--src-glob`, and the active change has no `review.md` with `Verdict: APPROVE`. When `pipeline.require_design_brief: true` and `src/` changed, it also requires `design-brief.md` (or a `Design: none` line in `proposal.md` for non-UI changes). It degrades gracefully to exit 0 (with a message, not silently) when: `.agents/orchestrator.yaml` is missing, neither review nor design brief is required, the diff can't be computed (e.g. shallow clone), or nothing under `--src-glob` changed. It also warns (never fails) when active changes exceed `pipeline.max_active_changes`. Both `agent-verify.yml` fragments (GitHub and GitLab) call `gate-check` automatically. Pre-commit uses `--staged` so it checks the index, not `HEAD~1`.

```bash
npx agent-orchestrator-kit gate-check --tasks <change-name>
```

Lints the task contract in `tasks.md`: every task needs `Files:` / `Do:` / `Done-when:`, no vague phrasing (`as needed`, `if necessary`, …), and every `Files:` path must exist unless prefixed `new file:`. Behavior follows `pipeline.task_contract` in `orchestrator.yaml`: `warn` (default) exits 0 with warnings, `strict` exits 1 on violations, `off` skips the lint.

```bash
npx agent-orchestrator-kit gate-check --review <change-name> [--json]
```

Deterministic Tier 1 of the review phase: strict OpenSpec validation, the task-contract lint, `Non-goals` / `Acceptance criteria` sections in `proposal.md`, and non-empty ADDED/MODIFIED/REMOVED sections in delta specs. Human-readable stdout, or `--json` for a `{pass, errors[]}` report.

### Pre-commit review gate (optional)

`gate-check` already exists; it is **not** wired to `git commit` unless you opt in. The kit never writes `.git/hooks/` directly.

```bash
npx agent-orchestrator-kit hooks-setup
# or: npx agent-orchestrator-kit init --hooks
```

- If `.husky/` exists, a marked line `sh scripts/pre-commit-gate-check.sh` is appended to `.husky/pre-commit` (idempotent; existing content is kept). `core.hooksPath` is not changed.
- Otherwise the kit writes committed `.githooks/pre-commit` and runs `git config core.hooksPath .githooks`. If `core.hooksPath` is already set to something else, the command refuses and prints a manual line to add.
- Lefthook: add `sh scripts/pre-commit-gate-check.sh` to your pre-commit job yourself (no auto-write).
- `init` without `--hooks` still installs `scripts/pre-commit-gate-check.sh` as a managed file, unconnected.
- Disable: remove the marked line from `.husky/pre-commit`, or `git config --unset core.hooksPath`.
- MVP (`require_spec_review: false`): the hook is a no-op (exit 0).
- Keep `agent-orchestrator-kit` in the project's **devDependencies** so `npx agent-orchestrator-kit` on every commit does not cold-fetch from the registry.

Run `hooks-setup` on each machine (`git config` is local), same as `figma-setup`.

### Optional MCP: GitHub, GitLab, browser

Same pattern as Figma: stdio launcher + gitignored env + committed `.example`. Tokens never go in chat or committed MCP JSON.

```bash
npx agent-orchestrator-kit mcp-setup
```

Detection uses `git remote get-url origin` (https and ssh). `--ci` is ignored.

| Origin hostname | Installed VCS MCP |
|-----------------|-------------------|
| `github.com` | GitHub only |
| `gitlab.com` or hostname contains `gitlab` (self-hosted) | GitLab only; `GITLAB_API_URL=https://<hostname>/api/v4` |
| missing / unrecognized | no VCS MCP (`status` shows skipped) |

Browser MCP (`@playwright/mcp`) is always added unless you pass `--no-browser`. Override detection with `--vcs github` or `--vcs gitlab`.

```bash
npx agent-orchestrator-kit mcp-setup --vcs gitlab --no-browser
```

Then put tokens **only** in the gitignored files (never in chat):

| Path | Git |
|------|-----|
| `.agents/github.local.env` | ignored |
| `.agents/gitlab.local.env` | ignored |
| `.agents/*.local.env.example` | committed |
| `scripts/*-mcp-launcher.cjs` | committed |

Cursor, Claude Code, and Amp all spawn the same launchers. Committed examples list all five servers (`memory`, `figma`, `github`, `gitlab`, `browser`); live `.mcp.json` / `.amp/settings.json` receive only the detected VCS plus browser.

`npx agent-orchestrator-kit status` prints MCP health (`ok` / `not configured` / `skipped`) without token values.

---

### Design intake: `/opsx:design`

Optional phase between explore and propose (or before apply) that captures design into a durable artifact so implement sessions do not depend on live Figma MCP:

```
/opsx:design add-login-form
```

Writes only:
- `openspec/changes/<name>/design-brief.md` — Source, Structure, Tokens, Reference images, Constraints, Confidence notes
- `openspec/changes/<name>/assets/` — reference PNGs

Source fallback: Figma MCP (one pass) → exported images → screenshots → photos. Raster sources must mark inferred values with confidence notes.

**Opt-in gate** (default off — existing projects unchanged):

```yaml
pipeline:
  require_design_brief: true   # gate-check fails without brief when src/ changed
```

Non-UI changes: add this line to `proposal.md`:

```
Design: none
```

**Existing projects after `update`:** the command file `opsx-design.md` is installed automatically. Your `orchestrator.yaml` is never overwritten — add the role and flag manually if you want the gate:

```yaml
pipeline:
  require_design_brief: false   # set true to enforce
roles:
  design_intake:
    command: /opsx:design
    mode: brief-only
    model_hint: strong
```

---

### Archive — `/opsx:archive`

After PR merged + CI green:
```
/opsx:archive add-bulk-camera-export
```

Archive is a **deterministic CLI**, not an agent workflow:

```bash
npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force] [--collect]
```

It checks the gates (APPROVE in `review.md` when required, all tasks `[x]`, target folder free), merges delta specs into `openspec/specs/` (`--sync`: ADDED append, MODIFIED replace, REMOVED delete), moves the change to `openspec/changes/archive/YYYY-MM-DD-<name>`, and runs `npx openspec validate --all --strict` with a full rollback on failure (main specs restored, new spec files deleted, move reverted). With delta specs present you must decide: `--sync` merges, `--no-sync --force` archives without merging, and no flag refuses with exit 1. It finishes by writing the final `handoff.md` (`next_command: none`), updating memory, appending an Archiver session, and printing the same human metrics summary as `metrics <name>`. Archive collects the locked client (Cursor hook / Amp threads / Claude JSONL) in `[pending.startedAt, now]` plus leftover of the previous session — the same leftover-then-collect flow as persist. `--collect` still runs every adapter. Unique `## Metrics` in the change `handoff.md` still counts as Archiver self-report; leftover apply numbers that match the previous session are ignored. The `/opsx:archive` command is a thin wrapper that calls this CLI; the `spec-archiver` subagent remains only as a fallback when the CLI is unavailable.

## Configuration

Edit `.agents/orchestrator.yaml` after init:

```yaml
project:
  name: "My Project"
  agent_language: uk      # response language for agents

pipeline:
  require_spec_review: true
  require_design_brief: false   # opt-in: require design-brief.md when src/ changed
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

## Figma token (optional)

Personal Access Token for design intake (`/opsx:design`) and the optional Framelink `figma-developer-mcp` server. **Never paste the token into AI chat.**

### Setup (each developer, once)

```bash
npx agent-orchestrator-kit figma-setup
# open .agents/figma.local.env in the IDE and set:
# FIGMA_ACCESS_TOKEN=figd_...
npx agent-orchestrator-kit figma-status
```

Then restart Cursor / Amp.

| Path | Purpose | Git |
|------|---------|-----|
| `.agents/figma.local.env` | Your token (`FIGMA_ACCESS_TOKEN`) | **ignored** |
| `.agents/figma.local.env.example` | Template | committed |
| `scripts/figma-mcp-launcher.cjs` | Starts MCP with token from the env file | committed |
| `.mcp.json` → `figma` | Points at the launcher (no secret inline) | committed OK |

Create a token: Figma → Settings → Security → Personal access tokens (file content read as needed).

### CLI

```bash
npx agent-orchestrator-kit figma-setup
npx agent-orchestrator-kit figma-status
npx agent-orchestrator-kit figma-fetch --url "https://www.figma.com/design/FILE_KEY/Name?node-id=1-2" \
  --out openspec/changes/<name>/assets/figma-nodes.json
# large frames: limit tree depth
npx agent-orchestrator-kit figma-fetch --file FILE_KEY --nodes 1:2 --depth 2 --out figma-nodes.json
```

`figma-fetch` uses the Figma REST API (`X-Figma-Token`) and writes JSON for design-brief capture. Live Figma is for design-intake only — apply uses `design-brief.md`.

### Upgrade existing projects

```bash
npx agent-orchestrator-kit@latest update
npx agent-orchestrator-kit figma-setup
./scripts/sync-local-agent-skills.sh
```

## Memory MCP — Shared State Between Sessions

Each role starts a fresh session. OpenSpec artifacts remain the source of truth; Memory MCP and `openspec/changes/<name>/handoff.md` are the phase index used to resume without re-explanation.

**Standard entities to save:**

```
Change:add-bulk-export     status: spec-approved, tasks: 0/7, last_role: reviewer, review: APPROVE
Decision:export-format     chosen: xlsx, reason: matches existing reports
Handoff:add-bulk-export    next_role: implementer, next_command: /opsx:apply add-bulk-export,
                           session_count: 2, summary: ..., blocked: none
```

Session boundaries are **parent-driven** (no routine subagent): every `/opsx:*` session restores via `npx agent-orchestrator-kit handoff --restore` (the CLI briefing already reads memory.json and `handoff.md`), falling back to reading `handoff.md` directly if the CLI fails. At exit the parent itself writes `handoff.md`, runs `npx agent-orchestrator-kit handoff <name>` (upserts `.cursor/memory.json` with an absolute path), and pastes the CLI stdout prompt. The `session-handoff` subagent is spawned only when the CLI path fails; Memory MCP is an optional mirror. The prompt is self-contained — Amp often skips Memory MCP, so the next thread must be able to work from the pasted text alone. Never configure Memory with a relative `MEMORY_FILE_PATH`; use `scripts/memory-mcp-launcher.cjs` (`npx agent-orchestrator-kit memory-setup`). The next phase always starts in a new chat. The canonical Session Start / Exit protocol lives in one place — `.agents/rules/session-handoff.mdc` — and the `/opsx:*` commands reference it instead of duplicating it.

### Change decisions (`decisions.md`)

Session decisions accumulate in git-tracked, append-only `openspec/changes/<name>/decisions.md`. That file is the canon visible in a PR/MR; Memory `Decision:*` is a **file → Memory** mirror only.

```bash
npx agent-orchestrator-kit handoff add-bulk-export
# appends dated bullets from handoff.md ## Decisions (skips duplicates; same topic + new text → new row)
npx agent-orchestrator-kit handoff add-bulk-export --restore
# prints decisions from the git file (or `decisions: none` if the file does not exist)
```

`Decisions: none` does not create the file. Re-running persist with the same handoff does not duplicate rows. A later revision of the same topic is a new line; the old line stays. `update` does not migrate historical Memory entities into the file.

### Cloud agent handoff (Phase 3)

Every persist writes a `## Runtime` section to `openspec/changes/<name>/handoff.md`:

```
## Runtime
- runtime: local|cloud
- agent_id: <id|none>
```

Detection is a fixed chain (no TTY / `CURSOR_AGENT` magic): `--runtime` → env `AOK_RUNTIME` → `CLOUD_ENV_MARKERS` (starts with `CURSOR_BACKGROUND_AGENT`) → existing `## Runtime` in the file → `local`. `agent_id` uses `--agent-id` → `AOK_AGENT_ID` → existing value → `none`. Invalid `--runtime` (not `local` or `cloud`) exits non-zero. Legacy files without Runtime stay valid; the next persist appends the section.

Configure a cloud agent once:

```
AOK_RUNTIME=cloud
AOK_AGENT_ID=<vm-or-run-id>
```

`--cloud-check` is a **separate** branch of `handoff`, never part of persist (persist has just rewritten `handoff.md`, so the tree is always dirty at that point). It verifies (1) `git status --porcelain -- openspec/changes/<name>/` is empty and (2) the current branch has an upstream with no unpushed commits. Verdict: `cloud` + any failure = non-zero; `local` + the same failure = warning + exit 0; clean = exit 0. The CLI never runs `git commit` or `git push`.

Cloud Session Exit order:

```bash
npx agent-orchestrator-kit handoff <name> --runtime cloud
git add openspec/changes/<name>/
git commit
git push
npx agent-orchestrator-kit handoff <name> --cloud-check   # require exit 0
```

Persist with `runtime: cloud` prints those four steps on stderr; stdout stays the pure `/opsx:` next-thread prompt. Local persist is unchanged.

### Change metrics

Every change accumulates git-tracked `openspec/changes/<name>/metrics.json` — the data source for planning the next feature: how long each phase took, how many sessions it needed, what it cost.

- **`## Metrics` self-report** — Session Exit fills `handoff.md` with `platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`, `spend_source` (`unknown` when missing). Persist reads that section; `metrics.json` is the source of truth for what landed. CLI flags do not rewrite the section.
- **`session.model`** — source product id wins when any collected source has a model; `--model` / `## Metrics: model` / `AOK_MODEL` apply only when sources have no model. Never a Closed role.
- **Session start** — `handoff --restore` writes a `pending` marker (`startedAt`, expected role).
- **Session end** — `handoff <name>` closes the pending session: duration, closed role, mapped phase (`explore` / `design` / `spec` / `review` / `apply` / `archive`), runtime (local/cloud), tasks snapshot (`n/m`), and spend from flags → self-report → adapters. Persist collect window is `[pending.startedAt, endedAt]`; a late hook after persist goes to leftover of that session, not the next persist. `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd` override session totals only and do not wipe `spendByPlatform` / `spendByModel`. Amp billed USD comes from `amp threads usage --details` (`Cost: $N` only; missing line → `costUsd: null`), not from converting credits. Cursor always writes a labeled `costUsdEstimated` when tokens exist: grok-4.6/4.5 use xAI API rates (`costSource: api-estimate`, including `-fast` and the 200k cliff); other models use a versioned fallback of $3/1M input + $15/1M output (or $3.50/1M when only `totalTokens` is present, `costSource: api-estimate-fallback`). That estimate is **not** the Cursor invoice and is never added into billed `costUsd`. Timestamps are ISO-8601 UTC (`…Z`). No restore marker? Pass `--started-at <iso>` or the duration stays honestly `null`.
- **Archive** — successful `archive <name>` always creates or finalizes `metrics.json`, sets `archivedAt`, appends an Archiver session, collects the locked client (Cursor hook / Amp export+usage / Claude JSONL) in `[pending.startedAt, now]` plus leftover of the previous session, and prints the same human summary as `metrics <name>`. `--collect` still runs all three adapters. Leftover apply `## Metrics` that repeats the previous session is ignored so those tokens are not counted twice.
- **`sessionEnd` leftover** — `scripts/cursor-spend-collect.cjs` also reads the newest `openspec/changes/archive/*-<name>/metrics.json` when the active change folder is gone, so a late hook after archive still attaches. `stop` / `afterAgentResponse` run the same leftover after a successful jsonl append. When `last.threadId` is non-empty, leftover keeps only rows whose `conversationId` matches that id (empty/`null` threadId stays time-only). In a multi-root window leftover walks every candidate that has `openspec/changes`, reading that root’s jsonl. Aggregates write `costUsdEstimated` with 4 decimal places. Each `phases.<phase>` stores `startedAt` / `endedAt` / `leadTimeMs` from that phase’s sessions; `durationMs` stays the work-time sum and does not clone `totals.leadTimeMs`.
- **Cursor `conversationId`** — restore writes `CURSOR_CONVERSATION_ID` into `pending.threadId`; Cursor collect and sessionEnd leftover skip rows whose `conversationId` does not match when a filter id is present (`last.threadId` on leftover).
- **Canonical role** — `session.role` stores the first known token (`Explorer`, `Architect`, `Spec Reviewer`, `Implementer`, `Archiver`, `Design Intake`); Closed role in `handoff.md` MAY keep a sentence after `—`.
- **Platform** — `--platform` → `## Metrics: platform` → `AOK_PLATFORM` → **pending client from `--restore`** → host env (Amp / Cursor / Claude Code) → collected sources (`cursor|claude|amp` only). Invalid `--platform` fails before persist/move.
- **Locked client** — `--restore` records `pending.platform` and Amp `pending.threadId` before phase work. Persist follows that client’s flow even if persist runs in another shell (no `AMP_*` / `CURSOR_*`). Amp: `amp threads export` plus `amp threads usage --details` (`AOK_AMP_BIN`) and local `threads/*.json`. Export supplies `model` / tokens / `agentMode`; usage supplies billed `$`. If Amp runs tools over a pipe (`/dev/null`), thread id comes from `amp threads list`, not stale `session.json` `lastThreadId`. Cursor: spend hook file. Claude: `~/.claude/projects`. `--collect` still runs all three adapters.
- **Cursor spend hook (optional)** — Cursor never writes token usage to disk, so the kit can install `scripts/cursor-spend-hook.cjs` plus `.cursor/hooks.json` entries (`stop` / `subagentStop` / `afterAgentResponse`) in `init` / `update` / `sync` / `mcp-setup`: the hook appends each turn's tokens to gitignored `.agents/spend/cursor-usage.jsonl`. After a successful `stop` / `afterAgentResponse` append the hook runs leftover (fail-open, no stdout). Hook and collect resolve the consumer in a multi-root window (not the first cwd with `.agents` or `openspec`). Persist auto-reads that file when the locked client is Cursor. Persist and restore do not self-heal the hook. `sessionEnd` still runs `scripts/cursor-spend-collect.cjs`. Restart Cursor once after the first install. `status` shows a `Spend capture` section. Claude JSONL remains a fallback. Amp web/CLI spend is taken from `amp threads export` (tokens, model, `agentMode`) and `amp threads usage` (billed USD).

Aggregates are recomputed on every write: per-phase totals (`startedAt`, `endedAt`, `leadTimeMs` from that phase’s sessions, `durationMs` = sum of session work time — not `totals.leadTimeMs` and not `endedAt − startedAt`, tokens, `costUsd`, `costUsdEstimated` to 4 decimals, `sessions`, `roles`, `models`) plus overall `totals` (`sessions`, `cloudSessions`, `durationMs` = sum of session work time, `leadTimeMs` = wall clock from first session start to last session end), `spend` (USD only), and separate **by platform** / **by model** tables. Numbers are null-honest: a metric nobody reported stays `null`, never a fake `0`. No single total that adds Amp credits to USD.

Fill `## Metrics` in `handoff.md` **before** persist (unknown is fine; do not invent `0`):

```markdown
## Metrics
- platform: cursor
- model: cursor-grok-4.6
- input_tokens: 128000
- output_tokens: 9400
- cost_usd: unknown
- amp_credits: unknown
- spend_source: self-report
```

```bash
npx agent-orchestrator-kit handoff add-thing
npx agent-orchestrator-kit handoff add-thing --collect   # optional: Claude JSONL / Amp threads / Cursor hook
npx agent-orchestrator-kit metrics add-thing             # human summary: phases, tokens, cost, roles / models
npx agent-orchestrator-kit metrics add-thing --json      # raw metrics.json (works for archived changes too)
npx agent-orchestrator-kit archive add-thing --sync      # finalize + the same tables as metrics
```

Recording is on by default and never a persist/archive/`gate-check` gate; opt out per persist with `--no-metrics`. Persist and archive collect the locked client without `--collect`; `--collect` runs every adapter. Flags (`--model`, `--platform`, `--input-tokens`, …) override session totals in `metrics.json` and do not rewrite the `## Metrics` section.

### Skill inventory

`.agents/orchestrator.yaml` carries a machine-readable `skills:` section (`kit` / `stack` / `external`) instead of hardcoded skill names in the CLI:

```yaml
skills:
  kit:
    - agent-orchestration
    - openspec-howto
    # ... remaining kit skills
  stack: []                 # vue3: vue-core, vue-pinia, vue-axios, vue-router
  external: ""              # vue3/node: frontend-agent-skills
```

`npx agent-orchestrator-kit status` prints **Skill health** after MCP health (`ok` / `missing` / `stale`) for kit + stack skills and Amp `subagent-*` wrappers. The section is warn-only: missing or stale skills never change the exit code. Repair with the existing commands — `sync` (stale IDE copies), `update` (missing kit files), or a manual stack install:

```bash
npx frontend-agent-skills install --agent all --yes
```

The CLI never auto-installs external skill packages. `.agents/orchestrator.yaml` is outside kit-managed paths, so `update` does **not** refresh `skills.kit` — after a kit skill is added or removed, edit that list by hand (or re-init with `--force`).

## Amp Code — Deep Integration Notes

Amp is the **primary target** of this kit. It reads `.agents/skills/` and `AGENTS.md` without any sync step — your team commits `.agents/` and everyone gets the same orchestration behavior automatically.

**Amp-specific features used:**

| Feature | How the kit uses it |
|---------|-------------------|
| `AGENTS.md` subtree loading | Per-domain AGENTS.md in `openspec/` subtree |
| `.agents/skills/` | All orchestration + domain skills |
| `mcp.json` in skill dir | Lazy MCP loading (Memory only when needed) |
| Subagents | Conductor routing + isolated `subagent-*` wrappers |
| Amp modes (rush/smart/deep) | Per-role model hints in AGENTS.md |

**Amp generated wrapper** (`.agents/skills/subagent-codebase-explorer/SKILL.md`):

```yaml
---
name: subagent-codebase-explorer
description: Read-only repository research specialist...
---

CRITICAL (Amp / Cursor / Claude): Parent MUST spawn this skill as an isolated subagent with fresh context.
Do not execute it in the main thread. If spawn is unavailable, STOP and report blocked.
```

The conductor invokes the wrapper in isolation and consumes only its structured report.

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
  --hooks            Opt-in: install pre-commit gate-check hook (husky-first)
  --force            Overwrite existing files

npx agent-orchestrator-kit update
  Updates kit-managed files, preserves project overlay

npx agent-orchestrator-kit sync [options]
  --target <ide>     cursor | claude | amp | all (default: all)
  Copies .agents/ to local IDE directories, removing skills/rules no longer
  present in .agents/ (does not touch memory.json, .mcp.json, CLAUDE.md, etc.)

npx agent-orchestrator-kit status
  Show progress, review verdict, archive-readiness, MCP health, and Skill health
  (warn-only; missing/stale skills do not fail the command)

npx agent-orchestrator-kit gate-check [change-name] [options]
  --src-glob <glob>  Source path filter used to detect code changes (default: src/)
  --base <ref>       Git ref to diff against (default: HEAD~1)
  --staged           Check staged files (git diff --cached) instead of --base
  --tasks <name>     Lint task contracts (Files / Do / Done-when)
  --review <name>    Deterministic Tier 1 review (optional --json)
  Exit non-zero when require_spec_review is true, src/ changed, and the
  active change has no review.md with Verdict: APPROVE. Graceful no-op
  otherwise (missing config, review not required, no relevant diff).

npx agent-orchestrator-kit hooks-setup
  Opt-in pre-commit gate (husky-first, else core.hooksPath=.githooks)

npx agent-orchestrator-kit mcp-setup [--vcs github|gitlab] [--no-browser]
  Install GitHub/GitLab (from origin) and browser MCP launchers

npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force] [--collect]
  Gate-check a completed change, optionally merge delta specs, move to
  openspec/changes/archive/YYYY-MM-DD-<name>, validate, write final handoff,
  and print the change-wide metrics summary. --collect also runs adapters.

npx agent-orchestrator-kit handoff [change-name] [options]
  --restore          Print the restore briefing instead of persisting
                     (also records the session start into metrics.json)
  --runtime <value>  local | cloud (invalid values exit non-zero)
  --agent-id <id>    Cloud agent identifier (default: none)
  --cloud-check      Verify change artifacts are committed and pushed
                     (cloud: non-zero on failure; local: warning, exit 0)
  --started-at <iso> Session start override when --restore was not run
  --model <name>     LLM product id (metrics.json); never a Closed role
  --platform <id>    cursor | claude | amp
  --input-tokens <n> / --output-tokens <n> / --total-tokens <n>
                     Token spend for this session (total defaults to in+out)
  --cost-usd <usd>   Session cost in USD
  --collect          Also run local spend adapters (off by default)
  --no-metrics       Skip recording this session into metrics.json

npx agent-orchestrator-kit metrics [change-name] [--json] [--collect]
  Show recorded session metrics for a change (active or archived):
  time per phase, sessions, tokens, cost, roles, models, lead time.
  --collect backfills the last session from adapters without adding a session.
```

## Directory Reference

```
.agents/                 # Committed — source of truth for all IDEs
  commands/              # /opsx:* command definitions
  rules/                 # Auto-applied rules for Cursor
  subagents/             # Custom subagents (source of truth, all IDEs)
  skills/                # Skills for Cursor, Claude Code, Amp
                         #   subagent-*/ — auto-generated Amp wrappers (do not edit)
  orchestrator.yaml      # Project pipeline config

.cursor/                 # Local only — Cursor IDE runtime
  skills/                # Synced from .agents/skills/
  rules/                 # Synced from .agents/rules/
  agents/                # Synced from .agents/subagents/
  memory.json            # Memory MCP data

.claude/                 # Local only — Claude Code runtime
  skills/                # Synced from .agents/skills/
  agents/                # Synced from .agents/subagents/
  CLAUDE.md              # Synced from root CLAUDE.md

.amp/                    # Local only — Amp config
  settings.json          # MCP servers (manual or via amp mcp add)

AGENTS.md                # Committed — Amp + Claude (AGENT.md fallback)
CLAUDE.md                # Committed — synced to .claude/CLAUDE.md
openspec/                # Committed — spec-driven workflow
  config.yaml            # Project context for AI
  specs/                 # Source of truth after archive
  changes/               # Active work; <name>/handoff.md + metrics.json index session state
```

## Roadmap

The kit moves toward an Agentic Factory in four phases. **One phase = one OpenSpec change**; the next phase does not start until the previous change is archived.
1. `add-factory-gates-and-mcp` — local review gate on commit and Figma-style MCP launchers (GitHub / GitLab / browser). Implemented: `hooks-setup`, `mcp-setup`, `gate-check --staged`, MCP health in `status`.
2. `add-factory-memory-and-skills` — git-canonical decisions with Memory MCP as a mirror, plus a machine skill inventory. Implemented: append-only `decisions.md`, Skill health in `status`.
3. `add-cloud-agent-handoff` — session artifacts exist only on git-tracked paths. Implemented: `## Runtime` in `handoff.md`, `--runtime` / `--agent-id` / `--cloud-check`, cloud Session Exit.
4. Phase 4 (`add-factory-control-plane`) is an opt-in platform decision, not the next sprint.
Phase bounds and non-goals: [`openspec/specs/agentic-factory-roadmap/spec.md`](openspec/specs/agentic-factory-roadmap/spec.md).

## Changelog

### 0.12.0
- Cursor leftover after `stop` / `afterAgentResponse` (fail-open, idempotent `sessionEnd`); leftover filters `last.threadId` when it is set
- Multi-root hook/collect resolve the consumer window; leftover walks every candidate with `openspec/changes`
- `costUsdEstimated` aggregates write 4 decimals; `phases.<phase>` stores `startedAt` / `endedAt` / `leadTimeMs` (work-time `durationMs` is not `totals.leadTimeMs`)

### 0.11.0
- Session metrics attribution: persist collect is `[pending.startedAt, endedAt]`; a late hook stays leftover of that session; archive is `[pending.startedAt, now]` plus leftover of the previous session
- Source product id wins for `session.model`; `--model` / `## Metrics` / `AOK_MODEL` apply only when sources have none
- Cursor `sessionEnd` writes `costUsdEstimated`; `stop` + `afterAgentResponse` no longer double-count a turn

### 0.10.0
- `costUsdEstimated` is first-class on `metrics.json`; Cursor writes a labeled estimate whenever tokens exist — grok via xAI API (`costSource: api-estimate`), other models via versioned fallback $3/1M in + $15/1M out (or $3.50/1M when only `totalTokens`, `costSource: api-estimate-fallback`). The estimate is **not** an invoice and is never mixed into billed `costUsd`. Amp without a `Cost:` line leaves `costUsd: null`; self-report `cost_usd` stays billed.

### 0.9.0
- **UTC timestamps** in `metrics.json` (`…Z`; broken Amp stamps parsed and normalized)
- Amp `threads usage --details` billed `$` + `agentMode` (never stored as `session.model`)
- Cursor `costUsdEstimated` from xAI API rates for grok-4.6/4.5 — labeled, not mixed into billed `costUsd`
- **Archive auto-collect** — Archiver session picks up the locked client after the last session; leftover apply `## Metrics` is not double-counted

### 0.8.0
- Locked session client on `--restore`; persist collects only that client without `--collect`
- Amp CLI `threads export` + `threads list` when Amp runs over a pipe

### 0.7.0
- **`## Metrics` self-report** — persist reads the session section in `handoff.md`; `metrics.json` is the source of truth; CLI flags do not rewrite the section
- **BREAKING** — `--no-collect` removed; `handoff` and `archive` collect local adapters only with opt-in `--collect`
- Archive prints the same human summary as `metrics <name>` (by phase / platform / model, `spendSource`, unreported count)
- Cursor spend hook is optional setup (`init` / `update` / `sync` / `mcp-setup`); persist and restore no longer self-heal `.cursor/hooks.json`

### 0.6.0
- **Mandatory Cursor spend hook** — `scripts/cursor-spend-hook.cjs` + `.cursor/hooks.json` (`stop` / `subagentStop` / `afterAgentResponse`) write `.agents/spend/cursor-usage.jsonl`; `sessionEnd` + `metrics --collect` backfill the last session; installed by `init` / `update` / `sync` / `mcp-setup` and self-healed on `handoff`
- Persist/archive auto-collect local usage from Claude JSONL, Amp threads, and the Cursor hook file into `spendByPlatform` / `spendByModel`
- Amp source ids namespaced as `<threadId>:<messageId>` so thread-local counters do not collide
- `status` prints a `Spend capture` section

### 0.5.0
- **Change metrics** — git-tracked `openspec/changes/<name>/metrics.json` (session start on `handoff --restore`, close on persist)
- **`metrics` CLI** — human summary or `--json`; phases, tokens, cost, agents, models, lead time
- Optional persist spend flags: `--model`, `--input-tokens`, `--output-tokens`, `--total-tokens`, `--cost-usd`, `--started-at`, `--no-metrics`

### 0.4.0
- Factory phases 1–3: `hooks-setup` / `gate-check --staged`, `mcp-setup` (GitHub / GitLab / browser), MCP and Skill health in `status`
- Git-canonical append-only `decisions.md`; Memory `Decision:*` is a file→Memory mirror
- Cloud agent handoff: `## Runtime` in `handoff.md`, `--runtime` / `--agent-id` / `--cloud-check`

### 0.3.0
- **`archive` CLI** — deterministic archive with gates, `--sync` delta merge, and rollback on validate failure
- **Task contract** — `gate-check --tasks` enforces `Files:` / `Do:` / `Done-when:` (`pipeline.task_contract: warn|strict|off`)
- **Tiered review** — `gate-check --review` is machine Tier 1; `spec-reviewer` writes `apply-notes.md` on APPROVE
- Lean apply (parent-driven) and parent-driven session handoff; `opsx-archive.md` is a thin CLI wrapper

### 0.2.0
- Thinned always-apply rules and `AGENTS.md` / `CLAUDE.md` (context budget); details stay in on-demand skills

### 0.1.14
- **HARD STOP session handoff** — `session-handoff` subagent at start/exit; Amp isolated `subagent-session-handoff`
- **`handoff` CLI** — writes `handoff.md`, upserts `.cursor/memory.json` with an absolute path, prints an expanded self-contained next-thread prompt
- **`memory-setup` + `memory-mcp-launcher.cjs`** — never a relative `MEMORY_FILE_PATH` (Amp was reading the wrong graph)
- Next-thread prompt includes role, spawn instructions, Done/Decisions/Blocked, and exit HARD STOP

### 0.1.13
- Pipeline **conductor**: `/opsx:*` parent spawns the routed specialist and does not do that work itself
- Five new stage subagents: `codebase-explorer`, `design-intake`, `spec-architect`, `spec-reviewer`, `spec-archiver`
- Session handoff: Memory → `handoff.md` → next-session prompt in `project.agent_language` (read Memory on start)
- Amp `subagent-*` wrappers must run as isolated subagents, not in the main thread

### 0.1.12
- `figma-fetch --depth <n>` for large frames
- Write large Figma JSON as raw API text (avoids `Invalid string length` on huge trees)

### 0.1.11
- Optional **Figma personal token** setup: `.agents/figma.local.env` (gitignored) + `figma-mcp-launcher.cjs` (no secret in `.mcp.json`)
- CLI: `figma-setup`, `figma-status`, `figma-fetch` (REST nodes/file JSON)
- Agent rule + docs: never paste Figma tokens into chat
- Amp PATH hardening: prefer `npx` / `npm run` for OpenSpec and kit CLIs (`cli-via-npm` rule)

### 0.1.10
- Custom subagents (`.agents/subagents/`) synced to `.cursor/agents/` + `.claude/agents/`, exposed to Amp via auto-generated `subagent-*` skill wrappers
- 6 default subagents: `openspec-guide`, `code-writer`, `code-reviewer`, `test-writer`, `setup-doctor`, `design-implementer`
- `update` no longer resurrects deleted CI workflow files

### 0.1.9
- Design intake — `/opsx:design` captures design into `design-brief.md` + `assets/` (Figma / export / screenshot / photo)
- Role `design_intake` + opt-in `pipeline.require_design_brief` (default `false`) in all profiles
- `gate-check` enforces design brief when enabled (`Design: none` opt-out for non-UI); `status` shows `brief: yes/no`

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
