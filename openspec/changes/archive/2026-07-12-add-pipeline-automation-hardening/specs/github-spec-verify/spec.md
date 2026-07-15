## ADDED Requirements

### Requirement: Init підтримує --spec-verify з --ci github

CLI `init` SHALL приймати `--spec-verify` разом з `--ci github` (а не лише `--ci gitlab`) і встановлювати GitHub-версію AI Spec Verifier.

#### Scenario: Init встановлює GitHub spec-verify

- **WHEN** користувач виконує `agent-orchestrator-kit init --ci github --spec-verify`
- **THEN** kit встановлює `.github/workflows/spec-verify.yml`
- **AND** kit встановлює `scripts/verify-specs.sh` (перевикористаний, той самий що для GitLab)
- **AND** kit встановлює `scripts/post-pr-verdict-github.sh`
- **AND** усі скрипти отримують `chmod +x`

#### Scenario: Init без --ci github --spec-verify не встановлює GitHub verifier

- **WHEN** користувач виконує `agent-orchestrator-kit init --ci github` без `--spec-verify`
- **THEN** `.github/workflows/spec-verify.yml` не встановлюється

#### Scenario: update оновлює GitHub spec-verify файли лише за наявності

- **WHEN** проєкт вже має `.github/workflows/spec-verify.yml` (встановлений раніше через `--spec-verify`)
- **AND** користувач виконує `agent-orchestrator-kit update`
- **THEN** `.github/workflows/spec-verify.yml` та `scripts/post-pr-verdict-github.sh` оновлюються з templates
- **WHEN** проєкт НЕ мав GitHub spec-verify встановленим
- **THEN** `update` не створює ці файли

### Requirement: GitHub spec-verify workflow

`templates/.github/workflows/spec-verify.yml` SHALL запускати `verify-specs.sh`, оцінювати verdict і постити результат як коментар PR через GitHub CLI.

#### Scenario: Workflow тригериться на pull_request зі змінами в src

- **WHEN** відкрито pull request, що змінює файли під `src/**`
- **THEN** job `spec-verify` виконується

#### Scenario: Workflow блокує на BLOCKED verdict

- **WHEN** `verify-specs.sh` записує `artifacts/verdict.json` з `"pass": false`
- **THEN** job `spec-verify` завершується з ненульовим exit code

#### Scenario: Workflow має права на коментування PR

- **WHEN** файл workflow встановлено
- **THEN** job містить `permissions: pull-requests: write`

### Requirement: post-pr-verdict-github.sh постить verdict через gh CLI

Скрипт SHALL парсити `artifacts/verdict.json` і постити коментар на pull request через `gh pr comment`, не логуючи токени.

#### Scenario: Успішний коментар

- **WHEN** `artifacts/verdict.json` існує і скрипт виконується в контексті GitHub Actions pull_request event (`GH_TOKEN`/`GITHUB_TOKEN` задано)
- **THEN** скрипт постить коментар з summary, score і таблицею findings на PR

#### Scenario: Graceful skip поза PR контекстом

- **WHEN** скрипт виконується не в pull_request контексті (немає номера PR)
- **THEN** скрипт завершується з exit code 0 без спроби коментування

#### Scenario: Не логує токен

- **WHEN** скрипт виконується
- **THEN** значення `GH_TOKEN`/`GITHUB_TOKEN` ніколи не виводиться в stdout/stderr
