# Decisions — spec-verify-conformance-report

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-10-30 Промпт містить два рядки понад дослівні блоки: обмеження висновків наданими файлами (сценарій «Limited context is not evidence of absence») і рядок Coordinates (null-правила та заборона номерів diff/промпту, сценарій «Blank lines preserve coordinates»). Без backticks, `$` і `\`.
- 2026-10-30 Тест «non-object response» не додано: кандидат за контрактом завжди починається з `{`, тож `raw_decode` дає лише dict; перевірка `isinstance(dict)` лишилась як захисна.
- 2026-10-30 Відома межа контракту екстракції (не виправлялась, поза scope): якщо pretty JSON має префікс на рядку з `{` або загорнутий у `[`, першим кандидатом стає вкладений object, що починає рядок (наприклад finding), і він зберігається як verdict; без `pass` CI трактує його як PASS. Кандидат на окремий change.
- 2026-10-30 `bash -n a b c` перевіряє лише перший файл; у validation.md записано і цю команду, і перевірку кожного скрипта окремо.
