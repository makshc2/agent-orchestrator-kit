# Proposal: Figma personal token setup

## Why

Design intake (`/opsx:design`) often needs Figma file/node access. Developers must supply a Personal Access Token **without pasting it into chat**. The kit should ship a safe local place for the token, wire MCP via a launcher that never embeds the secret in committed config, and document the flow for new developers after `init`/`update`.

## What Changes

- Local secret file `.agents/figma.local.env` (gitignored) + committed example
- MCP launcher script that reads the env file and starts `figma-developer-mcp` with `FIGMA_API_KEY`
- Cursor/Amp MCP examples include optional `figma` server pointing at the launcher (no token in JSON)
- CLI: `figma-status`, `figma-setup`, `figma-fetch` (REST nodes JSON for design intake)
- Agent rule + setup-doctor + README / AGENTS.md / opsx-design docs
- `orchestrator.yaml` declares `figma` under `mcp.optional` and env file path

## Non-goals

- Storing tokens in CI or committing real secrets
- Replacing official Cursor Figma OAuth plugin (PAT path is complementary)
- Live Figma calls during `/opsx:apply` (brief remains source of truth)

## Design

Design: none (kit tooling / docs; no product UI)

## Capabilities

- `figma-token-setup`: local token file, MCP launcher, CLI helpers, agent/docs guidance
