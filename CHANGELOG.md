# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **`costUsdEstimated` first-class** in `metrics.json` (`spend`, platforms, models, sessions, sources). Cursor writes a labeled estimate whenever tokens exist: grok-4.5/4.6 keep xAI API rates (`costSource: "api-estimate"`); other models use a versioned fallback of $3/1M input + $15/1M output (or $3.50/1M when only `totalTokens` is present, `costSource: "api-estimate-fallback"`). This is **not** a Cursor invoice and is never mixed into billed `costUsd`. Self-report `cost_usd` stays billed and is not copied into `costUsdEstimated`. Amp without a `Cost:` line leaves `costUsd: null` (tokens are not converted to USD; credits stay separate). Archived `metrics.json` files are not backfilled.

## [0.9.0] - 2026-08-31

### Added
- **UTC timestamps in `metrics.json`** — `createdAt` / `updatedAt` / `archivedAt` / session times / source `at` are stored as ISO-8601 UTC (`2026-08-31T07:08:17.563Z`). Broken Amp stamps like `2026-08-31T07:08:17.563464.000Z` are parsed and normalized to UTC. Human `metrics` output still prints Kyiv wall time (`31.08.2026 10:08:17 (Київ +03:00)`).
- **Amp `threads usage`** — when the locked client is Amp, persist also runs `amp threads usage <id> --details` (fail-open) and writes the billed `costUsd`, per-model costs, and `agentMode` (`low` / `medium` / `high` / `ultra`) from `amp threads export`. Mode is never stored as `session.model`. Placeholder `amp-default` yields to the real LLM id from sources.
- **Cursor API-equivalent estimate** — hook tokens for `cursor-grok-4.6` / `4.5` (including `-fast`, 200k long-context cliff, cache reads when present) fill `costUsdEstimated` with `costSource: "api-estimate"`. This is **not** the Cursor invoice and is never mixed into billed `costUsd`.
- **Archive auto-collect** — `archive <name>` detects the current client (`resolveRestoreClient`) and records Archiver spend from that adapter (Cursor hook / Amp export+usage / Claude JSONL) in the window after the last session. Leftover apply `## Metrics` numbers are ignored when they match the previous session. `--collect` still runs all three adapters.

### Changed
- `metrics` / archive summary cost line shows `$1.30 billed + ~$8.98 est.` when both exist.

## [0.8.0] - 2026-08-31

### Added
- **Locked session client** — `handoff --restore` detects `cursor` / `claude` / `amp` (env, Amp parent process, or recent `session.json` tty mapping) and stores `pending.platform` + `pending.threadId`. Persist follows that client: Amp runs `amp threads export` plus local thread JSON; Cursor reads the spend hook; Claude reads `~/.claude/projects`. `--platform` / `AOK_PLATFORM` / `## Metrics` still override.
- **Amp CLI export adapter** (`amp-cli`) — when the locked client is Amp (or `--collect`), the kit calls `amp threads export <id>` (override `AOK_AMP_BIN`). Fail-open if Amp CLI is missing. `agentMode` (`low`/`medium`) is never stored as `session.model`.
- **Amp web / pipe restore** — if the parent process is `amp` and stdin is `/dev/null` (no pts), the kit takes the newest id from `amp threads list` instead of stale `session.json` `lastThreadId`.

### Changed
- Persist without `--collect` now collects **only the locked/resolved client**, not all three adapters. `--collect` still runs every adapter.

## [0.7.0] - 2026-08-30

### Breaking
- **`--no-collect` removed** — persist and archive no longer collect local spend adapters by default. Pass `--collect` to run Claude JSONL, Amp thread, and Cursor hook adapters. Scripts that still pass `--no-collect` fail as an unknown option.

