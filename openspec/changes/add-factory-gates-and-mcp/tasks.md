# Tasks — add-factory-gates-and-mcp

## 1. Pre-commit гейт (commit-review-gate)

- [x] 1.1 Додати режим `--staged` у `gate-check`
  Files: bin/agent-orchestrator.js
  Do: додати опцію `--staged` до команди `gate-check`; реалізувати перевірку staged-змін через `git diff --cached --name-only -- <src-glob>` замість `gitDiffTouchesGlob(base)`; зберегти спільну логіку require_spec_review/вибору change/вердикту; неможливість порахувати diff → warning + exit 0
  Done-when: `gate-check --staged` повертає non-zero без APPROVE при staged-змінах у `src/`, exit 0 при APPROVE, без staged-змін у `src/` і при `require_spec_review: false`

- [x] 1.2 Створити hook-скрипт
  Files: new file: templates/scripts/pre-commit-gate-check.sh
  Do: shell-скрипт, який викликає `npx agent-orchestrator-kit gate-check --staged` і проксить його exit-код; додати shebang і короткий коментар про відключення
  Done-when: скрипт виконуваний, при запуску в проєкті kit-а викликає gate-check --staged і повертає його exit-код

- [x] 1.3 Додати команду `hooks-setup` і прапорець `init --hooks`
  Files: bin/agent-orchestrator.js
  Do: нова команда `hooks-setup`: якщо існує `.husky/` → ідемпотентно додати маркований рядок виклику `scripts/pre-commit-gate-check.sh` у `.husky/pre-commit`; інакше створити виконуваний `.githooks/pre-commit` і `git config core.hooksPath .githooks`; якщо `core.hooksPath` вже має чуже значення (не `.githooks`) — відмовитись з підказкою; `init --hooks` викликає ту саму логіку; `init` без `--hooks` не чіпає hooks; `pre-commit-gate-check.sh` додається до managed-скриптів init/update
  Done-when: повторний запуск `hooks-setup` не дублює рядок/файл; сценарії спеки commit-review-gate щодо husky/`core.hooksPath` проходять вручну в тимчасовому репо

## 2. MCP launcher-и та env-файли (optional-mcp-setup)

- [x] 2.1 Створити launcher-и github/gitlab/browser
  Files: new file: templates/scripts/github-mcp-launcher.cjs, new file: templates/scripts/gitlab-mcp-launcher.cjs, new file: templates/scripts/browser-mcp-launcher.cjs
  Do: скопіювати структуру `figma-mcp-launcher.cjs`; github: читає `.agents/github.local.env` (GITHUB_PERSONAL_ACCESS_TOKEN, синонім GITHUB_TOKEN), spawn `npx -y @modelcontextprotocol/server-github`; gitlab: читає `.agents/gitlab.local.env` (GITLAB_PERSONAL_ACCESS_TOKEN, синонім GITLAB_TOKEN, + GITLAB_API_URL з дефолтом `https://gitlab.com/api/v4`), spawn `npx -y @modelcontextprotocol/server-gitlab`; browser: без env-файлу, spawn `npx -y @playwright/mcp`; помилки без друку токенів
  Done-when: кожен launcher без токена завершується non-zero з підказкою (browser — стартує), значення токенів не друкуються

- [x] 2.2 Створити committed env-examples
  Files: new file: templates/.agents/github.local.env.example, new file: templates/.agents/gitlab.local.env.example
  Do: за зразком `figma.local.env.example`: коментар де взяти токен, порожній ключ токена; для gitlab додатково `GITLAB_API_URL=` з коментарем про self-hosted
  Done-when: examples існують, не містять реальних значень, згадують заборону вставляти токен у чат

- [x] 2.3 Оновити MCP-examples і orchestrator-шаблон
  Files: templates/.agents/mcp.json.example, templates/.agents/amp.settings.json.example, templates/orchestrator.yaml
  Do: додати записи `github`, `gitlab`, `browser` з launcher-шляхами `scripts/<tool>-mcp-launcher.cjs` в обидва examples; у `mcp.optional` додати `gitlab`
  Done-when: обидва examples містять п'ять серверів з однаковими шляхами; `mcp.optional` = figma, github, gitlab, browser

