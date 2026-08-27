## ADDED Requirements

### Requirement: Optional MCP ставляться патерном Figma-launcher-а

Kit SHALL постачати stdio launcher-и `scripts/github-mcp-launcher.cjs`, `scripts/gitlab-mcp-launcher.cjs` і `scripts/browser-mcp-launcher.cjs` за наявним патерном Figma: gitignored env-файл (`.agents/github.local.env`, `.agents/gitlab.local.env`) + committed `.example` + launcher, що читає токен локально і передає його лише через process env. Setup- і status-команди MUST NOT друкувати значення токенів. Committed файли (examples, launcher-и) MUST NOT містити реальних токенів. Browser MCP SHALL працювати без токена і без env-файлу.

#### Scenario: Launcher без токена падає з підказкою

- **GIVEN** `.agents/github.local.env` відсутній або токен порожній
- **WHEN** IDE запускає `scripts/github-mcp-launcher.cjs`
- **THEN** launcher завершується non-zero зі зрозумілим повідомленням, куди покласти токен
- **AND** значення токена ніде не друкується

#### Scenario: Секрети не потрапляють у git

- **WHEN** виконується `mcp-setup` або `update`
- **THEN** `.gitignore` містить `.agents/github.local.env` і `.agents/gitlab.local.env`
- **AND** committed конфіги містять лише виклики launcher-ів без секретів

### Requirement: VCS MCP визначається з git remote origin

`mcp-setup` SHALL визначати VCS-хост із `git remote get-url origin` (підтримуючи https- і ssh-форми URL): hostname `github.com` → встановлюється лише GitHub MCP; hostname `gitlab.com` або hostname, що містить `gitlab` → встановлюється лише GitLab MCP з base URL, взятим з remote hostname; відсутність remote або нерозпізнаний хост → жоден VCS MCP не встановлюється. Прапорець `--ci` MUST NOT впливати на детекцію. Явний override MUST бути доступний через `mcp-setup --vcs <github|gitlab>`.

#### Scenario: GitHub origin

- **GIVEN** `git remote get-url origin` повертає URL з hostname `github.com`
- **WHEN** виконується `mcp-setup`
- **THEN** у живі конфіги додається лише запис `github`
- **AND** GitLab-токен не вимагається

#### Scenario: Self-hosted GitLab origin

- **GIVEN** origin вказує на self-hosted GitLab (hostname містить `gitlab`, не `gitlab.com`)
- **WHEN** виконується `mcp-setup`
- **THEN** додається лише запис `gitlab`
- **AND** `GITLAB_API_URL` у `.agents/gitlab.local.env` формується з hostname remote, а не хардкодом `gitlab.com`
- **AND** GitHub-токен не вимагається

#### Scenario: Немає remote — VCS MCP пропускається

- **GIVEN** репозиторій без remote origin або з нерозпізнаним хостом
- **WHEN** виконується `mcp-setup`
- **THEN** жоден VCS MCP не встановлюється
- **AND** `status` показує пропуск, а не GitHub за замовчуванням

#### Scenario: --ci не перевизначає детекцію

- **GIVEN** origin на self-hosted GitLab
- **WHEN** kit було ініціалізовано з `--ci github`
- **THEN** `mcp-setup` усе одно ставить GitLab MCP

### Requirement: Паритет Cursor, Claude Code і Amp Code

Записи `github`, `gitlab`, `browser` SHALL бути присутні в обох committed examples — `.agents/mcp.json.example` (Cursor/Claude) і `.agents/amp.settings.json.example` (Amp) — і вказувати на ті самі `scripts/<tool>-mcp-launcher.cjs`. `mcp-setup` SHALL оновлювати живі конфіги обох форматів (`.mcp.json`, `.amp/settings.json`), додаючи browser завжди і лише детектований VCS MCP; недетектований VCS-запис MUST NOT потрапляти в живий конфіг, створений з example. Browser MCP MUST бути портативним stdio-сервером, що стартує в усіх трьох IDE; Cursor-native IDE browser MUST NOT вважатися виконанням цієї вимоги. `mcp.optional` у `templates/orchestrator.yaml` SHALL містити `figma`, `github`, `gitlab`, `browser`.

#### Scenario: Examples синхронні для трьох IDE

- **WHEN** виконується `update` або `mcp-setup`
- **THEN** `.agents/mcp.json.example` і `.agents/amp.settings.json.example` містять записи `memory`, `figma`, `github`, `gitlab`, `browser` з однаковими launcher-шляхами

#### Scenario: Живий конфіг отримує лише релевантний VCS

- **GIVEN** origin на `github.com` і відсутній `.mcp.json`
- **WHEN** виконується `mcp-setup`
- **THEN** створений `.mcp.json` містить `github` і `browser`, але не містить `gitlab`
- **AND** `.amp/settings.json` оновлюється за тим самим правилом

### Requirement: MCP-health видимий у status

`npx agent-orchestrator-kit status` SHALL друкувати секцію MCP-health: для кожного інструмента з `mcp.baseline` і `mcp.optional` конфігурації оркестратора — стан на основі локальних перевірок (launcher існує; env-файл існує і токен непорожній, де застосовно; запис присутній у `.mcp.json` та/або `.amp/settings.json`). Перевірка MUST бути статичною (без мережевих запитів) і MUST NOT друкувати значення токенів. Недетектований для цього репо VCS MCP SHALL показуватись як пропущений, а не як помилка.

#### Scenario: Health для налаштованого інструмента

- **GIVEN** figma-токен налаштовано і launcher встановлено
- **WHEN** виконується `status`
- **THEN** рядок `figma` показує стан ok/configured без значення токена

#### Scenario: Health для пропущеного VCS

- **GIVEN** origin на `github.com`
- **WHEN** виконується `status`
- **THEN** рядок `gitlab` показує skipped (не відповідає origin), а не failure
