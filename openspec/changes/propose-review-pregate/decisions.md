# Decisions — propose-review-pregate

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-09-25 Pre-gate Tier 1 на propose: після звіту `spec-architect` conductor запускає `gate-check --review <name>`; exit ≠ 0 → один re-spawn з повним списком помилок; далі ≠ 0 → `## Blocked` і next command `/opsx:propose <name>`; діє для першого propose, re-propose і structure-only re-propose.
- 2026-09-25 Рядок `**Gate:**` у звіті architect лише інформаційний — рішення за власним запуском conductor-а; Prompt у **Output** і Session Exit пропонують `/opsx:review` лише після exit 0.
- 2026-09-25 Self-check `gate-check --review` в `spec-architect.md` лише для spawn з `/opsx:propose`; під `/opsx:quick` — `**Gate:** not run (/opsx:quick)`; spawn без згадки quick вважається propose; заголовки `## Non-goals` / `## Acceptance criteria` обов'язкові для всіх spawn.
- 2026-09-25 Scope ширший за бриф: `openspec-guide.md` для «є proposal.md, немає review.md» радить `/opsx:review` лише при `gate-check --review` exit 0, інакше `/opsx:propose` (інакше guide суперечить Blocked-виходу); також `openspec-howto/SKILL.md` і README Role 2 **Exit gate:**.
- 2026-09-25 `pipeline-subagents` отримує 3 MODIFIED: дозволені дії parent після звіту (+pre-gate, +re-spawn); речення «спека task-contract не змінюється» обмежене обсягом своєї вимоги; маршрутизація guide з якорями за змістом замість номерів рядків.
- 2026-09-25 `templates/openspec-config.yaml.example` англійською, кожне правило в подвійних лапках: у OpenSpec 1.4.1 неекранований `: ` робить пункт map і відкидає весь список rules артефакту, ` #` мовчки обрізає правило.
- 2026-09-25 `init --force --profile node|generic` тепер перезаписує наявний `openspec/config.yaml` template-ом (як для vue3/mvp) — README і CHANGELOG про це попереджають; `update` і `init` без `--force` config не чіпають.
- 2026-09-25 Follow-up поза scope: правила в `profiles/vue3` і `profiles/mvp/openspec-config.yaml.example` неекрановані, тож OpenSpec їх не завантажує — окремий change.
- 2026-09-25 Пункти 1–2 розділу «Проблема» брифу conductor реконструював з cadence-data-worklog `my-work-pf-absences` (review.md, decisions.md): вставлений бриф починався з пункту 3.
- 2026-09-25 Spec review cycle 1 verdict is APPROVE: no Blocker, no Major, 20 non-blocking Minor. The next command is `/opsx:apply propose-review-pregate`, and `apply-notes.md` is the distilled implementer input. The implementer must not edit `review.md`.
- 2026-09-25 The Minor findings do not block apply. The ones worth a short optional re-propose or a follow-up:
- 2026-09-25 F6: the tiered-review Blocked scenario GIVEN needs «review.md absent or RC».
- 2026-09-25 C1: `Status: blocked` from `spec-architect` needs its own branch in the pre-gate, with no gate re-spawn.
- 2026-09-25 C2: the gate-error re-spawn in a Tier 2 re-propose is structure-only.
- 2026-09-25 F1: narrow the `/opsx:quick` Non-goal wording.
- 2026-09-25 F27: an unquoted YAML item with more than one `: ` makes the whole config unparseable.
- 2026-09-25 For the implementer, "replace" in tasks 1.1/1.2/1.7 means the old text must be gone, but the Done-when checks only test presence. Grep for leftovers as `apply-notes.md` lists, and run 1.1 before 1.2 because the 1.2 Done-when diffs against the finished command.
- 2026-09-25 The `npm test` baseline at HEAD 44a20e5 is 213/213, and 217/217 after apply. The Done-when of task 3.2 already holds before apply, so it is a regression gate. Check the non-goal guard with `git status --porcelain -- <paths>`, not `git diff --quiet`, which misses untracked files. This corrects the architect handoff claim that every Done-when fails before apply.
- 2026-09-25 Follow-up, outside this change: the guide maps any RC `review.md` to `/opsx:propose`. That is pre-existing and wrong for a stale RC after a rejected Tier 2 file or a finished re-propose (F5).
- 2026-09-25 Correction to the vue3/mvp follow-up: OpenSpec drops only the rule lists that contain unquoted `: ` items (vue3 proposal/tasks/specs; mvp proposal/tasks). vue3 `design` and mvp `specs` load today (F28).
