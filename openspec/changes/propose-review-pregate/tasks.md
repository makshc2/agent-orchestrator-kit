## 1. Propose: Tier 1 pre-gate, обов’язкові заголовки, якість Done-when

- [x] 1.1 Pre-gate і правила Done-when у команді opsx-propose.md
  Files: templates/.agents/commands/opsx-propose.md
  Do: Зробити шість правок текстом з блоків P1–P6 під цим таском (їхній 2-пробільний відступ списку не копіювати): (1) у реченні «**Conductor delegation is mandatory:** …» (зараз біля рядка 25) замінити кінцівку «it may only verify files, run status, and run strict validation.» на P1; (2) після абзацу, що закінчується «(mode via `pipeline.task_contract: warn|strict|off`).» (зараз біля рядка 36), вставити порожній рядок і абзац P2; (3) замінити рядки від «6. **Verify the report and show final status**» до закривального ``` його bash-блоку включно (зараз рядки 106–111) на P3; порожній рядок між цим bash-блоком і «**Output**» лишити, щоб «**Output**» не став продовженням пункту 6 списку; (4) у розділі **Output** замінити рядок «- What's ready: "All artifacts created and validated! Ready for spec review."» на P4; (5) у «## Session Exit (HARD STOP)» замінити речення «First line of the pasted prompt is `/opsx:review <name>`.» на P5; (6) у розділі **Output** замінити рядок «- Prompt: "Run `/opsx:review <name>` in a fresh session."» на P6. Абзац re-propose з «Required Before Apply» і рядок «**Source:** gate-check» не змінювати.
  Done-when: `grep -c -F 'Tier 1 pre-gate' templates/.agents/commands/opsx-propose.md` друкує 4 (baseline зараз 0; Do додає 4 такі рядки: P1, заголовок і абзац P3, P4; P5 і P6 цієї фрази не містять); `for p in 'npx agent-orchestrator-kit gate-check --review <name>' 'full list of gate-check errors' 'exit 0 is forbidden' 'informational only' 'new state is present' 'consistent with the code' 'volatile repo values' 'pre-gate passed'; do grep -q -F "$p" templates/.agents/commands/opsx-propose.md || echo "missing: $p"; done` нічого не друкує; `grep -F 'First line of the pasted prompt' templates/.agents/commands/opsx-propose.md | grep -c -F 'if the pre-gate still fails after the one re-spawn'` друкує 1 (baseline зараз 0; Do додає P5); `grep -F 'Prompt: "Run' templates/.agents/commands/opsx-propose.md | grep -c -F 'If the pre-gate still fails after the one re-spawn, report'` друкує 1 (baseline зараз 0; Do додає P6); `awk '/^\*\*Output\*\*$/{print (p=="" ? "BLANK-OK" : "NO-BLANK")} {p=$0}' templates/.agents/commands/opsx-propose.md` друкує рівно один рядок `BLANK-OK`; `grep -c -F 'it may only verify files, run status, and run strict validation.' templates/.agents/commands/opsx-propose.md` друкує 0; `grep -q -F 'Required Before Apply' templates/.agents/commands/opsx-propose.md && grep -q -F '**Source:** gate-check' templates/.agents/commands/opsx-propose.md` дає exit 0

  P1:
  ~~~~text
  it may only verify files, run status, run strict validation, run the Tier 1 pre-gate `npx agent-orchestrator-kit gate-check --review <name>`, and re-spawn `spec-architect` once with the gate-check errors.
  ~~~~

  P2:
  ~~~~markdown
  **Done-when quality:** Done-when checks that the new state is present, not only that the old state is gone. A quantitative `Done-when:` check (`grep -c`, "exactly N lines") must be consistent with the code or text that `Do:` of the same task prescribes. Do not hardcode volatile repo values (current version number, dates, "top entry"); describe them as the current value plus a rule evaluated at apply time.
  ~~~~

  P3:
  ~~~~markdown
  6. **Verify the report, run the Tier 1 pre-gate, and show final status**

     The conductor verifies `Status: done`, the `**Gate:**` line (informational only: whatever it says, including `not run` or nothing, the conductor's own run below decides), and each reported artifact path, then runs:
     ```bash
     npx openspec status --change "<name>"
     npx agent-orchestrator-kit gate-check --review <name>
     ```
     Tier 1 pre-gate (first propose, re-propose, and structure-only re-propose alike): the conductor MUST run `gate-check --review` itself; the architect's `**Gate:**` line does not replace it, and Tier 1 already includes `openspec validate --strict`. If it exits ≠ 0, re-spawn `spec-architect` once with the full list of gate-check errors (targeted fix), then run it again. If it still exits ≠ 0, close the session with `## Blocked` listing the remaining gate-check errors and next command `/opsx:propose <name>`. Handoff to `/opsx:review` without `gate-check --review` exit 0 is forbidden.
  ~~~~

  P4:
  ~~~~text
  - What's ready: "All artifacts created, validated, and Tier 1 pre-gate passed! Ready for spec review."
  ~~~~

  P5:
  ~~~~text
  First line of the pasted prompt is `/opsx:review <name>` only after `gate-check --review` exit 0; if the pre-gate still fails after the one re-spawn, it is `/opsx:propose <name>` and `handoff.md` has `## Blocked`.
  ~~~~

  P6:
  ~~~~text
  - Prompt: "Run `/opsx:review <name>` in a fresh session." only after `gate-check --review` exit 0. If the pre-gate still fails after the one re-spawn, report `## Blocked` with the remaining gate-check errors and next command `/opsx:propose <name>` instead of this prompt and the What's ready line.
  ~~~~

