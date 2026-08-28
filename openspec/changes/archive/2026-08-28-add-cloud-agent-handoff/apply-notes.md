# Apply Notes — add-cloud-agent-handoff

- Detection chain is fixed: `--runtime` → `AOK_RUNTIME` → `CLOUD_ENV_MARKERS` (start: `['CURSOR_BACKGROUND_AGENT']`) → existing `## Runtime` in `handoff.md` → `local`. No TTY/`CURSOR_AGENT` autodetection. `--runtime` accepts only `local|cloud`; anything else exits non-zero.
- `--cloud-check` is a separate branch of `handoff`, never part of persist — persist has just rewritten `handoff.md`, so the tree is always dirty at that point. Order: persist → commit → push → cloud-check.
- Verdict is differentiated: `cloud` + any failure = non-zero; `local` + same failure = warning + exit 0; clean = exit 0. Never run `git commit`/`git push` from the CLI.
- Pitfall: `log.ok/warn/err` print to **stdout**. The persist cloud block must use `console.error`; stdout must stay the pure prompt starting with `/opsx:` (task 2.2 Done-when asserts this).
- `HANDOFF_SECTIONS` has no reader — adding `'Runtime'` there changes nothing on its own; the rendering edit in `buildHandoffMarkdown` is what produces the section. Do both, as task 1.1 states.
- Do NOT extend `missingHandoffFields`: legacy `handoff.md` without `## Runtime` must persist with exit 0 and get the section appended.
- `buildHandoffMarkdown` has two callers (persist ~line 2734, archive ~line 2427). Give the section a safe default so the archive literal never renders `undefined`.
- In `archive`, the change dir is already moved by `renameSync` before the final handoff is built — read any previous runtime from the archive target dir, not from `openspec/changes/<name>/`.
- Section order in `handoff.md`: … Constraints, **Runtime**, Prompt.
- Cross-IDE parity comes from templates only: edit the three files in task 3.1. Do not hand-edit `.cursor/`, `.claude/`, Amp `subagent-*` wrappers, or the repo-root `.agents/rules/` dogfood copy.
- Out of bounds: new pipeline roles or subagents, cloud-VM APIs, Phase 4 items (control plane, sandbox, dashboard, audit log), blocking gates for local sessions.
- Tests: reuse the tmp-git-repo helper in `test/smoke.test.js` (~line 573); emulate upstream with a local bare remote for the pushed/unpushed cases.
- Verify: `npm test`; `npx openspec validate add-cloud-agent-handoff --strict`; `npx agent-orchestrator-kit gate-check --tasks add-cloud-agent-handoff`.
