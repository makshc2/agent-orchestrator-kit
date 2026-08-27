#!/usr/bin/env node
const { spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const projectDir = join(__dirname, '..');
const envPath = join(projectDir, '.agents', 'gitlab.local.env');
const DEFAULT_API_URL = 'https://gitlab.com/api/v4';

function readLocalEnv() {
  if (!existsSync(envPath)) {
    console.error(
      `[gitlab-mcp-launcher] Missing ${envPath}. Copy .agents/gitlab.local.env.example → .agents/gitlab.local.env and add GITLAB_PERSONAL_ACCESS_TOKEN (do not paste the token into chat).`
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
const token = envValues.GITLAB_PERSONAL_ACCESS_TOKEN || envValues.GITLAB_TOKEN || '';
if (!token) {
  console.error(
    '[gitlab-mcp-launcher] GITLAB_PERSONAL_ACCESS_TOKEN is empty in .agents/gitlab.local.env. Add a GitLab personal access token locally (never in chat).'
  );
  process.exit(1);
}

const apiUrl = envValues.GITLAB_API_URL || DEFAULT_API_URL;

const child = spawn('npx', ['-y', '@modelcontextprotocol/server-gitlab'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GITLAB_PERSONAL_ACCESS_TOKEN: token,
    GITLAB_TOKEN: token,
    GITLAB_API_URL: apiUrl,
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
  console.error(`[gitlab-mcp-launcher] Failed to start GitLab MCP: ${error.message}`);
  process.exit(1);
});