- [x] 1.2 Ті самі pre-gate і правила Done-when у skill openspec-propose
  Files: templates/.agents/skills/openspec-propose/SKILL.md
  Do: Файл має той самий текст, що й `opsx-propose.md`, у реченні «**Conductor delegation is mandatory:** …», блоці Task contract, кроці 6 і розділі **Output** (зараз біля рядків 25, 27–36 і 106–119), але не має секції Session Exit. Застосувати блоки P1–P4 і P6 з таску 1.1 до тих самих якорів: (1) кінцівку «it may only verify paths, run status, and run strict validation.» (зараз біля рядка 25) замінити на P1, де слово «files» замінено на «paths» (тобто «it may only verify paths, run status, run strict validation, run the Tier 1 pre-gate …»); (2) після абзацу, що закінчується «(mode via `pipeline.task_contract: warn|strict|off`).», вставити порожній рядок і P2; (3) рядки від «6. **Verify the report and show final status**» до закривального ``` його bash-блоку включно (зараз рядки 106–111) замінити на P3, а порожній рядок між цим bash-блоком і «**Output**» лишити; (4) рядок «- What's ready: "All artifacts created and validated! Ready for spec review."» замінити на P4; (5) рядок «- Prompt: "Run `/opsx:review <name>` in a fresh session."» замінити на P6. P5 не застосовувати. Frontmatter і решту файла не змінювати.
  Done-when: `grep -c -F 'Tier 1 pre-gate' templates/.agents/skills/openspec-propose/SKILL.md` друкує 4 (baseline зараз 0; Do додає 4 такі рядки: P1, заголовок і абзац P3, P4; P6 цієї фрази не містить); `for p in 'npx agent-orchestrator-kit gate-check --review <name>' 'full list of gate-check errors' 'exit 0 is forbidden' 'informational only' 'new state is present' 'consistent with the code' 'volatile repo values' 'pre-gate passed' 'it may only verify paths'; do grep -q -F "$p" templates/.agents/skills/openspec-propose/SKILL.md || echo "missing: $p"; done` нічого не друкує; `grep -F 'Prompt: "Run' templates/.agents/skills/openspec-propose/SKILL.md | grep -c -F 'If the pre-gate still fails after the one re-spawn, report'` друкує 1 (baseline зараз 0; Do додає P6); `awk '/^\*\*Output\*\*$/{print (p=="" ? "BLANK-OK" : "NO-BLANK")} {p=$0}' templates/.agents/skills/openspec-propose/SKILL.md` друкує рівно один рядок `BLANK-OK`; `grep -c -F 'it may only verify paths, run status, and run strict validation.' templates/.agents/skills/openspec-propose/SKILL.md` друкує 0; `diff <(awk '/^6\. \*\*Verify the report/{f=1} /^(## Session Exit|\*\*Artifact Creation Guidelines)/{f=0} f' templates/.agents/commands/opsx-propose.md) <(awk '/^6\. \*\*Verify the report/{f=1} /^(## Session Exit|\*\*Artifact Creation Guidelines)/{f=0} f' templates/.agents/skills/openspec-propose/SKILL.md)` (крок 6 разом із розділом **Output**) і `diff <(sed -n '/^\*\*Task contract/,/^\*\*Done-when quality/p' templates/.agents/commands/opsx-propose.md) <(sed -n '/^\*\*Task contract/,/^\*\*Done-when quality/p' templates/.agents/skills/openspec-propose/SKILL.md)` обидва нічого не друкують; файл досі містить «Required Before Apply» і «**Source:** gate-check»

- [x] 1.3 spec-architect: обов’язкові заголовки, правила Done-when, самозапуск gate-check і рядок Gate
  Files: templates/.agents/subagents/spec-architect.md
  Do: Чотири правки текстом з блоків A1–A4 під цим таском (2-пробільний відступ списку не копіювати), без перенумерації кроків: (1) у кінець рядка кроку «2. Create or update `proposal.md`, …» (зараз рядок 11, закінчується «conventions.») дописати пробіл і A1; (2) у кінець рядка кроку «4. Make tasks ordered, …» (зараз рядок 13, закінчується «without reading design.md.») дописати пробіл і A2; (3) весь рядок «6. Report which validation command the conductor should run; do not cross into review or implementation.» замінити на A3; (4) у блоці report contract після рядка «**Risks:** assumptions and migration concerns or none» і перед закриттям блоку вставити рядок A4. Крок 5 (з рядком «**Source:** gate-check») і розділ Rules не змінювати.
  Done-when: `grep -c -F '**Gate:** gate-check --review exit <code>' templates/.agents/subagents/spec-architect.md` друкує 2 (baseline зараз 0; Do додає рядки A3 і A4); `for p in '## Non-goals' '## Acceptance criteria' 'exact level-2 English headings' 'npx agent-orchestrator-kit gate-check --review <name>' 'When spawned by' '**Gate:** not run (/opsx:quick)' 'Default: a spawn prompt that does not mention' 'new state is present' 'consistent with the code' 'volatile repo values'; do grep -q -F "$p" templates/.agents/subagents/spec-architect.md || echo "missing: $p"; done` нічого не друкує; `grep -c -F 'Report which validation command the conductor should run' templates/.agents/subagents/spec-architect.md` друкує 0; файл досі містить «Required Before Apply», «**Source:** gate-check» і «Do NOT approve or review your own artifacts.»

  A1:
  ~~~~text
  `proposal.md` MUST contain the exact level-2 English headings `## Non-goals` and `## Acceptance criteria`, starting at column 0 (no translation, no bold-only label): `gate-check --review` (Tier 1) rejects the proposal without them, even when the schema template or `openspec/config.yaml` does not mention them.
  ~~~~

  A2:
  ~~~~text
  Done-when quality: Done-when checks that the new state is present, not only that the old state is gone. A quantitative `Done-when:` check (`grep -c`, "exactly N lines") must be consistent with the code or text that `Do:` of the same task prescribes. Do not hardcode volatile repo values (current version number, dates, "top entry"); describe them as the current value plus a rule evaluated at apply time.
  ~~~~

  A3:
  ~~~~text
  6. When spawned by `/opsx:propose` (first propose, re-propose, or structure-only re-propose): before the report, run `npx agent-orchestrator-kit gate-check --review <name>` yourself (read-only), fix every error it reports inside `openspec/changes/<name>/`, re-run it, and put the final exit code in the report line `**Gate:** gate-check --review exit <code>`; the conductor still runs the gate itself. When spawned by `/opsx:quick` (no review phase), keep its lightweight scope, do not run this self-check, and write `**Gate:** not run (/opsx:quick)`. Default: a spawn prompt that does not mention `/opsx:quick` or the quick-mode scope is a `/opsx:propose` spawn. Do not cross into review or implementation.
  ~~~~

  A4:
  ~~~~text
  **Gate:** gate-check --review exit <code>
  ~~~~

