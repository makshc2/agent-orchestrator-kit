## Context

Phase 1 роадмапу `agentic-factory-roadmap` (див. `openspec/specs/agentic-factory-roadmap/spec.md`, рішення D4/D5/D9/D10 в архівному design роадмапу). Наявний стан kit-а v0.3.0:

- `gate-check` уже детермінований: читає `pipeline.require_spec_review`, шукає `review.md` з `Verdict: APPROVE`, diff-ить `--base HEAD~1` по `--src-glob src/`. Але його ніхто не викликає на commit — хука немає.
- Патерн MCP-інструмента провалідований Figma: gitignored `.agents/figma.local.env` + committed `.example` + `scripts/figma-mcp-launcher.cjs` (spawn `npx -y <pkg>` з токеном в env) + `figma-setup`/`figma-status`, які ніколи не друкують токен + записи в `.agents/mcp.json.example` і `.agents/amp.settings.json.example`.
- `mcp.optional` у `templates/orchestrator.yaml` містить `figma`, `github`, `browser` — без `gitlab`, і жоден з трьох не має launcher-а.
- `status` показує лише зміни (tasks/review/brief) — MCP-health немає.
- Всі три IDE (Cursor `.mcp.json`, Claude той самий `.mcp.json`, Amp `.amp/settings.json` → `amp.mcpServers`) запускають однакові stdio launcher-и — це контракт паритету D10.

Обмеження: kit ставиться в чужі репо (власний husky/lefthook можливий), робочі GitLab-репо бувають self-hosted з нестандартним hostname, секрети не можуть потрапляти в git або чат.

## Goals / Non-Goals

**Goals:**

- Закрити governance-розрив: детермінований локальний гейт на commit, opt-in, з повагою до наявної hook-інфраструктури консюмера.
- Закрити Perceive-розрив: працюючі GitHub/GitLab/Browser MCP в усіх трьох IDE за наявним патерном Figma.
- Зробити стан MCP видимим: health-секція в `status`.

**Non-Goals:**

- Phase 2–4 роадмапу (decisions у git, skill manifest, cloud handoff, платформа).
- Новий патерн секретів чи конфігів MCP.
- Установка хука за замовчуванням або запис у `.git/hooks/` без opt-in.
- Заміна Browser MCP на Cursor IDE browser.

## Decisions

### D1. Pre-commit: husky-first, інакше `core.hooksPath` на committed каталог

`hooks-setup` (і `init --hooks`) працює так:

1. Якщо в проєкті є `.husky/` → append рядок `sh scripts/pre-commit-gate-check.sh` у `.husky/pre-commit` (створити файл, якщо його немає; не дублювати рядок при повторному запуску).
2. Інакше → створити committed `.githooks/pre-commit` (виконуваний, викликає той самий скрипт) і виконати `git config core.hooksPath .githooks`.
3. `.git/hooks/` напряму не чіпаємо ніколи.

Чому не лише `core.hooksPath`: у husky-репо `core.hooksPath` вже зайнятий husky — перезапис зламає консюмера. Чому не lefthook-інтеграція: lefthook-конфіг декларативний YAML і рідкісний у наших консюмерах; для нього документуємо ручний рядок у README, автозапис не робимо. Альтернатива «пакетний husky як залежність kit-а» відкинута: kit не має права додавати dependencies консюмеру.

`git config` — локальна операція, тому `hooks-setup` треба виконати на кожній машині; це прийнятно і симетрично `figma-setup`/`memory-setup` (теж локальні). README/next-steps це фіксують.

### D2. Гейту на commit потрібен режим `--staged`

Наявний `gate-check` diff-ить `HEAD~1...HEAD` — на момент pre-commit це попередній commit, а не те, що комітиться. Додаємо `gate-check --staged`: замість `gitDiffTouchesGlob(base)` використовується `git diff --cached --name-only -- <src-glob>`. Решта логіки (читання `require_spec_review`, вибір активного change, перевірка вердикту) спільна й не дублюється. Хук викликає `npx agent-orchestrator-kit gate-check --staged`.

Поведінка збігається з наявною семантикою: немає staged-змін у `src/` → exit 0; `require_spec_review: false` → exit 0 (no-op для mvp); неможливо порахувати diff → warning + exit 0 (never block on unknown), як уже робить `gitDiffTouchesGlob` із `null`.

### D3. Один `mcp-setup` замість трьох `<tool>-setup`

Команд `github-setup`/`gitlab-setup`/`browser-setup` не буде — одна `mcp-setup`, яка:

1. Освіжає managed-файли (launcher-и, examples) з templates.
2. Детектить VCS-хост із `git remote get-url origin` (канон D9 роадмапу):
   - hostname `github.com` → github;
   - hostname `gitlab.com` або містить `gitlab` → gitlab, `GITLAB_API_URL` = `https://<hostname>/api/v4` з remote (підтримати і ssh-форму `git@host:group/repo.git`);
   - інакше (немає remote, нерозпізнаний хост) → жоден VCS MCP, лог «skipped»;
   - `--ci` ніде не читається.
3. Створює відповідний gitignored env-файл з `.example` (як `ensureFigmaEnvFile`) і ніколи не друкує токен.
4. Додає в живі `.mcp.json` і `.amp/settings.json` записи: browser завжди, github/gitlab — лише детектований (як `ensureFigmaMcpEntry`).
5. Прапорець `--vcs <github|gitlab>` дозволяє явний override детекції (не `--ci`); `--no-browser` пропускає browser.

