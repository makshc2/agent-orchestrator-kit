# Tasks

- [x] 1.1 Validate the resulting main specs before review
  Files: bin/agent-orchestrator.js, new file: bin/spec-preflight.js
  Do: reuse planSpecSync, overlay all main specs in a temporary root, run the installed strict validator offline, preserve severities, report source scope, and clean up; generate a valid Purpose for short new capability names.
  Done-when: real CLI tests cover length boundaries, legacy blockers, removed/renamed requirements, read-only originals, and failure cleanup.
- [x] 1.2 Teach the description limit and separate legacy migration
  Files: templates/.agents/subagents/spec-architect.md, templates/.agents/commands/opsx-propose.md, templates/.agents/skills/openspec-propose/SKILL.md, templates/.agents/rules/openspec-workflow.mdc, templates/.agents/skills/openspec-howto/SKILL.md, templates/openspec-config.yaml.example, profiles/vue3/openspec-config.yaml.example, profiles/mvp/openspec-config.yaml.example, README.md, CHANGELOG.md
  Do: explain the 500-character description boundary, preserving MODIFIED behavior/scenarios, projected strict validation, and reporting unrelated blockers for separate migration.
  Done-when: generated authoring instructions and README contain the boundary and migration guidance; existing config/specs remain unchanged by update.
- [x] 1.3 Pin the development validator and adapt regression fixtures
  Files: package.json, package-lock.json, test/artifact-mutation-evals.test.js, test/fixtures/mutations/README.md, test/smoke.test.js, test/artifact-budget.test.js, test/tier1-delta-heading-check.test.js, test/archive-from-terminal.test.js, new file: test/spec-preflight.test.js
  Do: pin the installed OpenSpec baseline, allow only the additional preview invocation in mutation evals, adapt test stubs to JSON, and add real CLI/failure regression coverage without changing frozen fixture content.
  Done-when: tests exercise the real local validator and accept the additional narrow launcher call while rejecting other invocations.
- [x] 1.4 Verify implementation and compatibility
  Files: test/spec-preflight.test.js, openspec/changes/fix-main-spec-preflight/tasks.md
  Do: run the repository tests serially, the preflight suite against OpenSpec 1.14.1, strict change validation, and the kit Tier 1 gate; record results without migrating main specs or publishing.
  Done-when: checks pass and results are recorded in the change validation notes.
