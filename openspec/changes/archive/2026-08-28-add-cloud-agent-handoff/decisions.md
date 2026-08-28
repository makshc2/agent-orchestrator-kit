# Decisions — add-cloud-agent-handoff

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-08-27 cloud-check-verdict: `handoff <name> --cloud-check` при `runtime: cloud` падає non-zero, при `runtime: local` — warning з exit 0; закриває open question роадмапу (cloud-warning нічого не гарантує — VM зникає разом з артефактами, а local-сесія легітимно комітить пізніше)
- 2026-08-27 runtime-detection: детермінований пріоритет `--runtime` → env `AOK_RUNTIME` → константа CLOUD_ENV_MARKERS → наявна секція Runtime → `local`; магічна автодетекція (TTY, CURSOR_AGENT) відкинута через false positives
- 2026-08-27 cloud-check-not-in-persist: перевірка — окрема гілка після commit/push, не частина persist (persist сам щойно переписав handoff.md — робоче дерево завжди брудне в цю мить); persist при cloud лише друкує кроки commit → push → cloud-check у stderr
- 2026-08-28 review-verdict-approve: Tier 2 spec-review дав APPROVE без блокуючих findings; 6 нот — non-blocking, зафіксовані в review.md, дві з них перенесені в apply-notes.md як пастки реалізації (stdout у `log.ok/warn/err`; `HANDOFF_SECTIONS` без читача — рендер робить лише правка `buildHandoffMarkdown`)
- 2026-08-28 proposal-detection-chain-drift-accepted: у proposal.md ланцюжок детекції наведений без кроку «наявна секція Runtime», який є в design.md D1, decisions.md, дельта-спеці й таску 1.2 — визнано документаційним дрейфом, не блокером: три джерела, що ведуть реалізацію, узгоджені між собою
- 2026-08-28 stdout-trap-honored: persist cloud block uses `console.error`; `log.ok/warn/err` stay on stdout and were not used for that block
- 2026-08-28 archive-runtime-from-targetDir: after `renameSync`, prior `## Runtime` is read from the archive target path, not `openspec/changes/<name>/`