- [x] 1.4 Умови виходу propose → review і чекліст в agent-orchestration skill
  Files: templates/.agents/skills/agent-orchestration/SKILL.md
  Do: У розділі «### propose → review» (зараз біля рядка 97): (1) у bash-блоці після рядка, що починається «npx openspec status --change "<name>"» і закінчується «# applyRequires artifacts all done», додати рядок «npx agent-orchestrator-kit gate-check --review <name> # Tier 1 pre-gate: exit 0 required»; (2) після рядка «(Use `npx` / `npm run` — bare …» (зараз рядок 103, одразу під закриттям цього bash-блоку) вставити порожній рядок і рядок S2 з блоку під цим таском; наявний порожній рядок перед «### review → apply» лишається після S2, тож S2 є окремим абзацом і не зливається з рядком «(Use `npx` …». У розділі «## Orchestration Checklist (per change)» після пункту «`npx openspec validate <name> --strict --type change` passed before review» додати новий пункт у тому ж форматі чекбокса, що й сусідні пункти, з текстом «`npx agent-orchestrator-kit gate-check --review <name>` exit 0 at the end of propose (Tier 1 pre-gate) before review». Рядок метрики «- Spec review discovery loops: ≤ 2 (…)», рядок анти-патерна «one-finding review loop» і речення «If Request Changes — run `/opsx:propose <name>` to fix the punch list, then a new `/opsx:review`.» не змінювати.
  Done-when: `awk '/^### propose → review/{f=1} /^### review → apply/{f=0} f' templates/.agents/skills/agent-orchestration/SKILL.md | grep -c -F 'gate-check --review'` друкує 2 (baseline зараз 0; Do додає рядок bash-блоку і рядок S2); `awk '/^### propose → review/{f=1} /^### review → apply/{f=0} f' templates/.agents/skills/agent-orchestration/SKILL.md | grep -F '## Blocked' | grep -c -F '/opsx:propose <name>'` друкує 1 (baseline зараз 0; Do додає рядок S2); `awk '/^If .gate-check --review. exits/{print (p=="" ? "BEFORE-OK" : "BEFORE-BAD"); s=1; next} s{print ($0=="" ? "AFTER-OK" : "AFTER-BAD"); s=0} {p=$0}' templates/.agents/skills/agent-orchestration/SKILL.md` друкує рівно два рядки `BEFORE-OK` і `AFTER-OK` (S2 оточений порожніми рядками); `grep -q -F 'exit 0 at the end of propose (Tier 1 pre-gate) before review' templates/.agents/skills/agent-orchestration/SKILL.md` дає exit 0; `grep -c -F 'Spec review discovery loops: ≤ 2 (optional Tier 1 structural RC plus one semantic Tier 2 RC; a confirmation APPROVE after an exhaustive propose does not count as a discovery loop)' templates/.agents/skills/agent-orchestration/SKILL.md` друкує 1; файл досі містить «run `/opsx:propose <name>` to fix the punch list» і «one-finding review loop»

  S2:
  ~~~~text
  If `gate-check --review` exits ≠ 0: re-spawn `spec-architect` once with the full list of gate-check errors, then re-run it; still ≠ 0 → close the session with `## Blocked` and next command `/opsx:propose <name>`. No handoff to `/opsx:review` without exit 0. This applies to the first propose, re-propose, and structure-only re-propose; `/opsx:review` still runs Tier 1 itself.
  ~~~~

