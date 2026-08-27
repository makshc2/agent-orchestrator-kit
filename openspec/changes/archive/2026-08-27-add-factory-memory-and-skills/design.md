## Context

Phase 2 роадмапу `agentic-factory-roadmap` (вимога «Phase 2 робить рішення видимими в PR/MR», рішення D6/D10 архівного design роадмапу). Наявний стан kit-а:

- CLI `handoff <name>` уже парсить `handoff.md ## Decisions` (`parseDecisionItems`: рядки-буллети, фільтр `none`) і upsert-ить `Decision:<topic>` у `.cursor/memory.json` (`persistMemoryFromHandoff`). Тобто напрям файл → Memory існує; але durable-акумулятор — gitignored memory.json, а git-файл handoff.md — transient-буфер, який перезаписується щосесії.
- `handoff --restore` друкує next_command/next_role/closed_role/Done з handoff.md і кількість Memory-ентитей; рішення читаються лише з Memory.
- `archive` переносить папку change через `renameSync` — будь-який файл усередині (handoff.md, decisions.md) переїжджає в архів без додаткового коду.
- `KIT_SKILL_DIRS` — хардкодний масив 8 скілів у `bin/agent-orchestrator.js`; з нього будується `KIT_MANAGED_PATHS` для init/update. Той самий перелік фактично існує як вміст `templates/.agents/skills/`.
- Стекові скіли живуть як free-text `notes` у `roles.implementer` профілів vue3 («Use vue-core, vue-pinia, vue-axios, vue-router skills during apply») і node («javascript-core, javascript-node, javascript-testing»); джерело пакетів — `frontend-agent-skills` (README профілю vue3).
- `sync` копіює `.agents/skills/` → `.cursor/skills/` і `.claude/skills/` з delete-stale; Amp читає `.agents/` нативно, субагенти отримують генеровані wrapper-и `subagent-*` (`generateAmpSubagentSkills`), stale-wrapper-и видаляються.
- `status` показує зміни і MCP health (`printMcpHealth`: статичні локальні перевірки, warn-only, без мережі, exit 0). Про скіли — нічого.
- YAML читається regex-ами (`readPipelineConfig`, `parseMcpInventory` з `DEFAULT_MCP_INVENTORY`-fallback-ом) — kit свідомо без YAML-залежності.

Обмеження: memory.json лишається gitignored; паритет Cursor / Claude Code / Amp; без нових ролей пайплайна; без автоустановки external-пакетів.

## Goals / Non-Goals

**Goals:**

- Зробити рішення change-у видимими в PR/MR і на іншій машині: git-tracked append-only канон, Memory — дзеркало.
- Дати скілам машинний інвентар у конфігурації замість хардкоду в CLI і free-text notes у профілях.
- Зробити стан скілів видимим у `status` — з тим самим warn-only контрактом, що MCP health.

**Non-Goals:**

- ADR-фреймворк, `docs/decisions/`, міграція старих `Decision:*`.
- Автоустановка external skill-пакетів.
- Новий блокуючий гейт (у `gate-check` чи pre-commit) на рішення або скіли.
- Phase 3 (runtime у handoff, cloud-дисципліна) і Phase 4 (платформа).

## Decisions

### D1. Формат і життєвий цикл decisions.md

`openspec/changes/<name>/decisions.md` створюється CLI `handoff <name>` при першому непорожньому рішенні (при `Decisions: none` файл не створюється). Формат:

```markdown
# Decisions — <change-name>

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-08-27 decisions-canon: `openspec/changes/<name>/decisions.md`, append-only, ...
- 2026-08-28 skill-inventory: `skills:` section in `orchestrator.yaml` ...
```

Кожен запис — один рядок `- <YYYY-MM-DD> <текст рішення>`; дата — локальна дата запуску persist. Текст рішення вже має форму `topic: зміст` (конвенція handoff-шаблону, на ній тримається `Decision:<topic>` у Memory). Файл не є артефактом схеми OpenSpec (як handoff.md) — `openspec validate --strict` ігнорує сторонні .md у папці change; `archive` переносить його з папкою безкоштовно (`renameSync`).

Альтернативи відкинуті explorer-ом: секція в `design.md` (інший шар — design-time рішення архітектора, а не рішення сесій), лише handoff.md (rolling, без історії).

### D2. Append-only з дедуплікацією за нормалізованим текстом

