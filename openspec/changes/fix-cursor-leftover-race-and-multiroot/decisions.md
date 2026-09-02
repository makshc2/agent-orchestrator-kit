# Decisions — fix-cursor-leftover-race-and-multiroot

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-09-02 leftover одразу після append hook, не ширше вікно 120s і не повторний persist
- 2026-09-02 sessionEnd лишається ідемпотентним; collect експортує entry, stdin лише під `require.main === module`
- 2026-09-02 leftover sessionEnd фільтрує `last.threadId`; `threadId: null` — time-only
- 2026-09-02 один ranking resolveBaseDir; collect leftover по кожному кандидату з `openspec/changes`
- 2026-09-02 roundUsd4 після сум, не всередині addNullable
- 2026-09-02 live-order тест окремо від чинного +5s (jsonl спочатку)
- 2026-09-02 D8: `phases.<phase>.startedAt`/`endedAt`/`leadTimeMs` з сесій фази; `durationMs` = work time і не клонує `totals.leadTimeMs` (YouTrack 19:00–19:20 / 20 хв 1 с на всіх рядках)
- 2026-09-02 5.1 is a live-order regression guard; race fix is hook leftover after append, not a wider collect window
- 2026-09-02 existing +5s leftover fixture stays time-only unless the jsonl row has matching conversationId
- 2026-09-02 phase startedAt/endedAt/leadTimeMs use epoch ms (earlierTimestamp/laterTimestamp), not string ISO compare
- 2026-09-02 merge phases.*.startedAt/endedAt/leadTimeMs into main-spec schema list at archive