### Added
- **`## Metrics` in `handoff.md`** — Session Exit self-report (`platform`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `amp_credits`, `spend_source`). Persist and archive resolve spend from flags → self-report → optional `--collect` sources. The section stays the agent's declaration; `metrics.json` is the source of truth.
- **`session.spendSource`** and **`session.ampCredits`** — origin of the numbers (`self-report` / `flag` / `adapter` / `unreported`, or a custom `spend_source`) and Amp credits kept out of USD totals.
- **Archive summary** — after finalize, `archive` prints the same human tables as `metrics <name>` (by phase / platform / model, unreported count).

### Changed
- **Resolve chains** — `model`: `--model` → `## Metrics` → `AOK_MODEL` → sources (with `--collect`) → `null`. `platform`: `--platform` → `## Metrics` → `AOK_PLATFORM` → host env → sources.
- **Cursor spend hook** — still installed by `init` / `update` / `sync` / `mcp-setup`; persist, restore, and `metrics` no longer self-heal `.cursor/hooks.json`.
- **`spendByPlatform` / `spendByModel`** — include session-level self-report; matching `sources` are counted once; buckets without adapters keep `source: "none"`.

### Fixed
- **Spend collect window** — persist no longer starts the collect window at `pending.startedAt`. Window is `[last session.endedAt || createdAt, endedAt]`.
- **Amp collect without trees** — a thread is no longer skipped solely because `env.initial.trees` is missing; cwd fields, `AMP_CURRENT_THREAD` / `AMP_THREAD_ID`, or an exact cwd mention still match.
- **Amp leftover after persist/archive** — persist and archive run the same last-session backfill as `metrics --collect`.

## [0.6.0] - 2026-08-29

### Added
- **Mandatory Cursor spend hook** — `scripts/cursor-spend-hook.cjs` (fail-open, silent) appends per-turn token usage from Cursor `stop` / `subagentStop` hook payloads to gitignored `.agents/spend/cursor-usage.jsonl`; `ensureCursorSpendHook` installs the script and merges `.cursor/hooks.json` in `init`, `update`, `sync`, `mcp-setup`, and self-heals on every `handoff` restore/persist (persist reports to stderr only) so every kit project records Cursor spend without manual flags; `status` prints a `Spend capture` section (cursor hook state + record count, local Claude/Amp data presence)

### Changed
- **Change metrics** — `session.model` resolves `--model` → `AOK_MODEL` → `null` (stderr warning); persist/archive auto-collect local usage from Claude JSONL, Amp threads, and the Cursor spend hook file (`.agents/spend/cursor-usage.jsonl`) into separate `spendByPlatform` / `spendByModel` figures (flags override session totals only; never merge Amp credits into USD); human `metrics` table prints `roles` and `models` plus platform/model tables; `archive` always creates or finalizes `metrics.json` with an Archiver session; Session Exit protocol requires `--model <llm-product-id>`
- **Cursor spend adapter** — replaced the dead `state.vscdb` probe (Cursor never writes token usage to its local DB) with reading the hook-generated `.agents/spend/cursor-usage.jsonl` (window by `at`, dedup by `generation_id`, cumulative loop repeats keep the largest record, `source: "cursor-hook"`)

### Fixed
- **Amp source ids** — `messageId` is a thread-local counter (1, 3, 5…), so dedup ids are now namespaced as `<threadId>:<messageId>` to prevent collisions across threads

## [0.5.0] - 2026-08-29

### Added
- **Change metrics** — git-tracked `openspec/changes/<name>/metrics.json`: `handoff --restore` records the session start (`pending` marker), `handoff <name>` closes the session (duration, closed role → phase `explore|design|spec|review|apply|archive`, runtime, tasks snapshot, optional `--model` / `--input-tokens` / `--output-tokens` / `--total-tokens` / `--cost-usd`, `--started-at` when restore was skipped, `--no-metrics` to opt out), `archive <name>` sets `archivedAt`; per-phase and total aggregates (durations, tokens, cost, agents, models, `leadTimeMs`) are recomputed on every write and unreported values stay null-honest
- **`npx agent-orchestrator-kit metrics [change-name] [--json]`** — human summary (phases table, spend, recent sessions) or raw JSON; resolves archived changes under `openspec/changes/archive/*-<name>` too

