# Apply notes — add-factory-memory-and-skills

- Verify task 2.3 in a temporary `init`-ed project, not in the kit repo: this repo has no `.agents/skills/` or `.agents/subagents/`, so `status` here reports every kit skill `missing` and can never show `stale`. Reuse the `mkdtempSync` + `runInit` pattern from `test/smoke.test.js`.
- `resolveTemplate()` makes `profiles/*/orchestrator.yaml` full replacements of `templates/orchestrator.yaml`, so the `skills.kit` list is duplicated in five files. Prefer making the task 3.1(д) drift test iterate all five against `templates/.agents/skills/`.
- `templates/.agents/skills/` currently holds exactly the eight directories listed in task 2.1 and no `subagent-*` entries; keep the enumeration sorted and keep filtering the `subagent-` prefix defensively.
- `persistMemoryFromHandoff` already derives the topic as the text before the first colon truncated to 80 chars — reuse that logic when switching the source to `decisions.md`; do not change `Change:*` or `Handoff:*`.
- `printMcpHealth` is the last statement of the `status` action; append `printSkillHealth` after it and never touch `process.exitCode`.
- `sync` already excludes Amp `subagent-*` wrappers from `.cursor/`/`.claude/`; keep wrappers out of the per-skill loop and check them only against `.agents/skills/subagent-<n>/SKILL.md`.
- Emit the install hint in the form documented in `profiles/vue3/README.md` (`npx frontend-agent-skills install --agent all --yes`) so it is copy-pasteable; never run an install.
- Do NOT touch: `openspec/specs/` (archive syncs deltas), `.cursor/`, `.amp/`, `.gitignore` (memory.json must stay ignored), `gate-check`/pre-commit logic, `buildNextSessionPrompt`, or `templates/orchestrator.yaml`'s `handoff.spawn_handoff_subagent` (pre-existing drift, its own change).
- Do not migrate or delete existing `Decision:*` entities, and never write from Memory back into `decisions.md`.
- Note for README (task 3.2): `.agents/orchestrator.yaml` is outside `KIT_MANAGED_PATHS`, so `update` does not refresh `skills.kit` — consumers edit it by hand after a kit skill is added or removed.
- Verification: `npm test` (`node --test test/*.test.js`); `npx openspec validate add-factory-memory-and-skills --strict --type change`; `node bin/agent-orchestrator.js gate-check --tasks add-factory-memory-and-skills`; `rg KIT_SKILL_DIRS bin/` must return 0 matches.
