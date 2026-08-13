#!/usr/bin/env node
const { spawn } = require('child_process');
const { existsSync, mkdirSync } = require('fs');
const { dirname, join } = require('path');

function findProjectDir(startDir) {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (
      existsSync(join(dir, 'AGENTS.md')) ||
      existsSync(join(dir, '.agents', 'orchestrator.yaml'))
    ) {
      return dir;
    }
    dir = dirname(dir);
  }
  return join(startDir, '..');
}

const projectDir = findProjectDir(__dirname);
const cursorDir = join(projectDir, '.cursor');
const memoryFile = join(cursorDir, 'memory.json');

mkdirSync(cursorDir, { recursive: true });

const child = spawn('npx', ['-y', '@modelcontextprotocol/server-memory'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    MEMORY_FILE_PATH: memoryFile,
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
  console.error(`[memory-mcp-launcher] Failed to start memory MCP: ${error.message}`);
  process.exit(1);
});
