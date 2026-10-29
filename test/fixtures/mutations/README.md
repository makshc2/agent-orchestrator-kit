# Mutation eval corpus

Frozen fixture projects for `test/artifact-mutation-evals.test.js`. Each case
copies one fixture into a fresh temp directory, applies exactly one defect and
runs `gate-check --review <change> --json` with the locally installed OpenSpec
validator.

## Eval profile

Both fixtures pin the same profile in `.agents/orchestrator.yaml`:

```yaml
pipeline:
  task_contract: strict
  artifact_budget: off
```

Results describe the `strict` task-contract profile with `artifact_budget: off`,
not the default `warn` configuration.

## Fixtures

- `synthetic/` — minimal OpenSpec project with change `synthetic-change`,
  capability `sample-capability`, one MODIFIED requirement
  (`Sample modified requirement`) and one ADDED requirement
  (`Sample added requirement`), plus the stub `src/sample.txt`.
- `real-tier1/` — adapted snapshot of a real archived change (provenance below).

## Provenance of real-tier1

- Source commit: `046e5f3e6955493b3857b3487bd344c16582c67f`
- Source archive path: `openspec/changes/archive/2026-10-02-tier1-delta-heading-check/`
- Copied unchanged into `real-tier1/openspec/changes/tier1-delta-heading-check/`
  (via `git show <commit>:<path>` once, when the fixture was prepared):
  - `proposal.md`
  - `design.md`
  - `tasks.md`
  - `specs/tiered-review/spec.md`
  - `specs/lean-archive/spec.md`
- Main specs in `real-tier1/openspec/specs/`, taken from the same commit:
  - `tiered-review/spec.md` — byte-for-byte copy of `openspec/specs/tiered-review/spec.md`.
  - `lean-archive/spec.md` — copy of `openspec/specs/lean-archive/spec.md` with the
    whole `### Requirement: Sync застосовує RENAMED Requirements` block removed.

### Adaptations

- The change folder is named `tier1-delta-heading-check` (no date prefix).
- The `Sync застосовує RENAMED Requirements` block is removed from the
  `lean-archive` main spec: after the archive it was already merged into main
  and would conflict with the change's ADDED requirement.
- Empty, never executed stub files for every existing `Files:` path of the
  copied `tasks.md`: `bin/agent-orchestrator.js`,
  `templates/.agents/commands/opsx-review.md`,
  `templates/.agents/subagents/spec-reviewer.md`,
  `test/tier1-delta-heading-check.test.js`.
- Two added configs: `.agents/orchestrator.yaml` (strict, `artifact_budget: off`)
  and `openspec/config.yaml` (`schema: spec-driven`).
- `review.md`, `handoff.md` and `metrics.json` of the archived change are not copied.

This is a reconstructed compatible baseline, not the exact historical state
before review.

## Runtime isolation

The eval runtime reads only these frozen fixtures. It does not read the
archive, the live main specs of this repository or git history.

## Updating the corpus

Change fixtures only deliberately and together with this README (provenance
and adaptations). A fixture change must keep both baselines clean: validate
exit 0 and gate `pass: true`, `errors: []`.

## Running the eval

```sh
node --test test/artifact-mutation-evals.test.js   # targeted run, prints the report
npm test                                           # the same corpus via the test/*.test.js glob
```

The validator is the local `node_modules/@fission-ai/openspec` installed from
the lockfile (`npm ci`); a missing package is a setup failure. The run uses no
network, telemetry (`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`) or LLM.

The report is a Markdown table (`ID | Profile | Fixture | Defect class |
Expectation | Result | Reason`) followed by `caught / total`, the missed
known gaps with their reason and the newly caught IDs. Baselines are checked
first and are not rows of the table. If any case is invalid, or setup or a
baseline fails, the report says `incomplete` with the reason and prints no
ratio.

## Limits of the ratio

`caught / total` is the detection rate on this corpus only, in the `strict`
profile (`task_contract: strict`, `artifact_budget: off`). It is not a rate
over all possible defects and does not describe the default `warn`
configuration.

## Adding a case

1. Pick a new stable ID (next `S` number for `synthetic/`, `R` for
   `real-tier1/`); never reuse or renumber an ID.
2. Choose the fixture; if it must change, update it together with this README
   and keep both baselines clean.
3. Set the defect class, `expectation` (`must-catch` or `known-gap`) and a
   `reason`.
4. Write a mutator that hits its target exactly once, changes exactly one file
   and fails as invalid setup otherwise.
5. Write `required`/`allowed` matchers that name the target diagnostic (never
   "any error"), and an `oracle` (`pass`, or the expected validate issue).

Never weaken an `expectation` (for example `must-catch` to `known-gap`) to hide
a regression.
