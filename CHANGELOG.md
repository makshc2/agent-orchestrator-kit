# Changelog

All notable changes to this project will be documented in this file.

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

[0.1.8]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.6...v0.1.7
[0.1.5]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/makshc2/agent-orchestrator-kit/releases/tag/v0.1.0
