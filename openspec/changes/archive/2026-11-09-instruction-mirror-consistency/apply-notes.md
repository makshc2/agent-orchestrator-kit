# Apply notes — instruction-mirror-consistency

- Apply is parent-driven; follow tasks 1.1-4.3 in order. Reviewed by literal scratch apply: 479 -> 488 tests, all green.
- Do NOT edit any `.mdc` (Cursor always-on 11,792 of 12,000), `openspec/specs/**`, `subagents/session-handoff.md`, `spec-archiver.md`, `opsx-review.md`.
- Generate block bodies only with `syncInstructionMirrors('templates')` (task 1.2); never hand-write text between `aok:mirror` markers. Second run must report `"changed":[]`.
- Task 1.2(d): keep the two sentences outside the blocks verbatim (git-tracked paths; Closed role MAY have a sentence after `—`); test 4.2(5) pins them.
- Task 1.4 edits exactly five existing assertions (3 in `fix-next-session-prompt.test.js`, 1 merged in `archive-from-terminal.test.js` replacing two). Weakening any other test is forbidden; restore the template string instead.
- Task 2.2: keep the Thin conductor paragraph, Tier 1 pre-gate text, task contract and `Required Before Apply` byte-identical in `opsx-propose.md` and `openspec-propose/SKILL.md`.
- Task 2.3: copy the ladder/template text from `opsx-design.md` BEFORE deleting it; heading style inside `Capture details:` is free.
- Task 3.2: `code-reviewer.md` description must contain `Use on request or before a PR/MR` and `Do NOT use for`, and no `ALWAYS use`.
- Task 4.1: `Sessions: 4–8` stays in the skill; after edits `grep -nE 'rush|smart|deep' README.md` and the skill print nothing.
- Pitfall: `npx agent-orchestrator-kit` at the kit root runs the published package; use `node bin/agent-orchestrator.js` for gate-check.
- Verify: `npm test` (488 expected), `node --test test/smoke.test.js` (budget test), `npx openspec validate instruction-mirror-consistency --strict --type change`, `node bin/agent-orchestrator.js gate-check --tasks instruction-mirror-consistency`.
- Verify: `git status --short` lists no `.mdc` and nothing under `openspec/specs/`; tick boxes 1.1-4.2 only after the checks pass.
