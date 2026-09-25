#!/usr/bin/env node
const { spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const projectDir = join(__dirname, '..');
const envPath = join(projectDir, '.agents', 'github.local.env');

function readLocalEnv() {
  if (!existsSync(envPath)) {
    console.error(
      `[github-mcp-launcher] Missing ${envPath}. Copy .agents/github.local.env.example → .agents/github.local.env and add GITHUB_PERSONAL_ACCESS_TOKEN (do not paste the token into chat).`
    );
    process.exit(1);
  }

  const values = {};
  for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const envValues = readLocalEnv();
const token = envValues.GITHUB_PERSONAL_ACCESS_TOKEN || envValues.GITHUB_TOKEN || '';
if (!token) {
  console.error(
    '[github-mcp-launcher] GITHUB_PERSONAL_ACCESS_TOKEN is empty in .agents/github.local.env. Add a GitHub personal access token locally (never in chat).'
  );
  process.exit(1);
}

const child = spawn('npx', ['-y', '@modelcontextprotocol/server-github'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GITHUB_PERSONAL_ACCESS_TOKEN: token,
    GITHUB_TOKEN: token,
  },
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 1 : code);
});

child.on('error', (error) => {
  console.error(`[github-mcp-launcher] Failed to start GitHub MCP: ${error.message}`);
  process.exit(1);
});
