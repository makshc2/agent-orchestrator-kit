## Context

Fresh specialist contexts do not reliably auto-trigger tech skills. The code-writer prompt currently delegates skill discovery through configuration notes; the test-writer prompt has no tech-skill read prerequisite. `templates/.agents/subagents/` is the source of truth. Repository inspection found no profile subagent overrides or tracked prebuilt writer wrappers.

## Goals / Non-Goals

Goals: explicit file reads before authoring, conditional stack guidance, missing-file resilience, and auditable reports propagated through existing generators.

Non-goals: runtime enforcement, new skill content, routing changes, release or consumer rollout.

## Decisions

1. Replace code-writer prerequisite 1 with the user's mandatory Read-tool instruction. Check `.agents/orchestrator.yaml` → `project.stack`, read JavaScript and Vue core for every Vue 3 task, and list scoped Pinia, Axios, Router, composables, and Vite paths. Read uncertain matches and use `references/*.md` for deeper topics. Skill rules override model defaults. Explicit paths remove the current indirect discovery dependency.
2. Prepend mandatory loading to test-writer step 4, preserving its AAA guidance. For Vue 3, name Vue testing and JavaScript core. Both writers select equivalent installed skills for other stacks and record unavailable skill files as missing while continuing; this is explicit in both prompts so generic/node projects cannot become blocked by Vue prerequisites.
3. Add the exact report field `**Skills:** tech skills read (paths) or missing` immediately after `Status:` in both contracts. Do not change other contract fields.
4. Keep regeneration on the existing path. Run `syncInstructionMirrors('templates')` using the existing CLI helper, then run local CLI init, update, sync, and `scripts/sync-local-agent-skills.sh` in temporary consumer projects for generic, mvp, node, and vue3. Verify generated `.agents/skills/subagent-*`, `.claude/agents/`, and `.cursor/agents/` against the writer sources. Do not introduce untracked generated files into shipped templates or hand-edit mirrors. Existing instruction-mirror blocks should remain unchanged because their source rules are unchanged.
5. Use a manual regression record for this prompt-only bug. An automated test cannot reproduce a model's decision to omit Read calls from fresh context, and a new test that merely repeats the replacement text would not prove that behavior. Before editing, record the missing direct reads and audit field in both source prompts; afterward verify those prerequisites and report fields, exercise real generation, and run the existing full test suite. Any behavioral claim about future model sessions remains limited to the stronger prompt contract.

## Risks / Trade-offs

- Prompt compliance is not runtime enforcement → explicit mandatory language and the Skills audit expose omissions for future session review.
- Consumers may omit tech-skill files → report missing paths and continue, including in the test writer.
- Generated files can drift → regenerate with the kit and compare outputs across every profile.

## Migration Plan

After kit merge/release, run `npx agent-orchestrator-kit update` in the 12 managed consumers, then `sh scripts/sync-local-agent-skills.sh` in each. That external rollout is deferred until the kit is merged. Rollback consists of reverting the template edit and rerunning the same update/sync commands.

## Open Questions

None.
