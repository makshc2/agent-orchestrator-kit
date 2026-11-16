## Why

Consumer evidence across 72 sessions and 223 subagent spawns shows that implementation agents never read the Vue tech skills. Their fresh context contains an indirect stack hint instead of explicit file-reading instructions, while test writers have no tech-skill loading step.

## What Changes

- Require code writers to read applicable tech-skill files before coding, with explicit Vue 3 paths and scopes.
- Require test writers to read Vue testing and JavaScript skills before writing tests.
- Keep other stacks supported through equivalent installed skills and nonblocking missing-file reporting.
- Add a `Skills:` audit field immediately after `Status:` in both report contracts.
- Exercise existing generation and synchronization for all four profiles without hand-editing mirrors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-subagents`: explicit prerequisite tech-skill reads and auditable reports for code and test writers.

## Impact

The source changes are limited to `templates/.agents/subagents/code-writer.md` and `test-writer.md`. Profiles currently have no subagent overrides, and no prebuilt writer wrappers are tracked. Existing sync generates IDE agents and Amp skill wrappers from those sources. No runtime code or dependencies change.

## Non-goals

- Implementing a runtime tool-call enforcement mechanism or adding skills to consumers.
- Changing specialist routing, test strategy, or unrelated prompt content.
- Publishing, merging, or updating the 12 managed consumers before the kit is merged.

## Acceptance criteria

- Both writer prompts mandate Read-tool access to the relevant tech skills before authoring work; Vue 3 is conditional on `project.stack`.
- Code writer lists JavaScript, Vue core, Pinia, Axios, Router, composables, and Vite with their scopes; test writer lists Vue testing and JavaScript.
- Equivalent skills serve non-Vue stacks; unavailable files are reported as missing without blocking either writer.
- Both contracts place `**Skills:** tech skills read (paths) or missing` immediately after `Status:`.
- Existing generators propagate the instructions and audit fields to native agents and Amp wrappers for generic, mvp, node, and vue3, and the obsolete indirect instruction has no remaining repository matches outside dependencies.
- `npm test`, strict change validation, and applicable review/task gates pass. There is no package lint script.
