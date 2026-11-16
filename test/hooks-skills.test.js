import { test } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveSkills, parseProjectConfig, canonicalizePath } from '../bin/hooks/skills.js';
import { HOOK_SCOPES_REL } from '../bin/hooks/install.js';

const execFileAsync = promisify(execFile);
const SCOPES_TEMPLATE = await readFile('templates/hook-skill-scopes.json', 'utf8');
const installScopes = async (dir) => writeFile(join(dir, '.agents', 'hook-skill-scopes.json'), SCOPES_TEMPLATE);

async function makeVueProject() {
  const dir = await mkdtemp(join(tmpdir(), 'aok-skills-'));
  await execFileAsync('git', ['init', '--quiet', dir]);
  await mkdir(join(dir, '.agents'), { recursive: true });
  await installScopes(dir);
  const vueSkills = ['javascript-core', 'vue-core', 'vue-testing', 'vue-pinia', 'vue-axios', 'vue-router', 'vue-composables', 'vite'];
  for (const skill of vueSkills) {
    await mkdir(join(dir, '.agents', 'skills', skill), { recursive: true });
    await writeFile(join(dir, '.agents', 'skills', skill, 'SKILL.md'), `# ${skill}\n`);
  }
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), [
    'project:',
    '  name: demo',
    '  stack: vue3',
    'skills:',
    '  kit: []',
    '  stack:',
    ...vueSkills.map((skill) => `    - ${skill}`),
    '  external: ""',
    '',
  ].join('\n'));
  return { dir, vueSkills };
}

const names = (result) => result.selected.map((skill) => skill.name).sort();

test('vue3 implementation and testing roles select their base stacks', async () => {
  const { dir } = await makeVueProject();
  const implementation = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['src/App.vue'] });
  assert.deepEqual(names(implementation), ['javascript-core', 'vue-core']);
  const testing = resolveSkills({ projectDir: dir, role: 'test-writer', taskFiles: ['src/App.vue'] });
  assert.deepEqual(names(testing), ['javascript-core', 'vue-testing']);
  await rm(dir, { recursive: true, force: true });
});

test('task files and first accessed paths select every vue mapping category', async () => {
  const { dir } = await makeVueProject();
  const cases = [
    { path: 'src/stores/cart.js', skill: 'vue-pinia' },
    { path: 'src/api/client.js', skill: 'vue-axios' },
    { path: 'src/router/index.js', skill: 'vue-router' },
    { path: 'src/composables/useAuth.ts', skill: 'vue-composables' },
    { path: 'vite.config.ts', skill: 'vite' },
  ];
  for (const item of cases) {
    const viaTask = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: [item.path] });
    assert.ok(viaTask.selected.some((skill) => skill.name === item.skill), `${item.path} task file -> ${item.skill}`);
    const viaAccess = resolveSkills({ projectDir: dir, role: 'implementer', accessedPaths: [item.path] });
    assert.ok(viaAccess.selected.some((skill) => skill.name === item.skill), `${item.path} accessed -> ${item.skill}`);
  }
  await rm(dir, { recursive: true, force: true });
});

test('uninstalled scoped skills are never selected and no package is installed', async () => {
  const { dir } = await makeVueProject();
  await rm(join(dir, '.agents', 'skills', 'vue-pinia'), { recursive: true, force: true });
  const result = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['src/stores/cart.js'] });
  assert.ok(!result.selected.some((skill) => skill.name === 'vue-pinia'));
  assert.deepEqual(names(result), ['javascript-core', 'vue-core']);
  await rm(dir, { recursive: true, force: true });
});

test('generic and node projects use declared installed equivalents without vue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aok-skills-generic-'));
  await mkdir(join(dir, '.agents'), { recursive: true });
  await installScopes(dir);
  await mkdir(join(dir, '.agents', 'skills', 'javascript-core'), { recursive: true });
  await mkdir(join(dir, '.agents', 'skills', 'javascript-node'), { recursive: true });
  await mkdir(join(dir, '.agents', 'skills', 'javascript-testing'), { recursive: true });
  for (const skill of ['javascript-core', 'javascript-node', 'javascript-testing']) {
    await writeFile(join(dir, '.agents', 'skills', skill, 'SKILL.md'), `# ${skill}\n`);
  }
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), [
    'project:',
    '  name: svc',
    '  stack: node',
    'skills:',
    '  stack:',
    '    - javascript-core',
    '    - javascript-node',
    '    - javascript-testing',
    '',
  ].join('\n'));
  const result = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['src/server.js'] });
  assert.deepEqual(names(result), ['javascript-core', 'javascript-node', 'javascript-testing']);
  const testing = resolveSkills({ projectDir: dir, role: 'test-writer', taskFiles: ['test/api.test.js'] });
  assert.deepEqual(names(testing), ['javascript-core', 'javascript-node', 'javascript-testing']);
  await rm(dir, { recursive: true, force: true });
});

test('mvp profile with no installed stack selects nothing instead of guessing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aok-skills-mvp-'));
  await mkdir(join(dir, '.agents'), { recursive: true });
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), 'project:\n  name: tiny\nskills:\n  stack: []\n');
  const result = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['index.js'] });
  assert.deepEqual(result.selected, []);
  await rm(dir, { recursive: true, force: true });
});

