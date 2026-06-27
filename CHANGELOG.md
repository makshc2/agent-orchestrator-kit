# Changelog

All notable changes to this project will be documented in this file.

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

[0.1.4]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/makshc2/agent-orchestrator-kit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/makshc2/agent-orchestrator-kit/releases/tag/v0.1.0
