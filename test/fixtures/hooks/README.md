# Hook adapter fixtures

Inbound/outbound payloads the adapter tests replay. Each fixture records the
exact upstream schema source it was captured from. Versions listed here are the
only ones this kit claims; nothing here asserts parity for untested clients.

Captured 2026-11-16 against the official documentation:

| Client | Source | Version exercised |
| --- | --- | --- |
| Claude Code | https://code.claude.com/docs/en/hooks | shape-verified via `hook_event_name`; hook input carries no version field |
| Cursor | https://cursor.com/docs/hooks | 3.22.12 (`cursor --version` on the fixture machine); other versions downgrade to observation |
| Amp | https://ampcode.com/docs/plugin-api | PluginEventMap shape-verified; plugin events carry no version field |

Verified response surfaces used by the adapters (nothing else is serialized):

- Claude: `hookSpecificOutput.additionalContext` (SessionStart, SubagentStart,
  SubagentStop — context only, no decision control) and
  `hookSpecificOutput.permissionDecision` (PreToolUse).
- Cursor: `additional_context` (sessionStart, postToolUse), `permission`
  (preToolUse, subagentStart — subagentStart has permission output, not context
  injection), `followup_message` (stop, subagentStop). sessionStart/sessionEnd
  do not run in cloud agents.
- Amp: `message.content` (agent.start only; session.start is fire-and-forget),
  `reject-and-continue` (tool.call), `action: continue` (agent.end). Amp has no
  session.end or compaction events; agent.end is request completion.

Fields inside the fixtures were transcribed from the documented schemas;
`expected.kind`/`expected.output` capture what this kit's adapters derive from
them. Native payloads never leave the local machine.
