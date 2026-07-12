# Spec Review

**Change:** add-design-intake
**Date:** 2026-07-12
**Verdict:** APPROVE

## Checklist summary

- Proposal: ✓
- Design: ✓
- Tasks: ✓
- Delta specs: ✓

## Notes

1. Open question з design.md вирішено: рядок `brief: yes/no` у `status` показується **завжди** (дешево, корисно, і delta-спека вже сформульована саме так — вимога "Видимість brief у status" безумовна).
2. Імплементаційна нота для 3.4: поточний `gate-check` робить ранній `return` при `require_spec_review: false` (bin/agent-orchestrator.js, ~673–676). Brief-гейт мусить виконуватись незалежно від review-гейта (design.md, Risks: "обидва гейти незалежні") — профіль `mvp` має `require_spec_review: false`, тож ранній return треба реструктурувати. Рекомендовано додати в 5.2 smoke-сценарій комбінації `require_spec_review: false` + `require_design_brief: true`.
3. Формулювання "після review-гейта" в задачі 3.4 читати як "у тій самій команді, окремим незалежним блоком", а не "лише якщо review-гейт виконався".
