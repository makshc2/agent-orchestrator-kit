## 1. Templates & gitignore

- [x] 1.1 Add `.agents/figma.local.env.example`
- [x] 1.2 Add `scripts/figma-mcp-launcher.js`
- [x] 1.3 Extend `mcp.json.example` and `amp.settings.json.example` with launcher-based `figma` server
- [x] 1.4 Gitignore `.agents/figma.local.env` via CLI `GITIGNORE_LINES`
- [x] 1.5 Declare `figma` in orchestrator templates/profiles + `figma.env_file`

## 2. CLI

- [x] 2.1 Implement `figma-setup`, `figma-status`, `figma-fetch`
- [x] 2.2 Refresh examples on `update`; mention Figma in `printNextSteps`
- [x] 2.3 Add smoke tests for gitignore, status, setup

## 3. Agent docs

- [x] 3.1 Rule `figma-token-setup.mdc`
- [x] 3.2 Update setup-doctor, opsx-design, AGENTS.md, README
- [x] 3.3 CHANGELOG + version bump for release

## 4. Review gate

- [x] 4.1 Write `review.md` with Verdict: APPROVE (release requested)