test('ambiguous .vue paths in a non-vue project select the installed vue inventory conservatively', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aok-skills-mixed-'));
  await mkdir(join(dir, '.agents'), { recursive: true });
  await installScopes(dir);
  for (const skill of ['javascript-core', 'vue-core', 'vue-pinia']) {
    await mkdir(join(dir, '.agents', 'skills', skill), { recursive: true });
    await writeFile(join(dir, '.agents', 'skills', skill, 'SKILL.md'), `# ${skill}\n`);
  }
  await writeFile(join(dir, '.agents', 'orchestrator.yaml'), [
    'project:',
    '  name: mixed',
    '  stack: generic',
    'skills:',
    '  stack:',
    '    - javascript-core',
    '    - vue-core',
    '',
  ].join('\n'));
  const result = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['legacy/Widget.vue'] });
  assert.deepEqual(names(result), ['javascript-core', 'vue-core']);
  await rm(dir, { recursive: true, force: true });
});

test('missing applicable files are reported without blocking', async () => {
  const { dir } = await makeVueProject();
  const result = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['src/stores/absent.js'] });
  assert.deepEqual(result.missingFiles, ['src/stores/absent.js']);
  assert.ok(result.selected.length > 0);
  assert.ok(result.evaluatedFiles.length === 0);
  await rm(dir, { recursive: true, force: true });
});

test('path traversal and symlink escape are rejected', async () => {
  const { dir } = await makeVueProject();
  const outside = await mkdtemp(join(tmpdir(), 'aok-outside-'));
  await writeFile(join(outside, 'secret.js'), 'x');
  const traversal = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['../escape.js'] });
  assert.ok(traversal.rejectedFiles.some((entry) => entry.reason === 'outside-worktree'));

  await symlink(join(outside, 'secret.js'), join(dir, 'linked.js'));
  const link = canonicalizePath(dir, 'linked.js');
  assert.equal(link.status, 'rejected');
  assert.equal(link.reason, 'symlink-escape');
  const viaLink = resolveSkills({ projectDir: dir, role: 'implementer', accessedPaths: ['linked.js'] });
  assert.ok(viaLink.rejectedFiles.some((entry) => entry.reason === 'symlink-escape'));
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test('changed content changes the digest so callers can invalidate receipts', async () => {
  const { dir } = await makeVueProject();
  const first = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['src/App.vue'] });
  const core = first.selected.find((skill) => skill.name === 'javascript-core');
  const skillPath = join(dir, '.agents', 'skills', 'javascript-core', 'SKILL.md');
  await writeFile(skillPath, '# javascript-core v2\n');
  const second = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['src/App.vue'] });
  const coreAfter = second.selected.find((skill) => skill.name === 'javascript-core');
  assert.notEqual(core.contentDigest, coreAfter.contentDigest);
  await rm(dir, { recursive: true, force: true });
});

test('the shipped scopes file installs as an owned asset and parses', async () => {
  const raw = await readFile('templates/hook-skill-scopes.json', 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.schemaVersion, 1);
  assert.ok(parsed.stacks.vue3.roles.implementation.includes('javascript-core'));
  assert.ok(parsed.stacks.vue3.roles.testing.includes('vue-testing'));
  assert.ok(Array.isArray(parsed.stacks.vue3.fileScopes));
  assert.equal(HOOK_SCOPES_REL.split('\\').join('/'), '.agents/hook-skill-scopes.json');
});

test('parent and child roles resolve independently from one installed config', async () => {
  const { dir } = await makeVueProject();
  const parent = resolveSkills({ projectDir: dir, role: 'implementer', taskFiles: ['src/stores/cart.js'] });
  const child = resolveSkills({ projectDir: dir, role: 'test-writer', taskFiles: ['src/stores/cart.js'] });
  assert.deepEqual(names(parent), ['javascript-core', 'vue-core', 'vue-pinia']);
  assert.deepEqual(names(child), ['javascript-core', 'vue-pinia', 'vue-testing']);
  await rm(dir, { recursive: true, force: true });
});

test('project config parsing handles inline and list skill stacks', () => {
  const listForm = parseProjectConfig([
    'project:',
    '  name: a',
    '  stack: vue3',
    'skills:',
    '  kit: []',
    '  stack:',
    '    - javascript-core',
    '    - vue-core',
    '',
  ].join('\n'));
  assert.equal(listForm.stack, 'vue3');
  assert.deepEqual(listForm.skillsStack, ['javascript-core', 'vue-core']);

  const inlineForm = parseProjectConfig('project:\n  stack: node\nskills:\n  stack: [javascript-core, javascript-node]\n');
  assert.equal(inlineForm.stack, 'node');
  assert.deepEqual(inlineForm.skillsStack, ['javascript-core', 'javascript-node']);

  const empty = parseProjectConfig('project:\n  name: x\nskills:\n  stack: []\n');
  assert.deepEqual(empty.skillsStack, []);
});
