# Decisions — fix-metrics-session-attribution

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-08-31 Ім’я change: `fix-metrics-session-attribution`. Scope = бойові P0+P1 з VMS `align-unavailable-cameras-admin-ui` (не Amp-timestamp, не бекфіл архівів).
- 2026-08-31 Persist-вікно = `[pending.startedAt, endedAt]`; steal-сценарій «пізня подія в наступну сесію» інвертовано.
- 2026-08-31 Leftover-кінець = `pending.startedAt` якщо є, інакше `endedAt+120s`; resync totals з усіх sources, якщо немає числового override.
- 2026-08-31 Archive: pending-старт → leftover попередньої → Archiver `[pending, now]` з `durationMs`; sessionEnd читає найсвіжіший archive metrics.json.
- 2026-08-31 `session.model` / карти з adapter product id, коли sources є; family `--model` не пишеться в `spendByModel` поруч із hook id.
- 2026-08-31 Placeholder `unknown` + `spend_source: self-report` не freeze totals.
- 2026-08-31 Cursor filter за `conversationId` / `pending.threadId`; канонічна роль; `phaseForRole` architect перед review.
- 2026-08-31 review-verdict-request-changes: Tier 2 returned REQUEST CHANGES. Change goes back to Architect. MUST NOT enter apply until the three blocking findings are fixed and a new review records APPROVE.
- 2026-08-31 leftoverEnd-never-now: persist leftoverEnd = `pending.startedAt` else `endedAt+120s`; never `now`. `metrics --collect` stays `[last.startedAt, now]` + `source.id` dedup; leftover is a separate helper.
- 2026-08-31 collect-flag-archiver-window: MODIFY exact title `Прапорець `--collect` вмикає локальні адаптери` so Archiver `--collect` uses `[pending.startedAt, now]` (not `[last session.endedAt, now]`).
- 2026-08-31 spend-source-title-exact: MODIFY header is the exact main title `Джерело spend — прапорці, потім самозвіт, потім опційні адаптери`; «числовий» / placeholder-not-override lives in the body only.
- 2026-08-31 review-verdict-approve: Tier 2 returned APPROVE. Apply is allowed. Implement from `tasks.md` + `apply-notes.md`; do not treat uncommitted spend-collect WIP as this change.
- 2026-08-31 apply-implemented-attribution: leftover helper is separate from `metrics --collect`; persist leftoverEnd = `pending.startedAt` (exclusive) else `endedAt+120s` (inclusive), never `now`; Archiver collect `[pending.startedAt, now]` with numeric `durationMs`; `sessionEnd` leftover reads newest `openspec/changes/archive/*-<name>/metrics.json`.
- 2026-08-31 apply-tests-docs: steal tests inverted (late hook stays on previous persist / Implementer, not next persist / Archiver); Session Exit docs no longer treat `unknown` self-report as primary spend; `--model` is product id; README/CHANGELOG Unreleased document leftover, product id, and conversationId.
- 2026-08-31 archive-blocked-until-merge: do not archive until local tests pass, a PR is merged, and CI is green; archive remains `npx agent-orchestrator-kit archive fix-metrics-session-attribution --sync` (no `spec-archiver` unless that CLI fails).