## [0.4.0] - 2026-08-28

### Added
- **Phase 3 cloud agent handoff** — persist writes `## Runtime` (`runtime: local|cloud`, `agent_id`) via `--runtime` → `AOK_RUNTIME` → `CLOUD_ENV_MARKERS` → existing section → `local`; `handoff <name> --cloud-check` blocks on uncommitted/unpushed artifacts for cloud (local: warning, exit 0); persist never commits/pushes — cloud sessions print persist → commit → push → cloud-check on stderr
- **Phase 2 decisions canon** — git-tracked append-only `openspec/changes/<name>/decisions.md`; `npx agent-orchestrator-kit handoff <name>` appends dated bullets from `handoff.md ## Decisions` (no duplicates; same topic + new text keeps history); Memory `Decision:*` mirrors the file (last topic wins, file → Memory only); `handoff --restore` prints from the git file or `decisions: none`
- **Skill inventory** — `skills.kit` / `skills.stack` / `skills.external` in `orchestrator.yaml` (template + all profiles); kit skill list for `init`/`update` is enumerated from `templates/.agents/skills/` (no hardcoded `KIT_SKILL_DIRS`); `status` prints warn-only Skill health (`ok` / `missing` / `stale`) plus Amp wrapper freshness; missing stack skills hint `npx <external> install --agent all --yes` without running an install
- **`agentic-factory-roadmap`** — planning (docs-only) capability: sequences factory phases 1–4 and records platform-level non-goals; implementation stays in later changes
- **Phase 1 factory gates & MCP** — opt-in pre-commit `gate-check --staged` via `hooks-setup` / `init --hooks` (husky-first, otherwise `core.hooksPath=.githooks`; never writes `.git/hooks/`)
- **`mcp-setup`** — GitHub / GitLab / browser stdio launchers (Figma pattern); VCS host from `git remote origin` (not `--ci`); `--vcs` override; `--no-browser`
- **MCP health** in `status` (`ok` / `not configured` / `skipped`) without printing token values
- Committed examples list `memory`, `figma`, `github`, `gitlab`, `browser`; gitignored `.agents/github.local.env` and `.agents/gitlab.local.env`

## [0.3.0] - 2026-08-18

### Added
- **`npx agent-orchestrator-kit archive <name>`** — deterministic archive CLI: gates (APPROVE, all tasks `[x]`, free target), delta-spec merge into main specs with `--sync` (ADDED append / MODIFIED replace / REMOVED delete), explicit refusal without a sync decision (`--sync` or `--no-sync --force`), snapshot + full rollback when `openspec validate --all --strict` fails, final `handoff.md` (`next_command: none`) + memory upsert
- **Task contract lint** — `gate-check --tasks <name>` enforces `Files:` / `Do:` / `Done-when:` per task, rejects vague phrasing and nonexistent `Files:` paths without `new file:`; controlled by `pipeline.task_contract: warn|strict|off` (default `warn`, mvp `off`)
- **Tiered review** — `gate-check --review <name> [--json]` is deterministic Tier 1 (strict validation, task-contract lint, proposal `Non-goals`/`Acceptance criteria`, non-empty delta sections); `spec-reviewer` runs only after Tier 1 passes and writes `apply-notes.md` (≤ 20 lines) on APPROVE

### Changed
- **Lean delegation model** — apply is parent-driven (implementer reads `tasks.md` + `apply-notes.md`, spawns subagents only for ≥ 2 independent tasks or on request, STOP escape valve instead of improvisation); archive is CLI-only with `spec-archiver` demoted to fallback; propose/review specialists remain mandatory
- **Parent-driven session handoff** — canonical Session Start/Exit protocol consolidated in `.agents/rules/session-handoff.mdc`; `/opsx:*` commands reference it instead of duplicating it; `session-handoff` subagent and Memory MCP mirror are fallbacks (`handoff.spawn_handoff_subagent: false` in all profiles); `opsx-archive.md` slimmed to a ≤ 1.5 KB CLI wrapper

## [0.2.0] - 2026-08-18

