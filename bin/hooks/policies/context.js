import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalizePath, resolveSkills } from '../skills.js';

const digest = (text) => createHash('sha256').update(text).digest('hex');
const submissions = new WeakMap();
const finding = (code, message, paths = []) => ({ code, severity: 'info', message, paths });
const scoped = (store, event) => store?.storeFor ? store.storeFor(event.scope.agentId == null ? 'session' : 'agent') : store;
const same = (receipt, record) => receipt && ['sessionId', 'agentId', 'epoch', 'contentDigest', 'sourcePath'].every((key) => receipt[key] === record[key]);

// Called by adapters only after their verified response has been submitted. Merely
// evaluating a policy or serializing a response never creates an injection receipt.
export async function commitContextDelivery({ event, result, output, store }) {
  const text = output?.hookSpecificOutput?.additionalContext ?? output?.additional_context ?? output?.message?.content;
  if (typeof text !== 'string') return;
  const target = scoped(store, event);
  if (!target) return;
  for (const item of result.context ?? []) {
    const record = submissions.get(item);
    if (!record || !text.includes(item.text)) continue;
    await target.transact('skill-receipts', digest(item.sourcePath), () => record);
    await target.append('audit', { ...record, id: digest(`${event.eventId}:${item.id}`), paths: [record.sourcePath], type: 'skill-delivery', message: 'Full content submitted; model consumption and compliance are unconfirmed.' });
    submissions.delete(item);
  }
}

export const contextPolicy = {
  id: 'context',
  events: ['session.start', 'session.resume', 'agent.start', 'tool.before', 'tool.after', 'file.changed', 'context.reset', 'context.compacting'],
  async evaluate(event, ctx) {
    const result = { context: [], findings: [], decision: null };
    if (ctx.config?.hooks?.enabled !== true) return result;
    const projectDir = ctx.config?.projectDir;
    if (!projectDir || !event.scope?.changeId || !event.scope?.sessionId || !ctx.store) {
      result.findings.push(finding('skills.manual', 'Bound identity and local state are required; manually Read applicable skills.'));
      return result;
    }
    const previous = await ctx.store.read('skill-context', 'state');
    let epoch = event.contextEpoch ?? previous?.epoch ?? `event-${event.eventId}`;
    if (['context.reset', 'context.compacting'].includes(event.kind) && previous?.resetId !== event.eventId) epoch = event.contextEpoch ?? `reset-${event.eventId}`;
    const paths = [...new Set([...(previous?.paths ?? []), ...(event.data?.files ?? [])])].slice(-256);
    await ctx.store.transact('skill-context', 'state', () => ({ epoch, paths, resetId: ['context.reset', 'context.compacting'].includes(event.kind) ? event.eventId : previous?.resetId ?? null }));
    if (event.kind === 'context.compacting') return result;
    const resolution = resolveSkills({ projectDir, role: event.data?.role, taskFiles: ctx.config?.binding?.files ?? [], accessedPaths: paths });
    for (const path of resolution.missingSkills) result.findings.push(finding('skills.missing', 'Applicable skill file is missing.', [path]));
    const canInject = ctx.capabilities?.events?.[event.kind]?.injectContext === true;
    for (const skill of resolution.selected) {
      if (ctx.signal?.aborted) break;
      const canonical = canonicalizePath(projectDir, skill.sourcePath);
      if (canonical.status !== 'ok') {
        result.findings.push(finding(canonical.status === 'missing' ? 'skills.missing' : 'skills.rejected', 'Skill path cannot be loaded safely.', [skill.sourcePath]));
        continue;
      }
      const content = await readFile(canonical.absolute, 'utf8');
      const record = { sourcePath: skill.sourcePath, contentDigest: digest(content), sessionId: event.scope.sessionId, agentId: event.scope.agentId ?? null, epoch, source: 'hook', status: 'injected', eventId: event.eventId, occurredAt: event.occurredAt };
      const prior = await ctx.store.read('skill-receipts', digest(skill.sourcePath));
      if (same(prior, record) && ['injected', 'read'].includes(prior.status)) continue;
      // Only locally verified evidence supplied by the embedding adapter is trusted.
      // Current native fixtures do not establish full reads or static preloads.
      const evidence = (ctx.config?.skillEvidence ?? []).find((proof) => same(proof, record));
      if (evidence?.confirmed === true && evidence.fullContent === true && (evidence.source === 'native-preload' || (evidence.source === 'observed-read' && event.kind === 'tool.after' && event.data?.tool?.operation === 'read' && event.data?.outcome?.status === 'success'))) {
        const confirmed = { ...record, source: evidence.source, status: evidence.source === 'native-preload' ? 'injected' : 'read' };
        await ctx.store.transact('skill-receipts', digest(skill.sourcePath), () => confirmed);
        await ctx.store.append('audit', { ...confirmed, paths: [skill.sourcePath], type: 'skill-delivery' });
        continue;
      }
      if (evidence?.source === 'agent-reported') result.findings.push(finding('skills.reported', 'Agent-reported read; full-content delivery is unconfirmed.', [skill.sourcePath]));
      const item = { id: `skill-${digest(skill.sourcePath)}`, text: `[aok-hooks] ${skill.sourcePath} (${record.contentDigest}); submitted full content for session ${record.sessionId}, agent ${record.agentId ?? 'main'}, epoch ${epoch}. Delivery does not prove compliance.\n\n${content}`, sourcePath: skill.sourcePath, contentDigest: record.contentDigest };
      if (!canInject || Buffer.byteLength(JSON.stringify([...result.context, item])) > 32 * 1024) {
        result.findings.push(finding('skills.undelivered', 'Pending supported context boundary; manually Read this full skill.', [skill.sourcePath]));
        continue;
      }
      submissions.set(item, record);
      result.context.push(item);
    }
    return result;
  },
};
