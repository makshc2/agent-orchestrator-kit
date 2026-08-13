# Design: Figma personal token setup

## Goals

1. Token never appears in chat, git, or committed MCP JSON.
2. New developers know exactly where to paste the token after install.
3. Agents can detect “Figma configured: yes/no” and fetch node JSON without asking for the secret.

## Approach

```
.agents/figma.local.env          ← developer pastes FIGMA_ACCESS_TOKEN (gitignored)
        │
        ▼
scripts/figma-mcp-launcher.js    ← reads env, spawns figma-developer-mcp --stdio
        │
        ▼
.mcp.json / Amp settings         ← command: node scripts/figma-mcp-launcher.js (no secret)
```

Canonical env key in the local file: `FIGMA_ACCESS_TOKEN`.  
Launcher maps it to `FIGMA_API_KEY` for `figma-developer-mcp`.

CLI:
- `figma-setup` — ensure example→local env exists; never print token values
- `figma-status` — exit 0 if non-empty token present; print configured yes/no only
- `figma-fetch` — `GET /v1/files/:key/nodes` (or full file) → write JSON under `assets/` or `--out`

## Security

- Gitignore: `.agents/figma.local.env`
- Never log token substrings
- setup-doctor / agents: point to file path; refuse to ask user to paste token in chat
- Example files contain empty placeholders only

## Alternatives considered

- Put token in `.mcp.json` env → easy to commit; rejected
- Project root `.env` → mixes with app/Vite secrets; rejected
- IDE-global MCP only → weak project onboarding; rejected as sole option
