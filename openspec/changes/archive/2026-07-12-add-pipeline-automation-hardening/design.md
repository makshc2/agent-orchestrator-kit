# Design: Pipeline Automation Hardening

## Context

- Гейти конвеєра (`require_spec_review`, `max_active_changes`, archive-after-merge) описані в `.agents/orchestrator.yaml` і SKILL.md/командах, але перевіряються лише агентом у чаті (`templates/.agents/commands/opsx-apply.md`, крок "1.5 Check review gate")
- AI Spec Verifier (`init --ci gitlab --spec-verify`) вже має generic `verify-specs.sh` (без GitLab-специфіки в промпті/логіці verdict); GitLab-специфічний лише `post-mr-verdict.sh` (GitLab REST API)
- `agent-orchestrator sync` (Node, `bin/agent-orchestrator.js`) використовує `copyDir()`, який ніколи не видаляє файли в `dest`; `sync-local-agent-skills.sh` використовує `rsync -a --delete`. Два джерела істини з різною поведінкою
- Kit CI fragments (`.github/workflows/agent-verify.yml`, `.gitlab/agent-verify.yml`) зараз викликають лише `openspec validate --all --strict` + lint/build/test — без перевірки orchestration-гейтів

## Goals / Non-Goals

**Goals:**

- Перетворити review-gate і `max_active_changes` на команди з детермінованим exit code, придатні і для локального виклику, і для CI
- Дати GitHub-консюмерам ту саму AI Spec Verifier можливість, що є в GitLab (без дублювання промпт-логіки)
- Усунути розбіжність поведінки `sync` між Node CLI і shell-скриптом
- Не ламати consumer-проєкти, які ще не мають `review.md`/`orchestrator.yaml` в очікуваному форматі — де можливо, деградувати до warning, а не hard fail

**Non-Goals:**

- Автоматичний `openspec archive` без підтвердження людини
- Нові CI-провайдери (Bitbucket, Azure DevOps)
- Збір метрик (sessions/apply iterations) — окрема зміна
- Зміна формату/промпту verdict.json — лише перевикористання для GitHub

## Decisions

### 1. `gate-check` як окрема CLI-команда, не частина `init`

Гейт має виконуватись на кожному PR/MR, а не лише при `init`. Команда читає `.agents/orchestrator.yaml` (`pipeline.require_spec_review`, `pipeline.max_active_changes`), знаходить активні зміни через локальний парсинг `openspec/changes/*/tasks.md` + `review.md` (без залежності від конкретної версії `openspec` CLI JSON-схеми, щоб не ламатись при апдейтах OpenSpec) і git diff (`--src-glob`, за замовчуванням `src/`) для визначення, чи PR чіпає код.

**Логіка виходу:**
- Немає змін у `src/` (за `--src-glob`) → exit 0, "nothing to gate"
- `require_spec_review: false` → exit 0, "review not required (mvp/quick mode)"
- Є `review.md` з `Verdict: APPROVE` → exit 0
- Інакше → exit 1, повідомлення яку зміну і що бракує

`max_active_changes` — лише warning (exit 0 з `⚠`), бо перевищення ліміту не мусить блокувати вже наявний код; це сигнал для людини, не помилка збірки.

**Альтернатива:** робити `gate-check` частиною `openspec validate` — відхилено, бо це логіка kit-а (review workflow), не OpenSpec-схеми.

### 2. `status` — тонка обгортка, без нового стану

`agent-orchestrator status` не зберігає власний стан — лише читає `openspec/changes/*/{tasks.md,review.md}` і `.agents/orchestrator.yaml`, і виводить таблицю. Це усуває потребу власноруч ганяти `openspec status --change` для кожної зміни на початку сесії.

### 3. GitHub Spec Verifier перевикористовує `verify-specs.sh` без змін

`verify-specs.sh` вже стек- і CI-агностичний (project context з `openspec/config.yaml`, graceful skip). Різниця GitHub/GitLab — тільки спосіб (а) отримати changed files diff base і (б) запостити коментар. Тому:

- Новий `templates/scripts/post-pr-verdict-github.sh` — той самий verdict-parsing, коментар через `gh pr comment --body-file` (GitHub CLI, вже доступний на `ubuntu-latest` runners за замовчуванням)
- `templates/.github/workflows/spec-verify.yml` — job з `permissions: pull-requests: write`, встановлює `amp` CLI так само як GitLab job, викликає ті самі два скрипти

**Альтернатива:** переписати `verify-specs.sh` на дві версії (bash generic + Node) — відхилено, зайва складність, поточний скрипт вже working і покритий тестами.

### 4. Delete-семантика в `sync`

`copyDir()` отримує нову опцію `delete: true`, яка після копіювання проходить `dest` і видаляє файли/директорії, яких нема в `src` (окрім явних винятків: `memory.json`, `settings.json`, `CLAUDE.md`, `.mcp.json` — locally-generated, не з `.agents/`). Застосовується лише до `skills/` і `rules/` (детерміновані, повністю kit-managed директорії), не до кореня `.cursor/`/`.claude/`, де можуть бути user-generated файли.

**Альтернатива:** прибрати Node `sync` і залишити тільки shell-скрипт — відхилено: shell-скрипт непридатний на Windows (`rsync`, POSIX shebang), а kit позиціонується як кросплатформний.

### 5. CI fragments отримують `gate-check` як опційний, а не завжди-присутній крок

Щоб не ламати вже встановлені `agent-verify.yml` у консюмерів (файли оновлюються через `update`, який перезаписує `KIT_MANAGED_PATHS` безумовно), крок `gate-check` додається в fragment одразу (частина `KIT_MANAGED_PATHS`, як і решта verify-кроків), але сама команда **graceful-degrade**: якщо `.agents/orchestrator.yaml` відсутній або `require_spec_review` не задано — exit 0 з info-повідомленням. Це безпечно для `update` без `--force`-конфліктів.

## Risks / Trade-offs

- **[Risk] `gate-check` дає хибний exit 1 на нестандартному layout (немає `src/`)** → Mitigation: опція `--src-glob`, за замовчуванням береться з `verifier`/existing `SRC_GLOB` конвенції; при відсутності git-репозиторію чи diff base — graceful skip, не fail
- **[Risk] GitHub Spec Verifier дублює вартість Amp API викликів поруч з GitLab-варіантом для monorepo з обома CI** → Mitigation: документовано як alternative, не додатковий шар; консюмер обирає один CI provider через `--ci`
- **[Trade-off] `sync --delete` для skills/rules може видалити локальні кастомізації, якщо хтось руками редагував `.cursor/skills/`** → Mitigation: README explicitly documents `.cursor/`/`.claude/` як generated-only (вже задокументовано), delete обмежено підпапками `skills/`/`rules/`, а не всім `.cursor/`

## Migration Plan

1. Реліз наступної minor-версії kit-а (0.1.7)
2. Нові проєкти: `gate-check` доступний одразу; GitHub spec-verify — через `init --ci github --spec-verify`
3. Існуючі консюмери: `agent-orchestrator-kit update` підтягує оновлені CI fragments з `gate-check` кроком; `sync` delete-семантика діє з наступного запуску `sync`/`update`
4. Rollback: прибрати крок `gate-check` з `.gitlab-ci.yml`/`.github/workflows/agent-verify.yml` вручну, якщо потрібно тимчасово відключити

## Open Questions

Немає.
