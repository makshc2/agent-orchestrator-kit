#!/usr/bin/env node
const { spawn } = require('child_process');

const child = spawn('npx', ['-y', '@playwright/mcp'], {
  stdio: 'inherit',
  env: process.env,
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
  console.error(`[browser-mcp-launcher] Failed to start Playwright MCP: ${error.message}`);
  process.exit(1);
});
