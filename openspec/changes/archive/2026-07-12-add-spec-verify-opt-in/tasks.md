# Tasks: Opt-in AI Spec Verifier

## 1. Templates

- [x] 1.1 `templates/scripts/verify-specs.sh` — узагальнений скрипт (project context з `openspec/config.yaml`, англ. рядки, graceful skips, no secret logging)
- [x] 1.2 `templates/scripts/post-mr-verdict.sh` — узагальнений MR-коментар (англ. рядки)
- [x] 1.3 `templates/.gitlab/spec-verify.yml` — hidden base `.spec-verify-base` + job `spec-verify`, blocking default, закоментований `allow_failure: true` (Phase 1), artifacts verdict.json + verifier-prompt.md
- [x] 1.4 `templates/.gitlab-ci.starter.yml.example` — закоментований include `.gitlab/spec-verify.yml`

## 2. CLI (bin/agent-orchestrator.js)

- [x] 2.1 Опція `--spec-verify` в `init` (default false)
- [x] 2.2 `installSpecVerify(projectDir, templateDir, force)` — копіює fragment + скрипти, chmod +x
- [x] 2.3 Warning + skip якщо `--spec-verify` без `--ci gitlab`
- [x] 2.4 `patchOrchestratorSpecVerify(projectDir)` — додає `- spec-verify-blocking` у `roles.verifier.gates` (ідемпотентно)
- [x] 2.5 `KIT_OPTIN_PATHS` + opt-in refresh в `update` (копіювати лише якщо файл існує в проєкті)
- [x] 2.6 Next steps для `--spec-verify`: include fragment, AMP_API_KEY, GITLAB_VERIFIER_TOKEN

## 3. Tests (test/smoke.test.js)

- [x] 3.1 `init --ci gitlab --spec-verify` встановлює 3 файли + gate у orchestrator.yaml
- [x] 3.2 `init --ci gitlab` без флага — spec-verify файли відсутні
- [x] 3.3 `init --ci github --spec-verify` — warning, файли не встановлено
- [x] 3.4 Fragment: `.spec-verify-base`, no active `allow_failure: true`, artifacts, `src/**/*` rules
- [x] 3.5 `update` оновлює spec-verify файли лише при їх наявності (обидва напрями)
- [x] 3.6 Скрипти шаблонів не містять Vue-хардкоду і не логують `AMP_API_KEY`

## 4. Docs

- [x] 4.1 README: секція «AI Spec Verifier (GitLab, opt-in)» — install, CI variables, Phase 1 fallback, verdict schema
- [x] 4.2 `templates/AGENTS.md`: Verifier рядок — згадка spec-verify blocking gate при opt-in
- [x] 4.3 CHANGELOG: розділ 0.1.6

## 5. Release

- [x] 5.1 `package.json` version → 0.1.6
- [x] 5.2 `npx openspec validate --all --strict` — pass
- [x] 5.3 `npm test` — pass
- [x] 5.4 `npm run release:check` (test + pack dry-run) — pass, нові templates у tarball
- [x] 5.5 Commit + tag v0.1.6
