# Apply notes

- Виконуйте затверджені tasks.md за порядком і в межах їхніх Files/Do/Done-when.
- Не додавайте детермінований lint якості Done-when і не змінюйте вивід `gate-check --tasks`.
- Не змінюйте читачі verdict, гейти apply/archive, формат Tier 1 чи поведінку при `review_fast_fix: off`.
- Fast-fix: лише прийнятий Tier 2 RC, 1–2 локальні таски, явна згода користувача; Tier 1 непридатний.
- Повторне review зберігає повний Tier 2 checklist; додатковий same-class scan його не замінює.
- `Task verdicts` пише reviewer, але `--review-md` не вимагає секцію; `Fix During Apply` необов'язкова, але непорожня.
- Збережіть generated mirror blocks orchestration; нові YAML rules залишайте рядками.
- Оновіть наявні повні object expectations парсера для нового поля `reviewFastFix`.
- Не чіпайте споживацькі проєкти та `package.json`; bump, tag і публікація 0.24.0 належать користувачу.
- Виконайте цільові `node --test` з кожного таску; фінально: `npm test` і `npm pack --dry-run`.
