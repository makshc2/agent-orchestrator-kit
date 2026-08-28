## Context

Kit v0.3.x має parent-driven handoff: на виході сесії батько пише `openspec/changes/<name>/handoff.md`, CLI `handoff <name>` валідує секції, веде append-only `decisions.md`, upsert-ить Memory JSON і друкує next-thread prompt; `archive <name>` пише фінальний handoff сам. Секції файлу зафіксовані константою `HANDOFF_SECTIONS`, парсер — `parseHandoffMarkdown`, збирач — `buildHandoffMarkdown`, обов'язкові поля — `missingHandoffFields` (Closed role, Done, Next command). Git-хелпери в CLI вже є (`execSync`, `readGitOriginUrl`, diff-хелпери gate-check).

Розрив (роадмап, стовп Workspace): cloud-run пише артефакти на VM; без commit/push вони не існують для ноутбука. `handoff.md` не каже, де виконувалась сесія, а persist завершується exit 0 при повністю незакоміченому change-і. Роадмап D7 фіксує напрям: поле `runtime: local|cloud` (+ `agent_id`) у handoff, перевірка в CLI, правило для cloud-сесії. Роадмап D10.4: Phase 3 не робить Claude/Amp «cloud agents» — артефакти стають видимими в усіх трьох IDE через git.

Open question роадмапу, який закриває цей design: чи має `handoff --cloud-check` падати з non-zero, чи лишатись warning-ом.

## Goals / Non-Goals

**Goals:**

- Кожен persist фіксує runtime сесії (`local|cloud`) і `agent_id` у `handoff.md` детермінованим правилом без інтерактивних питань.
- Детермінована перевірка `--cloud-check`: артефакти change-у закомічені й запушені; для cloud-сесії це блокуючий гейт закриття, для local — діагностика.
- Протокол Session Exit знає про cloud: commit → push → cloud-check як обов'язкові кроки перед закриттям cloud-сесії; правило «артефакти сесії лише в git-tracked шляхах» записане в rule/skill/субагент.
- Паритет Cursor / Claude Code / Amp Code: усе — CLI і текст правил, жодного IDE-специфічного API.

**Non-Goals:**

- API-доступ до cloud-VM, відновлення старих гілок, автоматичний commit/push із CLI.
- Блокування local-сесій за dirty-стан (це територія pre-commit gate-check).
- Зміна схеми Memory-ентитей: runtime не потрапляє в obligatory Memory-поля (потрапляє лише як частина handoff.md).
- Phase 4: Control Plane, sandbox, dashboard, audit log.

## Decisions

### D1. Runtime — явний пріоритетний ланцюжок, автодетекція лише best-effort

Значення runtime визначається в persist-гілці CLI за фіксованим пріоритетом:

1. Прапорець `--runtime <local|cloud>` (валідні лише ці два значення; інше — помилка).
2. Env `AOK_RUNTIME` (`local|cloud`) — канонічний спосіб для cloud-середовищ: змінна прописується в environment-конфігу cloud-агента один раз.
3. Best-effort маркери середовища — одна константа `CLOUD_ENV_MARKERS` у CLI (стартово `CURSOR_BACKGROUND_AGENT`, розширюється точковим PR-ом); будь-який маркер присутній і непорожній → `cloud`.
4. Наявне значення з секції `## Runtime` попереднього `handoff.md` (сесія вже визначила runtime раніше).
5. Дефолт `local`.

`agent_id`: `--agent-id` → env `AOK_AGENT_ID` → наявне значення з файлу → `none`.

Альтернатива «розумна автодетекція» (TTY, hostname, `CURSOR_AGENT`) відкинута: `CURSOR_AGENT=1` виставляє і локальний cursor-agent CLI, TTY відсутній у будь-якому CI — false positives перетворили б local-сесії на «cloud» і вмикали б блокуючий гейт там, де він не потрібен. Явний env у cloud-конфігу — детермінований і дешевий.

### D2. `--cloud-check`: non-zero при cloud, warning при local

Окрема гілка `handoff <name> --cloud-check` (не частина persist) виконує дві перевірки:

1. **Чистота артефактів**: `git status --porcelain -- openspec/changes/<name>/` порожній (покриває і модифіковані, і untracked файли).
2. **Запушеність**: поточна гілка має upstream (`git rev-parse --abbrev-ref @{upstream}`) і `git rev-list --count @{upstream}..HEAD` дає 0.