### Changed
- **Context budget** — thinned always-apply rules and `AGENTS.md` / `CLAUDE.md`; details stay in on-demand skills. `figma-token-setup.mdc` is no longer `alwaysApply`. Restore spawn of `session-handoff` is skipped when `handoff --restore` already printed a briefing.

## [0.1.14] - 2026-08-13

### Added
- **`session-handoff` subagent** — mandatory restore at session start and persist at session exit (Amp: isolated `subagent-session-handoff`)
- **`npx agent-orchestrator-kit handoff <name>`** — validates `handoff.md`, upserts `.cursor/memory.json` with an absolute path, prints an expanded self-contained next-thread prompt in `project.agent_language`
- **`npx agent-orchestrator-kit memory-setup`** — installs `scripts/memory-mcp-launcher.cjs` and rewrites Cursor/Amp Memory MCP away from relative `MEMORY_FILE_PATH`
- Always-apply rule `.agents/rules/session-handoff.mdc` with HARD STOP gates Amp cannot treat as optional

### Changed
- Next-session prompt is now a full operating brief (Done, Decisions, Blocked, attach, which subagent to spawn, Amp isolation, exit HARD STOP) so the next thread works even if Memory MCP is ignored
- Amp `subagent-*` wrappers require STOP if spawn is unavailable instead of running specialist work in the main thread
- Memory MCP examples and init/sync use the launcher instead of `npx` + relative path

## [0.1.13] - 2026-08-13

### Added
- **Pipeline subagent conductor** — every `/opsx:*` parent session now delegates through an exclusive phase/signal routing table, with five new stage specialists for explore, design, propose, spec review, and archive (`codebase-explorer`, `design-intake`, `spec-architect`, `spec-reviewer`, `spec-archiver`)
- **Durable session handoff** — sessions restore and persist `Change:*`, `Handoff:*`, and `Decision:*` Memory entities, mirror state in `openspec/changes/<name>/handoff.md`, and emit one next-session prompt in `project.agent_language` (no service banner, no duplicated summary)

### Changed
- Amp `subagent-*` wrappers now require isolated fresh-context execution and return only a structured specialist report
- OpenSpec commands, orchestration rules, skills, profiles, and documentation now enforce conductor-only task marking and phase separation

## [0.1.12] - 2026-07-21

### Added
- **`figma-fetch --depth <n>`** — limit Figma node tree depth for large frames (omit = full tree)

### Fixed
- **`figma-fetch` large payloads** — write API response text as-is instead of pretty-printing via `JSON.stringify` (avoids `Invalid string length` on huge trees)
- Clearer error when Figma API returns a non-JSON body

## [0.1.11] - 2026-07-21

### Added
- **Figma personal token setup** — local `.agents/figma.local.env` (gitignored) + committed `.agents/figma.local.env.example`
- **`scripts/figma-mcp-launcher.cjs`** — starts `figma-developer-mcp` with token from the env file (no secret in `.mcp.json`)
- **CLI** — `figma-setup`, `figma-status`, `figma-fetch` (REST file/nodes JSON via `X-Figma-Token`)
- Cursor/Amp MCP examples include optional `figma` server pointing at the launcher
- Agent rule `figma-token-setup.mdc`; setup-doctor + `/opsx:design` guidance (never ask for token in chat)
- `orchestrator.yaml` / profiles: `mcp.optional` includes `figma` + `figma.env_file` metadata

### Fixed
- **Amp / agent PATH** — templates now document and require `npx` / `npm run` for OpenSpec and `agent-orchestrator-kit` CLIs (bare binaries often exit 127 in Amp shells)
- Added always-apply rule `templates/.agents/rules/cli-via-npm.mdc`; updated openspec skills/commands, `AGENTS.md`, `CLAUDE.md`, `orchestrator.yaml` `cli.*` hints
- Never recommend `openspec validate --strict` without `<name>` / `--all`

## [0.1.10] - 2026-07-15

