# Apply notes — add-agent-hook-runtime

- The v1 contract (design.md §2) is frozen for `add-agent-workflow-automation`. Do not rename exports, store levels or `ctx` fields.
- Store levels: hierarchy worktree→session→agent, and `change` is orthogonal. The session namespace never includes `changeId`, so binding never moves it.
- Default `ctx` store: agent level when session and agent ids are both present, session level when only the session id is present, quarantine (keyed by event id, with a diagnostic) when the session id is null. It never falls back to the shared worktree namespace.
- `storeFor('worktree')` is one shared namespace for every event in the worktree, null-session events included, and never quarantines. `storeFor('change')` works only when a change is bound. `storeFor('session'|'agent')` with a missing id quarantines with a diagnostic.
- If a null-session event cannot resolve a change through an explicit binding, treat `changeId` as null. Never infer it by recency or from the worktree.
- `hooks enable --client cursor` must not call `ensureCursorSpendHook` (change-metrics spec). Use dedicated owned-entry merge code.
- Capability/version status lives in `<git-dir>/aok-hooks/v1`. Only `.agents/hooks/ownership.json` is git-tracked.
- Hooks never call `handoff --restore`, bare `checkpoint`, or metrics functions. checkpoint.json, handoff.md, decisions.md, tasks.md and metrics.json stay byte-identical.
- The parent-delivery block in `opsx-apply.md` and `openspec-apply-change/SKILL.md` must be byte-identical. Add no hook text to `opsx-quick.md`.
- `session-handoff.mdc` must never contain the literal word `checkpoint`. Keep its canonical restore/persist wording verbatim (accepted risk, design.md:122).
- Do not hand-edit generated mirrors or wrappers. Use `syncInstructionMirrors('templates')` and the existing init/update/sync.
- Test 1.1 against a fake store, then wire in the real store from 1.2.
- Verify: `node --test test/hooks-*.test.js`, `npm test`, `npm pack --dry-run`, `npx --no-install openspec validate --all --strict`.
