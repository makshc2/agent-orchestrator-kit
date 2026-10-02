## Constraints (діють на всі таски, самі не є тасками)

- Порядок архівації: `fix-next-session-prompt` MUST бути заархівований ДО `archive-from-terminal` — ця зміна копіює його MODIFIED-вимогу «Next-session prompt follows agent_language» і змінює в ній лише один сценарій; у зворотному порядку sync замінить вимогу цілком і мовчки поверне старий сценарій. Це умова порядку архівації, а не блокер apply.
- Не запускати в корені репозиторію `init`, `update`, `sync` і `init --force` (інцидент ec7407a). Кореневий `.agents/rules/session-handoff.mdc` оновлюється лише командою `cp` у таску 4.3.
- Тести — лише вузькі прогони. Перед будь-яким тестовим процесом виміряти ресурси командою `nproc; awk '{print $1,$2,$3}' /proc/loadavg; awk '/MemAvailable/ {printf "%.0f\n", $2/1024}' /proc/meminfo` (правило `.agents/rules/ask-before-heavy-ops.mdc`): MemAvailable < 3000 MiB або loadavg 1m ≥ nproc × 0.7 → лише `--test-name-pattern` на один файл. Повний `node --test test/*.test.js` — лише в таску 7.1 і лише коли MemAvailable ≥ 3000 MiB та loadavg 1m < nproc × 0.5.
- `buildNextSessionPrompt`, `handoff --restore`, `metricsPrepareArchiveStart` і `test/smoke.test.js` не змінювати. Нові тести живуть у `test/archive-from-terminal.test.js`; єдине виправлення чужого тестового файлу — п'ять очікувань у таску 1.1.
- Блоки під тасками (C1, GH1, R1 тощо) — дослівний текст: двопробільний відступ блоку (відступ списку тасків) не копіювати, рядки `old`/`new` застосовувати як точну заміну підрядка, яка в файлі зустрічається рівно один раз.

## 1. CLI: archive_after_merge, спільна готовність, status

- [x] 1.1 parsePipelineConfig читає pipeline.archive_after_merge
  Files: bin/agent-orchestrator.js, test/gate-check-config-parser-and-src-glob.test.js
  Do: У `bin/agent-orchestrator.js` зробити дві вставки: (1) у `parsePipelineLegacy` одразу після рядка `pick('task_contract', /task_contract:\s*(warn|strict|off)/);` вставити рядок з блоку C1; (2) у `parsePipelineConfig` у літерал, що повертається, одразу після рядка `srcGlob: srcGlob || null,` вставити два рядки з блоку C2. `parsePipelineSection` не змінювати: він уже віддає будь-який прямий дочірній ключ `pipeline:` (закоментований ключ і той самий ключ під іншою секцією ігноруються тими самими правилами, що й решта `pipeline.*`). Далі у `test/gate-check-config-parser-and-src-glob.test.js` вставити рядок `    archiveAfterMerge: true,` (4 пробіли відступу) одразу після кожного з п'яти рядків, що закривають очікувані об'єкти `assert.deepEqual`: `    srcGlob: 'bin/, scripts/ templates/',`, `    srcGlob: 'lib/',`, `    srcGlob: 'lib/ app/',`, `    srcGlob: null,` і `    srcGlob: 'src/',` (кожен із них зустрічається у файлі рівно один раз); решту файлу не змінювати.
  Done-when: `grep -c -F "pick('archive_after_merge', /archive_after_merge:\\s*(true|false)/);" bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F 'archiveAfterMerge: bool(values.archive_after_merge, true),' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `node --input-type=module -e "import { parsePipelineConfig as p } from './bin/agent-orchestrator.js'; const ok = p('pipeline:\n  archive_after_merge: false\n').archiveAfterMerge === false && p('pipeline:\n  # archive_after_merge: false\n  archive_after_merge: true\n').archiveAfterMerge === true && p('version: 1\narchive_after_merge: false\n').archiveAfterMerge === false && p('').archiveAfterMerge === true; process.exit(ok ? 0 : 1)"` дає exit 0; `grep -c -F 'archiveAfterMerge: true,' test/gate-check-config-parser-and-src-glob.test.js` друкує 5 (baseline зараз 0); `node --test --test-reporter=tap test/gate-check-config-parser-and-src-glob.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# fail 0` (а `# pass` дорівнює кількості тестів файлу до правок — baseline зараз 16; без п'яти правок очікувань чотири тести з порівнянням повного об'єкта падають)

  C1:
  ~~~~js
    pick('archive_after_merge', /archive_after_merge:\s*(true|false)/);
  ~~~~

  C2:
  ~~~~js
      // Policy flag, default true (the shipped templates). Read by `status` and `archive --if-ready`.
      archiveAfterMerge: bool(values.archive_after_merge, true),
  ~~~~

