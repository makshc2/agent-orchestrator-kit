# Verification

## Before the fix

- Both writer templates lacked an explicit mandatory tech-skill Read prerequisite and the `Skills:` report field.
- A temporary generic consumer was initialized using the local `bin/agent-orchestrator.js init --profile generic --name TechSkillBaseline --lang en --ci none`, then `sync --target all`.
- All eight inspected outputs lacked both requirements: `.agents/subagents/{code-writer,test-writer}.md`, `.agents/skills/subagent-{code-writer,test-writer}/SKILL.md`, `.cursor/agents/{code-writer,test-writer}.md`, and `.claude/agents/{code-writer,test-writer}.md`.
- Recursive inventory found zero profile subagent overrides in each of `generic`, `mvp`, `node`, and `vue3`. Git tracks only the two shared writer templates, with no prebuilt writer wrappers.
- This reproduces the missing prompt contract and its propagation. Actual model Read-tool compliance requires subsequent consumer-session auditing.

## After the fix

- Both templates now contain the requested mandatory loading instruction and the exact `Skills:` audit field immediately after `Status:`. Vue paths are conditional on `stack: vue3`; both writers describe equivalent skills and reporting missing files while continuing. Existing AAA guidance is preserved.
- `rg -n --hidden 'MANDATORY — (load tech skills|before writing tests)' templates profiles`: both source templates found, no profile overrides.
- Repository-wide search, including hidden files and excluding `.git` and `node_modules`, found zero instances of the obsolete indirect stack-discovery instruction (exit 1, expected for no matches).

## Generation

- Invoked `syncInstructionMirrors('templates')` from `bin/instruction-mirrors.js`: `{ changed: [], drift: [], skipped: [] }`. A subsequent check confirmed no drift. The shipped mirror blocks were already current.
- Used the local CLI by absolute path in fresh temporary consumers for each profile, with these commands:
  1. `node <kit>/bin/agent-orchestrator.js init --profile <profile> --name TechSkillVerification --lang en --ci none`
  2. `node <kit>/bin/agent-orchestrator.js update`
  3. `node <kit>/bin/agent-orchestrator.js sync --target all`
  4. `sh scripts/sync-local-agent-skills.sh`
- All commands exited 0 for `generic`, `mvp`, `node`, and `vue3`.
- After both CLI sync and shell sync, Node assertions checked byte equality of source agents and both native IDE copies with the templates, and inclusion of each entire template body in its Amp wrapper. All eight outputs per profile passed after each sync (64 output checks total).
- Profile configuration was byte-identical before/after update. External Vue tech skills were absent in these clean consumers and generation succeeded; this checks distribution, while the missing-skill behavior of an executing model is specified by the prompt.
- No generated output was hand-edited or added to the shipped templates. Temporary consumers were removed after verification.

## Final checks

- `npm test`: exit 0, 488 passed, 0 failed, 0 skipped (453 top-level tests; 64.44 seconds).
- `npx --no-install openspec validate fix-mandatory-tech-skill-loading --strict --type change`: exit 0.
- `node bin/agent-orchestrator.js gate-check --review fix-mandatory-tech-skill-loading`: exit 0 before independent semantic review. Existing main-spec length INFO notices were unrelated to this delta.
- Independent review: `Verdict: APPROVE`; `gate-check --review-md fix-mandatory-tech-skill-loading`: exit 0.
- `node bin/agent-orchestrator.js gate-check --tasks fix-mandatory-tech-skill-loading`: exit 0.
- `git diff --check`: exit 0.
- Final searches included hidden and ignored files, excluding `.git` and `node_modules`: zero obsolete indirect instructions in both templates/profiles and the full repository.
- `package.json` defines no lint or build script; neither is claimed as run. No new text-mirroring tests were added.
- Consumer rollout remains deferred until merge/release: run `npx agent-orchestrator-kit update`, then `sh scripts/sync-local-agent-skills.sh`, in each of the 12 managed projects.