## 3. Команда mcp-setup і health у status

- [x] 3.1 Реалізувати детекцію VCS-хоста з git remote
  Files: bin/agent-orchestrator.js
  Do: функція, що читає `git remote get-url origin`, парсить https/ssh форми, повертає `github` (hostname github.com), `gitlab` + hostname (gitlab.com або hostname містить gitlab) або `none`; `--ci` не читається
  Done-when: unit-логіка покрита тестом на https-, ssh-URL github.com, gitlab.com, self-hosted gitlab hostname і відсутній remote

- [x] 3.2 Додати команду `mcp-setup`
  Files: bin/agent-orchestrator.js
  Do: команда `mcp-setup [--vcs github|gitlab] [--no-browser]`: освіжити managed-файли (launcher-и, examples), створити env-файл детектованого VCS з example (`ensureFigmaEnvFile`-патерн; для gitlab записати GITLAB_API_URL з hostname remote), оновити `.gitignore`, додати у живі `.mcp.json` і `.amp/settings.json` browser завжди та лише детектований VCS (`ensureFigmaMcpEntry`-патерн); якщо live-конфіг створюється з example — видалити з нього недетектований VCS-запис; без remote → VCS пропущено з логом; токени не друкуються
  Done-when: сценарії спеки optional-mcp-setup для GitHub origin, self-hosted GitLab, відсутнього remote і override `--vcs` проходять у тимчасових репо

- [x] 3.3 Додати MCP-health у `status`
  Files: bin/agent-orchestrator.js
  Do: розпарсити `mcp.baseline`/`mcp.optional` з `.agents/orchestrator.yaml` regex-ом (стиль `readPipelineConfig`); для кожного інструмента статично перевірити launcher, env-файл/токен (де застосовно), записи в `.mcp.json`/`.amp/settings.json`; друкувати ok / not configured / skipped (VCS, що не відповідає origin); без мережевих запитів і без значень токенів
  Done-when: `status` у цьому репо показує секцію MCP health з рядками для memory, figma, github, gitlab, browser

- [x] 3.4 Інтегрувати нові managed-файли в `init`/`update` і .gitignore
  Files: bin/agent-orchestrator.js
  Do: додати нові launcher-и, hook-скрипт і env-examples до managed-списків init/update (стиль FIGMA_MANAGED_PATHS); додати `.agents/github.local.env` і `.agents/gitlab.local.env` у GITIGNORE_LINES; оновити printNextSteps згадкою `mcp-setup`/`hooks-setup`
  Done-when: `update` у консюмері приносить нові файли; `.gitignore` після init/update містить нові env-шляхи

## 4. Тести та документація

- [x] 4.1 Смоук-тести нової поведінки
  Files: test/smoke.test.js
  Do: додати тести: init без `--hooks` не створює `.githooks` і не чіпає husky; `hooks-setup` у tmp-репо з `.husky/` append-ить рядок ідемпотентно, без husky — створює `.githooks/pre-commit` і ставить core.hooksPath; `gate-check --staged` блокує/пропускає за вердиктом; детекція remote для github/gitlab/self-hosted/none (через `git remote add` у tmp-репо); `mcp-setup` пише лише детектований VCS у live-конфіги; `status` містить MCP-health; examples містять п'ять серверів
  Done-when: `npm test` зелений локально

- [x] 4.2 Оновити README і CHANGELOG
  Files: README.md, CHANGELOG.md
  Do: описати `hooks-setup`/`init --hooks` (opt-in, husky-first, відключення), `mcp-setup` (детекція origin, --vcs override, токени лише в gitignored env), MCP-health у `status`; додати запис CHANGELOG для наступної версії
  Done-when: README містить розділи по обох можливостях; CHANGELOG має unreleased-запис Phase 1