- [x] 1.5 Quality gates у templates/AGENTS.md
  Files: templates/AGENTS.md
  Do: У рядку, що починається «Quality gates:» (зараз рядок 28), замінити фрагмент «`gate-check --review <name>` is deterministic Tier 1 of review — spec-reviewer (Tier 2) is spawned only after it passes and writes `apply-notes.md` on APPROVE.» на «`gate-check --review <name>` is deterministic Tier 1 — propose runs it as a pre-gate and hands off to review only on exit 0 (one `spec-architect` re-spawn, then `## Blocked`); review runs it again, and spec-reviewer (Tier 2) is spawned only after it passes and writes `apply-notes.md` on APPROVE.». Решту рядка (метрика discovery loops і анти-патерн) не змінювати.
  Done-when: `grep -q -F 'propose runs it as a pre-gate' templates/AGENTS.md && grep -q -F 'review runs it again' templates/AGENTS.md` дає exit 0; `grep -c -F 'is deterministic Tier 1 of review' templates/AGENTS.md` друкує 0; файл досі містить «Spec review discovery loops ≤ 2»; `node -e "process.exit(require('fs').readFileSync('templates/AGENTS.md','utf8').length < 4000 ? 0 : 1)"` дає exit 0

- [x] 1.6 Одне речення про pre-gate у templates/CLAUDE.md
  Files: templates/CLAUDE.md
  Do: У рядку, що починається «Lean delegation:» (зараз рядок 11), замінити фрагмент «Review is two-tiered: `gate-check --review` (deterministic) before `spec-reviewer`;» на «Review is two-tiered: `gate-check --review` (deterministic) before `spec-reviewer`; propose runs the same `gate-check --review` as a pre-gate and hands off to review only on exit 0;». Решту рядка (зокрема «`gate-check --tasks` lints the Files/Do/Done-when task contract.») і плейсхолдери `{{PROJECT_NAME}}` / `{{KIT_VERSION}}` не змінювати.
  Done-when: `grep -q -F 'as a pre-gate and hands off to review only on exit 0' templates/CLAUDE.md` дає exit 0; `grep -q -F 'Review is two-tiered' templates/CLAUDE.md && grep -q -F '{{PROJECT_NAME}}' templates/CLAUDE.md` дає exit 0

- [x] 1.7 Рядок CLI ↔ Cursor для propose в openspec-howto
  Files: templates/.agents/skills/openspec-howto/SKILL.md
  Do: У розділі «### CLI ↔ Cursor» (зараз біля рядка 104) замінити рядок «- `/opsx:propose` → потім `status`, `validate`» на «- `/opsx:propose` → потім `status`, `validate`, `npx agent-orchestrator-kit gate-check --review <name>` (Tier 1 pre-gate: exit 0 перед `/opsx:review`)». Інші рядки розділу не змінювати.
  Done-when: `grep -q -F 'Tier 1 pre-gate: exit 0' templates/.agents/skills/openspec-howto/SKILL.md` дає exit 0; `grep -c -F 'gate-check --review' templates/.agents/skills/openspec-howto/SKILL.md` друкує щонайменше 1

