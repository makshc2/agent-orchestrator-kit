---
name: /opsx-propose
id: opsx-propose
category: Workflow
description: Propose a new change - create it and generate all artifacts in one step
---

## Session Start (Before Any Work)

Honor the pasted command and announce the Architect role. Run `npx agent-orchestrator-kit status` or `npx openspec list --json`, then read Memory `Change:<name>`, `Handoff:<name>`, and `Decision:*`. If Memory is unavailable or empty, read `openspec/changes/<name>/handoff.md`; this fallback is not a blocker. For free-form “continue” / “next” with one active change, execute its `Handoff.next_command` instead of asking for the phase. Only then continue and spawn specialists.

Propose a new change - create the change and generate all artifacts in one step.

I'll create a change with artifacts:
- proposal.md (what & why)
- design.md (how)
- tasks.md (implementation steps)

When ready to implement, run /opsx:apply

---

**Input**: The argument after `/opsx:propose` is the change name (kebab-case), OR a description of what the user wants to build.

**Conductor delegation is mandatory:** spawn `spec-architect` with the resolved name, decision brief, design brief if present, and artifact instructions. The parent MUST NOT create or edit proposal/design/specs/tasks; after the structured report it may only verify files, run status, and run strict validation.

**Steps**

1. **If no input provided, ask what they want to build**

   Use the **AskUserQuestion tool** (open-ended, no preset options) to ask:
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Spawn the specialist**

   Spawn `spec-architect` with a self-contained prompt and require `## Subagent report: spec-architect`. Delegate steps 3–5 to it; do not perform artifact creation in the parent session.

3. **Create the change directory**
   ```bash
   npx openspec new change "<name>"
   ```
   This creates a scaffolded change in the planning home resolved by the CLI with `.openspec.yaml`.

4. **Get the artifact build order**
   ```bash
   npx openspec status --change "<name>" --json
   ```
   Parse the JSON to get:
   - `applyRequires`: array of artifact IDs needed before implementation (e.g., `["tasks"]`)
   - `artifacts`: list of all artifacts with their status and dependencies
   - `planningHome`, `changeRoot`, `artifactPaths`, and `actionContext`: path and scope context. Use these instead of assuming repo-local paths.

5. **Create artifacts in sequence until apply-ready**

   Use the **TodoWrite tool** to track progress through the artifacts.

   Loop through artifacts in dependency order (artifacts with no pending dependencies first):

   a. **For each artifact that is `ready` (dependencies satisfied)**:
      - Get instructions:
        ```bash
        npx openspec instructions <artifact-id> --change "<name>" --json
        ```
      - The instructions JSON includes:
        - `context`: Project background (constraints for you - do NOT include in output)
        - `rules`: Artifact-specific rules (constraints for you - do NOT include in output)
        - `template`: The structure to use for your output file
        - `instruction`: Schema-specific guidance for this artifact type
        - `resolvedOutputPath`: Resolved path or pattern to write the artifact
        - `dependencies`: Completed artifacts to read for context
      - Read any completed dependency files for context
      - Create the artifact file using `template` as the structure and write it to `resolvedOutputPath`
      - Apply `context` and `rules` as constraints - but do NOT copy them into the file
      - Show brief progress: "Created <artifact-id>"

   b. **Continue until all `applyRequires` artifacts are complete**
      - After creating each artifact, re-run `npx openspec status --change "<name>" --json`
      - Check if every artifact ID in `applyRequires` has `status: "done"` in the artifacts array
      - Stop when all `applyRequires` artifacts are done

   c. **If an artifact requires user input** (unclear context):
      - Use **AskUserQuestion tool** to clarify
      - Then continue with creation

6. **Verify the report and show final status**

   The conductor verifies `Status: done` and each reported artifact path, then runs:
   ```bash
   npx openspec status --change "<name>"
   ```

**Output**

After completing all artifacts, summarize:
- Change name and location
- List of artifacts created with brief descriptions
- What's ready: "All artifacts created and validated! Ready for spec review."
- Prompt: "Run `/opsx:review <name>` in a fresh session."

## Session Exit (Mandatory Order)

After strict validation passes: (1) attempt to update Memory `Change:<name>`, `Handoff:<name>`, and new `Decision:*`; (2) write `openspec/changes/<name>/handoff.md` using the orchestration skill template even if Memory fails; (3) print one fenced prompt beginning `/opsx:review <name>`. Use `project.agent_language`, tell the next session to read Memory and the file fallback, omit banner labels and the full summary. Do not start review in this chat.

**Artifact Creation Guidelines**

- Follow the `instruction` field from `openspec instructions` for each artifact type
- The schema defines what each artifact should contain - follow it
- Read dependency artifacts for context before creating new ones
- Use `template` as the structure for your output file - fill in its sections
- **IMPORTANT**: `context` and `rules` are constraints for YOU, not content for the file
  - Do NOT copy `<context>`, `<rules>`, `<project_context>` blocks into the artifact
  - These guide what you write, but should never appear in the output

**Guardrails**
- Create ALL artifacts needed for implementation (as defined by schema's `apply.requires`)
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user - but prefer making reasonable decisions to keep momentum
- If a change with that name already exists, ask if user wants to continue it or create a new one
- Verify each artifact file exists after writing before proceeding to next
