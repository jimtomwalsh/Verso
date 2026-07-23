# ADR 0002 — `doc.theme` is the versioned, agent-facing design-spec contract

Status: accepted (2026-07-15)

<!-- SCHEMA_VERSION: 1 -->
<!-- The line above is machine-checked by tests/run.js against
     window.THEME_SCHEMA_VERSION (src/theme.js). Bump BOTH together. -->

## Context

The theme is now **per-course**, living on `doc.theme` (was editor-global localStorage).
It is one **versioned, documented object** with three consumers:

1. **The author** edits it (Settings -> Theme).
2. **`render(doc, theme)`** applies it (and the SCORM export bakes the same output).
3. **The agent** generates against it — the north star of #77: `doc.theme` is a
   machine-readable design system the agent reads to produce on-spec work (custom
   blocks, whole sections, a course built from an imported schema). #96 (Magic Block)
   and #49 (agent mode) CONSUME this substrate; a future Claude-DS import maps INTO it.

This ADR **locks the shape** so those downstream builds hit a stable target. It records
what slices #124 (per-course home + migration), #125 (full-token editing), #126 (presets),
and #127 (blockStyles cascade) actually produced. No behaviour change — documentation only.

Code is truth: the shapes below are defined in `src/theme.js` (`BASE`, `THEMES`,
`TEXT_STYLES`, `TEXT_ROLES`, `normalizeDocTheme`, `docThemeToModes`) and applied in
`src/render.js` (`applyTheme`, `resolveBlockBox`, `applyBlockAppearance`) /
`src/export.js` (`tokenBody`, `themeCss`). If this ADR and the code disagree, the code
wins and this ADR is stale — fix it.

## The object

```
doc.theme = {
  schemaVersion,                 // integer, currently 1 (= window.THEME_SCHEMA_VERSION)
  color: { dark: {...}, light: {...} },   // PER-MODE colour tokens
  font,  space,  radius,  size,  button,  // SHARED across modes (= today's BASE)
  textStyles,                    // named-text-style SNAPSHOT (preset payload; see note)
  blockStyles                    // per-block-TYPE default appearance (#127)
}
```

Two sibling per-doc design stores the editor also reads (NOT under `doc.theme`, but part
of the same design system):