Чому не тиражувати `figma-setup` на кожен tool: три майже однакові команди при спільному життєвому циклі; крім того, детекція remote за визначенням спільна. `figma-setup`/`figma-status` лишаються як є (зворотна сумісність), `mcp-setup` їх не поглинає в цьому change.

### D4. MCP-пакети в launcher-ах

- github: `npx -y @modelcontextprotocol/server-github`, токен `GITHUB_PERSONAL_ACCESS_TOKEN` з `.agents/github.local.env` (ключ `GITHUB_TOKEN` теж читається як синонім).
- gitlab: `npx -y @modelcontextprotocol/server-gitlab`, env `GITLAB_PERSONAL_ACCESS_TOKEN` (+ синонім `GITLAB_TOKEN`) і `GITLAB_API_URL` з `.agents/gitlab.local.env` (URL записує `mcp-setup` при детекції; launcher без URL дефолтить на `https://gitlab.com/api/v4`).
- browser: `npx -y @playwright/mcp` — stdio, без токена, env-файл не потрібен; працює однаково в Cursor, Claude Code і Amp (виконує вимогу D10 «портативний stdio-сервер»).

Чому reference-сервери, а не офіційний `github-mcp-server`: офіційний вимагає Docker або бінарник — ламає npx-патерн launcher-ів і паритет машин. Якщо reference-пакет деградує, заміна локалізована в одному launcher-файлі.

Структура кожного launcher-а — копія `figma-mcp-launcher.cjs`: читання env-файлу без друку значень, `spawn('npx', ['-y', <pkg>])`, проксі exit-коду/сигналу, зрозуміла помилка при відсутньому токені.

### D5. MCP-health усередині `status`, а не окрема команда

`status` після блоку змін друкує секцію `MCP health`: для кожного інструмента з `mcp.baseline` + `mcp.optional` орчестратор-конфігу — рядок `ok | not configured | skipped (no origin match)` на основі: launcher-файл існує; env-файл існує і токен непорожній (де застосовно); запис є в `.mcp.json` та/або `.amp/settings.json`. Жодних мережевих запитів — health статичний і швидкий, значення токенів не друкуються (лише «configured»). Причина «в status, а не `mcp-status`»: роадмап-спека прямо вимагає «MCP-health у `status`»; окремої команди спека не обіцяє.

Парсинг `mcp.baseline`/`mcp.optional` з YAML — простим regex-блоком за прикладом `readPipelineConfig` (kit свідомо без YAML-залежності).

### D6. Examples містять усі MCP, живі конфіги — лише релевантні

`.agents/mcp.json.example` і `.agents/amp.settings.json.example` отримують усі п'ять записів (`memory`, `figma`, `github`, `gitlab`, `browser`) — це виконує вимогу паритету «запис з'являється в обох committed examples». Але живі `.mcp.json` / `.amp/settings.json` доповнює лише `mcp-setup` і лише детектованим VCS + browser: інакше в GitHub-репо IDE намагався б стартувати gitlab-launcher і навпаки. Наслідок: `ensureMemoryMcpEntry`-стиль «створити live-конфіг копією example, якщо його немає» для нового example означав би всі п'ять серверів — тому `mcp-setup` після копіювання видаляє з новоствореного live-конфігу недетектований VCS-запис.

## Risks / Trade-offs

- [Append у `.husky/pre-commit` зачепить чужий вміст] → додаємо лише один рядок з маркер-коментарем `# agent-orchestrator-kit gate`, ідемпотентно; видалення документоване (прибрати рядок).
- [`core.hooksPath` перекриє майбутній husky консюмера] → `hooks-setup` перевіряє поточне значення `core.hooksPath` і відмовляється перезаписувати чуже (не `.githooks`) значення з підказкою.
- [Reference MCP-сервери GitHub/GitLab заархівовані upstream-ом] → контракт ізольований у launcher-ах; заміна пакета = правка одного файлу + `update` у консюмерах.
- [Детекція «hostname містить gitlab» дасть false negative для екзотичного self-hosted домену без "gitlab"] → `mcp-setup --vcs gitlab` як явний override; `status` показує skipped, а не мовчить.
- [`@playwright/mcp` тягне браузери при першому старті] → це разовий локальний кошт; у CI browser MCP не запускається.
- [Хук уповільнює commit (npx cold start)] → гейт виконує лише локальні файлові перевірки і один `git diff --cached`; прийнятно для commit-частоти пайплайна.
- [Новий live-конфіг з example містить недетектований VCS] → D6: `mcp-setup` чистить недетектований запис одразу після створення файлу з example.

## Migration Plan

Наявні консюмери: `npx agent-orchestrator-kit update` (нові launcher-и/examples) → опційно `mcp-setup` → опційно `hooks-setup`. Нічого не вмикається саме по собі. Rollback: прибрати рядок з `.husky/pre-commit` або `git config --unset core.hooksPath`; видалити MCP-записи з live-конфігів. Секрети живуть лише в gitignored файлах — видалення файлу = відкликання.

## Open Questions

- Чи достатньо `@modelcontextprotocol/server-gitlab` для self-hosted інстансів зі старим API — перевіряється на робочому репо під час apply; якщо ні, launcher переключається на альтернативний пакет без зміни спеки.