- [x] 1.8 openspec-guide: провалений pre-gate без review.md веде на propose
  Files: templates/.agents/subagents/openspec-guide.md
  Do: У кроці «4. Map what you find to the correct next command:» замінити весь рядок «   - `proposal.md` exists but no `review.md` → `/opsx:review <name>` (must run in a separate read-only session)» (зараз рядок 18) на рядок G1 з блоку під цим таском (2-пробільний відступ списку не копіювати; сам рядок G1 починається з 3 пробілів і «- », як сусідні пункти). Решту пунктів кроку 4 (зокрема «`review.md` contains `Verdict: REQUEST CHANGES` → `/opsx:propose <name>`»), рядок «**Never edit files.**», крок 5 і report contract не змінювати.
  Done-when: `grep -F 'exists but no' templates/.agents/subagents/openspec-guide.md | grep -c -F 'gate-check --review <name>'` друкує 1 (baseline зараз 0; Do додає рядок G1); `for p in 'read-only Tier 1 pre-gate' 'the propose pre-gate failed' 'exit ≠ 0 →'; do grep -q -F "$p" templates/.agents/subagents/openspec-guide.md || echo "missing: $p"; done` нічого не друкує; `grep -c -E 'no .review\.md. → ./opsx:review' templates/.agents/subagents/openspec-guide.md` друкує 0 (старої прямої гілки на review немає); файл досі містить «Verdict: REQUEST CHANGES» у тому самому рядку, що й «/opsx:propose <name>», і рядок «**Never edit files.**»

  G1:
  ~~~~text
     - `proposal.md` exists but no `review.md` → run `npx agent-orchestrator-kit gate-check --review <name>` (read-only Tier 1 pre-gate): exit 0 → `/opsx:review <name>` (must run in a separate read-only session); exit ≠ 0 → `/opsx:propose <name>` and quote the gate-check errors (the propose pre-gate failed)
  ~~~~

## 2. OpenSpec config fallback і документація

- [x] 2.1 Стек-нейтральний templates/openspec-config.yaml.example
  Files: new file: templates/openspec-config.yaml.example
  Do: Створити файл дослівно з блоку Y під цим таском (2-пробільний відступ списку не копіювати). Файл англійський і стек-нейтральний, має плейсхолдери `{{PROJECT_NAME}}` / `{{LANG}}`, і кожен пункт під `rules:` стоїть у подвійних лапках: неекранований пункт з «: » YAML парсить як map, і OpenSpec 1.4.1 відкидає весь список артефакта з попередженням «must be an array of strings», а неекранований « #» YAML мовчки обрізає як коментар (правило коротшає без попередження). `profiles/vue3/openspec-config.yaml.example`, `profiles/mvp/openspec-config.yaml.example` і `bin/agent-orchestrator.js` не змінювати.
  Done-when: `test -f templates/openspec-config.yaml.example` дає exit 0; `for p in '## Non-goals' '## Acceptance criteria' '{{PROJECT_NAME}}' '{{LANG}}' 'Files:' 'Done-when:' 'new state is present' 'consistent with the code' 'volatile repo values'; do grep -q -F "$p" templates/openspec-config.yaml.example || echo "missing: $p"; done` нічого не друкує; `grep -c -i -E 'vue|pinia' templates/openspec-config.yaml.example` друкує 0; `awk '/^rules:/{f=1} f && /^ +- /' templates/openspec-config.yaml.example | grep -c -v '^ *- "'` друкує 0; одна самодостатня команда, запущена в одному shell з кореня репозиторію (вона сама створює і видаляє тимчасову директорію), `K=$PWD; d=$(mktemp -d); mkdir -p $d/openspec; cp templates/openspec-config.yaml.example $d/openspec/config.yaml && (cd $d && $K/node_modules/.bin/openspec new change probe >/dev/null 2>&1 && for a in proposal design specs tasks; do $K/node_modules/.bin/openspec instructions $a --change probe --json 2>&1 >/dev/null; done && $K/node_modules/.bin/openspec instructions proposal --change probe --json 2>/dev/null | grep -q -F '## Acceptance criteria' && echo RULES-OK); rm -rf $d` друкує рівно один рядок `RULES-OK` (будь-який інший рядок, зокрема «must be an array of strings» зі stderr, означає провал; якщо `cp` чи `openspec new change probe` падає, `&&` зупиняє ланцюжок і `RULES-OK` не друкується)

  Y:
  ~~~~yaml
  schema: spec-driven

  context: |
    Project: {{PROJECT_NAME}}.
    Stack: describe the runtime, frameworks, package manager, and the build / lint / test commands here.
    Agent language: {{LANG}} (prose in artifacts; code identifiers, paths, and CLI commands stay in English).
    Kit gates: npx agent-orchestrator-kit gate-check --review <name> (Tier 1) and npx agent-orchestrator-kit gate-check --tasks <name> (task contract).

  rules:
    proposal:
      - "Write prose in the agent language ({{LANG}}); keep the two mandatory section headings in English exactly as shown below."
      - "Always include a Non-goals section with the exact level-2 heading '## Non-goals' at column 0."
      - "Always include an Acceptance criteria section with the exact level-2 heading '## Acceptance criteria' at column 0: 3–7 numbered, verifiable items."
      - "gate-check --review (Tier 1) rejects the proposal when either heading is missing, translated, or bold-only."
    design:
      - "Reference existing modules and patterns in the repository; describe changes at module, API, and data level."
    tasks:
      - "Split work into tasks of up to ~2 hours."
      - "Task contract: every task carries indented fields Files: (real repo paths; new ones prefixed with new file:), Do: (concrete change in 1–3 lines), Done-when: (verifiable condition or command)."
      - "Each task is self-contained for a blind implementer without design.md; no vague wording ('as needed', 'if necessary', 'as appropriate')."
      - "Done-when checks that the new state is present, not only that the old state is gone."
      - "A quantitative Done-when check (grep -c, 'exactly N lines') must be consistent with the code or text that Do: of the same task prescribes."
      - "Do not hardcode volatile repo values (current version number, dates, 'top entry'); describe them as the current value plus a rule evaluated at apply time."
      - "Last task: build, lint, and tests pass."
    specs:
      - "Delta format: ADDED / MODIFIED / REMOVED Requirements; every requirement uses SHALL or MUST and has at least one '#### Scenario:'."
  ~~~~