### Added
- **Custom subagents** — new `.agents/subagents/` asset category, synced to `.cursor/agents/` and `.claude/agents/` (like skills/rules, delete-stale semantics on `sync`)
- 6 default subagents: `openspec-guide` (pipeline navigator, read-only), `code-writer` (scoped task implementation), `code-reviewer` (spec-compliance + convention review), `test-writer` (test authoring), `setup-doctor` (orchestrator setup diagnosis/repair), `design-implementer` (pixel-accurate Figma/screenshot → code, honors design-brief priority)
- **Amp support via skill wrappers** — Amp has no file-based subagents, so `init`/`update`/`sync` auto-generate a committed `.agents/skills/subagent-<name>/SKILL.md` wrapper per subagent (Amp loads `.agents/skills/` natively); wrappers are excluded from `.cursor/`/`.claude/` skill sync and removed when the source subagent is deleted
- `update` and `sync --target cursor|claude|all` now manage `.agents/subagents/` alongside skills and rules
- `scripts/sync-local-agent-skills.sh` generates Amp wrappers and rsyncs `.agents/subagents/` → `.cursor/agents/` and `.claude/agents/`

### Fixed
- `update` no longer resurrects a CI workflow file the project deleted (e.g. `.github/workflows/agent-verify.yml` after switching to GitLab CI) — CI files are refreshed only when already present
- `update` keeps `scripts/sync-local-agent-skills.sh` executable

## [0.1.9] - 2026-07-12

### Added
- **Design intake** — optional `/opsx:design` phase: captures Figma / export / screenshot / photo into `design-brief.md` + `assets/` (writes only those paths)
- **Role `design_intake`** in templates and all profiles (`generic`, `vue3`, `node`, `mvp`) with `pipeline.require_design_brief: false` (opt-in)
- **`gate-check` design brief gate** — when `require_design_brief: true` and `src/` changed, requires `design-brief.md` or `Design: none` in `proposal.md`
- **`status`** shows `brief: yes/no` for every active change
- **Docs** — AGENTS.md / CLAUDE.md / rules / agent-orchestration skill / README section for design intake and manual enable after `update`

## [0.1.8] - 2026-07-07

### Changed
- **README** — Quickstart block (new vs existing project) and upgrade guide for `status` / `gate-check` / GitHub Spec Verifier adoption

## [0.1.7] - 2026-07-07

### Added
- **`agent-orchestrator status`** — dashboard for active OpenSpec changes: task progress (`N/M`), review verdict, `ready to archive` flag
- **`agent-orchestrator gate-check`** — deterministic review-gate check; exits non-zero when `src/` changed without an approved `review.md` (`require_spec_review: true`); warns (non-blocking) when active changes exceed `max_active_changes`; graceful no-op without `.agents/orchestrator.yaml`, when review isn't required, or when the diff can't be computed
- **GitHub AI Spec Verifier** — `init --ci github --spec-verify` installs `.github/workflows/spec-verify.yml` + `scripts/post-pr-verdict-github.sh` (via `gh pr comment`), reusing the existing stack-agnostic `scripts/verify-specs.sh`
- **OpenSpec specs** — `orchestrator-cli-controls`, `github-spec-verify`

### Changed
- **`sync`** (CLI) now removes stale skills/rules no longer present in `.agents/skills|rules` — matches `sync-local-agent-skills.sh` (`rsync --delete`); does not touch `memory.json`, `.mcp.json`, `CLAUDE.md`, `settings.json`
- **`agent-verify.yml`** (both GitHub and GitLab fragments) now run `gate-check` as part of verify
- **`--spec-verify`** — no longer GitLab-only; valid with `--ci gitlab` or `--ci github`
- **README / AGENTS.md / agent-orchestration skill** — document `status`, `gate-check`, and GitHub Spec Verifier parity

## [0.1.6] - 2026-07-02

