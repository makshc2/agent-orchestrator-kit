## ADDED Requirements

### Requirement: Writers explicitly load stack tech skills before authoring

The code-writer and test-writer prompts MUST require reading `project.stack` from `.agents/orchestrator.yaml` and loading applicable tech-skill files with the Read tool before writing code or tests. The instructions MUST state that skill rules take precedence over model defaults.

#### Scenario: Vue 3 implementation task

- **WHEN** code-writer handles a task for `stack: vue3`
- **THEN** its prompt requires `.agents/skills/javascript-core/SKILL.md` and `.agents/skills/vue-core/SKILL.md` for every task
- **AND** it explicitly names `.agents/skills/vue-pinia/SKILL.md` for stores and store usage, `.agents/skills/vue-axios/SKILL.md` for HTTP modules and interceptors, `.agents/skills/vue-router/SKILL.md` for routes and guards, `.agents/skills/vue-composables/SKILL.md` for composables, and `.agents/skills/vite/SKILL.md` for Vite configuration, plugins, environment variables, and builds
- **AND** it requires reading uncertain scope matches and points to the skills' `references/*.md` for deeper topics

#### Scenario: Vue 3 test task

- **WHEN** test-writer handles tests for `stack: vue3`
- **THEN** step 4 requires reading `.agents/skills/vue-testing/SKILL.md` and `.agents/skills/javascript-core/SKILL.md` before the existing AAA test-writing instructions

### Requirement: Tech-skill loading supports other stacks and missing files

Both writer prompts MUST make the Vue skill list conditional on `stack: vue3`, select equivalent installed skills from `.agents/skills/` for other stacks, and instruct the writer to report unavailable skill files as missing and continue without blocking.

#### Scenario: Generic or Node consumer

- **WHEN** either writer runs in a generic or Node consumer
- **THEN** its prompt directs it to equivalent installed implementation or testing skills for that stack
- **AND** the Vue 3 list is not an unconditional dependency

#### Scenario: A skill file is unavailable

- **WHEN** a relevant skill file is missing for either writer
- **THEN** its prompt requires a missing entry in the Skills report and continued work

### Requirement: Writer reports audit tech-skill reads

Code-writer and test-writer report contracts MUST include `**Skills:** tech skills read (paths) or missing` immediately after `Status:`. Existing generation MUST preserve the loading instructions and audit field in native IDE agents and Amp wrappers across all supported profiles.

#### Scenario: Report contract exposes loaded or missing paths

- **WHEN** either source writer prompt's report contract is read
- **THEN** its Skills field immediately follows Status and requests read paths or missing entries

#### Scenario: Profile generation preserves the writer contract

- **WHEN** the local kit initializes, updates, and synchronizes consumers for generic, mvp, node, and vue3
- **THEN** generated Claude and Cursor writer agents and Amp writer skill wrappers contain the source prompts' mandatory loading instructions and Skills field
