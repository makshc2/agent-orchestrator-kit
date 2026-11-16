## 1. Reproduce and repair writer prompts

- [x] 1.1 Record the manual regression baseline before editing
  Files: templates/.agents/subagents/code-writer.md, templates/.agents/subagents/test-writer.md, new file: openspec/changes/fix-mandatory-tech-skill-loading/verification.md
  Do: Inspect both source prompts for explicit mandatory tech-skill Read prerequisites and the Skills report field. Initialize a temporary generic consumer with the local CLI, run sync --target all, and inspect its two source agents, two Amp wrappers, two Claude agents, and two Cursor agents. Record that both mandatory instructions and audit fields are absent before the fix. Record that all four profiles have no subagent overrides. Do not add a text-mirroring automated test: the model's omitted Read calls are not deterministically reproducible by the kit test harness.
  Done-when: verification.md records the pre-fix missing-prerequisite and missing-audit observations for source and generated prompts; task 3.1 will record their presence after the fix.

- [x] 1.2 Require explicit tech-skill reads and auditable reports in both writers
  Files: templates/.agents/subagents/code-writer.md, templates/.agents/subagents/test-writer.md
  Do: Replace code-writer prerequisite 1 with "MANDATORY — load tech skills" and require Read before coding, skill rules over defaults, and project.stack first. For vue3 list .agents/skills/{javascript-core,vue-core}/SKILL.md for every task, vue-pinia for stores/usage, vue-axios for HTTP/interceptors, vue-router for routes/guards/params, vue-composables for composables, and vite for config/plugins/env/builds. Require uncertain matches to be read and name references/*.md for deeper topics. Prepend "MANDATORY — before writing tests" to test-writer step 4, requiring project.stack and Read of .agents/skills/{vue-testing,javascript-core}/SKILL.md for vue3 before existing AAA text, following skill rules over defaults. In both writers select equivalent installed skills for other stacks; explicitly report missing files in Skills and continue. Add the exact line "**Skills:** tech skills read (paths) or missing" immediately after Status in both report contracts. Preserve other instructions.
  Done-when: Both source files contain their mandatory instruction, explicit conditional Vue paths, equivalent-stack and missing-file fallback, and the Skills line immediately after Status; repository searches excluding dependencies find no obsolete indirect stack-discovery instruction.

## 2. Regenerate and verify distribution

- [x] 2.1 Exercise existing generation across all profiles
  Files: templates/.agents/subagents/code-writer.md, templates/.agents/subagents/test-writer.md, bin/agent-orchestrator.js, test/instruction-mirrors.test.js, new file: openspec/changes/fix-mandatory-tech-skill-loading/verification.md
  Do: Invoke the existing syncInstructionMirrors helper for templates using the precedent in test/instruction-mirrors.test.js. In isolated temporary consumers for generic, mvp, node, and vue3, run the local bin/agent-orchestrator.js init, update, and sync --target all followed by sh scripts/sync-local-agent-skills.sh. Compare the two generated native agents and Amp wrappers with the source prompts for mandatory loading and Skills audit content. Record commands/results in verification.md. Do not hand-edit generated output or add prebuilt wrappers to templates.
  Done-when: verification.md records successful generation for all four profiles, current template mirror blocks, and the mandatory instructions and audit fields in both Claude/Cursor agents and Amp wrappers for each profile.

## 3. Complete validation

- [x] 3.1 Validate the change and record final evidence
  Files: package.json, new file: openspec/changes/fix-mandatory-tech-skill-loading/verification.md
  Do: Run npm test, npx --no-install openspec validate fix-mandatory-tech-skill-loading --strict --type change, and node bin/agent-orchestrator.js gate-check --tasks fix-mandatory-tech-skill-loading. Search templates and profiles for the two mandatory phrases and the repository excluding dependencies for the obsolete indirect instruction. Record exit statuses, post-fix presence of read prerequisites and audit fields, and absence of a package lint script in verification.md. Keep consumer rollout deferred until kit merge.
  Done-when: Existing tests, strict validation, and task gate pass; source and generated output observations change from missing before the fix to present afterward; verification.md records searches with no remaining obsolete instruction and notes no lint script exists.
