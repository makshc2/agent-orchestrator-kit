# Apply notes: add-factory-gates-and-mcp

## Констрейнти
- Писати лише в: `bin/agent-orchestrator.js`, `templates/scripts/`, `templates/.agents/`, `templates/orchestrator.yaml`, `test/smoke.test.js`, `README.md`, `CHANGELOG.md`, `openspec/changes/add-factory-gates-and-mcp/tasks.md` (лише `[x]`).
- Не редагувати proposal/design/specs/review — лише виконувати таски.
- `.git/hooks/` напряму не чіпати ніколи; hook вмикається лише через `hooks-setup` / `init --hooks`.
- Токени й значення env ніколи не друкувати — ні в логах команд, ні в тестах, ні в чаті.
- Нових dependencies у `package.json` kit-а не додавати (MCP-пакети йдуть через `npx -y` у launcher-ах).

## Підводні камені
- Таска 1.1: `--staged` має успадкувати «never block on unknown» — diff неможливий → warning + exit 0, як `gitDiffTouchesGlob` з `null` (bin ~1634–1640). Спільну логіку require_spec_review/вибору change/вердикту не дублювати.
- Таска 1.3: перевіряти поточний `git config core.hooksPath` і відмовлятися перезаписувати чуже (не `.githooks`) значення; append у `.husky/pre-commit` — один рядок з маркером `# agent-orchestrator-kit gate`, ідемпотентно. `pre-commit-gate-check.sh` до managed-списків додається тут — у 3.4 лише переконатися, що вже є (перетин тасків, не дублювати).
- Таска 2.1: структура launcher-ів — копія `figma-mcp-launcher.cjs` (шляхи від `__dirname`/project root, не від cwd — це і є «правило Memory MCP» для Amp). Reference-пакети `server-github`/`server-gitlab` заархівовані upstream: перед використанням перевірити, що ставляться через `npx -y` і працюють по stdio; якщо ні — замінити пакет лише в launcher-і, спеку не міняти.
- Таска 3.1: парсити і https-, і ssh-форму (`git@host:group/repo.git`); правило gitlab — hostname `gitlab.com` або містить `gitlab`; `--ci` ніде не читати.
- Таска 3.2: якщо live-конфіг створюється копією example — видалити з нього недетектований VCS-запис (D6); `figma`-запис лишається (наявна семантика example, не чистити). Порядок: managed-файли → env-файл (+`GITLAB_API_URL` з hostname remote) → `.gitignore` → live-конфіги.
- Таска 3.3: `mcp.baseline`/`mcp.optional` парсити regex-ом у стилі `readPipelineConfig` (без YAML-залежності); статуси `ok | not configured | skipped (no origin match)`; без мережевих запитів.
- Таска 4.2: у README для хука згадати рекомендацію тримати kit у devDependencies (npx cold start на кожен commit).

## Перевірка (після всіх тасок)
- `npx openspec validate add-factory-gates-and-mcp --strict --type change`
- `npx agent-orchestrator-kit gate-check --tasks add-factory-gates-and-mcp`
- `npm test`
- Ручні сценарії в tmp-репо: `hooks-setup` з/без `.husky/`, чужий `core.hooksPath`; `mcp-setup` з origin github.com / self-hosted gitlab / без remote / `--vcs` override
- `git diff` по `templates/.agents/*.example` — жодних реальних токенів
