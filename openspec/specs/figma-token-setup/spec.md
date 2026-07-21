## ADDED Requirements

### Requirement: Local Figma token file

The kit SHALL provide a committed template `.agents/figma.local.env.example` and SHALL add `.agents/figma.local.env` to the project `.gitignore` on `init`/`update` gitignore merge. Developers MUST place their Personal Access Token in `.agents/figma.local.env` as `FIGMA_ACCESS_TOKEN` without committing the file.

#### Scenario: Init adds gitignore and example

- **WHEN** a developer runs `npx agent-orchestrator-kit init`
- **THEN** `.agents/figma.local.env.example` exists in the project and `.gitignore` contains `.agents/figma.local.env`

#### Scenario: Token is not requested in chat

- **WHEN** an agent detects missing Figma configuration
- **THEN** the agent instructs the user to edit `.agents/figma.local.env` locally and MUST NOT ask the user to paste the token into the chat

### Requirement: MCP launcher without embedded secret

The kit SHALL ship `scripts/figma-mcp-launcher.js` that reads `FIGMA_ACCESS_TOKEN` (or `FIGMA_API_KEY`) from `.agents/figma.local.env` and starts `figma-developer-mcp` with `--stdio`, passing the value as `FIGMA_API_KEY`. Committed MCP examples MUST reference the launcher and MUST NOT contain a real token.

#### Scenario: Cursor MCP example uses launcher

- **WHEN** a project uses `.agents/mcp.json.example`
- **THEN** the `figma` server entry runs `node scripts/figma-mcp-launcher.js` (or equivalent) without an inline API key

### Requirement: CLI status, setup, and fetch

The kit CLI SHALL expose:

- `figma-setup` — copies the example env file to `.agents/figma.local.env` when missing
- `figma-status` — reports whether a non-empty token is configured (boolean only; exit non-zero when missing)
- `figma-fetch` — fetches Figma file or node JSON via the REST API using the local token and writes it to `--out`

#### Scenario: Status without leaking secret

- **WHEN** a developer runs `npx agent-orchestrator-kit figma-status` with a configured token
- **THEN** the CLI prints that Figma is configured and does not print the token value

#### Scenario: Fetch nodes JSON

- **WHEN** a developer runs `figma-fetch` with a file key and node ids and a valid token
- **THEN** the CLI writes JSON to the given `--out` path
