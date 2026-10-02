# Decisions — lean-conductor-protocol

<!-- append-only; пише npx agent-orchestrator-kit handoff <name> з handoff.md ## Decisions -->

- 2026-10-02 lean-conductor-protocol-bucket-scope: `checkReviewMd` looks for the Blocker/Major/Minor buckets inside the body of the Findings section, not anywhere in the file, and matches bucket lines case-insensitively like headings; task 2.1 gives the line regex without a scope or flags, the delta spec says «Findings з відрами» and D5 asks for tolerance.
- 2026-10-02 lean-conductor-protocol-literal-headings: a heading is any line that matches `^#{1,6}` as task 2.1 defines it, with no fenced-code awareness, so a column-0 `# comment` line inside a code fence ends a section and can give a false "section is empty" or "no bucket" rejection; known limitation, candidate for a follow-up change.