- [x] 1.2 Спільна функція готовності archiveReadinessBlockers і рядок політики в status
  Files: bin/agent-orchestrator.js
  Do: У `bin/agent-orchestrator.js` зробити чотири правки: (1) одразу після функції `hasDesignOptOut` вставити функцію з блоку C3 — це та сама логіка блокерів, що була inline в `status`, винесена в одну функцію (`config === null` означає: review обов'язковий, brief ні); (2) у action команди `.command('status')` замінити початок за парою C4-old → C4-new: `config` читається одразу під `log.title`, під заголовком друкується `archive_after_merge: <true|false>`, коли `config` не `null`, а локальні `requireReview` / `requireBrief` зникають; (3) у циклі по changes замінити inline-блок обчислення `blockers` на пару C5-old → C5-new; (4) у кінець блоку `export { … }` перед `};` додати рядок `  archiveReadinessBlockers,`. Рядки виводу `status` (`tasks:`, `review:`, `brief:`, `ready to archive`, `not ready to archive — …`) і їхні тексти не змінювати.
  Done-when: `grep -c -F 'function archiveReadinessBlockers(changeDir, config) {' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F 'const blockers = archiveReadinessBlockers(changeDir, config);' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F "archive_after_merge: \${config.archiveAfterMerge}" bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F '      const requireReview = config ? config.requireSpecReview : true;' bin/agent-orchestrator.js` друкує 0 (baseline зараз 1: inline-копія в `status` з відступом 6 пробілів; helper має відступ 2, `archive` — 4); `node -e "import('./bin/agent-orchestrator.js').then(m=>process.exit(typeof m.archiveReadinessBlockers==='function'?0:1))"` дає exit 0; `node --test --test-reporter=tap --test-name-pattern="^status" test/smoke.test.js 2>&1 | grep -E '^# fail '` друкує `# fail 0` (наявні status-тести, зокрема `not ready to archive — tasks incomplete`, лишаються зеленими)

  C3:
  ~~~~js
  // The single definition of "ready to archive": `status` prints these blockers and
  // `archive --if-ready` skips on them. `config` is the readPipelineConfig result
  // (null without .agents/orchestrator.yaml: review required, brief not).
  function archiveReadinessBlockers(changeDir, config) {
    const requireReview = config ? config.requireSpecReview : true;
    const requireBrief = config ? config.requireDesignBrief : false;
    const progress = parseTasksProgress(changeDir);
    const verdict = parseReviewVerdict(changeDir);
    const blockers = [];
    if (!(progress && progress.total > 0 && progress.done === progress.total)) {
      blockers.push('tasks incomplete');
    }
    if (requireReview && !(verdict && /^APPROVE/i.test(verdict))) {
      blockers.push(verdict ? `review verdict "${verdict}" (need APPROVE)` : 'no review.md');
    }
    if (requireBrief && !parseDesignBrief(changeDir) && !hasDesignOptOut(changeDir)) {
      blockers.push('no design-brief.md');
    }
    return blockers;
  }
  ~~~~

  C4-old:
  ~~~~js
      log.title('agent-orchestrator status');

      const changes = listActiveChanges(projectDir);
      if (changes.length === 0) {
        log.info('No active changes');
      } else {
        // Readiness must mirror the gates `archive` actually enforces — reporting
        // "ready" on task count alone told the conductor to archive a change the
        // CLI would then refuse.
        const config = readPipelineConfig(projectDir);
        const requireReview = config ? config.requireSpecReview : true;
        const requireBrief = config ? config.requireDesignBrief : false;

        for (const name of changes) {
  ~~~~

  C4-new:
  ~~~~js
      log.title('agent-orchestrator status');

      const config = readPipelineConfig(projectDir);
      if (config) log.info(`archive_after_merge: ${config.archiveAfterMerge}`);

      const changes = listActiveChanges(projectDir);
      if (changes.length === 0) {
        log.info('No active changes');
      } else {
        for (const name of changes) {
  ~~~~

  C5-old:
  ~~~~js
          const blockers = [];
          if (!(progress && progress.total > 0 && progress.done === progress.total)) {
            blockers.push('tasks incomplete');
          }
          if (requireReview && !(verdict && /^APPROVE/i.test(verdict))) {
            blockers.push(verdict ? `review verdict "${verdict}" (need APPROVE)` : 'no review.md');
          }
          if (requireBrief && !hasBrief && !hasDesignOptOut(changeDir)) {
            blockers.push('no design-brief.md');
          }
  ~~~~

  C5-new:
  ~~~~js
          // Readiness must mirror the gates `archive` actually enforces — reporting
          // "ready" on task count alone told the conductor to archive a change the
          // CLI would then refuse. One shared definition, also used by `archive --if-ready`.
          const blockers = archiveReadinessBlockers(changeDir, config);
  ~~~~

- [x] 1.3 Коментар-політика над archive_after_merge у шаблоні й профілях
  Files: templates/orchestrator.yaml, profiles/generic/orchestrator.yaml, profiles/mvp/orchestrator.yaml, profiles/node/orchestrator.yaml, profiles/vue3/orchestrator.yaml
  Do: У кожному з п'яти файлів вставити рядок із блоку C6 безпосередньо над рядком `  archive_after_merge: true` (у `profiles/mvp/orchestrator.yaml` — над `  archive_after_merge: false`), відступ 2 пробіли. Значення ключа не змінювати. Рядок-коментар не містить пари `archive_after_merge: true|false`, тож legacy-reader його не підхоплює.
  Done-when: `for f in templates/orchestrator.yaml profiles/generic/orchestrator.yaml profiles/mvp/orchestrator.yaml profiles/node/orchestrator.yaml profiles/vue3/orchestrator.yaml; do grep -B1 -E '^  archive_after_merge: (true|false)$' "$f" | head -1 | grep -c -F '# Policy: status prints it; "archive --if-ready" and the opt-in CI job honour it; a manual archive ignores it.'; done` друкує п'ять рядків `1` (baseline зараз п'ять `0`); `grep -h -E '^  archive_after_merge:' templates/orchestrator.yaml profiles/*/orchestrator.yaml | sort | uniq -c` друкує `4   archive_after_merge: true` і `1   archive_after_merge: false` (значення не змінені, baseline те саме)

  C6:
  ~~~~yaml
    # Policy: status prints it; "archive --if-ready" and the opt-in CI job honour it; a manual archive ignores it.
  ~~~~

- [x] 1.4 Новий тестовий файл: хелпери, групи config і status
  Files: new file: test/archive-from-terminal.test.js
  Do: Створити `test/archive-from-terminal.test.js`: спершу весь блок TH1 дослівно (імпорти, хелпери, openspec-stub зі `status --change <n> --json`, що віддає `changeRoot` і шлях `tasks.md` — Gate 2 archive читає саме його), далі шість тестів із такими назвами й перевірками. (1) `config: parsePipelineConfig reads archive_after_merge with a true default` — `parsePipelineConfig('pipeline:\n  archive_after_merge: false\n').archiveAfterMerge === false`; `'pipeline:\n  archive_after_merge: true # keep\n'` → `true`; `'pipeline:\n  require_spec_review: true\n'` (ключа немає) → `true`; `'pipeline:\n  archive_after_merge: maybe\n'` → `true`; `''` → `true`. (2) `config: a commented key and the same key under another section do not change archive_after_merge` — `'pipeline:\n  # archive_after_merge: false\n  archive_after_merge: true\n'` → `true`; `'pipeline:\n  # archive_after_merge: false\n  require_spec_review: true\n'` → `true`; `'pipeline:\n  require_spec_review: true\nverifier:\n  archive_after_merge: false\n'` → `true`. (3) `config: a legacy file without a pipeline block still reads archive_after_merge` — `'version: 1\narchive_after_merge: false\n'` → `false`; `'version: 1\nroles: {}\n'` → `true`. (4) `config: templates and profiles keep their archive_after_merge values and a policy comment` — для `templates/orchestrator.yaml`, `profiles/generic|node|vue3/orchestrator.yaml` (очікується `true`) і `profiles/mvp/orchestrator.yaml` (`false`): `parsePipelineConfig(<вміст файлу з KIT_ROOT>).archiveAfterMerge` дорівнює очікуваному, а рядок безпосередньо над `  archive_after_merge: (true|false)` дорівнює точно рядку з блоку C6 таску 1.3. (5) `status: prints the archive_after_merge line only when orchestrator.yaml exists` — у `withProject`: `status` має exit 0 і stdout містить `archive_after_merge: true`; після `setPipelineFlag(dir, 'archive_after_merge', 'false')` stdout містить `archive_after_merge: false`; після `rmSync(join(dir, '.agents/orchestrator.yaml'))` exit 0 і stdout не містить `archive_after_merge`. (6) `status: archiveReadinessBlockers is the one definition status and archive --if-ready share` — у `withProject` взяти `generic = parsePipelineConfig(<.agents/orchestrator.yaml проєкту>)`; порожній каталог `openspec/changes/empty` (створений через `mkdirSync`, без жодного файла) → `archiveReadinessBlockers` повертає `['tasks incomplete', 'no review.md']`, і `status` друкує `not ready to archive — tasks incomplete; no review.md`; `makeChange(dir, 'open', { tasks: TASKS_OPEN, review: '# Review\n\n**Verdict:** REQUEST_CHANGES\n' })` → `['tasks incomplete', 'review verdict "REQUEST_CHANGES" (need APPROVE)']`; `makeChange(dir, 'ready')` → `[]`, і з `config = null` теж `[]`; `makeChange(dir, 'no-tasks', { tasks: null })` з `{ ...generic, requireSpecReview: false }` → `['tasks incomplete']`; `ready` з `{ ...generic, requireSpecReview: false, requireDesignBrief: true }` → `['no design-brief.md']`, а після запису `# Proposal\n\nDesign: none\n` у `proposal.md` цього change → `[]`.
  Done-when: `node --test --test-reporter=tap --test-name-pattern="^(config|status):" test/archive-from-terminal.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 6` і `# fail 0` (baseline: файлу ще немає); `grep -c '^test(' test/archive-from-terminal.test.js` друкує 6 (Do прописує рівно шість тестів)

  TH1:
  ~~~~js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { execSync, spawnSync } from 'node:child_process';
  import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
  import { join, dirname } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { tmpdir } from 'node:os';
  import { archiveReadinessBlockers, parsePipelineConfig } from '../bin/agent-orchestrator.js';

  // archive-from-terminal: green-apply exit prints the archive command, `archive` gets
  // Gate 0 and `--if-ready`, `pipeline.archive_after_merge` is read, /opsx:archive is a
  // fallback, and CI archive is opt-in.

  const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const CLI = join(KIT_ROOT, 'bin', 'agent-orchestrator.js');
  // eslint-disable-next-line no-control-regex
  const ANSI_RE = /\x1B\[[0-9;]*m/g;
  const ARCHIVE_LINE = (name) => `npx agent-orchestrator-kit archive ${name} --sync`;

  function isolatedEnv(dir) {
    const env = {
      ...process.env,
      HOME: join(dir, '.aok-home'),
      XDG_CONFIG_HOME: join(dir, '.aok-xdg-config'),
      XDG_DATA_HOME: join(dir, '.aok-xdg-data'),
      AMP_DATA_DIR: join(dir, '.aok-amp'),
      AOK_AMP_BIN: join(dir, '.no-amp-bin'),
    };
    for (const key of ['AOK_MODEL', 'AOK_PLATFORM', 'CURSOR_AGENT', 'CURSOR_CONVERSATION_ID', 'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'AMP_CURRENT_THREAD', 'AMP_THREAD_ID']) delete env[key];
    for (const sub of ['.aok-home', '.aok-xdg-config', '.aok-xdg-data', '.aok-amp']) mkdirSync(join(dir, sub), { recursive: true });
    return env;
  }

  function cli(dir, args) {
    const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', env: isolatedEnv(dir) });
    return { status: res.status, stdout: res.stdout.replace(ANSI_RE, ''), stderr: res.stderr.replace(ANSI_RE, '') };
  }

  function runInit(dir, profile = 'generic', lang = 'en') {
    execSync(`node "${CLI}" init --profile ${profile} --name ArchiveFromTerminal --lang ${lang}`, { cwd: dir, stdio: 'pipe' });
  }

  // Deterministic openspec stub (same contract as test/smoke.test.js): `status --change <n> --json`
  // reports changeRoot and the tasks.md path, `validate` always passes.
  const OPENSPEC_STUB = `#!/usr/bin/env node
  const fs = require('fs');
  const path = require('path');
  const args = process.argv.slice(2);
  if (args[0] === 'status') {
    const name = args[args.indexOf('--change') + 1];
    const changesDir = path.join(process.cwd(), 'openspec', 'changes');
    const changeRoot = path.join(changesDir, name);
    if (!fs.existsSync(changeRoot)) { console.error('Change not found: ' + name); process.exit(1); }
    const tasksPath = path.join(changeRoot, 'tasks.md');
    console.log(JSON.stringify({ schemaName: 'spec-driven', changeRoot, planningHome: { changesDir }, artifactPaths: { tasks: { existingOutputPaths: fs.existsSync(tasksPath) ? [tasksPath] : [] } } }));
    process.exit(0);
  }
  if (args[0] === 'validate') { console.log('valid (stub)'); process.exit(0); }
  process.exit(0);
  `;

  function installOpenspecStub(dir) {
    const pkgDir = join(dir, 'node_modules', 'openspec');
    const binDir = join(dir, 'node_modules', '.bin');
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'openspec', version: '0.0.0', bin: { openspec: './cli.js' } }));
    writeFileSync(join(pkgDir, 'cli.js'), OPENSPEC_STUB, { mode: 0o755 });
    writeFileSync(join(binDir, 'openspec'), '#!/bin/sh\nexec node "$(dirname "$0")/../openspec/cli.js" "$@"\n', { mode: 0o755 });
  }

  function withProject(prefix, fn, { profile = 'generic', lang = 'en' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    try {
      runInit(dir, profile, lang);
      installOpenspecStub(dir);
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const TASKS_DONE = '- [x] 1.1 Do the thing\n';
  const TASKS_OPEN = '- [x] 1.1 Do the thing\n- [ ] 1.2 Still open\n';
  const APPROVE = '# Spec Review\n\n**Verdict:** APPROVE\n';

  // A change that every archive gate accepts (APPROVE, all tasks done, no delta specs).
  // `tasks: null` / `review: null` leave the file out.
  function makeChange(dir, name, { review = APPROVE, tasks = TASKS_DONE } = {}) {
    const changeDir = join(dir, 'openspec/changes', name);
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n');
    if (tasks !== null) writeFileSync(join(changeDir, 'tasks.md'), tasks);
    if (review !== null) writeFileSync(join(changeDir, 'review.md'), review);
    return changeDir;
  }

  // Flip a `pipeline:` flag (`  <key>: true|false`) in the project's .agents/orchestrator.yaml.
  function setPipelineFlag(dir, key, value) {
    const orchPath = join(dir, '.agents/orchestrator.yaml');
    const orch = readFileSync(orchPath, 'utf-8');
    assert.match(orch, new RegExp(`^  ${key}: (true|false)$`, 'm'));
    writeFileSync(orchPath, orch.replace(new RegExp(`^  ${key}: (true|false)$`, 'm'), `  ${key}: ${value}`));
  }

  // Dated archive folders of one change name under openspec/changes/archive/.
  function archiveEntries(dir, name) {
    const root = join(dir, 'openspec/changes/archive');
    return existsSync(root) ? readdirSync(root).filter((d) => d.endsWith(`-${name}`)) : [];
  }
  ~~~~

## 2. CLI: archive — Gate 0 і --if-ready

- [x] 2.1 Gate 0 в archive: findArchivedMarker до Gate 1 і до будь-якого запису
  Files: bin/agent-orchestrator.js
  Do: У `bin/agent-orchestrator.js` зробити три правки: (1) вставити функцію `findArchivedMarker` із блоку C7 безпосередньо перед рядком-коментарем `// --- Task-contract lint (gate-check --tasks) ---`; (2) в action команди `.command('archive <name>')` замінити ділянку за парою C8-old → C8-new: `config` читається один раз одразу після перевірки `existsSync(changeRoot)` (рядок `const config = readPipelineConfig(projectDir);` переїжджає з Gate 1), далі йде Gate 0, а Gate 1 починається після нього; виклики `metricsPrepareArchiveStart`, `renameSync`, sync-запис і rollback нижче не чіпати; (3) у кінець блоку `export { … }` перед `};` додати рядок `  findArchivedMarker,`.
  Done-when: `grep -c -F 'function findArchivedMarker(changeRoot) {' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F 'const archivedMarker = findArchivedMarker(changeRoot);' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F 'already-archived gate failed' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `awk '/const archivedMarker = findArchivedMarker\(changeRoot\);/{a=NR} /\/\/ Gate 1: review verdict/{b=NR} /metricsPrepareArchiveStart\(changeRoot, name/{c=NR} END{exit !(a>0 && b>a && c>b)}' bin/agent-orchestrator.js` дає exit 0 (Gate 0 стоїть перед Gate 1 і перед `metricsPrepareArchiveStart`); `node -e "import('./bin/agent-orchestrator.js').then(m=>process.exit(typeof m.findArchivedMarker==='function'?0:1))"` дає exit 0; `node --test --test-reporter=tap --test-name-pattern="^archive" test/smoke.test.js 2>&1 | grep -E '^# fail '` друкує `# fail 0` (наявні archive-тести, зокрема відмова на gate, sync і rollback, лишаються зеленими)

  C7:
  ~~~~js
  // Gate 0 of `archive`: positive evidence that this ACTIVE change folder is already
  // archived (a copied or re-opened archive folder). Returns the marker text, or
  // null. Missing, unreadable or invalid files are never evidence (fail-open).
  function findArchivedMarker(changeRoot) {
    try {
      const parsed = JSON.parse(readFileSync(join(changeRoot, 'metrics.json'), 'utf-8'));
      if (parsed && typeof parsed.archivedAt === 'string' && parsed.archivedAt.trim()) {
        return `metrics.json archivedAt is set (${parsed.archivedAt.trim()})`;
      }
    } catch {
      // absent or invalid metrics.json: no evidence
    }
    try {
      const sections = parseHandoffMarkdown(readFileSync(join(changeRoot, 'handoff.md'), 'utf-8'));
      if (firstLineCommand(sectionOr(sections, 'Next command')).toLowerCase() === 'none') {
        return 'handoff.md Next command is none';
      }
    } catch {
      // absent handoff.md: no evidence
    }
    return null;
  }

  ~~~~

  C8-old:
  ~~~~js
      if (!existsSync(changeRoot)) return fail(`change not found: ${changeRoot}`);

      // Gate 1: review verdict (only when required by pipeline config)
      const config = readPipelineConfig(projectDir);
      const requireReview = config ? config.requireSpecReview : true;
  ~~~~

  C8-new:
  ~~~~js
      if (!existsSync(changeRoot)) return fail(`change not found: ${changeRoot}`);

      const config = readPipelineConfig(projectDir);

      // Gate 0: positive evidence that this ACTIVE folder is already archived.
      const archivedMarker = findArchivedMarker(changeRoot);
      if (archivedMarker) {
        return fail(
          `already-archived gate failed — change "${name}" is marked as archived (${archivedMarker}). If this folder is a re-opened copy, clear "archivedAt" in metrics.json or set a real "## Next command" in handoff.md, then re-run archive.`,
        );
      }

      // Gate 1: review verdict (only when required by pipeline config)
      const requireReview = config ? config.requireSpecReview : true;
  ~~~~

- [x] 2.2 archive --if-ready: skip замість помилки, готовність як у status
  Files: bin/agent-orchestrator.js
  Do: У `bin/agent-orchestrator.js` зробити дві правки: (1) у ланцюжку `.command('archive <name>')` одразу після рядка `.option('--force', 'confirm archiving without merge when delta specs exist', false)` вставити рядок опції з блоку C9; (2) замінити ділянку C10-old (результат таску 2.1: від рядка `const config = readPipelineConfig(projectDir);` до рядка `const requireReview = …`) на C10-new: функція `skip` друкує рівно один рядок `skip: <причина>` у stdout і не чіпає exit code; перевірки йдуть у порядку (1) `archive_after_merge` = `false`, (2) маркер Gate 0, (3) `archiveReadinessBlockers(changeRoot, config)` непорожній — усі до будь-якого запису; без `--if-ready` Gate 0 відмовляє (exit 1), а `archive_after_merge` не перевіряється. Gate 1–3, sync, `metricsPrepareArchiveStart`, rename і rollback не чіпати: справжні збої (наявний target, sync-конфлікт, провал validate) лишаються exit 1.
  Done-when: `grep -c -F ".option('--if-ready'," bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F 'const skip = (reason) => console.log(' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F "return skip('archive_after_merge is false');" bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F "not ready — \${blockers.join('; ')}" bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `node bin/agent-orchestrator.js archive --help | grep -c -F -- '--if-ready'` друкує 1 (baseline зараз 0); `node --test --test-reporter=tap --test-name-pattern="^archive" test/smoke.test.js 2>&1 | grep -E '^# fail '` друкує `# fail 0`

  C9:
  ~~~~js
    .option('--if-ready', 'CI mode: print `skip: <reason>` and exit 0 (nothing changed) when archive_after_merge is false, the change already looks archived, or it is not ready; real failures still exit 1', false)
  ~~~~

  C10-old:
  ~~~~js
      const config = readPipelineConfig(projectDir);

      // Gate 0: positive evidence that this ACTIVE folder is already archived.
      const archivedMarker = findArchivedMarker(changeRoot);
      if (archivedMarker) {
        return fail(
          `already-archived gate failed — change "${name}" is marked as archived (${archivedMarker}). If this folder is a re-opened copy, clear "archivedAt" in metrics.json or set a real "## Next command" in handoff.md, then re-run archive.`,
        );
      }

      // Gate 1: review verdict (only when required by pipeline config)
      const requireReview = config ? config.requireSpecReview : true;
  ~~~~

  C10-new:
  ~~~~js
      const config = readPipelineConfig(projectDir);
      // --if-ready (CI): "nothing to archive" is a skip, not a failure. Everything
      // below runs before any write, so a skip leaves the tree untouched.
      const skip = (reason) => console.log(`skip: ${reason}`);
      if (opts.ifReady && config && config.archiveAfterMerge === false) return skip('archive_after_merge is false');

      // Gate 0: positive evidence that this ACTIVE folder is already archived.
      const archivedMarker = findArchivedMarker(changeRoot);
      if (archivedMarker) {
        if (opts.ifReady) return skip(`already archived — ${archivedMarker}`);
        return fail(
          `already-archived gate failed — change "${name}" is marked as archived (${archivedMarker}). If this folder is a re-opened copy, clear "archivedAt" in metrics.json or set a real "## Next command" in handoff.md, then re-run archive.`,
        );
      }

      if (opts.ifReady) {
        const blockers = archiveReadinessBlockers(changeRoot, config);
        if (blockers.length) return skip(`not ready — ${blockers.join('; ')}`);
      }

      // Gate 1: review verdict (only when required by pipeline config)
      const requireReview = config ? config.requireSpecReview : true;
  ~~~~

- [x] 2.3 Тести: групи gate0, if-ready і terminal
  Files: new file: test/archive-from-terminal.test.js
  Do: У `test/archive-from-terminal.test.js` (створений таском 1.4) розширити імпорт з `../bin/agent-orchestrator.js` до `{ archiveReadinessBlockers, findArchivedMarker, parsePipelineConfig }`, після `archiveEntries` додати блок TH2 дослівно і дописати вісім тестів. (1) `gate0: archivedAt in the active metrics.json refuses and mutates nothing` — у `withProject`: `changeDir = makeChange(dir, 'add-auth')`, `addDelta(dir, changeDir, AUTH_ADDED)`, `metrics.json` = `JSON.stringify({ version: 2, change: 'add-auth', archivedAt: '2026-09-01T10:00:00.000Z', sessions: [], pending: null })`; запам'ятати байти цього файлу й `openspec/specs/auth/spec.md`; `cli(dir, ['archive', 'add-auth', '--sync'])` → `status` 1, stderr містить `already-archived gate failed`, `metrics.json archivedAt is set (2026-09-01T10:00:00.000Z)` і `clear "archivedAt"`; `changeDir` існує, `openspec/changes/archive` не існує, `metrics.json` і main spec байт-у-байт ті самі. (2) `gate0: a handoff Next command of none refuses (case and backticks ignored)` — для кожного значення `` `none` ``, `NONE`, `None` окремий `withProject`: `handoff.md` = `# Session Handoff\n\n## Closed role\nArchiver\n\n## Next command\n<значення>\n\n## Next role\nnone\n`; `findArchivedMarker(changeDir) === 'handoff.md Next command is none'`; `cli(dir, ['archive', 'add-auth'])` → `status` 1, stderr містить `already-archived gate failed`, `handoff.md Next command is none` і `set a real "## Next command"`; `changeDir` існує, `archive/` ні. (3) `gate0: reused names, absent or invalid metrics.json and empty markers never refuse` — п'ять варіантів, кожен у власному `withProject` (`makeChange(dir, 'add-auth')`, потім підготовка): старий архів `openspec/changes/archive/2026-01-01-add-auth/proposal.md`; `metrics.json` = `{not json`; `metrics.json` з `archivedAt: null`; з `archivedAt: ''`; `handoff.md` з `## Next command` = `` `${ARCHIVE_LINE('add-auth')}` ``; для кожного `findArchivedMarker(changeDir) === null`, `archive add-auth` → `status` 0, `changeDir` більше не існує, у `archiveEntries(dir, 'add-auth')` рівно одна папка не з префіксом `2026-01-01`. (4) `if-ready: skips with exit 0 and no mutation when archive_after_merge is false, a marker is set, or the change is not ready` — п'ять випадків, кожен у власному `withProject` із `makeChange`, `addDelta(…, AUTH_ADDED)` і підготовкою: `setPipelineFlag(dir, 'archive_after_merge', 'false')` → stdout має рядок `skip: archive_after_merge is false`; `metrics.json` з `archivedAt` → `skip: already archived — metrics.json archivedAt is set`; видалений `review.md` → `skip: not ready — no review.md`; `tasks.md` = `TASKS_OPEN` → `skip: not ready — tasks incomplete`; `setPipelineFlag(dir, 'require_spec_review', 'false')` + видалені `tasks.md` і `review.md` → `skip: not ready — tasks incomplete`. Для кожного: `cli(dir, ['archive', 'add-auth', '--sync', '--if-ready'])` → `status` 0, у stdout рівно один рядок, що починається з `skip: ` (`/^skip: /gm`), `changeDir` існує, `openspec/changes/archive` не існує, `metrics.json` (якщо був) і main spec байт-у-байт ті самі, а там, де його не було, не створений. (5) `if-ready: archives a ready change like a normal archive` — готовий change з `AUTH_ADDED`: `archive add-auth --sync --if-ready` → `status` 0, stdout без `skip: ` і з `archived add-auth`, `changeDir` зник, `archiveEntries` має 1 папку, main spec містить `Fresh Req`. (6) `if-ready: without the flag archive_after_merge is not consulted` — `setPipelineFlag(dir, 'archive_after_merge', 'false')`, готовий change, `archive add-auth` без `--if-ready` → `status` 0 і одна архівна папка. (7) `if-ready: real failures stay loud (sync conflict, existing target)` — у першому `withProject` delta `AUTH_GHOST`: `archive add-auth --sync --if-ready` → `status` 1, stderr містить `sync conflict: auth: MODIFIED requirement not found in main spec: "Ghost Req"`, stdout без `skip: `, `changeDir` існує; у другому `withProject` створити `openspec/changes/archive/<сьогодні YYYY-MM-DD>-add-auth/` (`new Date().toISOString().slice(0, 10)`) → `status` 1, stderr містить `archive gate failed — target already exists`, `changeDir` існує. (8) `terminal: archive without client env exits 0, sets archivedAt and records Archiver platform null` — `changeDir = makeChange(dir, 'add-auth')` і `metrics.json` = `JSON.stringify({ version: 1, change: 'add-auth', sessions: [{ startedAt: '2026-08-29T06:00:00.000Z', endedAt: '2026-08-29T07:00:00.000Z', durationMs: 3600000, role: 'Implementer', phase: 'apply', runtime: 'local' }], pending: null })`; `cli(dir, ['archive', 'add-auth', '--sync'])` (`cli` вже прибирає `CURSOR_*`, `CLAUDE*`, `AMP_*`, `AOK_PLATFORM`) → `status` 0, stderr містить `metrics: `; в архівному `metrics.json` `archivedAt` заповнено, `pending === null`, сесія `Archiver` має `platform === null`, `spendSource === 'unreported'`, `inputTokens === null`, а сесія `Implementer` збережена з `durationMs === 3600000`.
  Done-when: `node --test --test-reporter=tap --test-name-pattern="^(gate0|if-ready|terminal):" test/archive-from-terminal.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 8` і `# fail 0` (baseline: цих тестів ще немає); `grep -c '^test(' test/archive-from-terminal.test.js` друкує 14 (шість із таску 1.4 плюс вісім цього таску)

  TH2:
  ~~~~js
  const AUTH_MAIN = '## Purpose\n\nAuth.\n\n## Requirements\n\n### Requirement: Old Req\n\nThe system SHALL use the original behavior.\n\n#### Scenario: original\n- WHEN it runs\n- THEN it is original\n';
  const AUTH_ADDED = '## ADDED Requirements\n\n### Requirement: Fresh Req\n\nThe system SHALL be fresh.\n\n#### Scenario: fresh\n- WHEN created\n- THEN fresh\n';
  const AUTH_GHOST = '## MODIFIED Requirements\n\n### Requirement: Ghost Req\n\nThe system SHALL exist.\n\n#### Scenario: ghost\n- WHEN it runs\n- THEN it fails\n';

  // Delta spec for capability `auth` in the change plus a matching main spec.
  function addDelta(dir, changeDir, delta) {
    mkdirSync(join(changeDir, 'specs/auth'), { recursive: true });
    writeFileSync(join(changeDir, 'specs/auth/spec.md'), delta);
    mkdirSync(join(dir, 'openspec/specs/auth'), { recursive: true });
    writeFileSync(join(dir, 'openspec/specs/auth/spec.md'), AUTH_MAIN);
  }
  ~~~~

## 3. CLI: зелений apply друкує команду archive

- [x] 3.1 handoff: isGreenApplyExit, archiveCommandLine і гілка зеленого apply
  Files: bin/agent-orchestrator.js
  Do: У `bin/agent-orchestrator.js` зробити чотири правки: (1) одразу перед функцією `missingHandoffFields` вставити три функції з блоку C11 (`archiveCommandLine`, `isBlockedEmpty`, `isGreenApplyExit`); (2) у persist-гілці action `.command('handoff [change-name]')` (після `missingHandoffFields`, підрахунку `progress` і резолву metrics-платформи) замінити пару рядків `const prompt = buildNextSessionPrompt(…)…;` + `fields.prompt = prompt;` на пару C12-old → C12-new: у зеленому apply `fields.nextCommand` стає `archiveCommandLine(name)`, `fields.nextRole` — `'none'`, `prompt` — той самий рядок (stderr-нотатка, якщо Next command агента відрізнявся), інакше `buildNextSessionPrompt` викликається як раніше; (3) наприкінці persist-гілки замінити пару рядків із `console.error(pc.dim('Copy the prompt below …'))` і `process.stdout.write(…)` на C13-new (в зеленому apply підказка про термінал замінює «Copy the prompt below…», stdout лишається `${prompt}\n`); (4) у кінець блоку `export { … }` перед `};` додати рядки `  archiveCommandLine,` і `  isGreenApplyExit,`. Функцію `buildNextSessionPrompt`, гілку `--restore` та решту persist-кроків (decisions, memory, metrics) не змінювати.
  Done-when: `grep -c -F 'function archiveCommandLine(name) {' bin/agent-orchestrator.js` друкує 1 і `grep -c -F 'function isGreenApplyExit(fields, progress) {' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0 і 0); `grep -c -F 'const greenApply = isGreenApplyExit(fields, progress);' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F 'let prompt;' bin/agent-orchestrator.js` друкує 1 (baseline зараз 0); `grep -c -F 'buildNextSessionPrompt(fields, agentLanguage, orchestratorMeta)' bin/agent-orchestrator.js` друкує 1 (baseline зараз 1: виклик лишився один, тепер у гілці else); `diff <(git show HEAD:bin/agent-orchestrator.js | sed -n '/^function buildNextSessionPrompt/,/^}/p') <(sed -n '/^function buildNextSessionPrompt/,/^}/p' bin/agent-orchestrator.js)` нічого не друкує (тіло `buildNextSessionPrompt` не змінене, поки файл не закомічено з його правкою); `node -e "import('./bin/agent-orchestrator.js').then(m=>process.exit(typeof m.archiveCommandLine==='function' && m.archiveCommandLine('x')==='npx agent-orchestrator-kit archive x --sync' && typeof m.isGreenApplyExit==='function' ? 0 : 1))"` дає exit 0; `node --test --test-reporter=tap test/fix-next-session-prompt.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# fail 0` (а `# pass` дорівнює кількості тестів файлу — baseline зараз 9); `node --test --test-reporter=tap --test-name-pattern="^handoff persist|english project gets english" test/smoke.test.js 2>&1 | grep -E '^# fail '` друкує `# fail 0`

  C11:
  ~~~~js
  // Green apply: the Implementer closes with every task done and nothing blocked, so
  // the next step is a terminal command after merge, not a new chat.
  function archiveCommandLine(name) {
    return `npx agent-orchestrator-kit archive ${name} --sync`;
  }

  // `## Blocked` counts as empty only for these exact values (case-insensitive,
  // one optional list bullet and trailing dot ignored); any other text means blocked.
  function isBlockedEmpty(value) {
    const text = String(value || '')
      .trim()
      .replace(/^[-*]\s+/, '')
      .replace(/\.$/, '')
      .trim()
      .toLowerCase();
    return ['', 'none', '-', '—', 'n/a', 'немає'].includes(text);
  }

  function isGreenApplyExit(fields, progress) {
    return (
      canonicalRole(fields.closedRole) === 'Implementer' &&
      Boolean(progress) &&
      progress.total > 0 &&
      progress.done === progress.total &&
      isBlockedEmpty(fields.blocked)
    );
  }

  ~~~~

  C12-old:
  ~~~~js
      const prompt = buildNextSessionPrompt(fields, agentLanguage, orchestratorMeta).replace(/^\n+|\n+$/g, '');
      fields.prompt = prompt;
  ~~~~

  C12-new:
  ~~~~js
      // Green apply prints the archive command instead of a next-session prompt;
      // the Next command the agent wrote is replaced (with a stderr note when it differed).
      const greenApply = isGreenApplyExit(fields, progress);
      let prompt;
      if (greenApply) {
        const archiveLine = archiveCommandLine(name);
        if (firstLineCommand(fields.nextCommand) !== archiveLine) {
          console.error(`handoff: green apply — Next command replaced with the archive command (was: ${firstLineCommand(fields.nextCommand)})`);
        }
        fields.nextCommand = archiveLine;
        fields.nextRole = 'none';
        prompt = archiveLine;
      } else {
        prompt = buildNextSessionPrompt(fields, agentLanguage, orchestratorMeta).replace(/^\n+|\n+$/g, '');
      }
      fields.prompt = prompt;
  ~~~~

  C13-old:
  ~~~~js
      console.error(pc.dim('Copy the prompt below into the next chat as one fenced block. Do not include this line.'));
      process.stdout.write(`${prompt}\n`);
  ~~~~

  C13-new:
  ~~~~js
      console.error(
        pc.dim(
          greenApply
            ? 'Run the line below in a terminal after the PR is merged — no new chat needed (/opsx:archive is the fallback).'
            : 'Copy the prompt below into the next chat as one fenced block. Do not include this line.',
        ),
      );
      process.stdout.write(`${prompt}\n`);
  ~~~~

- [x] 3.2 Тести: група green-apply
  Files: new file: test/archive-from-terminal.test.js
  Do: У `test/archive-from-terminal.test.js` розширити імпорт з `../bin/agent-orchestrator.js` до `{ archiveCommandLine, archiveReadinessBlockers, findArchivedMarker, isGreenApplyExit, parsePipelineConfig }`, після `addDelta` додати блок TH3 дослівно і дописати сім тестів; у кожному з них, крім шостого (чиста функція), спершу створити change командою `makeApplyChange(dir, 'add-thing')` (усі таски `[x]`), а `uk`-варіант п'ятого тесту й варіант з `archive_after_merge: false` теж роблять це у власному `withProject`. (1) `green-apply: Implementer with all tasks done and no blockers prints exactly the archive line` — `makeApplyChange(dir, 'add-thing')`, `persist(dir, 'add-thing', { metrics: true })` → `status` 0; `stdout === ARCHIVE_LINE('add-thing') + '\n'`; stderr містить `Run the line below in a terminal after the PR is merged` і не містить `Copy the prompt below` та `green apply — Next command replaced` (агент уже написав рядок archive); `handoff.md` містить `## Next command\n` + бектик + рядок archive + бектик, `## Next role\nnone\n` і `## Prompt\n\n` + fenced-блок `text` із тим самим рядком; останній запис `sessions` у `metrics.json` має `role === 'Implementer'`. (2) `green-apply: other roles, open tasks, blockers and missing tasks keep the normal prompt` — в одному `withProject`: `persist(dir, 'add-thing', { role: 'Architect', next: '/opsx:review add-thing' })` при всіх `[x]` → stdout починається з `/opsx:review add-thing\n` і містить `HARD STOP`; після `tasks.md` = `TASKS_OPEN` Implementer з `next: '/opsx:apply add-thing'` → stdout починається з `/opsx:apply add-thing\n`, містить `HARD STOP`, а stderr не містить `Run the line below`; після `tasks.md` = `TASKS_DONE` і `blocked: 'waiting for CI on the PR'` → звичайний промпт з `HARD STOP`; після `tasks.md` = `# Tasks\n\nno checkboxes\n` → звичайний промпт; після `rmSync(tasks.md)` → звичайний промпт. (3) `green-apply: an agent-supplied Next command is replaced and the CLI says so on stderr` — `persist(dir, 'add-thing', { next: '/opsx:archive add-thing' })` → stdout рівно рядок archive + `\n`, stderr містить `green apply — Next command replaced with the archive command (was: /opsx:archive add-thing)`, `handoff.md` містить `## Next command\n` з рядком archive у бектиках. (4) `green-apply: --no-metrics regeneration is byte-identical` — перший `persist`, збережені stdout і `handoff.md`; `cli(dir, ['handoff', 'add-thing', '--no-metrics'])` → `status` 0, stdout і `handoff.md` ті самі. (5) `green-apply: a uk project and archive_after_merge false still get the same single line` — `withProject(…, { lang: 'uk' })` і окремий `withProject` із `setPipelineFlag(dir, 'archive_after_merge', 'false')`: обидва дають stdout рівно рядок archive + `\n`. (6) `green-apply: isGreenApplyExit and archiveCommandLine follow the trigger table` — `archiveCommandLine('add-thing') === ARCHIVE_LINE('add-thing')`; `isGreenApplyExit({ closedRole, blocked }, { total: 2, done: 2 })` істинний для `('Implementer', 'none')`, `('implementer — apply complete', 'None.')` і для `blocked` з `''`, `'-'`, `'- none'`, `'—'`, `'n/a'`, `'N/A'`, `'немає'`, `'Немає.'`; хибний для `blocked` `'waiting for CI'`, `'none yet'`, `'none\n- other'`; хибний для ролей `Architect` і `Spec Reviewer`, для `{ total: 2, done: 1 }`, `{ total: 0, done: 0 }` і `null`. (7) `green-apply: handoff --restore is unchanged and prints no archive hint` — після зеленого `persist` `cli(dir, ['handoff', 'add-thing', '--restore', '--no-metrics'])` → `status` 0, stdout містить `next_command: npx agent-orchestrator-kit archive add-thing --sync` і `next_role: none`, а stdout+stderr не містять `Run the line below` та `green apply`.
  Done-when: `node --test --test-reporter=tap --test-name-pattern="^green-apply:" test/archive-from-terminal.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 7` і `# fail 0` (baseline: цих тестів ще немає); `grep -c '^test(' test/archive-from-terminal.test.js` друкує 21 (чотирнадцять із тасків 1.4 і 2.3 плюс сім цього таску)

  TH3:
  ~~~~js
  // Persist a handoff for `name` through the CLI flags (no handoff.md needed).
  // Defaults describe the green-apply case: Implementer, the archive line as Next command.
  function persist(dir, name, { role = 'Implementer — all tasks done', next = ARCHIVE_LINE(name), blocked, metrics = false } = {}) {
    const args = ['handoff', name, '--closed-role', role, '--done', 'all tasks done; build and lint green', '--next-command', next, '--next-role', 'none'];
    if (blocked !== undefined) args.push('--blocked', blocked);
    if (!metrics) args.push('--no-metrics');
    return cli(dir, args);
  }

  // Change dir with only a tasks.md (`tasks: null` leaves it out).
  function makeApplyChange(dir, name, tasks = TASKS_DONE) {
    const changeDir = join(dir, 'openspec/changes', name);
    mkdirSync(changeDir, { recursive: true });
    if (tasks !== null) writeFileSync(join(changeDir, 'tasks.md'), tasks);
    return changeDir;
  }
  ~~~~

## 4. Шаблони, правила й тексти

- [x] 4.1 /opsx:archive — fallback ≤ 1 KB; skill openspec-archive-change
  Files: templates/.agents/commands/opsx-archive.md, templates/.agents/skills/openspec-archive-change/SKILL.md
  Do: Замінити весь вміст `templates/.agents/commands/opsx-archive.md` текстом з блоку T1 дослівно (п'ять рядків frontmatter, абзац «Normal path…», чотири пронумеровані кроки, останній рядок; без підрядка `spec-archiver` і без заголовків `##`). У `templates/.agents/skills/openspec-archive-change/SKILL.md` зробити дві заміни підрядка: пара AR1-old → AR1-new (перше речення після frontmatter) і пара AR2-old → AR2-new (початок речення про гейти в кроці 3); блок «Guardrails» і рядок виклику CLI не змінювати.
  Done-when: `test "$(wc -c < templates/.agents/commands/opsx-archive.md)" -le 1024` дає exit 0 (baseline зараз 1210 байт); `grep -c -F 'in a terminal after the PR is merged (or let the opted-in CI job do it)' templates/.agents/commands/opsx-archive.md` друкує 1 і `grep -c -F 'Use this command only when that was impossible or the CLI refused.' templates/.agents/commands/opsx-archive.md` друкує 1 (baseline зараз 0 і 0); `grep -c -F 'spec-archiver' templates/.agents/commands/opsx-archive.md` друкує 0; `grep -c -E '^## ' templates/.agents/commands/opsx-archive.md` друкує 0; `grep -c -F 'The normal path is a terminal after the PR is merged' templates/.agents/skills/openspec-archive-change/SKILL.md` друкує 1 і `grep -c -F 'Gate 0:' templates/.agents/skills/openspec-archive-change/SKILL.md` друкує 1 (baseline зараз 0 і 0); `grep -c -F 'npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]' templates/.agents/skills/openspec-archive-change/SKILL.md` друкує 1 (baseline зараз 1: рядок виклику CLI збережено); `node --test --test-reporter=tap --test-name-pattern="init installs the lean archive command" test/smoke.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 1` і `# fail 0`

  T1:
  ~~~~markdown
  ---
  name: /opsx-archive
  id: opsx-archive
  category: Workflow
  description: Fallback — archive a completed change via the agent-orchestrator-kit CLI when a terminal or CI could not
  ---

  Normal path: run `npx agent-orchestrator-kit archive <name> --sync` in a terminal after the PR is merged (or let the opted-in CI job do it). Use this command only when that was impossible or the CLI refused. Protocol: `.agents/rules/session-handoff.mdc` — `archive` writes its own final `handoff.md`, so there is no Session Exit here.

  1. Resolve the name: the argument after `/opsx:archive`, else `npx openspec list --json` + AskUserQuestion. Never guess.
  2. If delta specs exist, ask: merge (`--sync`) or skip (`--no-sync --force`).
  3. Run `npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]` and show stdout as-is.
  4. On exit ≠ 0, print the refusal from stderr and STOP — no manual merge/move.

  No phase subagents. No next-thread prompt after a successful archive.
  ~~~~

  AR1-old:
  ~~~~text
  Archive a completed change. The phase is fully deterministic — one CLI call, no phase subagents.
  ~~~~

  AR1-new:
  ~~~~text
  Archive a completed change. The phase is fully deterministic — one CLI call, no phase subagents. The normal path is a terminal after the PR is merged (`npx agent-orchestrator-kit archive <name> --sync`) or an opted-in CI job; use this skill when that was impossible or the CLI refused.
  ~~~~

  AR2-old:
  ~~~~text
     The CLI checks gates (review APPROVE
  ~~~~

  AR2-new:
  ~~~~text
     The CLI first refuses a folder that already looks archived (Gate 0: `archivedAt` in `metrics.json` or `Next command: none`), then checks gates (review APPROVE
  ~~~~

- [x] 4.2 opsx-apply.md і двійник openspec-apply-change: рядок archive на виході
  Files: templates/.agents/commands/opsx-apply.md, templates/.agents/skills/openspec-apply-change/SKILL.md
  Do: У `templates/.agents/commands/opsx-apply.md` зробити чотири заміни підрядка за парами AP1…AP4 (old → new), а в `templates/.agents/skills/openspec-apply-change/SKILL.md` — три за парами AS1…AS3. Інші рядки обох файлів (escape valve, Guardrails, `Parent-driven apply`) не змінювати. Нова фраза Session Exit лише в `opsx-apply.md`: двійник-skill не має секції Session Exit, тож вимога до `## Blocked` / `## Next command` / `## Next role` описана в його кроці 7 (AS2).
  Done-when: `grep -c -F 'npx agent-orchestrator-kit archive <name> --sync' templates/.agents/commands/opsx-apply.md` друкує 3 (baseline зараз 0; Do додає літерал у крок 7, у Output On Completion і в Session Exit) і `grep -c -F 'npx agent-orchestrator-kit archive <name> --sync' templates/.agents/skills/openspec-apply-change/SKILL.md` друкує 2 (baseline зараз 0; Do додає літерал у крок 7 і в Output On Completion); `grep -c -F 'suggest archive' templates/.agents/commands/opsx-apply.md` друкує 0 і те саме для `templates/.agents/skills/openspec-apply-change/SKILL.md` (baseline зараз 2 і 2); `grep -c -F 'You can archive this change with' templates/.agents/commands/opsx-apply.md` друкує 0 (baseline зараз 1); `grep -c -F 'Ready to archive this change.' templates/.agents/skills/openspec-apply-change/SKILL.md` друкує 0 (baseline зараз 1); `grep -c -F '**Green apply** (every task' templates/.agents/commands/opsx-apply.md` друкує 1 (baseline зараз 0); `grep -c -F 'Never start archive in this apply chat.' templates/.agents/commands/opsx-apply.md` друкує 1 (baseline зараз 1: заборону збережено); `node --test --test-reporter=tap --test-name-pattern="opsx-apply documents review gate|init installs the lean archive command" test/smoke.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 2` і `# fail 0`

  AP1-old:
  ~~~~text
     - If `state: "all_done"`: congratulate, suggest archive
  ~~~~

  AP1-new:
  ~~~~text
     - If `state: "all_done"`: congratulate and give the archive command line (see Session Exit)
  ~~~~

  AP2-old:
  ~~~~text
     - If all done: suggest archive
  ~~~~

  AP2-new:
  ~~~~text
     - If all done: show the archive command line `npx agent-orchestrator-kit archive <name> --sync` (terminal, after merge)
  ~~~~

  AP3-old:
  ~~~~text
  All tasks complete! You can archive this change with `/opsx:archive`.
  ~~~~

  AP3-new:
  ~~~~text
  All tasks complete! After the PR is merged, archive from a terminal: `npx agent-orchestrator-kit archive <name> --sync`.
  ~~~~

  AP4-old:
  ~~~~text
  Include task and build/lint status in Done. Never start archive in this apply chat.
  ~~~~

  AP4-new:
  ~~~~text
  Include task and build/lint status in Done. Never start archive in this apply chat.

  **Green apply** (every task `[x]`, build/lint green): write `## Blocked` as `none`, `## Next command` as the literal line `npx agent-orchestrator-kit archive <name> --sync` and `## Next role` as `none`. `handoff <name>` then prints only that line instead of a prompt — paste it as the one fenced block; it is run in a terminal after the PR is merged, so no new chat is needed. Otherwise keep `/opsx:apply <name>` (tasks remain) or `/opsx:propose <name>` (escape valve — record the gap in `## Blocked`).
  ~~~~

  AS1-old:
  ~~~~text
     - If `state: "all_done"`: congratulate, suggest archive
  ~~~~

  AS1-new:
  ~~~~text
     - If `state: "all_done"`: congratulate and give the archive command line
  ~~~~

  AS2-old:
  ~~~~text
     - If all done: suggest archive
  ~~~~

  AS2-new:
  ~~~~text
     - If all done: show the archive command line `npx agent-orchestrator-kit archive <name> --sync` (terminal, after merge). At Session Exit write it as `## Next command` with `## Blocked` `none` and `## Next role` `none`; `handoff <name>` then prints only that line instead of a prompt
  ~~~~

  AS3-old:
  ~~~~text
  All tasks complete! Ready to archive this change.
  ~~~~

  AS3-new:
  ~~~~text
  All tasks complete! After the PR is merged, archive from a terminal: `npx agent-orchestrator-kit archive <name> --sync`.
  ~~~~

- [x] 4.3 Rules session-handoff.mdc (+ копія в корені) і agent-orchestration.mdc в межах бюджету
  Files: templates/.agents/rules/session-handoff.mdc, templates/.agents/rules/agent-orchestration.mdc, .agents/rules/session-handoff.mdc
  Do: Спершу виміряти baseline суми довжин always-apply `.mdc` командою B1 і записати число B (baseline зараз 11734; бюджетний тест вимагає < 12000, ця зміна — не більше B + 200). Потім зробити чотири заміни підрядка: у `templates/.agents/rules/session-handoff.mdc` — пари S1 (крок 6 Session Exit) і S2 (абзац «Archive exception»); у `templates/.agents/rules/agent-orchestration.mdc` — пари A2 (рядок таблиці маршрутизації `/opsx:archive`) і A3 (абзац Exit HARD STOP). Закріплені тестами підрядки не чіпати: `Done/Blocked/Attach/spawn/HARD STOP`, `No separate Memory MCP read step`, `ONLY if both are unavailable`, `spawn_handoff_subagent: true`, рівно три нумеровані кроки Session Start; слово `spec-archiver` у таблиці; `Exit HARD STOP: parent writes `handoff.md` → `npx agent-orchestrator-kit handoff <name>` (exit 0)`, `` `session-handoff` persist only if the CLI failed `` і префікс `Start: honor pasted `/opsx:*` → `npx agent-orchestrator-kit handoff <name> --restore``. Нарешті скопіювати шаблон у корінь командою `cp templates/.agents/rules/session-handoff.mdc .agents/rules/session-handoff.mdc` (без `init --force`, `update` і `sync`).
  Done-when: `cmp templates/.agents/rules/session-handoff.mdc .agents/rules/session-handoff.mdc` не друкує нічого (exit 0); `B=<baseline з Do> node -e "const fs=require('fs'),p=require('path');let t=0;for(const f of fs.readdirSync('templates/.agents/rules').filter(x=>x.endsWith('.mdc'))){const s=fs.readFileSync(p.join('templates/.agents/rules',f),'utf-8');if(/^alwaysApply:\\s*true\\s*\$/m.test(s))t+=s.length}console.log(t);process.exit(t<12000&&t<=Number(process.env.B)+200?0:1)"` дає exit 0 (команда та сама, що й B1; `<baseline з Do>` — число, виміряне перед правками, зараз 11734); `grep -c -F '(green apply: the CLI prints one archive line for a terminal)' templates/.agents/rules/session-handoff.mdc` друкує 1 і `grep -c -F '(terminal/CI; ' templates/.agents/rules/session-handoff.mdc` друкує 1 (baseline зараз 0 і 0); `grep -c -F '(fallback) | — terminal/CI: ' templates/.agents/rules/agent-orchestration.mdc` друкує 1 і `grep -c -F '(green apply: the single archive line for a terminal)' templates/.agents/rules/agent-orchestration.mdc` друкує 1 (baseline зараз 0 і 0); `node --test --test-reporter=tap test/fix-next-session-prompt.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# fail 0` (а `# pass` дорівнює кількості тестів файлу — baseline зараз 9); `node --test --test-reporter=tap --test-name-pattern="always-apply rules|init installs orchestration" test/smoke.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 2` і `# fail 0`

  B1:
  ~~~~bash
  node -e "const fs=require('fs'),p=require('path');let t=0;for(const f of fs.readdirSync('templates/.agents/rules').filter(x=>x.endsWith('.mdc'))){const s=fs.readFileSync(p.join('templates/.agents/rules',f),'utf-8');if(/^alwaysApply:\\s*true\\s*\$/m.test(s))t+=s.length}console.log(t)"
  ~~~~

  S1-old:
  ~~~~text
  6. Paste CLI stdout as one fenced block. First line `/opsx:…`. Body uses
  ~~~~

  S1-new:
  ~~~~text
  6. Paste CLI stdout as one fenced block. First line `/opsx:…` (green apply: the CLI prints one archive line for a terminal). Body uses
  ~~~~

  S2-old:
  ~~~~text
  `npx agent-orchestrator-kit archive <name>` writes the final
  ~~~~

  S2-new:
  ~~~~text
  `npx agent-orchestrator-kit archive <name>` (terminal/CI; `/opsx:archive` = fallback) writes the final
  ~~~~

  A2-old:
  ~~~~text
  | `/opsx:archive` | — use `npx agent-orchestrator-kit archive <name>` | CLI;
  ~~~~

  A2-new:
  ~~~~text
  | `/opsx:archive` (fallback) | — terminal/CI: `npx agent-orchestrator-kit archive <name>` | CLI;
  ~~~~

  A3-old:
  ~~~~text
  paste CLI stdout as one fenced `/opsx:*` prompt. `session-handoff`
  ~~~~

  A3-new:
  ~~~~text
  paste CLI stdout as one fenced `/opsx:*` prompt (green apply: the single archive line for a terminal). `session-handoff`
  ~~~~

- [x] 4.4 AGENTS.md і CLAUDE.md: термінал/CI замість чату
  Files: templates/AGENTS.md, templates/CLAUDE.md
  Do: У `templates/AGENTS.md` зробити чотири заміни підрядка за парами AG1…AG4, у `templates/CLAUDE.md` — дві за парами CL1 і CL2. Решту тексту обох файлів не змінювати (зокрема речення «propose runs it as a pre-gate» у `AGENTS.md`).
  Done-when: `node -e "process.exit(require('fs').readFileSync('templates/AGENTS.md','utf-8').length<4000?0:1)"` дає exit 0 (baseline зараз 2904 символи; після правок бюджетний тест вимагає < 4000); `grep -c -F 'opted-in CI' templates/AGENTS.md` друкує 1 і `grep -c -F 'opted-in CI' templates/CLAUDE.md` друкує 1 (baseline зараз 0 і 0); `grep -c -F 'terminal' templates/AGENTS.md` друкує 4 (baseline зараз 0; Do додає чотири рядки: AG1…AG4); `grep -c -F 'single archive line' templates/CLAUDE.md` друкує 1 (baseline зараз 0); `grep -c -F 'propose runs it as a pre-gate' templates/AGENTS.md` друкує 1 (baseline зараз 1); `node --test --test-reporter=tap --test-name-pattern="always-apply rules|review punch-list|propose runs Tier 1" test/smoke.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 3` і `# fail 0`

  AG1-old:
  ~~~~text
  **archive is a CLI** (`npx agent-orchestrator-kit archive <name> [--sync]`), no subagent.
  ~~~~

  AG1-new:
  ~~~~text
  **archive is a CLI** run from a terminal or opted-in CI (`npx agent-orchestrator-kit archive <name> --sync`; `/opsx:archive` is the fallback), no subagent.
  ~~~~

  AG2-old:
  ~~~~text
  | Archive | `/opsx:archive` |
  ~~~~

  AG2-new:
  ~~~~text
  | Archive | terminal/CI: `npx agent-orchestrator-kit archive <name> --sync` (fallback `/opsx:archive`) |
  ~~~~

  AG3-old:
  ~~~~text
  → paste the CLI `/opsx:*` prompt. `session-handoff` subagent = fallback only.
  ~~~~

  AG3-new:
  ~~~~text
  → paste the CLI `/opsx:*` prompt (after a green apply the CLI prints one archive line for a terminal instead). `session-handoff` subagent = fallback only.
  ~~~~

  AG4-old:
  ~~~~text
  - Archive after merge. Build/lint before PR.
  ~~~~

  AG4-new:
  ~~~~text
  - Archive after merge — from a terminal or CI (`/opsx:archive` is the fallback). Build/lint before PR.
  ~~~~

  CL1-old:
  ~~~~text
  archive runs `npx agent-orchestrator-kit archive <name> [--sync]` — no subagent.
  ~~~~

  CL1-new:
  ~~~~text
  archive runs from a terminal or opted-in CI as `npx agent-orchestrator-kit archive <name> --sync` (`/opsx:archive` is the fallback) — no subagent.
  ~~~~

  CL2-old:
  ~~~~text
  optional `--collect`), paste the CLI prompt.
  ~~~~

  CL2-new:
  ~~~~text
  optional `--collect`), paste the CLI prompt (after a green apply: the single archive line, for a terminal).
  ~~~~

- [x] 4.5 Skill agent-orchestration, openspec-guide і subagent session-handoff
  Files: templates/.agents/skills/agent-orchestration/SKILL.md, templates/.agents/subagents/openspec-guide.md, templates/.agents/subagents/session-handoff.md
  Do: У `templates/.agents/skills/agent-orchestration/SKILL.md` зробити п'ять замін підрядка за парами SK1…SK5 (SK5 — пункт чек-листа «Orchestration Checklist (per change)», текст якого починається з `/opsx:archive` run after merge; маркер чекбокса на початку рядка лишити, замінюється лише текст після нього), у `templates/.agents/subagents/openspec-guide.md` — пара OG1, у `templates/.agents/subagents/session-handoff.md` — пара SH1 (крок 5 у «Persist mode»). Закріплені тестами фрази не чіпати: рівно два входження «no separate Memory MCP read step» (без урахування регістру), шість нумерованих кроків між `**Start of each session:**` і `**During session:**`, `Spec review discovery loops: ≤ 2`, `one-finding review loop`, `run `/opsx:propose <name>` to fix the punch list`, у `openspec-guide.md` — рядки про `gate-check --review` і `Verdict: REQUEST CHANGES`.
  Done-when: `grep -c -F '(fallback) | — terminal/CI: ' templates/.agents/skills/agent-orchestration/SKILL.md` друкує 1 (baseline зараз 0); `awk '/^### verify → archive/{f=1} /^## Session Rules/{f=0} f' templates/.agents/skills/agent-orchestration/SKILL.md | grep -c -F 'npx agent-orchestrator-kit archive <name> --sync'` друкує 1 (baseline зараз 0); `grep -c -F 'after a green apply' templates/.agents/skills/agent-orchestration/SKILL.md` друкує 2 (baseline зараз 0; SK3 і SK4); `grep -c -F 'AOK_ARCHIVE_ON_MERGE' templates/.agents/skills/agent-orchestration/SKILL.md` друкує 1 (baseline зараз 0); `grep -c -E '/opsx:archive. run after merge' templates/.agents/skills/agent-orchestration/SKILL.md` друкує 0 і `grep -c -E 'archive <name> --sync. run after merge' templates/.agents/skills/agent-orchestration/SKILL.md` друкує 1 (baseline зараз 1 і 0; крапка в шаблоні збігається з бектиком у тексті); `grep -c -F 'CI auto-archives after merge if' templates/.agents/subagents/openspec-guide.md` друкує 0 (baseline зараз 1) і `grep -c -F 'AOK_ARCHIVE_ON_MERGE=true' templates/.agents/subagents/openspec-guide.md` друкує 1 (baseline зараз 0); `grep -c -F 'after a green apply' templates/.agents/subagents/session-handoff.md` друкує 1 (baseline зараз 0); `node --test --test-reporter=tap test/fix-next-session-prompt.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# fail 0` (а `# pass` дорівнює кількості тестів файлу — baseline зараз 9); `node --test --test-reporter=tap --test-name-pattern="review punch-list|propose runs Tier 1" test/smoke.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 2` і `# fail 0`

  SK1-old:
  ~~~~text
  | `/opsx:archive` | — run `npx agent-orchestrator-kit archive <name>` | CLI; phase subagent forbidden
  ~~~~

  SK1-new:
  ~~~~text
  | `/opsx:archive` (fallback) | — terminal/CI: `npx agent-orchestrator-kit archive <name>` | CLI; phase subagent forbidden
  ~~~~

  SK2-old:
  ~~~~text
  ### verify → archive
  After PR merged + CI green:
  ```
  /opsx:archive <name>
  ```
  Archive is one deterministic CLI call — `npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]` — which checks gates, merges delta specs on `--sync`, moves the change to the dated archive, validates with rollback, and writes the final handoff. No phase subagent.
  ~~~~

  SK2-new:
  ~~~~text
  ### verify → archive
  After PR merged + CI green, run it from a terminal — no chat needed:
  ```
  npx agent-orchestrator-kit archive <name> --sync
  ```
  Archive is one deterministic CLI call — `npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]` — which refuses a folder that already looks archived (Gate 0), checks gates, merges delta specs on `--sync`, moves the change to the dated archive, validates with rollback, and writes the final handoff. No phase subagent. An opted-in CI job (`AOK_ARCHIVE_ON_MERGE=true`) runs the same command with `--if-ready` after merge; `/opsx:archive <name>` in chat is only the fallback when a terminal or CI was not available.
  ~~~~

  SK3-old:
  ~~~~text
  5. Paste the CLI stdout as one fenced next-session prompt. First line is `/opsx:<next> <name>`; body uses
  ~~~~

  SK3-new:
  ~~~~text
  5. Paste the CLI stdout as one fenced next-session prompt. First line is `/opsx:<next> <name>` (after a green apply the CLI prints only `npx agent-orchestrator-kit archive <name> --sync` — run it in a terminal after merge); body uses
  ~~~~

  SK4-old:
  ~~~~text
  (3) paste the CLI stdout prompt whose first line is `/opsx:<next> <name>`.
  ~~~~

  SK4-new:
  ~~~~text
  (3) paste the CLI stdout prompt whose first line is `/opsx:<next> <name>` (after a green apply: the single archive line instead).
  ~~~~

  SK5-old:
  ~~~~text
  `/opsx:archive` run after merge — `npx agent-orchestrator-kit status` shows "ready to archive"
  ~~~~

  SK5-new:
  ~~~~text
  `npx agent-orchestrator-kit archive <name> --sync` run after merge (terminal or opted-in CI; `/opsx:archive` is the fallback) — `npx agent-orchestrator-kit status` shows "ready to archive"
  ~~~~

  OG1-old:
  ~~~~text
     - All tasks `[x]` and review approved → ready to archive, suggest `/opsx:archive <name>` (or note that GitLab/GitHub CI auto-archives after merge if `archive_after_merge: true`)
  ~~~~

  OG1-new:
  ~~~~text
     - All tasks `[x]` and review approved → ready to archive: suggest the terminal command `npx agent-orchestrator-kit archive <name> --sync` after the PR is merged (`/opsx:archive <name>` only as a fallback; CI archives automatically only when the repo opted in with `AOK_ARCHIVE_ON_MERGE=true` and `archive_after_merge: true`)
  ~~~~

  SH1-old:
  ~~~~text
  5. Put the CLI stdout prompt (first line `/opsx:…`) into **Next prompt** unchanged.
  ~~~~

  SH1-new:
  ~~~~text
  5. Put the CLI stdout prompt (first line `/opsx:…`, or the single `npx agent-orchestrator-kit archive <name> --sync` line after a green apply) into **Next prompt** unchanged.
  ~~~~

- [x] 4.6 Тести: група templates
  Files: new file: test/archive-from-terminal.test.js
  Do: У `test/archive-from-terminal.test.js` після `makeApplyChange` додати хелпер `const readKit = (rel) => readFileSync(join(KIT_ROOT, rel), 'utf-8');` і чотири тести (шляхи — від `KIT_ROOT`). (1) `templates: opsx-archive is a thin fallback within 1024 bytes and never names spec-archiver` — `statSync(templates/.agents/commands/opsx-archive.md).size <= 1024`; текст не містить `spec-archiver`, не має жодного рядка, що починається з `## `, містить `Fallback`, `Normal path: run `npx agent-orchestrator-kit archive <name> --sync` in a terminal`, `npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]`, `On exit ≠ 0, print the refusal from stderr and STOP` і `no manual merge/move`. (2) `templates: apply command and skill name the archive line and Next role none` — `opsx-apply.md` містить речення з AP4-new (`**Green apply** (every task `[x]`, build/lint green): write `## Blocked` as `none`, `## Next command` as the literal line `npx agent-orchestrator-kit archive <name> --sync` and `## Next role` as `none``) і `Never start archive in this apply chat.`, літерал `` `npx agent-orchestrator-kit archive <name> --sync` `` (у бектиках) зустрічається в ньому рівно 3 рази, а фрази `suggest archive` та ``archive this change with `/opsx:archive` `` відсутні; `openspec-apply-change/SKILL.md` містить цей літерал рівно 2 рази і фразу `` `## Next command` with `## Blocked` `none` and `## Next role` `none` ``, а `suggest archive` відсутнє. (3) `templates: rules and AGENTS.md keep their budgets and describe terminal-first archive` — `session-handoff.mdc` містить `First line `/opsx:…` (green apply: the CLI prints one archive line for a terminal).` і ``archive <name>` (terminal/CI; `/opsx:archive` = fallback) writes the final``; `agent-orchestration.mdc` містить рядок таблиці з A2-new повністю (`| `/opsx:archive` (fallback) | — terminal/CI: `npx agent-orchestrator-kit archive <name>` | CLI; subagent forbidden (`spec-archiver` = CLI-failure fallback only) |`) і `(green apply: the single archive line for a terminal)`; `.agents/rules/session-handoff.mdc` кіта дорівнює шаблону; сума `text.length` усіх `templates/.agents/rules/*.mdc` з `alwaysApply: true` < 12000; `templates/AGENTS.md` коротший за 4000 символів і містить усі чотири нові фрази AG1-new…AG4-new (для AG3 — `after a green apply the CLI prints one archive line for a terminal instead`); `templates/CLAUDE.md` містить CL1-new (`archive runs from a terminal or opted-in CI as `npx agent-orchestrator-kit archive <name> --sync` (`/opsx:archive` is the fallback)`). (4) `templates: skills and subagents tell the same terminal-first story` — секція `### verify → archive` (між `### verify → archive` і `## Session Rules`) skill `agent-orchestration` містить `run it from a terminal — no chat needed:` з наступним fenced-блоком `npx agent-orchestrator-kit archive <name> --sync`, а також `Gate 0`, `--if-ready` і ``/opsx:archive <name>` in chat is only the fallback``; той самий skill містить `| `/opsx:archive` (fallback) | — terminal/CI:`, обидва виняткові речення SK3-new / SK4-new (`after a green apply the CLI prints only` і `after a green apply: the single archive line instead`) та пункт чек-листа, що починається з `- [ ] ` + `` `npx agent-orchestrator-kit archive <name> --sync` run after merge ``, і не містить рядка, що починається з `- [ ] ` + `` `/opsx:archive` run after merge ``; `openspec-guide.md` містить `suggest the terminal command `npx agent-orchestrator-kit archive <name> --sync` after the PR is merged` і `AOK_ARCHIVE_ON_MERGE=true`, але не `CI auto-archives after merge if`; `subagents/session-handoff.md` містить ``or the single `npx agent-orchestrator-kit archive <name> --sync` line after a green apply``; skill `openspec-archive-change` містить `The normal path is a terminal after the PR is merged`, ``Gate 0: `archivedAt` in `metrics.json` or `Next command: none` `` і ``npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force]``.
  Done-when: `node --test --test-reporter=tap --test-name-pattern="^templates:" test/archive-from-terminal.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 4` і `# fail 0` (baseline: цих тестів ще немає); `grep -c '^test(' test/archive-from-terminal.test.js` друкує 25 (двадцять один із тасків 1.4, 2.3 і 3.2 плюс чотири цього таску)

## 5. CI-шаблони: opt-in архівація

- [x] 5.1 GitHub: job archive у agent-verify.yml
  Files: templates/.github/workflows/agent-verify.yml
  Do: Дописати в кінець `templates/.github/workflows/agent-verify.yml` (після останнього рядка `        run: pnpm test`) один порожній рядок і блок GH1 дослівно: блок належить до ключа `jobs:` (відступ 2 пробіли), тобто стає другим job-ом після `verify`. Наявні рядки файлу (перший job `verify` з усіма кроками) не змінювати.
  Done-when: `node -e "const Y=require('yaml');const d=Y.parse(require('fs').readFileSync('templates/.github/workflows/agent-verify.yml','utf-8'));const a=d.jobs.archive;process.exit(Object.keys(d.jobs).join()==='verify,archive' && a.needs==='verify' && a.concurrency.group==='agent-archive' && a.concurrency['cancel-in-progress']===false && a.steps[0].with['fetch-depth']===0 && a.steps[0].with.token==='\${{ secrets.AOK_ARCHIVE_TOKEN || github.token }}' && d.jobs.verify.steps.some(x=>x.name==='OpenSpec validate') && d.jobs.verify.steps.some(x=>x.name==='Test (pnpm)') ? 0 : 1)"` дає exit 0 (baseline зараз: `archive` немає, `verify` має кроки `OpenSpec validate` і `Test (pnpm)`); `grep -c -F 'AOK_ARCHIVE_ON_MERGE' templates/.github/workflows/agent-verify.yml` друкує 2 і `grep -c -F 'AOK_ARCHIVE_TOKEN' templates/.github/workflows/agent-verify.yml` друкує 2 (baseline зараз 0 і 0); `grep -c -F -- '--if-ready' templates/.github/workflows/agent-verify.yml` друкує 2 і `grep -c -F '[skip ci]' templates/.github/workflows/agent-verify.yml` друкує 2 (baseline зараз 0 і 0); `grep -c -F 'needs: verify' templates/.github/workflows/agent-verify.yml` друкує 1 (baseline зараз 0); `git diff --numstat -- templates/.github/workflows/agent-verify.yml | awk '{exit $2==0 ? 0 : 1}'` дає exit 0 (у diff лише додані рядки, поки файл не закомічено); `node --test --test-reporter=tap --test-name-pattern="CI workflow supports yarn and pnpm detection|init --ci github default keeps backward compat" test/smoke.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 2` і `# fail 0`

  GH1:
  ~~~~yaml
    # Opt-in: archive merged changes from CI instead of a terminal (a terminal stays the default).
    # OFF unless the repository variable AOK_ARCHIVE_ON_MERGE is "true"
    # (Settings → Secrets and variables → Actions → Variables).
    # Pushing the archive commit needs a token that may push to the protected default branch:
    # store it as the secret AOK_ARCHIVE_TOKEN (branch-protection bypass); without it the
    # workflow token is used and the push works only on an unprotected branch.
    # The commit message carries [skip ci], so the push does not start another run.
    # `archive --if-ready` decides readiness (archive_after_merge: true, review APPROVE,
    # all tasks done, not already archived); a change that is not ready is skipped.
    archive:
      needs: verify
      if: github.event_name == 'push' && github.ref_name == github.event.repository.default_branch && vars.AOK_ARCHIVE_ON_MERGE == 'true'
      runs-on: ubuntu-latest
      permissions:
        contents: write
      concurrency:
        group: agent-archive
        cancel-in-progress: false
      steps:
        - uses: actions/checkout@v5
          with:
            fetch-depth: 0
            token: ${{ secrets.AOK_ARCHIVE_TOKEN || github.token }}

        - uses: actions/setup-node@v5
          with:
            node-version: 22

        - name: Install dependencies
          run: |
            if [ -f pnpm-lock.yaml ]; then
              corepack enable
              pnpm install --frozen-lockfile
            elif [ -f yarn.lock ]; then
              yarn install --frozen-lockfile
            else
              npm ci
            fi

        - name: Archive ready changes
          run: |
            set -eu
            for dir in openspec/changes/*/; do
              [ -d "$dir" ] || continue
              name=$(basename "$dir")
              [ "$name" = "archive" ] && continue
              npx agent-orchestrator-kit archive "$name" --sync --if-ready
            done

        - name: Commit and push the archive
          run: |
            set -eu
            git config user.name "agent-orchestrator-kit[bot]"
            git config user.email "agent-orchestrator-kit@users.noreply.github.com"
            git add -A openspec
            if git diff --cached --quiet; then
              echo "nothing archived"
              exit 0
            fi
            git commit -m "chore(openspec): archive merged change [skip ci]"
            git push origin HEAD:"$GITHUB_REF_NAME"
  ~~~~

- [x] 5.2 GitLab: job agent-archive у .gitlab/agent-verify.yml
  Files: templates/.gitlab/agent-verify.yml
  Do: Дописати в кінець `templates/.gitlab/agent-verify.yml` (після останнього рядка `    - if: $CI_COMMIT_BRANCH == "develop"`) один порожній рядок і блок GL1 дослівно (top-level job на відступі 0). Наявні `.agent-verify-base` і `agent-verify` не змінювати: `agent-archive` лише `extends` базу (image `node:20`, встановлення залежностей, `GIT_DEPTH: 0`) і перевизначає `script`.
  Done-when: `node -e "const Y=require('yaml');const d=Y.parse(require('fs').readFileSync('templates/.gitlab/agent-verify.yml','utf-8'));const a=d['agent-archive'];process.exit(Object.keys(d).join()==='.agent-verify-base,agent-verify,agent-archive' && a.extends==='.agent-verify-base' && a.needs.join()==='agent-verify' && a.rules.length===1 && a.rules[0].if==='\$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH && \$AOK_ARCHIVE_ON_MERGE == \"true\"' && d['agent-verify'].extends==='.agent-verify-base' && d['.agent-verify-base'].image==='node:20' ? 0 : 1)"` дає exit 0 (baseline зараз: `agent-archive` немає, `agent-verify` extends базу, база має image node:20); `grep -c -F 'AOK_ARCHIVE_ON_MERGE' templates/.gitlab/agent-verify.yml` друкує 2 і `grep -c -F 'AOK_ARCHIVE_TOKEN' templates/.gitlab/agent-verify.yml` друкує 2 (baseline зараз 0 і 0); `grep -c -F -- '--if-ready' templates/.gitlab/agent-verify.yml` друкує 2 і `grep -c -F '[skip ci]' templates/.gitlab/agent-verify.yml` друкує 2 (baseline зараз 0 і 0); `grep -c -F 'needs:' templates/.gitlab/agent-verify.yml` друкує 1 (baseline зараз 0) і `grep -c -F 'extends:' templates/.gitlab/agent-verify.yml` друкує 2 (baseline зараз 1); `git diff --numstat -- templates/.gitlab/agent-verify.yml | awk '{exit $2==0 ? 0 : 1}'` дає exit 0 (лише додані рядки, поки файл не закомічено); `node --test --test-reporter=tap --test-name-pattern="GitLab fragment contains PM detection|init --ci gitlab \+ update refreshes GitLab fragment" test/smoke.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 2` і `# fail 0`

  GL1:
  ~~~~yaml
  # Opt-in: archive merged changes from CI instead of a terminal (a terminal stays the default).
  # OFF unless the CI/CD variable AOK_ARCHIVE_ON_MERGE is "true". Pushing the archive commit needs
  # a masked CI/CD variable AOK_ARCHIVE_TOKEN: an access token with write_repository whose user may
  # push to the protected default branch (branch-protection bypass).
  # The commit message carries [skip ci], so the push does not start another pipeline.
  # `archive --if-ready` decides readiness (archive_after_merge: true, review APPROVE, all tasks
  # done, not already archived); a change that is not ready is skipped.
  agent-archive:
    extends: .agent-verify-base
    needs: ["agent-verify"]
    rules:
      - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $AOK_ARCHIVE_ON_MERGE == "true"'
    script:
      - |
        set -eu
        for dir in openspec/changes/*/; do
          [ -d "$dir" ] || continue
          name=$(basename "$dir")
          [ "$name" = "archive" ] && continue
          npx agent-orchestrator-kit archive "$name" --sync --if-ready
        done
      - |
        set -eu
        git config user.name "agent-orchestrator-kit[bot]"
        git config user.email "agent-orchestrator-kit@noreply.invalid"
        git add -A openspec
        if git diff --cached --quiet; then
          echo "nothing archived"
          exit 0
        fi
        git commit -m "chore(openspec): archive merged change [skip ci]"
        git push "https://oauth2:${AOK_ARCHIVE_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" "HEAD:${CI_DEFAULT_BRANCH}"
  ~~~~

- [x] 5.3 Тести: група ci
  Files: new file: test/archive-from-terminal.test.js
  Do: У `test/archive-from-terminal.test.js` дописати два async-тести; YAML парсити динамічним `const { parse } = await import('yaml');` усередині кожного тесту (пакет `yaml` лежить у `node_modules` як залежність devDependency `@fission-ai/openspec`), текст файлів читати хелпером `readKit` з таску 4.6. (1) `ci: GitHub workflow keeps the verify job and adds an opt-in archive job` — `Object.keys(doc.jobs)` містить `verify` і `archive`; імена кроків `doc.jobs.verify.steps` містять `Detect package manager`, `OpenSpec validate`, `Gate check (review gate)`, `Lint (npm)`, `Build (npm)`, `Test (npm)` і `Test (pnpm)`; `doc.on.push.branches` містить `main`; `archive.needs === 'verify'`; `archive.if` містить `github.event_name == 'push'`, `github.ref_name == github.event.repository.default_branch` і `vars.AOK_ARCHIVE_ON_MERGE == 'true'`; `archive.concurrency` дорівнює `{ group: 'agent-archive', 'cancel-in-progress': false }`; `archive.permissions.contents === 'write'`; перший крок — `actions/checkout@v5` з `with['fetch-depth'] === 0` і `with.token === '${{ secrets.AOK_ARCHIVE_TOKEN || github.token }}'`; об'єднані `run` кроків archive містять `npx agent-orchestrator-kit archive "$name" --sync --if-ready`, `git add -A openspec`, `git diff --cached --quiet`, `git commit -m "chore(openspec): archive merged change [skip ci]"` і `git push origin HEAD:"$GITHUB_REF_NAME"`; текст файлу містить `AOK_ARCHIVE_TOKEN`, `[skip ci]` і `a terminal stays the default`. (2) `ci: GitLab fragment keeps the base and agent-verify jobs and adds an opt-in agent-archive job` — `Object.keys(doc)` містить `.agent-verify-base`, `agent-verify` і `agent-archive`; `doc['.agent-verify-base'].image === 'node:20'`, а об'єднаний `script` бази містить `npx openspec validate --all --strict` і `gate-check`; `doc['agent-verify'].extends === '.agent-verify-base'`, а `doc['agent-verify'].rules` містить правило `{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' }`; `agent-archive`: `extends === '.agent-verify-base'`, `needs` дорівнює `['agent-verify']`, `rules` дорівнює `[{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $AOK_ARCHIVE_ON_MERGE == "true"' }]`; об'єднаний `script` містить `npx agent-orchestrator-kit archive "$name" --sync --if-ready`, `git commit -m "chore(openspec): archive merged change [skip ci]"` і `git push "https://oauth2:${AOK_ARCHIVE_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" "HEAD:${CI_DEFAULT_BRANCH}"`; текст файлу містить `a terminal stays the default`.
  Done-when: `node --test --test-reporter=tap --test-name-pattern="^ci:" test/archive-from-terminal.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 2` і `# fail 0` (baseline: цих тестів ще немає); `grep -c '^test(' test/archive-from-terminal.test.js` друкує 27 (двадцять п'ять із тасків 1.4, 2.3, 3.2 і 4.6 плюс два цього таску); `node --test --test-reporter=tap test/archive-from-terminal.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 27` і `# fail 0`

## 6. README і CHANGELOG

- [x] 6.1 README: розділ Archive, Configuration, CLI reference
  Files: README.md
  Do: У `README.md` зробити дев'ять замін підрядка за парами R1…R9 (old → new; кожен old зустрічається в файлі рівно один раз). У блоках R2-new, R3-new і R4-new лапки з трьох бектиків — звичайні fenced-блоки README (у цьому файлі вони обгорнуті в чотири тильди). Розділ «Changelog» самого README (список випущених версій) і решту тексту не змінювати.
  Done-when: `grep -c -F -- '--if-ready' README.md` друкує 6 (baseline зараз 0; Do додає шість рядків: у R3-new, три в R4-new, у R5-new і в R8-new); `grep -c -F 'AOK_ARCHIVE_ON_MERGE' README.md` друкує 1 і `grep -c -F 'AOK_ARCHIVE_TOKEN' README.md` друкує 1 (baseline зараз 0 і 0); `grep -c -F '[skip ci]' README.md` друкує 1 (baseline зараз 0); `grep -c -F 'Gate 0' README.md` друкує 4 (baseline зараз 0; рядки в R3-new, R4-new і два в R8-new); `grep -c -F 'archive_after_merge' README.md` друкує 6 (baseline зараз 1: єдиний рядок блоку Configuration лишається одним; R4-new додає два рядки, R6-new, R7-new і R8-new — по одному); `grep -c -F '#### CI archive (opt-in)' README.md` друкує 1 (baseline зараз 0); `grep -c -F 'hook can append leftover usage to a *local*' README.md` друкує 1 (baseline зараз 0); `grep -c -F '/opsx:archive add-bulk-camera-export' README.md` друкує 0 (baseline зараз 1: приклад чат-команди замінено на термінальну)

  R1-old:
  ~~~~markdown
  ### Archive — `/opsx:archive`
  ~~~~

  R1-new:
  ~~~~markdown
  ### Archive — terminal first, `/opsx:archive` as fallback
  ~~~~

  R2-old:
  ~~~~markdown
  After PR merged + CI green:
  ```
  /opsx:archive add-bulk-camera-export
  ```
  ~~~~

  R2-new:
  ~~~~markdown
  After the PR is merged and CI is green, archive from a terminal — no chat needed:

  ```bash
  npx agent-orchestrator-kit archive add-bulk-camera-export --sync
  ```

  After a green apply (the Implementer closes, every task in `tasks.md` is `[x]`, `## Blocked` is `none`), `handoff <name>` prints exactly this line instead of a next-session prompt; run it once the PR is merged. `/opsx:archive <name>` stays as a fallback for when a terminal or CI was not available.
  ~~~~

  R3-old:
  ~~~~markdown
  npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force] [--collect]
  ```

  It checks the gates (APPROVE in `review.md` when required, all tasks `[x]`, target folder free),
  ~~~~

  R3-new:
  ~~~~markdown
  npx agent-orchestrator-kit archive <name> [--sync | --no-sync --force] [--if-ready] [--collect]
  ```

  It first runs **Gate 0** and refuses a folder that already looks archived (`archivedAt` set in the change `metrics.json`, or `Next command: none` in `handoff.md`; for a re-opened copy clear the marker and re-run), then checks the gates (APPROVE in `review.md` when required, all tasks `[x]`, target folder free),
  ~~~~

  R4-old:
  ~~~~markdown
  The `/opsx:archive` command is a thin wrapper that calls this CLI; the `spec-archiver` subagent remains only as a fallback when the CLI is unavailable.
  ~~~~

  R4-new:
  ~~~~markdown
  `/opsx:archive` is the chat fallback: a thin wrapper that calls this CLI, shows its output, and on a refusal prints it and stops; the `spec-archiver` subagent remains only as a fallback when the CLI is unavailable.

  **`--if-ready`** is the CI mode of the same command. It prints one `skip: <reason>` line, exits 0 and changes nothing when `pipeline.archive_after_merge` is `false`, the change already looks archived (Gate 0), or it is not ready — the same blockers `status` prints (`tasks incomplete`, `no review.md`, …; a missing `tasks.md` counts as not ready). Otherwise it archives like a normal run, and real failures (an existing target folder, a delta-spec sync conflict, a failed validation) still exit 1. Without `--if-ready` a manual archive ignores `archive_after_merge`.

  #### CI archive (opt-in)

  A terminal stays the default. The CI templates (`agent-verify.yml`: GitHub job `archive`, GitLab job `agent-archive`) also contain an archive job that is off until you opt in:

  1. Set the repository variable (GitLab: CI/CD variable) `AOK_ARCHIVE_ON_MERGE=true`. Without it the job is skipped.
  2. Add the secret (GitLab: masked CI/CD variable) `AOK_ARCHIVE_TOKEN` — a token whose user may push to the protected default branch (a branch-protection bypass). On GitHub the job falls back to the workflow token, which can push only to an unprotected branch.
  3. Keep `pipeline.archive_after_merge: true` in `.agents/orchestrator.yaml` (the `mvp` profile sets `false`).

  On a push to the default branch the job waits for `verify`, runs `archive <name> --sync --if-ready` for every `openspec/changes/<name>/`, and pushes one `chore(openspec): archive merged change [skip ci]` commit with the moved change and its finalized `metrics.json`; `[skip ci]` keeps that push from starting another run.

  Known caveats: a Cursor `sessionEnd` hook can append leftover usage to a *local* `metrics.json` after the last persist, which then conflicts with the CI commit (keep the archived copy when you resolve it); two merges in quick succession can make the first push fail as non-fast-forward (the next push to the default branch archives again, or archive from a terminal); the job runs the published `npx agent-orchestrator-kit`, so it needs a kit version that has `--if-ready`.
  ~~~~

  R5-old:
  ~~~~yaml
    archive_after_merge: true
    task_contract: warn           #
  ~~~~

  R5-new:
  ~~~~yaml
    archive_after_merge: true     # policy flag: `status` shows it; `archive --if-ready` and the opt-in CI job honour it; a manual archive ignores it
    task_contract: warn           #
  ~~~~

  R6-old:
  ~~~~markdown
  Prints every active OpenSpec change with task progress
  ~~~~

  R6-new:
  ~~~~markdown
  Prints an `archive_after_merge: <true|false>` policy line under the title (when `.agents/orchestrator.yaml` exists), then every active OpenSpec change with task progress
  ~~~~

  R7-old:
  ~~~~text
  npx agent-orchestrator-kit status
    Show progress, review verdict, archive-readiness, MCP health, and Skill health
  ~~~~

  R7-new:
  ~~~~text
  npx agent-orchestrator-kit status
    Show the archive_after_merge policy line, progress, review verdict, archive-readiness, MCP health, and Skill health
  ~~~~

  R8-old:
  ~~~~text
    --collect          Collect all spend adapters (default: locked client only)
    Gate-check a completed change, optionally merge delta specs, move to
  ~~~~

  R8-new:
  ~~~~text
    --collect          Collect all spend adapters (default: locked client only)
    --if-ready         CI mode: print "skip: <reason>" and exit 0 (nothing changed) when
                       archive_after_merge is false, the change already looks archived
                       (Gate 0) or is not ready; real failures still exit 1
    Refuse an already archived folder (Gate 0), gate-check a completed change, optionally merge delta specs, move to
  ~~~~

  R9-old:
  ~~~~text
    --no-metrics       Skip recording this session into metrics.json
  ~~~~

  R9-new:
  ~~~~text
    --no-metrics       Skip recording this session into metrics.json
    After a green apply (Implementer, every task [x], Blocked none) stdout is the
    single archive command line instead of a next-session prompt.
  ~~~~

- [x] 6.2 CHANGELOG: пункти в наявних блоках Added і Changed секції Unreleased
  Files: CHANGELOG.md
  Do: У `CHANGELOG.md` у секції `## [Unreleased]` зробити дві вставки без нових підзаголовків і без зміни версії: (1) пара CH1-old → CH1-new додає один пункт на початок наявного блоку `### Added`; (2) пара CH2-old → CH2-new додає один пункт на початок наявного блоку `### Changed` (перед пунктом «Next-session prompt follows the parent-driven protocol»). Решту файлу не змінювати.
  Done-when: `grep -c -F -- '--if-ready' CHANGELOG.md` друкує 1 (baseline зараз 0); `grep -c -F 'Archive from a terminal or opt-in CI, with an already-archived gate.' CHANGELOG.md` друкує 1 і `grep -c -F 'A green apply prints the archive command, and ' CHANGELOG.md` друкує 1 (baseline зараз 0 і 0); `awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f && /^### /' CHANGELOG.md` друкує рівно три рядки `### Added`, `### Changed`, `### Fixed` (підзаголовки не додано, baseline зараз ті самі три); `git diff --quiet -- package.json` дає exit 0 (версію не змінено, baseline зараз так само)

  CH1-old:
  ~~~~markdown
  ## [Unreleased]

  ### Added
  ~~~~

  CH1-new:
  ~~~~markdown
  ## [Unreleased]

  ### Added
  - **Archive from a terminal or opt-in CI, with an already-archived gate.** `archive <name>` first refuses a folder that already looks archived (Gate 0: `archivedAt` in the active `metrics.json`, or `Next command: none` in `handoff.md`; absent or invalid files never refuse). New `archive <name> --if-ready` is the CI mode: it prints `skip: <reason>` and exits 0 without touching anything when `archive_after_merge` is `false`, the change is already archived, or it is not ready (the same blockers `status` prints, now one shared helper); real failures still exit 1. `pipeline.archive_after_merge` is finally read (default `true`) and `status` prints it. The CI templates gain an opt-in archive job (GitHub `archive`, GitLab `agent-archive`, enabled by `AOK_ARCHIVE_ON_MERGE=true`, pushing with `AOK_ARCHIVE_TOKEN`, commit message `[skip ci]`); a terminal stays the default.
  ~~~~

  CH2-old:
  ~~~~markdown
  ### Changed
  - **Next-session prompt follows the parent-driven protocol.**
  ~~~~

  CH2-new:
  ~~~~markdown
  ### Changed
  - **A green apply prints the archive command, and `/opsx:archive` is a fallback.** When the Implementer closes with every task `[x]` and `## Blocked` empty, `handoff <name>` prints exactly `npx agent-orchestrator-kit archive <name> --sync` (to run in a terminal after merge) instead of a next-session prompt, and sets `## Next role` to `none`; every other exit is unchanged. `templates/.agents/commands/opsx-archive.md` shrinks to a fallback that calls the CLI and stops on a refusal; the apply command and skill, the rules, `AGENTS.md`, `CLAUDE.md` and `openspec-guide` now point to the terminal. `parsePipelineConfig` returns a new `archiveAfterMerge` key.
  - **Next-session prompt follows the parent-driven protocol.**
  ~~~~

## 7. Перевірка

- [x] 7.1 Артефакти, нові тести й повний набір
  Files: openspec/changes/archive-from-terminal/proposal.md, openspec/changes/archive-from-terminal/design.md, openspec/changes/archive-from-terminal/tasks.md, new file: test/archive-from-terminal.test.js
  Do: З кореня репозиторію прогнати по черзі `npx --no-install openspec validate archive-from-terminal --strict --type change`, `node bin/agent-orchestrator.js gate-check --review archive-from-terminal`, `node bin/agent-orchestrator.js gate-check --tasks archive-from-terminal` і `node --test test/archive-from-terminal.test.js`; виправити причину будь-якої відмови у файлах тасків 1.1–6.2, не послаблюючи асертів і не змінюючи `test/smoke.test.js` та `package.json`. Потім виміряти ресурси (команда з Constraints) і, лише коли MemAvailable ≥ 3000 MiB та loadavg 1m < nproc × 0.5, прогнати повний `node --test test/*.test.js`; інакше обмежитись вузькими прогонами `test/archive-from-terminal.test.js`, `test/fix-next-session-prompt.test.js`, `test/gate-check-config-parser-and-src-glob.test.js` та `--test-name-pattern="^status|^archive|^handoff persist|always-apply rules|init installs the lean archive command" test/smoke.test.js` і записати в handoff, що повний набір не запускався через ресурси. Не запускати `init`, `update`, `sync` і `init --force` у корені.
  Done-when: `npx --no-install openspec validate archive-from-terminal --strict --type change >/dev/null; echo $?` друкує 0; `node bin/agent-orchestrator.js gate-check --review archive-from-terminal >/dev/null 2>&1; echo $?` друкує 0; `node bin/agent-orchestrator.js gate-check --tasks archive-from-terminal >/dev/null 2>&1; echo $?` друкує 0; `node --test --test-reporter=tap test/archive-from-terminal.test.js 2>&1 | grep -E '^# (pass|fail) '` друкує `# pass 27` і `# fail 0`; `git diff --quiet -- test/smoke.test.js package.json; echo $?` друкує 0; повний `node --test test/*.test.js 2>&1 | grep -E '^# fail '` друкує `# fail 0` (baseline зараз: усі тести проходять; загальну кількість не фіксувати — вона дорівнює поточному числу тестів плюс 27)
