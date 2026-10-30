import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// Validate the state archive will write, using the consumer's OpenSpec CLI.
// Never replace main specs in the working tree, even temporarily.
export function validateProjectedSpecs(projectDir, plan) {
  const specs = new Map();
  const mainDir = join(projectDir, 'openspec', 'specs');
  if (existsSync(mainDir)) {
    for (const entry of readdirSync(mainDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const file = join(mainDir, entry.name, 'spec.md');
      if (existsSync(file)) specs.set(entry.name, readFileSync(file, 'utf-8'));
    }
  }
  for (const entry of plan) specs.set(relative(mainDir, dirname(entry.mainPath)), entry.newContent);
  if (!specs.size) return { errors: [], warnings: [] };

  const preview = mkdtempSync(join(tmpdir(), 'aok-spec-preview-'));
  try {
    // npx resolves the same local installation, including hoisted workspace deps.
    // A junction also works on Windows without requiring symlink privileges.
    for (let dir = resolve(projectDir); ; dir = dirname(dir)) {
      const modules = join(dir, 'node_modules');
      if (existsSync(join(modules, '.bin', 'openspec')) || existsSync(join(modules, '.bin', 'openspec.cmd'))) {
        symlinkSync(modules, join(preview, 'node_modules'), 'junction');
        break;
      }
      if (dirname(dir) === dir) break;
    }
    for (const [capability, content] of specs) {
      const file = join(preview, 'openspec', 'specs', capability, 'spec.md');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }

    let stdout;
    let failure;
    try {
      stdout = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['--no-install', 'openspec', 'validate', '--specs', '--strict', '--json'], {
          cwd: preview,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1', npm_config_offline: 'true' },
          shell: process.platform === 'win32',
        });
    } catch (error) {
      stdout = error.stdout;
      failure = error;
    }
    let report;
    try { report = JSON.parse(stdout); } catch { /* Fail closed below. */ }
    if (!report || !Array.isArray(report.items) || report.items.length !== specs.size
      || new Set(report.items.map((item) => item?.id)).size !== specs.size
      || report.items.some((item) => !item || !specs.has(item.id) || item.type !== 'spec'
        || typeof item.valid !== 'boolean' || !Array.isArray(item.issues)
        || item.issues.some((issue) => !issue || !['ERROR', 'WARNING', 'INFO'].includes(issue.level)
          || typeof issue.path !== 'string' || typeof issue.message !== 'string'))) {
      const detail = String(failure?.stderr || failure?.message || stdout || 'missing JSON report').trim();
      return { errors: [`projected main specs: OpenSpec validation did not return a complete JSON report: ${detail}`], warnings: [] };
    }
    const errors = [];
    const warnings = [];
    for (const item of report.items) {
      const source = `openspec/specs/${item.id}/spec.md`;
      const projected = plan.some((entry) => relative(mainDir, dirname(entry.mainPath)) === item.id);
      const context = projected ? 'after delta sync' : 'existing main spec; outside this change';
      for (const issue of item.issues) {
        const detail = `projected main specs: ${source} (${context}), ${issue.path}: [${issue.level}] ${issue.message}`;
        if (issue.level === 'ERROR' || issue.level === 'WARNING') errors.push(detail);
        else if (issue.level === 'INFO') warnings.push(detail);
      }
      if (!item.valid && !item.issues.some((issue) => issue.level === 'ERROR' || issue.level === 'WARNING')) {
        errors.push(`projected main specs: ${source} (${context}) is invalid`);
      }
    }
    if (failure && !errors.length) errors.push(`projected main specs: OpenSpec exited unsuccessfully: ${failure.message}`);
    return { errors, warnings };
  } finally {
    rmSync(preview, { recursive: true, force: true });
  }
}
