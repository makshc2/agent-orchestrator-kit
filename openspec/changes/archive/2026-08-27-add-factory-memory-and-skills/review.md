# Spec Review — add-factory-memory-and-skills

Tier 2 (LLM) review. Tier 1 (`gate-check --review`) passed before this session; strict validation, contract-field presence, proposal sections and delta-spec section structure are not re-checked here.

Scope of this review: proposal ↔ design ↔ tasks consistency, conflicts with `openspec/specs/`, scope creep against Non-goals, task self-sufficiency, and existence of every repository path and identifier referenced by `tasks.md`.

Verdict: APPROVE

## Findings

### Medium

**M1. Task 2.3 Done-when is not reproducible in this repository.**
`bin/agent-orchestrator.js` is checked in the kit repo, but the kit repo has no `.agents/skills/` and no `.agents/subagents/` — `.agents/` contains only `rules/` (`memory-mcp-autosetup.mdc`, `session-handoff.mdc`). `.cursor/skills/openspec-howto/` is also already absent (only five of the eight skills are synced locally). Consequently `status` run in this repo will report every kit skill as `missing`, never `stale`, and the step "after deleting `.cursor/skills/openspec-howto/` the skill line shows stale" cannot be observed here. The behaviour itself is unambiguously specified in the task's `Do` block and in the delta spec, and task 3.1(е) covers the same states in the smoke suite, which uses temporary `init`-ed projects (`mkdtempSync` + `runInit`, the pattern task 2.2 already names explicitly). Non-blocking: verify task 2.3 in a temporary `init`-ed project rather than in the kit repo. Carried into `apply-notes.md`.

**M2. The anti-drift test pins only `templates/orchestrator.yaml`, while `skills.kit` is duplicated in five files.**
`resolveTemplate()` returns `profiles/<profile>/orchestrator.yaml` whenever it exists and only falls back to `templates/orchestrator.yaml`, so the four profile files are full replacements, not overlays. Task 2.1 therefore writes the identical eight-item `kit:` list into five files, but task 3.1(д) and the delta-spec sentence ("`skills.kit` у `templates/orchestrator.yaml` MUST збігатися з переліком директорій `templates/.agents/skills/`") pin only the template. A future kit skill added to `templates/.agents/skills/` will silently drift the four profile files, and health expectations for `generic`/`vue3`/`node`/`mvp` projects will be wrong. Non-blocking (the requirement is satisfied as written, and the surface is warn-only), but extending the same test over all five files is cheap and stays inside task 3.1's stated intent. Carried into `apply-notes.md`.

### Low

**L1. Byte comparison may permanently mark external stack skills as `stale`.**
`stale` is defined as a byte difference between `.agents/skills/<name>/SKILL.md` and the `.cursor/` / `.claude/` copies. Kit skills are always produced by `sync`, so byte equality holds. Stack skills, however, are installed by `frontend-agent-skills`, and `profiles/vue3/README.md` documents `install --agent all`, which writes the IDE directories itself. If that installer emits any per-agent variation (frontmatter in particular), stack skills would report `stale` permanently even in a healthy project. `design.md ## Risks` does not list this case. Warn-only, so nothing breaks; worth a sentence of expectation-setting in the README subsection of task 3.2.

**L2. Health expectations go stale after `update`.**
`.agents/orchestrator.yaml` is deliberately outside `KIT_MANAGED_PATHS` (`update` preserves the project overlay), so `skills.kit` in a consumer project is a snapshot taken at `init`. After an `update` that adds or removes a kit skill, health over- or under-reports until the consumer edits the file by hand. D6 accepts this implicitly ("конфіг не керує update") and the Migration Plan says manual editing is optional — the consequence is simply not stated anywhere a consumer would read it. Documenting it in task 3.2 closes the gap.

**L3. `external` is a scalar, and `parseMcpInventory` has no scalar precedent.**
Task 2.2 says "скаляр external" and points at `parseMcpInventory` for style, but that function parses list items only. Quote stripping for `external: ""` and `external: frontend-agent-skills` is left to the implementer. Task 3.1(г) exercises the parser on a full section, so the omission is self-correcting.

**L4. The install hint is not copy-pasteable as specified.**
D7 and task 2.3 print `npx <external> install`, whereas the form documented in `profiles/vue3/README.md` and `profiles/mvp/README.md` is `npx frontend-agent-skills install --agent all --yes`. Emitting the documented form makes the hint directly usable without changing any requirement.

**L5. `handoff.md` reports the wrong task count.**
`tasks.md` contains nine checkboxes (1.1–1.4, 2.1–2.3, 3.1–3.2); the `## Done` section of `handoff.md` says "7 tasks in 3 groups" while the embedded prompt correctly says `tasks: 0/9`. `handoff.md` is not an OpenSpec schema artifact and the next persist recomputes the count, so no action is required — recorded only so the count is not mistaken for a missing task group.

### Informational (pre-existing, out of scope)

**I1.** `templates/orchestrator.yaml` sets `handoff.spawn_handoff_subagent: false`, while the main `session-handoff` requirement "Orchestrator yaml handoff flags" demands all five handoff flags be `true`. This drift predates the change and is unrelated to it. It MUST NOT be fixed during apply — it belongs to its own change.

## Verified

