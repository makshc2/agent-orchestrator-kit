# Apply notes — surface-estimated-spend

Apply is already landed (11/11). Do not re-implement, uncheck tasks, or edit `bin/`, tests, README, CHANGELOG, or main specs by hand. Next is `/opsx:archive` with `--sync` (or `--no-sync --force`). Missing `.agents/orchestrator.yaml` ⇒ `require_spec_review: true`.

Keep: grok table + cliff + `-fast`×2; Cursor `costUsd` always `null`; fallback `$3/$15` (or `$3.50/1M` total) + `api-estimate-fallback`; Amp `Cost: $N` or `null` (`costSource: "amp-usage"` only when Cost parsed); Claude `total_cost_usd` only; `isDirectCliRun()` so test imports do not start commander; billed vs estimate never summed into one field.

Do not: live HTTP / Amp billing API / Cursor SDK / new deps; credits→USD or Amp tokens→USD; Claude pricing table; Factory Control Plane / board; backfill archived `metrics.json`; treat this change’s live `metrics.json` as a schema fixture; change collect skip of cursor rows with both input and output null; change archive’s warn on `spend.costUsd === null`; invent a second archive cost renderer (metrics and archive share `formatMetricsCostLine`).

Verify (run tests only if the user explicitly asked): `npx openspec validate surface-estimated-spend --strict --type change`; after archive, `openspec/specs/change-metrics/spec.md` must contain `costUsdEstimated` and `api-estimate-fallback`.
