# UX/UI Style Guide — POINTER (superseded by the Verso Design System)

> **This file no longer holds the rules.** The single source of truth for the Verso
> UI's look, feel, and canonical control set is the vendored **Verso Design System**
> at [`design-system/`](design-system/). Read it — do not cite this file for style rules,
> and do not re-add prose rules here (that is exactly the two-competing-rulebooks drift
> this scrub removed, per the chrome-redesign decision).

This file is retained only as the stable entry pointer that the `/verso-dev` skill and
new contributors open first. Its body delegates to `design-system/`.

---

## Where the rules live now

Start at the DS root and read these, in order:

- **`design-system/readme.md`** — the canonical rulebook: content fundamentals, visual
  foundations (colour, type, density, radii, borders, elevation, selection/hover, motion),
  iconography, and the **canonical control set** (the inventory) with its 1:1 mapping onto
  Verso's existing helpers.
- **`design-system/styles.css`** — the single entry point; it imports the token layer.
- **`design-system/tokens/`** — `fonts.css` · `colors.css` · `typography.css` ·
  `spacing.css` · `effects.css`. These token values are the SoT (vendored verbatim).
- **`design-system/components/<group>/`** — per component a `.d.ts` contract + a
  `.prompt.md` usage note. **These two are the conformance target** for Verso's vanilla
  builders. (The sibling `.jsx` is reference-only — see below.)
- **`design-system/tokens/`** (above) is the foundation spec for colour, type, spacing and
  brand — the token CSS values are the source of truth.
- **`design-system/ui_kits/editor/`** — the high-fidelity editor mockup of the 4 pictured
  surfaces (TopBar, LeftPanel, Inspector, Canvas). Match these pixel-for-pixel.

## Reference-only — never loaded by the app

Verso is vanilla JS (classic-script globals, opens from `file://`, no ES modules / bundler /
npm). The DS ships some artifacts that violate that and are therefore **reference only —
nothing in the app loads them**:

- React `.jsx` component sources and the `_ds_bundle.js` /
  `window.VersoDesignSystem_*` bundle (and `_ds_manifest.json`,
  `_adherence.oxlintrc.json`).
- The DS's Lucide-via-CDN icons and Google-Fonts-via-CDN `@import`
  (`design-system/tokens/fonts.css`).

What is **adopted** from the DS: the token CSS values, the visual spec (readme prose), the
component contracts (`.d.ts` / `.prompt.md`), the Lucide glyph set (to be inlined locally),
and the fonts (to be vendored locally). Icons resolve through a single `Icon` accessor keyed
by Lucide (kebab-case) names — never a stray inline `<svg>`.

## Verso-UI-only invariant (unchanged)

Scope is **Verso UI only** (`editor.css`, the inspector/render code in `src/editor.js`,
`src/export.js` UI, `index.html`). It NEVER governs the exported course output
(`src/render.js`, `src/course.css`) — that is the learner-facing product, styled separately.
`render(doc, theme)`, `src/course.css` tokens, and SCORM export bytes stay byte-identical.
DS Verso UI tokens must never enter `src/course.css` nor be read by `render()`.

---

## Machine-gate mapping (what `tests/run.js` enforces, and against what)

The DS is the human rulebook; `tests/run.js` is its automated negative-space guard. The two
existing conformance sections stay the seam (no new seam):

- **`panel-standards`** (`tests/run.js`, section `"panel-standards"`) — retired-pattern guard:
  canonical primitives present; open-state persisted; no word-boolean `segmentedLive`.
- **UI kit conformance gate — ticket 9 HARD FAIL** (`tests/run.js`, section
  `"UI kit conformance gate (ticket 9 — HARD FAIL)"`) — three violation classes must be 0:
  (1) no hand-appended block container chrome (all via `renderContainerChrome`),
  (2) no inline one-off glyphs (all from the canonical glyph set),
  (3) no labelled dimensional controls (`numRow`/`labeledRow` deleted).

As the Verso UI migrates to the DS, these sections gain assertions (per the chrome-redesign decisions):
no raw hex / no `--ui-*` in the Verso UI once migration completes; icons only via the Lucide `Icon`
accessor; Verso UI controls only via the canonical control set; DS token files present and
imported by the editor entry CSS; `course.css` carries no Verso UI tokens.

The DS canonical controls map 1:1 onto Verso's existing helpers (build against these; the gate
enforces they are used, not hand-rolled):

| DS component (`design-system/components/…`) | Verso helper (`src/editor.js`) |
|---|---|
| `IconField` | `iconField` (55 sites) |
| `SwitchRow` / `Switch` | `switchRow` (27) |
| `SegmentedControl` | `segmentedLive` / `segmentedIconLive` (20) |
| `FieldRow` + `TwoUp` | `fieldRow` / `twoUp` (20) |
| `ColorField` | `colourControl` (unified `colorField`) |
| `PanelSection` | `sectionGroup` (`sub` / `disclosure` / `subDisclosure`) |
| `Modal` | `promptModal` / `confirmModal` (shared `.modal-*`) |
| `ContextMenu` | `showContextMenu` |
| `Icon` | the Lucide `Icon` accessor (retiring the hand-drawn `GLYPHS`) |

## Re-sync path

A future DS drop is applied by replacing the vendored `design-system/` files (drop-in). The
alias layer (until deleted) and the conformance gate above absorb the rest. Keep this pointer
short — if a needed pattern is missing, add it to the DS, not here.
