import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const MIRROR_TARGET = '.agents/skills/agent-orchestration/SKILL.md';

export const MIRRORS = [
  { id: 'session-start', source: '.agents/rules/session-handoff.mdc', start: '## Session Start', stop: '## ' },
  { id: 'session-exit', source: '.agents/rules/session-handoff.mdc', start: '## Session Exit', stop: '## ' },
  {
    id: 'routing',
    source: '.agents/rules/agent-orchestration.mdc',
    start: 'The parent `/opsx:*` session is the **conductor**.',
    stop: '## ',
  },
];

export function extractMirrorSource(text, spec) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((line) => line.startsWith(spec.start));
  if (startIdx === -1) return null;
  const isHeading = spec.start.startsWith('#');
  const from = isHeading ? startIdx + 1 : startIdx;
  let to = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith(spec.stop)) {
      to = i;
      break;
    }
  }
  const body = lines.slice(from, to);
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  return body.join('\n');
}

export function renderInstructionMirrors(root) {
  const result = { changed: [], drift: [], skipped: [], text: null };
  const targetPath = join(root, MIRROR_TARGET);
  if (!existsSync(targetPath)) {
    result.skipped.push('target');
    return result;
  }
  let lines = readFileSync(targetPath, 'utf8').split('\n');
  for (const spec of MIRRORS) {
    const sourcePath = join(root, spec.source);
    if (!existsSync(sourcePath)) {
      result.skipped.push(spec.id);
      continue;
    }
    const body = extractMirrorSource(readFileSync(sourcePath, 'utf8'), spec);
    if (body === null) {
      result.skipped.push(spec.id);
      continue;
    }
    const beginPrefix = `<!-- aok:mirror:begin ${spec.id} `;
    const endLine = `<!-- aok:mirror:end ${spec.id} -->`;
    const beginIdx = lines.findIndex((line) => line.startsWith(beginPrefix));
    const endIdx = lines.findIndex((line) => line === endLine);
    if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
      result.skipped.push(spec.id);
      continue;
    }
    const newBlock = [
      `<!-- aok:mirror:begin ${spec.id} (generated from ${spec.source}; edit the source and run sync) -->`,
      ...body.split('\n'),
      endLine,
    ];
    const oldBlock = lines.slice(beginIdx, endIdx + 1);
    if (oldBlock.join('\n') === newBlock.join('\n')) continue;
    result.drift.push(spec.id);
    result.changed.push(spec.id);
    lines = [...lines.slice(0, beginIdx), ...newBlock, ...lines.slice(endIdx + 1)];
  }
  result.text = lines.join('\n');
  return result;
}

export function syncInstructionMirrors(root, { check = false } = {}) {
  const rendered = renderInstructionMirrors(root);
  if (!check && rendered.text != null && rendered.changed.length > 0) {
    writeFileSync(join(root, MIRROR_TARGET), rendered.text);
  }
  return {
    changed: check ? [] : rendered.changed,
    drift: rendered.drift,
    skipped: rendered.skipped,
  };
}
