# Apply Notes — propose-review-pregate

- Paste every block verbatim: P1–P6, A1–A4, S2, G1, Y, R1, C, T1, T2. Strip exactly the 2-space list indent. G1 keeps its own 3-space indent and `- `.
- "Replace" means the old text must be gone, and Done-when does not check this. After 1.1 and 1.2, grep for 0 matches of `Verify the report and show final status`, `All artifacts created and validated!` and the old unconditional `- Prompt: "Run \`/opsx:review <name>\` in a fresh session."` line. In the command, also check for `First line of the pasted prompt is \`/opsx:review <name>\`.`
- Run 1.1 before 1.2, because the 1.2 Done-when diffs the skill against the finished command. The skill takes P1 with "paths" (not "files") and gets no P5.
- Placement: keep the blank line before `**Output**` in both propose files. A4 goes inside the report-contract fence, after `**Risks:**`. The 1.4 gate-check line goes inside the ```bash block, and the checklist item keeps `- [ ] `. The README line goes inside the Role 2 **Exit gate:** ```bash block.
- Do NOT touch: `bin/`, `package.json`, `profiles/`, `opsx-review.md`, `spec-reviewer.md`, `opsx-quick.md`, the `Spec review discovery loops: ≤ 2 (...)` line, spec-architect step 5 and `**Source:** gate-check`, guide step 5, or the guide's RC→propose and APPROVE→apply bullets.
- Config template: double-quote every item under `rules:`. An unquoted item with more than one `: ` makes the whole config unparseable, not just that list.
- CHANGELOG: edit `[Unreleased]` only. No version header and no `package.json` bump.
- The architect `**Gate:**` line is informational only. The conductor's own `gate-check --review` run decides the handoff.
- Verify:
  - `npm test` → baseline + 4 tests, all passing (213 → 217 at HEAD 44a20e5);
  - `npx openspec validate --all --strict`;
  - `npx agent-orchestrator-kit gate-check --review propose-review-pregate`;
  - `git status --porcelain -- package.json bin/ profiles/ templates/.agents/commands/opsx-review.md templates/.agents/subagents/spec-reviewer.md templates/.agents/commands/opsx-quick.md` prints nothing (`git diff --quiet` misses untracked files).
