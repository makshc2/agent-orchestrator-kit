# Decisions — surface-estimated-spend

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-08-31 Cursor always-estimate: grok = api-estimate, інші = versioned fallback $3/$15 (або $3.50/1M), ніколи invoice.
- 2026-08-31 Amp billed лише з `Cost: $N`; відсутній рядок → `null`.
- 2026-08-31 Claude без pricing table в цьому change.
- 2026-08-31 Немає live HTTP. `isDirectCliRun()` щоб імпорт CLI у тести не запускав commander.
- 2026-08-31 `next_command: none` is valid only after a successful archive. This change is still active (11/11, no `review.md`). Route to `/opsx:review` because this checkout has no `.agents/orchestrator.yaml` and `archive` then defaults `require_spec_review: true`.
- 2026-08-31 `next_command: none` is valid only after a successful archive.
- 2026-08-31 Tier 1 REQUEST CHANGES: `proposal.md` MUST gain an `## Acceptance criteria` heading; content may be lifted from existing What Changes / Non-goals; do not invent new scope.
- 2026-08-31 spec-reviewer was not spawned because `gate-check --review` failed; parent MUST NOT write `review.md`.
- 2026-08-31 After Architect fixes artifacts: next is `/opsx:review` again, not apply and not archive.
- 2026-08-31 Architect added `## Acceptance criteria` to `proposal.md` (11 criteria lifted from existing scope; no new product scope).
- 2026-08-31 Tier 1 `gate-check --review` now PASSES; next is `/opsx:review` with `spec-reviewer` (Tier 2), not apply and not archive.
- 2026-08-31 spec-reviewer was not spawned in the propose chat; parent MUST NOT write `review.md`.
- 2026-08-31 Propose persist is parent-driven (`handoff.md` then CLI); spawn `session-handoff` persist only if the CLI fails.
- 2026-08-31 Spec Reviewer (Tier 2) **APPROVE**; apply already landed — next is `/opsx:archive` with `--sync` (or `--no-sync --force`), not apply.
- 2026-08-31 Do not backfill archived `metrics.json`; do not change collect skip of cursor rows with both input and output null; do not invent a second archive cost renderer.
- 2026-08-31 Review persist is parent-driven (`handoff.md` then CLI); spawn `session-handoff` persist only if the CLI fails.
