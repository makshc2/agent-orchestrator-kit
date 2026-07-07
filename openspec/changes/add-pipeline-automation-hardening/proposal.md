# Proposal: Pipeline Automation Hardening

## Intent

Закрити прогалини автоматизації, знайдені при інспекції kit-а: review-gate та `max_active_changes` зараз перевіряються лише "на чесність" LLM (soft-конвенція в SKILL.md/командах), archive виконується вручну і регулярно забувається (навіть у власному репозиторії kit-а), AI Spec Verifier існує лише для GitLab, а `agent-orchestrator sync` (Node CLI) розходиться поведінкою з `sync-local-agent-skills.sh` (не видаляє застарілі файли). Ця зміна робить частину orchestration-контролів **детермінованими** (CLI/CI), а не залежними від пам'яті агента чи людини.

## Scope

- Нова CLI-команда `agent-orchestrator status` — агрегований дашборд по активних changes (задачі, review-verdict, готовність до archive)
- Нова CLI-команда `agent-orchestrator gate-check <change>` — жорстка перевірка review-gate (`review.md` з `Verdict: APPROVE`) і `max_active_changes`; придатна для CI/pre-commit
- Новий CI-крок (GitHub + GitLab agent-verify fragments) що викликає `gate-check` при змінах у `src/`
- GitHub-паритет для AI Spec Verifier: `templates/.github/workflows/spec-verify.yml` + `templates/scripts/post-pr-verdict-github.sh` (через `gh` CLI), перевикористання наявного `verify-specs.sh`
- Виправлення `agent-orchestrator sync`: видалення застарілих файлів (`--delete`-семантика) при синхронізації `.agents/skills/` → `.cursor/skills/` / `.claude/skills/`, паритет з shell-скриптом
- Опційний CI job "archive suggestion" (не блокуючий): після merge у main виводить попередження, якщо є `complete`, але не заархівована зміна (як `add-spec-verify-opt-in` зараз)
- Smoke-тести для нових CLI-команд і сценаріїв
- Docs: README (нові CLI-команди, `--ci gitlab|github --spec-verify` паритет), CHANGELOG, `templates/AGENTS.md` / skill `agent-orchestration`

## Non-goals

- Повна автоматизація `/opsx:archive` без підтвердження людини (лишається запропонований, не автовиконаний крок) — ризик втратити delta-specs sync без огляду
- Bitbucket/Azure DevOps CI-провайдери
- Метрики (`sessions per change`, `apply iterations`) — окрема майбутня зміна
- Config-drift `doctor` команда для `orchestrator.yaml` — окрема майбутня зміна
- Зміна формату `verdict.json` чи промпту AI Spec Verifier (лише перевикористання для GitHub)

## Why

Кit документує кілька "hard rules" (one active change, no apply без review-approve, archive after merge), але жоден з них не має програмної перевірки — усе тримається на тому, що агент у чаті сам прочитає інструкцію. Практичний доказ крихкості: у самому репозиторії kit-а зміна `add-spec-verify-opt-in` повністю завершена (24/24 задачі, реліз v0.1.6 затегано), але досі не заархівована. Аналогічно, AI Spec Verifier — цінна можливість, доступна лише GitLab-консюмерам. І `agent-orchestrator sync` (єдиний кросплатформний, не-POSIX шлях для Windows) тихо залишає сирітські файли скілів, яких вже нема в `.agents/skills/`.

## What Changes

- **`bin/agent-orchestrator.js`**: нові команди `status` та `gate-check`; фікс `copyDir`/`sync` для видалення застарілих файлів (опція `delete: true` при синхронізації skills/rules)
- **`templates/.github/workflows/agent-verify.yml`** та **`templates/.gitlab/agent-verify.yml`**: опційний крок `gate-check` (виконується тільки коли `pipeline.require_spec_review: true` і PR/MR змінює `src/`)
- **`templates/.github/workflows/spec-verify.yml`** (новий): GitHub-версія AI Spec Verifier, перевикористовує `templates/scripts/verify-specs.sh`
- **`templates/scripts/post-pr-verdict-github.sh`** (новий): постить verdict як коментар PR через `gh pr comment` / GitHub REST API
- **`test/smoke.test.js`**: тести для `status`, `gate-check`, sync delete-behavior, GitHub spec-verify install
- **README.md, templates/AGENTS.md, templates/.agents/skills/agent-orchestration/SKILL.md, CHANGELOG.md**: документація нових команд і GitHub spec-verify паритету

## Acceptance criteria

1. `agent-orchestrator status` виводить для кожної активної зміни: % виконаних задач, наявність і verdict `review.md`, ready-to-archive прапорець
2. `agent-orchestrator gate-check <name>` повертає ненульовий exit code, якщо `require_spec_review: true`, зміна змінює `src/` (за git diff), а `review.md` відсутній або має `Verdict: REQUEST CHANGES`
3. `gate-check` також попереджає (не обов'язково блокує), якщо активних changes більше за `max_active_changes`
4. `init --ci gitlab --spec-verify` і новий `init --ci github --spec-verify` обидва встановлюють робочий AI Spec Verifier (з відповідним способом коментування PR/MR)
5. `agent-orchestrator sync` після видалення скіла з `.agents/skills/` більше не залишає його в `.cursor/skills/` / `.claude/skills/`
6. `npm test` зелений; `npx openspec validate --all --strict` проходить

## Capabilities

### New Capabilities

- `orchestrator-cli-controls`: CLI-команди `status` і `gate-check` для детермінованого контролю orchestration-гейтів, плюс delete-семантика `sync` (усуває сирітські файли скілів)
- `github-spec-verify`: AI Spec Verifier для GitHub-консюмерів (паритет з GitLab)

### Modified Capabilities

- `gitlab-consumer-verify`: додається опційний `gate-check` крок у `.gitlab/agent-verify.yml`; CLI `sync` отримує delete-семантику (стосується всіх консюмерів, не лише GitLab, але спека `gitlab-consumer-verify` вже описує CLI init/sync поведінку для GitLab profile)

## Impact

- Нові проєкти: gate-check і status доступні одразу після `init` (частина `bin/agent-orchestrator.js`, версій-незалежно від профілю)
- Існуючі консюмери: отримують нові команди через `npx agent-orchestrator-kit@latest status` / `gate-check` без міграції; CI fragments оновлюються через `update`
- GitHub-консюмери: можуть увімкнути AI Spec Verifier через `init --ci github --spec-verify` (раніше — тільки GitLab)