Вердикт залежить від runtime, прочитаного з `handoff.md ## Runtime` (з тим самим ланцюжком override-ів D1): `cloud` → будь-який фейл = exit non-zero з переліком проблемних шляхів/причин; `local` → ті самі повідомлення як warning, exit 0.

Чому не всередині persist: chicken-and-egg — persist сам щойно переписав `handoff.md`, тож робоче дерево в цю мить завжди брудне. Правильний порядок cloud-виходу: persist → commit → push → cloud-check. Persist при `runtime: cloud` друкує ці кроки в stderr (stdout лишається чистим prompt-ом).

Чому диференційований вердикт, а не завжди non-zero: local-сесія легітимно закривається до commit-у (commit робиться після review людиною); завжди-error зробив би `--cloud-check` марним для local-діагностики. Чому не завжди warning: для cloud warning нічого не гарантує — сесія на VM закриється, артефакти зникнуть; роадмап-спека прямо вимагає «handoff вважається неповним».

### D3. Секція Runtime — опційна для читання, обов'язкова для запису

`## Runtime` додається в `HANDOFF_SECTIONS` і `buildHandoffMarkdown`; persist завжди записує її (формат: `- runtime: <local|cloud>`, `- agent_id: <id|none>`). `missingHandoffFields` не розширюється: старі `handoff.md` без секції валідні, persist дописує її мовчки. `archive` пише Runtime у фінальний handoff тим самим ланцюжком D1.

Альтернатива «зробити Runtime обов'язковою секцією» відкинута: зламала б persist для всіх активних changes консюмерів одразу після `update` без жодної користі — значення однаково обчислюється автоматично.

### D4. Дисципліна workspace — текст протоколу, не runtime-enforcement

Правило «агент пише артефакти сесії лише в git-tracked шляхи (не /tmp, не gitignored-кеші)» і cloud-кроки Session Exit живуть у канонічному `session-handoff.mdc` (alwaysApply), дзеркаляться в skill `agent-orchestration` і субагенті `session-handoff`. CLI механічно тримає лише вихідну точку (cloud-check); слідкувати за кожним write агента неможливо і не потрібно — незакомічений артефакт однаково спіймає cloud-check.

### D5. Паритет трьох IDE — безкоштовний за конструкцією

Уся механіка — `bin/agent-orchestrator.js` (CLI, викликається через npx у будь-якому IDE) і markdown-правила, які `init`/`update` вже синхронізують у `.cursor/`, `.claude/` і Amp `subagent-*`. Жодного Cursor-native API. Env `AOK_RUNTIME`/`AOK_AGENT_ID` працюють в environment-конфігах будь-якого cloud-runtime.

## Risks / Trade-offs

- **False negative детекції: cloud-сесія без `AOK_RUNTIME` і маркерів отримає `runtime: local`** → мітигація: правило Session Exit вимагає від cloud-сесії явно передати `--runtime cloud`; README документує env для environment-конфігу; маркер-константа розширюється точково.
- **`--cloud-check` пройде, а потім агент допише файли** → мітигація: правило фіксує cloud-check як останній крок перед закриттям; повторний запуск дешевий і детермінований.
- **Detached HEAD / shallow clone на VM ламає перевірку upstream** → мітигація: помилки git-команд у cloud-check трактуються як фейл перевірки (для cloud) з підказкою `git push -u origin HEAD`, не як crash CLI.
- **Trade-off: два нові прапорці й env-пара — більше поверхні CLI** → прийнято: альтернатива (магічна автодетекція) недетермінована; поверхня документована в одному місці README.
- **Legacy handoff.md без Runtime у активних changes консюмерів** → мітигація D3: секція опційна для читання, дописується наступним persist-ом.

## Migration Plan

Немає міграції даних. Консюмери отримують поведінку після `npx agent-orchestrator-kit update` (нові тексти правил) — persist почне дописувати Runtime у наявні handoff.md без ручних кроків. Rollback: відкат версії пакета; секція Runtime у файлах нешкідлива для старого CLI (парсер ігнорує невідомі секції).

## Open Questions

Немає. Open question роадмапу «non-zero чи warning для `--cloud-check`» закритий D2 (диференційовано за runtime).