### Added
- **`init --spec-verify`** — opt-in AI Spec Verifier for GitLab consumers: on MRs changing `src/`, an Amp agent verifies code against `openspec/specs/`, posts PASS/BLOCKED to the MR, and fails the pipeline on BLOCKED
- **Templates** — `.gitlab/spec-verify.yml` (blocking job, commented Phase 1 `allow_failure` fallback), `scripts/verify-specs.sh` (stack-agnostic prompt with project context from `openspec/config.yaml`, graceful skips, secret-safe), `scripts/post-mr-verdict.sh` (GitLab MR comment)
- **Orchestrator gate** — `spec-verify-blocking` auto-added to `roles.verifier.gates` (idempotent)
- **OpenSpec spec** — `spec-verify-consumer`

### Changed
- **`update`** refreshes spec-verify files via `KIT_OPTIN_PATHS` — only in projects that already installed them
- **README / AGENTS.md template** — AI Spec Verifier documented (install, CI variables, verdict schema, Phase 1 rollout)

## [0.1.5] - 2026-06-27

### Added
- **`init --ci gitlab|github|none`** — CI provider flag (default: `github`)
- **GitLab verify** — `.gitlab/agent-verify.yml` fragment with multi-PM detect (npm/yarn/pnpm)
- **PM-aware prebuild hook** — `verify:openspec` + `prebuild` injection on `--ci gitlab` (zero DevOps config via `npm run build`)
- **Starter example** — `templates/.gitlab-ci.starter.yml.example` for early push before DevOps owns root CI
- **OpenSpec specs** — `gitlab-consumer-verify`, `kit-ci-verify` synced to `openspec/specs/`

### Changed
- **`update`** refreshes `.gitlab/agent-verify.yml` via `KIT_MANAGED_PATHS`
- **README + AGENTS.md** — GitLab verifier path documented (prebuild hook, not GitHub Actions)
- **`printNextSteps`** — GitLab hints for `--ci gitlab` users

## [0.1.4] - 2026-06-27

### Added
- **Kit repo CI** — `.github/workflows/agent-verify.yml` (npm ci → OpenSpec validate → test)
- **OpenSpec devDependency** — `@fission-ai/openspec` for local and CI validation

## [0.1.3] - 2026-06-14

### Added
- **`mvp` profile** — demos/spikes: `require_spec_review: false`, up to 3 active changes
- **`/opsx:quick` command** — propose + apply in one session for MVP workflows
- **`openspec/config.yaml.example`** from vue3 and mvp profiles on init
- **Review gate enforcement** — `/opsx:review` writes `review.md`; `/opsx:apply` checks `require_spec_review`
- **Vue 3 review checklist** in `/opsx:review` (script setup, Pinia, Axios)
- **Package manager detection** (npm/yarn/pnpm) → updates verifier commands in `orchestrator.yaml`
- **CI workflow** auto-detects npm / yarn / pnpm
- **OpenSpec + frontend-agent-skills** hints in init next steps
- **Profile validation** with warning for unknown profiles

### Fixed
- Gitignore dedup uses exact line match (not substring) — `.cursor/memory.json` no longer blocks `.cursor`
- `.claude` added to gitignore on init
- `sync --target amp` — explicit Amp handling + `.amp/settings.json` bootstrap

## [0.1.2] - 2026-06-14

### Fixed
- CLI executable bit on `bin/agent-orchestrator.js` (`agent-orchestrator: not found` via npx)
- Added `agent-orchestrator-kit` bin alias (matches package name for npx)

## [0.1.1] - 2026-06-14

### Added
- All OpenSpec skills (`openspec-*`, `spec-workflow-openspec`)
- CI workflow template `.github/workflows/agent-verify.yml`
- `.agents/amp.settings.json.example` for Amp Code MCP
- `update` command refreshes all kit-managed skills and CI
- Sync script auto-creates `.amp/settings.json` from example

### Removed
- Unused `prompts` dependency

## [0.1.0] - 2026-06-14

### Added
- Initial release: 5-role orchestration pipeline, `/opsx:*` commands, IDE sync

[0.9.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.14...v0.2.0
[0.1.14]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/makshc2/agent-orchestrator-kit/releases/tag/v0.1.0