Persist-гілка `handoff <name>`: для кожного item-а з `parseDecisionItems(fields.decisions)` порівнюється нормалізований текст (trim, послідовності пробілів згорнуті в один) з нормалізованими текстами наявних записів decisions.md (без префікса `- <дата> `). Немає збігу → append; є збіг → пропуск. Наявні рядки ніколи не переписуються і не видаляються.

Наслідки: повторний `handoff` тієї самої сесії (або наступна сесія, що не оновила `## Decisions`) не плодить дублікати; той самий topic з новим текстом — новий рядок, історія редакцій зберігається. Ручні дописи у файл не зачіпаються (CLI лише додає в кінець).

### D3. Мірор Decision:* будується з decisions.md, не з handoff.md

`persistMemoryFromHandoff` міняє джерело `Decision:*`: після append-у CLI читає decisions.md і для кожного запису в порядку файлу upsert-ить `Decision:<topic>` з observation `chosen: <текст>`. Оскільки upsert перезаписує entity з тим самим ім'ям, останній запис topic-а у файлі (найновіша редакція) перемагає — Memory відображає актуальний стан, файл тримає історію. `Change:*` і `Handoff:*` пишуться як раніше з handoff.md.

Напрям синхронізації лише файл → Memory. Зворотного шляху немає: Memory може бути порожнім/відсутнім (нова машина, gitignore) — це не впливає на канон. Наявні `Decision:*` від старих changes не мігруються і не чистяться (no-migration): вони перезапишуться природно, якщо topic повториться, або лишаться як історичний шум локальної машини.

### D4. Restore друкує рішення з git-файлу

`handoff --restore` отримує блок Decisions: якщо `openspec/changes/<name>/decisions.md` існує — друкуються його записи і шлях; якщо ні — `decisions: none`. Memory JSON для друку рішень не використовується (лишається рядок з кількістю ентитей як діагностика Memory-стану). Промпт наступної сесії (`buildNextSessionPrompt`) не змінюється: його секція «Рішення» — це рішення поточної сесії з handoff.md; накопичена історія доступна через `--restore` і сам git-файл.

### D5. Схема skills: у orchestrator.yaml і regex-парсер

```yaml
skills:
  kit:
    - agent-orchestration
    - openspec-howto
    - openspec-explore
    - openspec-propose
    - openspec-apply-change
    - openspec-archive-change
    - openspec-sync-specs
    - spec-workflow-openspec
  stack: []        # профільні скіли; vue3: vue-core, vue-pinia, vue-axios, vue-router
  external: ""     # npm-пакет-джерело stack-скілів; vue3/node: frontend-agent-skills
```

Дзеркалить провалідований патерн `mcp: baseline/optional`. Парсер — `parseSkillsInventory` у стилі `parseMcpInventory` (regex, без YAML-залежності): списки `kit`/`stack`, скаляр `external`. Fallback для legacy-проєктів без секції: `kit` = перелік директорій `templates/.agents/skills/` установленого kit-пакета (без префікса `subagent-`), `stack` порожній, `external` порожній — симетрично `DEFAULT_MCP_INVENTORY`.

Профілі: vue3 → `stack: [vue-core, vue-pinia, vue-axios, vue-router]`, `external: frontend-agent-skills`; node → `stack: [javascript-core, javascript-node, javascript-testing]`, `external: frontend-agent-skills`; generic/mvp → порожні `stack`/`external`. Free-text `notes` зі списками скілів у vue3/node видаляються — машинний список їх замінює (notes mvp про quick-режим не є skill-інвентарем і лишаються). Альтернатива «генерований skills.json manifest» відкинута explorer-ом: ще один файл для синхронізації, тоді як orchestrator.yaml уже є місцем конфігурації пайплайна.

### D6. KIT_SKILL_DIRS: managed-перелік — з templates, очікування health — з конфігурації

Хардкодний масив видаляється. Два споживачі переліку розділяються:

1. **init/update (що постачає пакет)**: `KIT_MANAGED_PATHS` будується з фактичного вмісту `templates/.agents/skills/` kit-пакета (readdir на KIT_ROOT). Новий скіл у templates автоматично потрапляє в init/update без правки списків у коді.
2. **status/health (що очікує проєкт)**: перелік з `skills:` конфігурації проєкту (з fallback-ом D5).