**Paths and identifiers in `tasks.md` all exist.** `bin/agent-orchestrator.js`; `templates/orchestrator.yaml`; all four `profiles/{generic,vue3,node,mvp}/orchestrator.yaml`; all four protocol templates of task 1.4 (`templates/.agents/rules/session-handoff.mdc`, `templates/.agents/rules/memory-mcp-autosetup.mdc`, `templates/.agents/skills/agent-orchestration/SKILL.md`, `templates/.agents/subagents/session-handoff.md`), each already containing the Decisions / `Decision:<topic>` text the task extends; `test/smoke.test.js` (single test file, runner `node --test test/*.test.js`); `README.md`; `CHANGELOG.md`. The only new file is `openspec/changes/<name>/decisions.md`, created by the CLI at runtime — correctly not presented as an existing path.

**Code identifiers match reality.** `KIT_SKILL_DIRS` (line 15) and `KIT_MANAGED_PATHS` (line 26, derived from it and consumed by `update` at line 1859); `parseDecisionItems` (1003, strips `-`/`*` bullets and filters `none`); `persistMemoryFromHandoff` (1010) derives the topic as the text before the first colon truncated to 80 characters — task 1.2's "як зараз" is literally accurate; `parseMcpInventory` (570) and its `readMcpInventory` fallback (598) are a usable template for `parseSkillsInventory`/`readSkillsInventory`, including the "break on the next top-level key" guard; `printMcpHealth` (606) is called last in the `status` action (1970–1999), so appending `printSkillHealth` after it is a one-line insertion; `generateAmpSubagentSkills` (1676) builds the wrapper body inline and can be split into a shared builder as task 2.3 requires; the `--restore` branch (2471) prints handoff fields plus a Memory-entity count, matching task 1.3's instruction to keep that count as diagnostics.

**Inventory lists are accurate at proposal time.** `templates/.agents/skills/` contains exactly the eight directories enumerated in D5 and task 2.1, with no `subagent-*` entries (wrappers are generated into consumer projects only), so the fallback enumeration and the drift test are consistent. `templates/` is listed in package.json `files`, so enumeration also works when the kit is installed as a dependency. `notes:` lines carrying skill lists exist exactly where task 2.1 says (`profiles/vue3/orchestrator.yaml:39`, `profiles/node/orchestrator.yaml:39`); the `mvp` notes are quick-mode text, correctly excluded.

**Two scenarios are satisfiable with zero new code, as claimed.** `runTier1Review` (1268) has no artifact whitelist and `openspec validate --strict --type change` already tolerates `handoff.md` in the change folder, so "Відсутність decisions.md не блокує гейти" holds. `archive` moves the whole change directory (`lean-archive`: "change переміщується в `openspec/changes/archive/YYYY-MM-DD-<name>`"), so "Archive переносить історію рішень безкоштовно" holds.

**Capability split follows established precedent.** The Phase 1 analogue — "MCP-health видимий у status" — lives in the `optional-mcp-setup` capability rather than in `orchestrator-cli-controls`, whose `status` requirement fixes no closed output contract. Putting skill health in a new `skill-inventory` capability is the same partition, and it does not conflict with the `sync` cleanup requirement in `orchestrator-cli-controls`.

**The MODIFIED requirement loses nothing.** Compared with `openspec/specs/session-handoff/spec.md` line 93, the delta preserves every obligation (validate `handoff.md`, upsert `.cursor/memory.json` by absolute path, print the expanded prompt in `project.agent_language`, restore briefing from file and Memory JSON, `memory-setup` on `scripts/memory-mcp-launcher.cjs`) and both original scenarios verbatim, adding only the append step, the file→Memory mirror direction, and the restore source for decisions. No conflict with the other `session-handoff` requirements: restore/persist ordering, the handoff template section list, and the Memory entity schema are all untouched, and the ADDED requirement mirrors the existing "not an OpenSpec schema artifact" treatment of `handoff.md`.

**IDE parity holds.** `.agents/` stays the single source; health compares the Cursor and Claude copies and validates the Amp `subagent-*` wrappers byte-for-byte, which is the only Amp-visible surface since Amp reads `.agents/` natively. `sync` already excludes wrappers from `.cursor/`/`.claude/`, so they cannot produce false `stale` results in the per-skill loop. Nothing in the change is Cursor-only, satisfying the roadmap parity requirement.

**No scope creep.** Nothing in the artifacts touches Phase 3 (no `runtime` field, no cloud-workspace discipline) or Phase 4 (no dashboard, sandbox, audit, Control Plane, external runtime); no new pipeline role; no project-wide `docs/decisions/` or ADR framework; no migration of existing `Decision:*`; no auto-install (both D7 and the delta spec state `MUST NOT` for installation); no new blocking gate, and the delta explicitly forbids `gate-check`/pre-commit from inspecting `decisions.md`. `.gitignore` keeps `.cursor/` and `.cursor/memory.json`, while `openspec/changes/` is not ignored, so `decisions.md` is genuinely git-tracked and memory.json genuinely stays out of git.

**Tasks are self-sufficient.** Every task carries `Files`/`Do`/`Done-when` with the concrete formats an implementer needs — the exact header and HTML comment of `decisions.md`, the `- <YYYY-MM-DD> <текст>` line shape, the dedup normalization rule and the date-prefix strip, the topic derivation, the full fallback contents, and the three health state definitions. `design.md` is not required to execute any of them; D1–D7 only restate rationale. Task ordering is executable as written: 1.1 creates the file before 1.2 reads it, and 2.2 lands the parser before 2.3 consumes it.