- **`doc.styles`** — the LIVE named-text-style store (`getTextStyles()`), e.g.
  `"Heading 1": { font, size, weight, lineHeight, letterSpacing }`. A text block links to
  one by `block.styleRef` (a live reference); render resolves it via the `__docStyles`
  per-pass hook. `doc.theme.textStyles` is a **snapshot** of this set used to carry styles
  in a cross-course preset (#126, copy-on-apply, merge-by-name) — the live SoT is
  `doc.styles`.
- **`doc.textRoles`** — block TYPE -> named-style NAME map (#145), e.g.
  `{ heading: "Heading 1", paragraph: "Body 1", note: "Callout", ... }`. Seeded from
  `window.TEXT_ROLES`. On a CSV/schema import (and on drop), the editor auto-links each
  unstyled text block's `styleRef` to its type's role, so imported courses arrive
  pre-styled.

### Field-level definition

**`color.dark` / `color.light`** — per-mode colour tokens. Keys (each a CSS colour):
`bg, surface, surfaceAlt, ink, inkSoft, muted, hair, rule, accent, success, danger`.
Emitted as `--color-<kebab>` (e.g. `--color-surface-alt`). This is the ONLY per-mode
group; the learner can flip dark/light at runtime and only these values change.

**`font`** — `{ heading, body }`, each a full CSS font **stack** (e.g.
`"'Exo 2', 'Segoe UI', system-ui, sans-serif"`), NOT a bare family name (a bare name would
emit an unquoted var and break). The editor picks a family and stores
`fontStackFor(name)`; `fontNameFromStack(stack)` reverses it for the picker. Emitted as
`--font-heading` / `--font-body`.

**`space`** — `{ xs, sm, md, lg, xl }`, px strings (`"6px"..."56px"`). `--space-<key>`.

**`radius`** — `{ card }`, px string. `--radius-card`.

**`size`** — `{ pageTitle, cardNum, cardTitle, cardBody }`, px strings.
`--size-<kebab>` (e.g. `--size-page-title`).

**`button`** — the shared CTA/nav button look:
`{ bg, fg, radius, padY, padX, fontSize, fontWeight, borderWidth, borderColor,
hoverBg, hoverFg }`. Colour values may be token refs (`"var(--color-accent)"`) so they
track the mode. Emitted as `--button-<kebab>`; `course.css` consumes them as DEFAULTS a
per-block button override still beats.

**`blockStyles`** — `{ <blockType>: <box> }` where `<box>` is the same shape as a block's
own `block.box`: `{ fill, textColor, border (bool), borderColor, borderWidth (number),
radius (number) }`. Each is the DEFAULT appearance for every block of that type. Absent /
`{}` = no type default (blocks render as before). Captured from a styled block
("Capture look" in its Appearance panel) or edited in Settings -> Theme -> Block styles.

## Resolution / cascade rules

- **Token emission is generic.** `applyTheme` (editor) and `tokenBody` (export) iterate
  EVERY group and emit `--<group>-<kebab(key)>`. Adding a key to a group ships to both
  editor and export automatically — no per-key wiring.
- **Per-mode projection.** `docThemeToModes(doc.theme)` projects to the flat
  `{ dark, light }` shape render/export consume. `color` is per-mode; the shared groups
  (`font/space/radius/size/button`) are shared **by reference** across both modes AND with
  `doc.theme`, so one edit updates both modes and the doc at once.
- **Block appearance cascade (#127).** `resolveBlockBox(typeDef, block.box)` =
  `theme.blockStyles[type]` as the BASELINE, `block.box` overriding **key-by-key** (a
  block can suppress an inherited border with `border:false`). `render` reaches
  `blockStyles` via the `__blockStyles` per-pass hook — set from `doc.theme.blockStyles`
  at all three surfaces (editor canvas, preview, export), never editor state.
- **Named text styles.** A text block references a style by `block.styleRef`; render
  resolves it via `__docStyles` (set from `doc.styles`). References are live — editing the
  named style repaints every linked block.

## Versioning + migration

- **`schemaVersion`** = `window.THEME_SCHEMA_VERSION` (currently **1**), stamped by
  `normalizeDocTheme`.
- **`normalizeDocTheme(dt)`** is an idempotent validate + backfill: it fills any missing
  group from the baseline, promotes a legacy FLAT colour map (pre per-mode split) to both
  modes, and never throws — so an old / hand-built / agent-authored / partial `doc.theme`
  always resolves. A brand-new doc is seeded by `defaultDocTheme()`; the one-time migration
  from the ex-global working theme is `makeDocTheme({dark, light})`.
- **To evolve the contract:** add the new field to `BASE` / `normalizeDocTheme` (backfill
  it so old docs stay valid), bump `THEME_SCHEMA_VERSION`, update the `<!-- SCHEMA_VERSION -->`
  marker at the top of this ADR (the test guard asserts they match), and document the field
  above. Keep `normalizeDocTheme` idempotent.

## Agent generation constraint (the north star)

When the agent generates or edits course content against this contract:

- **Prefer type defaults over per-block styling.** To make every block of a type look a
  certain way, write `doc.theme.blockStyles[type]` (or capture a styled exemplar), not a
  `block.box` on each. Set `block.box` only where a single block must DEVIATE from its type
  default.
- **Reference named styles, never inline them.** Link text via `block.styleRef` (and keep
  `doc.textRoles` pointing each type at its role) so a later theme edit repaints
  everything. Do not bake font/size onto individual text blocks.
- **Use token refs for colours** where a value should track the mode
  (`"var(--color-accent)"`), so generated blocks stay dark/light-correct.
- **`doc.theme` is the superset** a Claude-built design system maps into (DS import is
  deferred to a joint #96/#49 pass, but the shape here is designed to be that target — no
  re-architecture expected).

## Invariant

`doc.theme` is **doc data**, passed as `render`'s existing theme arg (per-mode projection)
and read in `render` only through per-pass hooks (`__blockStyles`, `__docStyles`), never
from editor state. `mount()` rebuilds the working cache so `setDoc` round-trips
`doc.theme`; the export bakes the same output. Editor == export holds by construction.
See #77 (spec), #124-#128 (slices), and `docs/adr/0001-media-hoist-at-save-choke-point.md`
for the sibling storage invariant.
