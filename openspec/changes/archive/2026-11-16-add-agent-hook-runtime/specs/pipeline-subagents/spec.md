## ADDED Requirements

### Requirement: Parent apply instruction covers hook skill delivery states

The `/opsx:apply` command and `openspec-apply-change` skill SHALL carry one byte-identical parent skill-loading block covering: hooks disabled or identity unavailable (mandatory manual Read of resolved paths), hooks enabled (bind change/role/task/session, injected content only with a current same-context receipt), and platforms without context-capable events (manual Read fallback). `/opsx:quick` SHALL inherit it by referencing `/opsx:apply`.

#### Scenario: Twins carry identical parent guidance

- **WHEN** `opsx-apply.md` and `openspec-apply-change/SKILL.md` are compared
- **THEN** the parent skill-loading block is byte-identical in both and names the manual Read, bind-then-receipt, and unsupported-platform fallback states

#### Scenario: Hooks disabled or identity unavailable parent

- **WHEN** the parent starts apply with hooks disabled or without a session identifier
- **THEN** the instruction mandates manual Read of the resolved skill paths and never claims injection

#### Scenario: Hooks enabled parent binds before implementing

- **GIVEN** hooks are enabled and the native session identifier is known
- **WHEN** the parent reads the instruction
- **THEN** it binds change/role/task/session before implementing and accepts injected content only with a current same-context receipt

#### Scenario: Unsupported platform parent

- **GIVEN** hooks are enabled on a client whose current event cannot inject context
- **WHEN** the parent reads the instruction
- **THEN** it uses the manual Read fallback instead of waiting for a queued delivery

#### Scenario: Quick inherits the apply guidance

- **WHEN** `/opsx:quick` reaches its apply step
- **THEN** it follows `/opsx:apply` and applies the same parent skill-loading block without separate hook wording

## MODIFIED Requirements

### Requirement: Writers explicitly load stack tech skills before authoring

The code-writer and test-writer prompts MUST require reading `project.stack` from `.agents/orchestrator.yaml` and loading applicable tech-skill files with the Read tool before writing code or tests, unless their full current contents have a verified delivery receipt in that same agent/context epoch. The instructions MUST state that skill rules take precedence over model defaults.

#### Scenario: Vue 3 implementation task

- **WHEN** code-writer handles a task for `stack: vue3`
- **THEN** its prompt requires `.agents/skills/javascript-core/SKILL.md` and `.agents/skills/vue-core/SKILL.md` for every task
- **AND** it explicitly names `.agents/skills/vue-pinia/SKILL.md` for stores and store usage, `.agents/skills/vue-axios/SKILL.md` for HTTP modules and interceptors, `.agents/skills/vue-router/SKILL.md` for routes and guards, `.agents/skills/vue-composables/SKILL.md` for composables, and `.agents/skills/vite/SKILL.md` for Vite configuration, plugins, environment variables, and builds
- **AND** it requires reading uncertain scope matches and points to the skills' `references/*.md` for deeper topics

#### Scenario: Vue 3 test task

- **WHEN** test-writer handles tests for `stack: vue3`
- **THEN** step 4 requires reading `.agents/skills/vue-testing/SKILL.md` and `.agents/skills/javascript-core/SKILL.md` before the existing AAA test-writing instructions

#### Scenario: Verified context delivery avoids duplicate reads

- **GIVEN** the agent context contains a complete applicable skill and a receipt for its current digest and epoch
- **WHEN** the writer starts authoring
- **THEN** this loading obligation is satisfied without another identical Read call
- **AND** absent, stale, partial, queued, or unsupported delivery retains the mandatory Read fallback

### Requirement: Writer reports audit tech-skill reads

Code-writer and test-writer report contracts MUST include `**Skills:** read (paths), injected (paths), or missing (paths)` immediately after `Status:`. Existing generation MUST preserve the loading instructions and audit field in native IDE agents and Amp wrappers across all supported profiles.

#### Scenario: Report contract exposes loaded or missing paths

- **WHEN** either source writer prompt's report contract is read
- **THEN** its Skills field immediately follows Status and requests read paths, injected paths, or missing entries

#### Scenario: Profile generation preserves the writer contract

- **WHEN** the local kit initializes, updates, and synchronizes consumers for generic, mvp, node, and vue3
- **THEN** generated Claude and Cursor writer agents and Amp writer skill wrappers contain the source prompts' mandatory loading instructions and Skills field

#### Scenario: Audit does not infer compliance

- **WHEN** a hook submits full skill content with a current receipt
- **THEN** the writer reports injected rather than read and the receipt identifies submitted delivery when acknowledgment is unavailable
- **AND** incomplete reads, overflow, or unsupported delivery are disclosed as gaps, not fabricated read/injected entries
