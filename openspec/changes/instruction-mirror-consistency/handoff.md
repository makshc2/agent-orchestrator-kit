# Session Handoff

## Closed role
Implementer

## Change
- name: instruction-mirror-consistency
- status: applying
- tasks: 12/12
- review: APPROVE
- last_role: Implementer

## Done
Parent-driven apply of `instruction-mirror-consistency`, tasks 1.1–4.3 in order, all 12 `[x]`. New `bin/instruction-mirrors.js` (MIRRORS, MIRROR_TARGET, extractMirrorSource, syncInstructionMirrors); `templates/.agents/skills/agent-orchestration/SKILL.md` now carries three generated blocks (`session-start`, `session-exit`, `routing`) produced only by `syncInstructionMirrors('templates')` (first run changed all three, second run `"changed":[]`), and the Mandatory Memory paragraphs collapsed into the one prescribed paragraph. `bin/agent-orchestrator.js`: `applyInstructionMirrors` runs before each of the 3 `generateAmpSubagentSkills` calls (init/update/sync); a fresh `init` has 0 drift. Tests: new `test/instruction-mirrors.test.js` (4 tests) and `test/instruction-text-consistency.test.js` (5 tests); exactly the five named assertions edited in `fix-next-session-prompt.test.js` (3) and `archive-from-terminal.test.js` (2 merged into 1). Templates: spec-architect owns the artifact build loop; opsx-propose and openspec-propose SKILL point to it (steps 3–5 and Artifact Creation Guidelines removed, Verify renumbered to 3); design-intake owns `Capture details:` (ladder/assets/brief template/confidence copied from opsx-design, `### N.` titles rendered as bold labels), opsx-design keeps steps 1–3; opsx-quick time-box removed; code-reviewer is on request + diff-gated + reads apply-notes.md; skill/README model hints use Amp low/high/ultra, review = strong, `1–3 tasks` and `All tasks in one apply session` removed; README documents the generated blocks. Verification: `npm test` 488/488 pass; `node --test test/smoke.test.js` 170/170 incl. `always-apply rules stay within a context budget`; `npx openspec validate instruction-mirror-consistency --strict --type change` valid; `node bin/agent-orchestrator.js gate-check --tasks` and `--review` exit 0. `git status --short` lists no `.mdc` and nothing under `openspec/specs/`. Build/lint: the kit has no separate build/lint script; `npm test` is the gate and is green. Nothing committed.

## Decisions
- instruction-mirror-consistency apply: `Capture details:` renders the former `### 3.`–`### 6.` titles as bold inline labels — heading style was free per apply-notes; bold labels avoid a second-level heading inside a subagent body.

## Blocked
none

## Next command
`npx agent-orchestrator-kit archive instruction-mirror-consistency --sync`

## Next role
none

## Attach
- `openspec/changes/instruction-mirror-consistency/tasks.md`
- `openspec/changes/instruction-mirror-consistency/apply-notes.md`

## Subagents to spawn
none

## Constraints
- language: en
- do not mix phases
- archive only after the PR is merged, from a terminal

## Runtime
- runtime: local
- agent_id: none

## Prompt

```text
npx agent-orchestrator-kit archive instruction-mirror-consistency --sync
```
