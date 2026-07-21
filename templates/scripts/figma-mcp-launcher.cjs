#!/usr/bin/env node
const { spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const projectDir = join(__dirname, '..');
const envPath = join(projectDir, '.agents', 'figma.local.env');

function readLocalToken() {
  if (!existsSync(envPath)) {
    console.error(
      `[figma-mcp-launcher] Missing ${envPath}. Copy .agents/figma.local.env.example → .agents/figma.local.env and add FIGMA_ACCESS_TOKEN (do not paste the token into chat).`
    );
    process.exit(1);
  }

  const raw = readFileSync(envPath, 'utf-8');
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
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

  return values.FIGMA_ACCESS_TOKEN || values.FIGMA_API_KEY || '';
}

const token = readLocalToken();
if (!token) {
  console.error(
    '[figma-mcp-launcher] FIGMA_ACCESS_TOKEN is empty in .agents/figma.local.env. Add your Figma personal access token locally (never in chat).'
  );
  process.exit(1);
}

const child = spawn('npx', ['-y', 'figma-developer-mcp', '--stdio'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FIGMA_API_KEY: token,
    FIGMA_ACCESS_TOKEN: token,
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
  console.error(`[figma-mcp-launcher] Failed to start figma-developer-mcp: ${error.message}`);
  process.exit(1);
});