Чому не «конфіг керує update»: на момент `init` orchestrator.yaml ще не існує, а консюмер, що випадково зіпсував `skills.kit`, не повинен зламати собі `update`. Захист від дрейфу: смоук-тест звіряє `skills.kit` шаблону `templates/orchestrator.yaml` з переліком директорій `templates/.agents/skills/`.

### D7. Skill health: статичне байтове порівняння, warn-only

Нова секція `Skill health` у `status` після MCP health. Для кожного скіла з `kit` + `stack`:

- `missing` — немає `.agents/skills/<name>/SKILL.md`; для stack-скіла рядок додає підказку `npx <external> install` (presence-check, без автозапуску);
- `stale` — джерело є, але `SKILL.md` у `.cursor/skills/<name>/` чи `.claude/skills/<name>/` відсутній або байтово відрізняється від `.agents/skills/<name>/SKILL.md`;
- `ok` — джерело є і обидві IDE-копії збігаються.

Свіжість Amp wrapper-ів: для кожного `.agents/subagents/<n>.md` з валідним frontmatter очікуваний вміст wrapper-а генерується тією самою функцією-builder-ом, що в `generateAmpSubagentSkills` (виділяється спільна функція), і байтово порівнюється з `.agents/skills/subagent-<n>/SKILL.md`; розбіжність або відсутність → `stale`, підсумковий рядок `subagent wrappers: ok (n/n)` чи перелік проблемних.

Порівняння за вмістом, а не mtime: git не зберігає mtime — після clone порівняння часу дало б хибні stale. Порівнюється лише SKILL.md (entry-файл) як проксі стану директорії — дешево і ловить дрейф опису/тіла; `sync` усе одно копіює директорії цілком. Amp читає `.agents/` нативно — для самих скілів Amp-перевірки немає, паритет Amp покривається wrapper-ами. Секція warn-only: exit code не змінюється за жодного стану — паритет з MCP health, який ніколи не валить CI; жодних мережевих запитів. Лікування — наявні команди: `sync` (stale), `update` (missing kit), `npx <external> install` (missing stack).

## Risks / Trade-offs

- [Той самий сенс рішення, переформульований у наступній сесії, створить «дубль» з іншим текстом] → прийнято: append-only історія цінніша за ідеальну дедуплікацію; Memory-мірор все одно тримає останню редакцію topic-а.
- [decisions.md ростиме у довгих changes] → масштаб обмежений життям change (4–8 сесій за метриками kit-а); файл їде в архів разом із change.
- [Порівняння лише SKILL.md пропустить дрейф reference-файлів скіла] → прийнятий trade-off (D7): SKILL.md — entry-файл, який змінюється при кожній змістовній правці; повне порівняння директорій — зайва вартість для warn-only діагностики.
- [Fallback-перелік із templates розійдеться зі `skills.kit` шаблону] → смоук-тест D6 тримає їх синхронними в CI kit-а.
- [Regex-парсер YAML зламається на екзотичному форматуванні секції] → той самий клас ризику, що прийнятий для `parseMcpInventory`/`readPipelineConfig`; шаблон і профілі постачає сам kit, формат контрольований.
- [Свіжий clone показує всі скіли stale, бо `.cursor/`/`.claude/` порожні] → це коректний сигнал («виконай sync»), не хибне спрацювання; warn-only, нічого не блокує.
- [Консюмер вручну редагує decisions.md і ламає парсинг дедуплікації] → CLI лише додає в кінець і порівнює нормалізовані рядки-буллети; не-буллетні рядки ігноруються.

## Migration Plan

Наявні консюмери: `npx agent-orchestrator-kit update` приносить оновлені шаблони; секція `skills:` з'являється у нових init, legacy-проєкти без секції працюють через fallback (D5) — редагувати orchestrator.yaml вручну не обов'язково. decisions.md з'являється органічно після першого `handoff` з непорожніми Decisions. Старі `Decision:*` у memory.json не мігруються (рішення no-migration). Rollback: видалити decisions.md конкретного change-у і секцію `skills:` — CLI повертається до попередньої поведінки через fallback-и.

## Open Questions

Немає — продуктові рішення зафіксовані explorer-ом (decisions-canon, memory-mirror, skill-inventory, skill-health, no-decisions-gate, no-migration), design-рішення D1–D7 закривають формати і семантику.