- [x] 2.2 README: ручне правило для наявного openspec/config.yaml і Exit gate Architect
  Files: README.md
  Do: (1) У розділі «## Update» після рядка «- Any project-conventions skills» і перед заголовком «### Upgrading an existing project to v0.1.7 (status / gate-check / GitHub Spec Verifier)» вставити порожній рядок і блок R1 з-під цього таску (2-пробільний відступ списку не копіювати); наявний порожній рядок перед заголовком «### Upgrading …» лишається роздільником після R1. (2) У розділі «### Role 2: Architect — `/opsx:propose <name>`» у bash-блоці після «**Exit gate:**», після рядка «npx openspec validate <name> --strict --type change  # must be ✓», додати рядок «npx agent-orchestrator-kit gate-check --review <name>  # Tier 1 pre-gate: exit 0 before /opsx:review». Верхній банер Quickstart і розділ «## Changelog» не змінювати.
  Done-when: `s=$(awk '/^## Update$/{f=1} /^### Upgrading an existing project to v0.1.7/{f=0} f' README.md); for p in 'Acceptance criteria' 'templates/openspec-config.yaml.example' 'Double-quote every rule' 'init --force'; do grep -q -F "$p" <<<"$s" || echo "missing: $p"; done` нічого не друкує; `awk '/^### Role 2: Architect/{f=1} /^### Role 3: Spec Reviewer/{f=0} f' README.md | grep -c -F 'gate-check --review'` друкує 1 (baseline зараз 0; Do додає один рядок у bash-блок **Exit gate:**); `git diff --quiet -- package.json` дає exit 0

  R1:
  ~~~~markdown
  **Existing `openspec/config.yaml`:** `update` never touches it, and `init` skips `openspec/config.yaml.example` when `openspec/config.yaml` already exists (for example after `npx openspec init`). Add the proposal rule by hand, under `rules.proposal`, so `openspec instructions proposal` tells the architect about the Tier 1 headings:

  ```yaml
  rules:
    proposal:
      - "Always include the exact level-2 headings '## Non-goals' and '## Acceptance criteria' (gate-check --review Tier 1 rejects the proposal without them)."
  ```

  Double-quote every rule: an unquoted item that contains `: ` makes OpenSpec drop the whole list for that artifact, and an unquoted ` #` silently cuts the rule short (YAML reads the rest as a comment). A fresh `init --profile node` or `init --profile generic` installs `openspec/config.yaml.example` with these rules from `templates/openspec-config.yaml.example`; `init --force` overwrites an existing `openspec/config.yaml`.
  ~~~~

