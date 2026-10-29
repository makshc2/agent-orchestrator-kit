# Apply notes — artifact-mutation-evals

- Allowed new paths only: `test/artifact-mutation-evals.test.js` and `test/fixtures/mutations/` (synthetic/, real-tier1/, README.md). Do NOT touch `bin`, `package.json`, `package-lock.json`, `templates`, `profiles`, `.github`, main specs, archive, other tests.
- Test is ESM `node:test`, built-in modules only; `npm test` globs `test/*.test.js` (fixtures under `test/fixtures/` are not picked up).
- Never run `init`, `archive`, handoff, metrics or any LLM inside the eval; never install packages; no global openspec; no success stub for validate.
- Task order: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 4.1; tasks 2.2-4.1 append to the file from 2.1 (the `new file:` prefix in Files is lint-only, do not overwrite).
- Real fixture comes from `git show 046e5f3e6955493b3857b3487bd344c16582c67f:<path>` once at prepare time; the runtime reads neither archive, live main specs nor git history. Remove the whole `Sync застосовує RENAMED Requirements` block from the fixture lean-archive main spec.
- Pinned names: `synthetic-change`, `sample-capability`, `neighbor-change`, `tier1-delta-heading-check`; timeout 60000 ms, maxBuffer 1048576; first synthetic task adds `New marker is present` (S10 premise).
- Launcher is CommonJS (`require`), accepts exactly six args (`openspec validate <name> --strict --type change`), exit 2 otherwise; the `--json` oracle calls the local bin directly.
- `caught` needs exit 1, `pass:false`, every required matcher and every error allowed; any stray error, signal, timeout or bad JSON is INVALID and fails. known-gap missed passes and stays visible; no matcher "any error".
- Incomplete run prints `incomplete` and no `caught / total` (regex `\d+ / \d+` must not match).
- Cleanup temp roots in `finally`: after the run `ls "$(node -p "os.tmpdir()")" | grep -c '^aok-mutation-eval-'` prints 0 (exit 1 of grep -c on zero is normal).
- Scope checks (must print nothing): `git status --porcelain -- bin package.json package-lock.json templates profiles .github`; and `git status --porcelain --untracked-files=all -- . ':(exclude)openspec/changes/artifact-mutation-evals' ':(exclude)docs' ':(exclude).idea' ':(exclude)test/artifact-mutation-evals.test.js' ':(exclude)test/fixtures/mutations'`.
- Verify: `node --test test/artifact-mutation-evals.test.js`, `npm test` (312 tests pass before the change), `npx openspec validate artifact-mutation-evals --strict --type change`.
- tasks.md is Ukrainian by repo convention; keep it. Do not edit proposal/design/specs during apply.
