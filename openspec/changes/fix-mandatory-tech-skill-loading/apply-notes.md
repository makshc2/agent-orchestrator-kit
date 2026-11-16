# Apply notes

- Record the pre-fix source and generated-output baseline before editing either writer.
- Edit only the two writer template prompts for product behavior; preserve all other instructions and AAA guidance.
- Use the user's explicit Vue skill paths and scopes; Vue prerequisites apply only to stack: vue3.
- Both writers must select equivalent skills for other stacks and report missing skill files in Skills while continuing.
- Put `**Skills:** tech skills read (paths) or missing` immediately after Status in both report contracts.
- No profile subagent overrides or tracked prebuilt writer wrappers currently exist.
- Regenerate template mirror blocks through `syncInstructionMirrors` as demonstrated by `test/instruction-mirrors.test.js`.
- Exercise local CLI init, update, sync --target all, and the shell sync script in temporary generic, mvp, node, and vue3 consumers.
- Compare both Claude/Cursor native agents and Amp wrappers with the source content; never hand-edit generated files.
- Run `npm test`, `npx --no-install openspec validate fix-mandatory-tech-skill-loading --strict --type change`, and `node bin/agent-orchestrator.js gate-check --tasks fix-mandatory-tech-skill-loading`.
- Verify mandatory instructions and audit-field placement, and search for the obsolete indirect instruction without adding that literal to new artifacts.
- Record commands and results in verification.md; package.json has no lint script.
- Do not add string-mirroring tests, runtime enforcement, release changes, or consumer rollout; prompt compliance remains a documented limitation.