- [x] 2.3 CHANGELOG [Unreleased]
  Files: CHANGELOG.md
  Do: Внести блок C з-під цього таску (2-пробільний відступ списку не копіювати) у секцію «## [Unreleased]» — від цього заголовка до наступного заголовка, що починається «## [». Правило на момент apply: якщо в секції ще немає заголовка «### Added», вставити його з пунктом C під ним; якщо вже є — дописати пункт C з-під «### Added» у кінець наявного підрозділу «### Added», без другого такого заголовка. Так само для «### Changed» і трьох пунктів C з-під нього. Між підрозділами і перед наступним «## [» лишити по одному порожньому рядку. Наявні записи секції не змінювати і не переставляти, не додавати заголовок релізу з номером версії чи датою і не змінювати `package.json`.
  Done-when: `s=$(awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md); for p in '**Stack-neutral ' 'runs the Tier 1 pre-gate.**' 'knows the mandatory proposal headings and Done-when quality rules.**' 'routes a failed propose pre-gate back to propose.**' 'templates/openspec-config.yaml.example' 'init --force --profile node|generic' '## Blocked' '**Gate:** gate-check --review exit <code>' '**Gate:** not run (/opsx:quick)'; do grep -q -F "$p" <<<"$s" || echo "missing: $p"; done` нічого не друкує (нові пункти є саме в [Unreleased], незалежно від того, що там було до apply); `awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md | grep -c '^### Added$'` друкує 1 і те саме з `'^### Changed$'` друкує 1 (жодного дубля підзаголовка); `git diff -U0 -- CHANGELOG.md | grep -c '^+## \['` друкує 0; `git diff --quiet -- package.json` дає exit 0

  C:
  ~~~~markdown
  ### Added
  - **Stack-neutral `openspec/config.yaml.example` for the `node` and `generic` profiles.** New `templates/openspec-config.yaml.example` (English, `{{PROJECT_NAME}}` / `{{LANG}}`) is the fallback `init` installs when a profile has no own file: `rules.proposal` requires the exact `## Non-goals` and `## Acceptance criteria` headings, `rules.tasks` carries the Files/Do/Done-when contract and the Done-when quality rules, and every rule is double-quoted so OpenSpec does not drop the list. `update` and `init` without `--force` never touch an existing `openspec/config.yaml`: add the rule by hand (README → Update). Note: `init --force --profile node|generic` now overwrites an existing `openspec/config.yaml` with this template, as `init --force` already did for `vue3` / `mvp`.

  ### Changed
  - **`/opsx:propose` runs the Tier 1 pre-gate.** After the `spec-architect` report the conductor runs `npx agent-orchestrator-kit gate-check --review <name>`; on exit ≠ 0 it re-spawns `spec-architect` once with the full error list, and if the gate still fails it closes with `## Blocked` and next command `/opsx:propose <name>`. Handoff to `/opsx:review` requires exit 0 for the first propose, re-propose, and structure-only re-propose; the `/opsx:review` prompt in Output and Session Exit is conditional on it. Review still runs Tier 1 itself; `gate-check` is unchanged.
  - **`spec-architect` knows the mandatory proposal headings and Done-when quality rules.** It requires `## Non-goals` and `## Acceptance criteria`; when spawned by `/opsx:propose` it runs `gate-check --review` before its report and adds `**Gate:** gate-check --review exit <code>` (under `/opsx:quick` it writes `**Gate:** not run (/opsx:quick)`; a spawn prompt that does not mention quick counts as `/opsx:propose`). Done-when must check the new state, keep counts consistent with `Do:`, and avoid volatile repo values. The same rules are in the propose Task contract block.
  - **`openspec-guide` routes a failed propose pre-gate back to propose.** For a change with `proposal.md` and no `review.md` it runs `gate-check --review <name>`: exit 0 → `/opsx:review <name>`, exit ≠ 0 → `/opsx:propose <name>`.
  ~~~~

## 3. Тести

