# Session Handoff

## Closed role
Implementer

## Change
- name: apply-test-run-discipline

## Done
Apply session 4: groups 6, 7 and 3 finished; 20/20 tasks ticked after each Done-when check held.

6.1 — BLOCK-E BULLET inserted byte for byte after the `Mark the task complete` bullet in `templates/.agents/commands/opsx-apply.md` and the apply `SKILL.md`, BLOCK-E QUICK appended to step 5 of `opsx-quick.md`. `grep -c 'checkpoint <name> --task <id>'` = 1/1/0, `grep -c checkpoint` on quick = 1, the `## Decisions` phrase = 1 in each apply twin, the bullet line diffs empty between the twins, and `grep -ci checkpoint` = 0 for `templates/AGENTS.md` and the five always-on rules.
6.2 — README: a `checkpoint [change-name]` block with the six options before the `handoff` block in `## CLI Reference`, a RECOVERY BRIEFING sentence appended to the `--restore` option text, and a new `### Checkpoint and recovery briefing` section after `### Change decisions`. Both greps = 1, `RECOVERY BRIEFING` = 2, `git diff --stat -- CHANGELOG.md package.json` empty.
7.1 — new `test/session-checkpoint.test.js`, 22/22. Mutations confirmed: writing the target directly instead of renaming fails `rename failure keeps the last good file`; calling `appendDecisionsFromHandoff` from `checkpoint` fails `checkpoint never writes decisions.md`. Both files restored (`diff -q` clean).
7.2 — new `test/restore-recovery-briefing.test.js`, 30/30. Mutation confirmed: reporting `current` whenever a checkpoint exists fails `checkpoint after the edit does not bless the review`; `bin/recovery-sources.js` restored. `test/restore-unpersisted-warning.test.js` still 5/5.
7.3 — new `test/checkpoint-guidance.test.js`, 3/3; removing the bullet from the apply `SKILL.md` makes it fail; file restored.
3.1 — new `test/apply-test-run-discipline.test.js`, 6/6; deleting the `6.5.` heading from `opsx-apply.md` makes it fail; file restored.
3.3 — `npx openspec validate apply-test-run-discipline --strict --type change`, `npx openspec validate --all --strict` (21 passed, 0 failed), `gate-check --tasks` and `gate-check --review` all exit 0; the `--review` output has no `artifact budget` line (only pre-existing INFO length notes on main specs outside this change).

One code fix inside this change's own Part B file: `bin/session-recovery.js` matched task `Files:` entries against paths already normalized by `oneLine`, so a changed path containing a tab could never match. Matching now uses the raw `git.changed` paths and `oneLine` is applied only when rendering. This was found by the 7.2 test `untracked directories, unusual names and renames` and is confined to `bin/session-recovery.js` (task 5.2's file); 5.2's invariant still holds (`grep -c '^import '` = 0).

Note on the same 7.2 test: the `Files:` parser strips `"` and `'` from each entry, so a filename containing a quote cannot be expressed in a task contract. The odd-name fixture therefore uses a path with a tab and a backslash, listed as a quoted entry, which exercises the same unwrapping without relying on an unrepresentable name.

tests: 469/469 (full suite `node --test --test-concurrency=1 test/*.test.js`, exit 0; measured first: 12 CPU, 14 GB available, load 1.27, so no narrowing was needed). The always-apply rule size test, the `templates/AGENTS.md` size test, `test/fix-next-session-prompt.test.js`, the `opsx-archive.md` size test, the green-apply sentence test and the literal archive-line count test in `test/archive-from-terminal.test.js` all pass, and `test/restore-unpersisted-warning.test.js` passes unchanged. Build/lint: no build step in this kit.

## Decisions
- 2026-11-03 apply-test-run-discipline: the recovery briefing matches task `Files:` entries against raw git paths and normalizes with `oneLine` only when rendering, so paths containing a tab are still matched.

## Blocked
none

## Next command
`npx agent-orchestrator-kit archive apply-test-run-discipline --sync`

## Next role
none

## Attach
- `openspec/changes/apply-test-run-discipline/tasks.md`
- `openspec/changes/apply-test-run-discipline/apply-notes.md`
- `openspec/changes/apply-test-run-discipline/review.md`
- `test/session-checkpoint.test.js`
- `test/restore-recovery-briefing.test.js`
- `test/checkpoint-guidance.test.js`
- `test/apply-test-run-discipline.test.js`

## Subagents to spawn


## Constraints
- language: en
- Existing fix-main-spec-preflight deletions, archive additions and related main-spec changes predate this change and are outside it.
- Token and spend totals are unavailable and must remain unknown.

## Runtime
- runtime: local
- agent_id: none

## Metrics
- platform: unknown
- model: unknown
- input_tokens: unknown
- output_tokens: unknown
- cost_usd: unknown
- amp_credits: unknown
- spend_source: unknown

## Prompt

```text
npx agent-orchestrator-kit archive apply-test-run-discipline --sync
```
