// Owned by agent-orchestrator-kit (hooks enable --client amp).
// Thin project plugin: it only loads the packaged runtime and forwards Amp
// lifecycle events to the adapter — no policy logic lives in this file.
// Amp resolves plugins against the project, so the runtime is located through
// node_modules or AOK_HOOK_RUNTIME, never the network.

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

type AmpEventPayload = Record<string, any>;
interface AmpEvents {
  on(event: string, handler: (payload: AmpEventPayload) => void | Promise<void> | any): void;
}

const RUNTIME_EVENTS = ['session.start', 'agent.start', 'agent.end', 'tool.call', 'tool.result'];
const REQUEST_EVENTS = new Set(['agent.start', 'agent.end', 'tool.call']);

function resolveRuntime(): string | null {
  if (process.env.AOK_HOOK_RUNTIME) return path.resolve(process.env.AOK_HOOK_RUNTIME);
  for (let dir = process.cwd(); ; ) {
    for (const name of ['agent-orchestrator-kit', 'agent-orchestrator']) {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadAdapter(): Promise<any> {
  const root = resolveRuntime();
  if (!root) {
    process.stderr.write('[aok-hooks] packaged runtime not found — manual workflow applies\n');
    return null;
  }
  const adapterPath = path.join(root, 'bin', 'hooks', 'adapters', 'amp.js');
  if (!existsSync(adapterPath)) {
    process.stderr.write(`[aok-hooks] amp adapter missing at ${adapterPath} — manual workflow applies\n`);
    return null;
  }
  const adapter = await import(url.pathToFileURL(adapterPath).href);
  if (typeof adapter.run !== 'function') {
    process.stderr.write('[aok-hooks] amp adapter does not export run() — manual workflow applies\n');
    return null;
  }
  return adapter;
}

async function forward(adapter: any, event: string, payload: AmpEventPayload): Promise<any> {
  try {
    const result = await adapter.run({ projectDir: process.cwd(), payload, nativeEvent: event, respond: 'return' });
    if (event === 'tool.call' && result && result.output && Object.keys(result.output).length > 0) {
      return result.output;
    }
    if (REQUEST_EVENTS.has(event) && result && result.output && Object.keys(result.output).length > 0) {
      return result.output;
    }
    return undefined;
  } catch (error: any) {
    process.stderr.write(`[aok-hooks] amp adapter failed on ${event}: ${error?.message ?? String(error)}\n`);
    return undefined;
  }
}

export default async function register(events: AmpEvents): Promise<void> {
  let adapter: any = null;
  try {
    adapter = await loadAdapter();
  } catch (error: any) {
    process.stderr.write(`[aok-hooks] amp runtime load failed: ${error?.message ?? String(error)}\n`);
    return;
  }
  if (!adapter || typeof events?.on !== 'function') return;
  for (const event of RUNTIME_EVENTS) {
    events.on(event, (payload: AmpEventPayload) => forward(adapter, event, payload));
  }
}
