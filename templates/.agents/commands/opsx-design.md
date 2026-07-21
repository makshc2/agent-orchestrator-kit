---
name: /opsx-design
id: opsx-design
category: Workflow
description: Capture design from any source into a durable design brief for an OpenSpec change
---

Capture design into a durable brief for an OpenSpec change. One-shot intake from Figma, exports, screenshots, or photos — then apply never needs live design tools.

**IMPORTANT: You must NEVER edit any file in `src/` or any source code. You may write only `openspec/changes/<name>/design-brief.md` and files under `openspec/changes/<name>/assets/`.**

**Input**: Optionally specify a change name (e.g., `/opsx:design add-login-form`). If omitted, auto-select if one active change exists, otherwise list and ask. If the change does not exist yet, create the change directory when writing the brief (after explore chose the name).

---

## Steps

### 1. Select the change

If name provided — use it. Otherwise:
- Run `npx openspec list --json` to list active changes.
- Auto-select if only one exists.
- Ask the user if ambiguous.

Announce: "Design intake for change: **<name>**"

### 2. Choose source (fallback ladder)

Use the first available source; do not climb the ladder twice:

1. **Figma MCP** — one pass only (`get_design_context` / screenshot / metadata). Capture everything needed immediately; never call Figma again during later apply. If MCP fails, check `npx agent-orchestrator-kit figma-status`. If the token is missing, tell the user to run `figma-setup` and edit `.agents/figma.local.env` locally — **never ask them to paste the token into chat**. Optional REST dump: `npx agent-orchestrator-kit figma-fetch --url "<figma-url>" --out openspec/changes/<name>/assets/figma-nodes.json`.
2. **Exported images** — PNG/SVG already in the repo or attached by the user.
3. **Screenshots** — UI captures (desktop/mobile).
4. **Photos** — physical mockups or whiteboard photos.

Ask the user for the source if unclear. Prefer Figma when a `figma.com` URL is given.

### 3. Capture into assets/

Save reference images under `openspec/changes/<name>/assets/`:
- Prefer compressed PNG; ~1–2 images per breakpoint
- Do not commit raw video, PSD, or huge originals
- Name files clearly: `desktop.png`, `mobile.png`, `hero-detail.png`

### 4. Write design-brief.md

Create or overwrite `openspec/changes/<name>/design-brief.md` using this template:

```markdown
# Design Brief

**Change:** <name>
**Captured:** <ISO date>

## Source

- Type: Figma | export | screenshot | photo
- URL / path: <figma URL or file path>
- File key / node ids: <if Figma>
- Capture date: <ISO date>
- Notes: <auth, branch, frame names>

## Structure

- Layout hierarchy (sections, regions, key components)
- Responsive breakpoints if known
- Navigation / interaction notes relevant to implementation

## Tokens

- Colors: <hex or token names>
- Typography: <families, sizes, weights>
- Spacing: <scale or measured gaps>
- Radii / shadows / borders: <as observed>

## Reference images

- `assets/<file>` — <what it shows>

## Constraints

- Must match: <hard constraints from design>
- Out of scope / approximate OK: <soft areas>
- Non-UI change? If this change has no UI, put `Design: none` in `proposal.md` instead of this brief.

## Confidence notes

- Measured / from Figma: <list>
- Inferred (screenshot/photo): mark each inferred value with a confidence marker, e.g. `~8px (medium confidence)` or `color ≈ #1a1a1a (low confidence)`
```

### 5. Confidence markers for raster sources

When the source is a **screenshot** or **photo** (not Figma MCP / vector export):
- Do not present guessed spacing, colors, or type sizes as facts
- Mark every inferred token/value with a confidence note in **Confidence notes** and inline in **Tokens** where useful
- Prefer ranges or approximations over fake precision

### 6. Handoff

Output a short summary:

```
## Design Intake Complete

**Change:** <name>
**Brief:** openspec/changes/<name>/design-brief.md
**Assets:** N file(s) under assets/

### Next
- Continue with `/opsx:propose <name>` if artifacts are missing
- Or `/opsx:apply <name>` — Implementer must use the brief, not live Figma MCP
```

For non-UI changes: do not invent a brief. Tell the Architect to add a line `Design: none` in `proposal.md` so `gate-check` can opt out when `require_design_brief: true`.

---

## Guardrails

- **Never** edit source code or `src/`
- **Never** edit `tasks.md`, `review.md`, or other OpenSpec artifacts except creating the change folder if needed for the brief
- **May write only** `openspec/changes/<name>/design-brief.md` and `openspec/changes/<name>/assets/*`
- **Never** rely on a second Figma MCP pass later — store everything in the brief now
- **Never** tell apply sessions to open live Figma; point them at the brief + assets
- Keep `assets/` small (compressed PNG, few files)
- Ask for clarification only if the source is missing or unreadable