- [x] 3.1 Smoke-тести pre-gate, config template і init node/generic
  Files: test/smoke.test.js
  Do: Додати чотири тести дослівно з блоків T1 і T2 під цим таском (2-пробільний відступ списку не копіювати), без нових import-ів: `readFileSync`, `existsSync`, `mkdtempSync`, `mkdirSync`, `writeFileSync`, `rmSync`, `join`, `tmpdir` уже імпортовані в рядках 1–11, `KIT_ROOT` визначено там само, а хелпер `runInit` — зараз біля рядка 87. Блок T1 вставити одразу після закриття тесту `test('review punch-list templates route RC to propose', …)`; блок T2 — одразу після закриття тесту `test('vue3 profile installs openspec config example', …)`. Наявні тести й асерти не змінювати.
  Done-when: `grep -c -F -e "test('propose runs Tier 1 pre-gate before review handoff'" -e "test('templates/openspec-config.yaml.example is a stack-neutral fallback'" -e "test('node and generic profiles install openspec config example with Acceptance criteria'" -e "test('init keeps an existing openspec/config.yaml for the node profile'" test/smoke.test.js` друкує 4; `node --test --test-reporter=tap --test-name-pattern="pre-gate|stack-neutral|with Acceptance criteria|keeps an existing openspec" test/smoke.test.js | grep -E '^# (pass|fail) '` друкує `# pass 4` і `# fail 0`

  T1:
  ~~~~js
  test('propose runs Tier 1 pre-gate before review handoff', () => {
    const propose = readFileSync(join(KIT_ROOT, 'templates/.agents/commands/opsx-propose.md'), 'utf-8');
    const proposeSkill = readFileSync(join(KIT_ROOT, 'templates/.agents/skills/openspec-propose/SKILL.md'), 'utf-8');
    const architect = readFileSync(join(KIT_ROOT, 'templates/.agents/subagents/spec-architect.md'), 'utf-8');
    const skill = readFileSync(join(KIT_ROOT, 'templates/.agents/skills/agent-orchestration/SKILL.md'), 'utf-8');
    const agents = readFileSync(join(KIT_ROOT, 'templates/AGENTS.md'), 'utf-8');
    const guide = readFileSync(join(KIT_ROOT, 'templates/.agents/subagents/openspec-guide.md'), 'utf-8');

    for (const text of [propose, proposeSkill]) {
      assert.match(text, /gate-check --review/);
      assert.match(text, /Tier 1 pre-gate/);
      assert.match(text, /exit 0 is forbidden/);
      assert.match(text, /If the pre-gate still fails after the one re-spawn, report `## Blocked`/);
    }
    assert.match(architect, /## Non-goals/);
    assert.match(architect, /## Acceptance criteria/);
    assert.match(architect, /\*\*Gate:\*\* gate-check --review exit <code>/);
    assert.match(architect, /\*\*Gate:\*\* not run \(\/opsx:quick\)/);
    assert.match(architect, /Default: a spawn prompt that does not mention `\/opsx:quick`/);
    for (const text of [propose, proposeSkill, architect]) {
      assert.match(text, /new state is present/);
      assert.match(text, /consistent with the code/);
      assert.match(text, /volatile repo values/);
    }
    const start = skill.indexOf('### propose → review');
    const end = skill.indexOf('### review → apply');
    assert.ok(start >= 0 && end > start, 'propose → review section not found');
    const proposeToReview = skill.slice(start, end);
    assert.match(proposeToReview, /gate-check --review/);
    assert.match(proposeToReview, /## Blocked/);
    assert.match(skill, /Spec review discovery loops: ≤ 2/);
    assert.match(agents, /propose runs it as a pre-gate/);
    assert.match(guide, /no `review\.md` → run `npx agent-orchestrator-kit gate-check --review <name>`/);
    assert.match(guide, /exit ≠ 0 → `\/opsx:propose <name>`/);
    assert.doesNotMatch(guide, /no `review\.md` → `\/opsx:review/);
  });
  ~~~~

  T2:
  ~~~~js
  test('templates/openspec-config.yaml.example is a stack-neutral fallback', () => {
    const templatePath = join(KIT_ROOT, 'templates/openspec-config.yaml.example');
    assert.ok(existsSync(templatePath), 'templates/openspec-config.yaml.example missing');
    const example = readFileSync(templatePath, 'utf-8');
    assert.match(example, /^rules:/m);
    assert.match(example, /^ {2}proposal:/m);
    assert.match(example, /^ {2}tasks:/m);
    assert.match(example, /## Non-goals/);
    assert.match(example, /## Acceptance criteria/);
    assert.match(example, /Files:.*Do:.*Done-when:/);
    assert.match(example, /new state is present/);
    assert.match(example, /\{\{PROJECT_NAME\}\}/);
    assert.match(example, /\{\{LANG\}\}/);
    assert.doesNotMatch(example, /vue|pinia/i);
    const ruleItems = example
      .slice(example.indexOf('\nrules:'))
      .split('\n')
      .filter((line) => /^\s+- /.test(line));
    assert.ok(ruleItems.length > 0, 'no rule items under rules:');
    for (const line of ruleItems) {
      assert.match(line, /^\s+- "/, `rule must be a double-quoted YAML string: ${line}`);
    }
  });

  test('node and generic profiles install openspec config example with Acceptance criteria', () => {
    for (const profile of ['node', 'generic']) {
      const dir = mkdtempSync(join(tmpdir(), `aok-${profile}-cfg-`));
      try {
        runInit(dir, `--profile ${profile} --name NodeApp --lang uk`);
        const examplePath = join(dir, 'openspec/config.yaml.example');
        assert.ok(existsSync(examplePath), `${profile}: openspec/config.yaml.example missing`);
        const example = readFileSync(examplePath, 'utf-8');
        assert.match(example, /Acceptance criteria/);
        assert.match(example, /Non-goals/);
        assert.match(example, /NodeApp/);
        assert.doesNotMatch(example, /\{\{/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('init keeps an existing openspec/config.yaml for the node profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aok-node-keep-'));
    const original = 'schema: spec-driven\n# consumer config\n';
    try {
      mkdirSync(join(dir, 'openspec'), { recursive: true });
      writeFileSync(join(dir, 'openspec/config.yaml'), original);
      runInit(dir, '--profile node --name NodeApp --lang uk');
      assert.equal(readFileSync(join(dir, 'openspec/config.yaml'), 'utf-8'), original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  ~~~~

- [x] 3.2 Повний npm test зелений
  Files: test/smoke.test.js
  Do: З кореня репозиторію запустити `npm test`. Якщо тест падає, виправити причину у файлах тасків 1.1–3.1, не послаблюючи асертів і не змінюючи `bin/`, `package.json`, `templates/.agents/commands/opsx-review.md`, `templates/.agents/subagents/spec-reviewer.md`, `templates/.agents/commands/opsx-quick.md` чи `profiles/`, і повторити запуск.
  Done-when: `npm test` дає exit 0; `git diff --quiet -- package.json bin/ profiles/ templates/.agents/commands/opsx-review.md templates/.agents/subagents/spec-reviewer.md templates/.agents/commands/opsx-quick.md` дає exit 0
