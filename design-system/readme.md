# Verso Design System

The design system for **Verso** — a browser-based authoring tool for building interactive
eLearning courses and exporting them as self-contained **SCORM 1.2** packages (for offline /
air-gapped LMS delivery). This system defines the **Verso UI** — the panels, inspector, toolbar
and canvas of the app itself: a dense, calm, dark-first editor interface with a consistent
control vocabulary (segments, icon-fields, colour field, sections) applied to Verso's block types.

## Canonical controls

This system encodes the editor's full set of controls, grouped by concern:

**foundation/** · `Icon`
**actions/** · `Button` · `IconButton`
**controls/** · `IconField` · `TextField` · `FieldRow` + `TwoUp` · `SegmentedControl` · `Switch` + `SwitchRow` · `Select` · `Checkbox` · `ColorField`
**panels/** · `Panel` · `PanelSection` · `Breadcrumb` · `LeftRail`
**navigation/** · `Tabs` · `DocumentTab`
**structure/** · `TreeItem` · `BlockPaletteItem` · `BlockTile` + `BlockGrid` · `Badge`
**overlays/** · `Modal` · `ContextMenu` · `Tooltip` · `CanvasOverlayBar`
**browser/** · `CourseCard` · `CardGrid` + `BrowserEmptyState` · `ThumbnailFrame` · `SearchField` · `RecentsMenuRow`
**board/** · `GraphBoard` · `ScreenNode` · `Edge` · `ConnectionPort`

Direct mapping to the editor's canonical helpers: `IconField`←`iconField` (55 sites),
`SwitchRow`←`switchRow` (27), `SegmentedControl`←`segmentedLive`/`segmentedIconLive` (20),
`FieldRow`+`TwoUp`←`fieldRow`/`twoUp` (20), `ColorField`←the unified `colorField`,
`PanelSection`←`sectionGroup`, `Modal`←`promptModal`/`confirmModal`, `ContextMenu`←`showContextMenu`.

### Surfaces
- `Icon` — a glyph wrapper giving components a consistent icon API (line icons, kebab-case names).
- `TextField` — free-text entry (captions, alt text, URLs, disclaimers).
- `BlockTile` + `BlockGrid` — an icon-tile grid layout for the Blocks palette.
- `LeftRail` + `CanvasOverlayBar` — the editor-shell surfaces. `LeftRail` is the far-left icon
  rail (nav-tab glyphs swap the sibling `Panel`'s content; pinned glyphs fire global actions).
  `CanvasOverlayBar` is the persistent floating canvas toolbar (grid / find & replace / comment /
  zoom), always visible and independent of selection.
- `browser/` — the home screen's wall of course cards and the save/recents dropdown. Thumbnails
  are live scaled-DOM previews of page 1 (no rasteriser — the `file://` constraint).
- `board/` — the 2D node-graph builder surface (the hotspot software-tour builder). Node board
  coords persist on `screens[].bx/by`; `render()` ignores them so it stays a pure function of the
  doc. Editor chrome only — renders/exports nothing.

### Action priority
**Preview (Demo)** is the most frequent action, so the top bar makes it the single accent primary
button; **Export** is a secondary button with a chevron for export options.

---

## Content fundamentals

How Verso writes UI copy:

- **Voice: plain, second-person, instructional.** The product speaks to the author as "you".
  Never first-person, never corporate "we" in the UI.
- **Sentence case everywhere** — buttons, labels, menu items, section headers. Exceptions: the
  Structure outliner's chapter names are upper-cased, as are the small uppercase section eyebrows.
- **Labels are nouns; actions are verbs.** Control labels name the thing ("Colour", "Radius");
  buttons and menu items are imperative verbs ("Rename chapter", "Split page here").
- **Terse.** Field labels are one or two words; descriptions are a single clause.
- **Concrete domain terms, no jargon.** Chapters, Pages, Blocks, Knowledge check, Hotspots, Nav
  pill, Glossary, Variant, SCORM.
- **British spelling** in system prose and colour tokens ("Colour", "behaviour", "centre").
- **No emoji, no exclamation, no marketing tone in the UI.** The editor is a calm, dense tool.
- **Empty/placeholder copy is a gentle instruction**: "describe the image", "Paste from clipboard".

---

## Visual foundations

- **Theme.** Dark is the primary editor theme; a full light theme is a scoped token override
  (`[data-theme="light"]`). The learner runtime crossfades between the two.
- **Colour.** A cool neutral grey ramp (`#171717`→`#f5f5f5`) does almost all the work. Surfaces
  stack by lightness: canvas `#171717` → panel/app `#1e1e1e` → raised menus `#262626` → inputs
  `#2c2c2c`. A single azure accent `#0D99FF` marks selection, focus, and primary action. Status
  colours are sparing: green `#14AE5C` (success / correct), red `#F24822` (error / destructive),
  yellow warning, purple for library components. A neon-pink `#FF2D9B` is reserved for the
  unfilled-slot authoring cue.
- **Type.** Verso UI is **Inter** at small sizes — 11px is the workhorse (labels, values, menu
  rows). **Exo 2** is the brand/display face (wordmark and course content). **JetBrains Mono** for
  code / HTML-interaction fields.
- **Density & spacing.** Tight. An 8px grid; controls are 24px tall by default, rows ~28px, the
  toolbar 40px. Label columns are fixed-width so values align in a clean column.
- **Radii.** Small: inputs/segments 2px, buttons 4px, popovers/cards 6px, modals 8px. Nothing is
  pill-rounded except toggles and count badges.
- **Borders over shadows.** On dark UI, separation is mostly 1px hairline borders
  (`rgba(255,255,255,0.10)`) and subtle fills. Inputs are borderless at rest, border on hover,
  accent ring on focus.
- **Elevation.** Only floating surfaces cast shadow (popovers, menus, modals), each with a 1px
  border. Docked panels never float.
- **Selection & hover.** Hover = a faint white wash (`rgba(255,255,255,0.06)`). Selected row = an
  accent-blue tint; selected canvas object = a 2px accent outline. Pressed = a stronger wash.
- **Motion.** Quick and functional — 120ms hovers/presses, 180ms popovers, 240ms theme crossfade;
  `cubic-bezier(.2,0,0,1)` easing. No bounce, no decorative loops. Respects `prefers-reduced-motion`.
- **Backgrounds.** Flat token colours only — no gradients or textures in the Verso UI. (Course
  content the author builds may use imagery; the editor stays flat.)
- **Cards / containers.** A flat raised surface with a small radius and a 1px hairline — no drop
  shadow while docked, no coloured left-border accents.

---

## Iconography

- **Style.** A single-weight 16px line-icon set with 2px strokes and rounded caps/joins.
  Monochrome, tinted by `currentColor` (`--icon-idle` at rest, `--icon-strong` / `--accent` when
  active).
- **Where they appear.** Densely — every toolbar button, block-palette entry, tree row, and menu
  item leads with a glyph; alignment/style controls are icon-only segmented controls.
- **Source.** Icons are provided through the `Icon` component, which maps to the
  [Lucide](https://lucide.dev) line-icon set (kebab-case names) — a match for the stroke weight,
  grid and rounded-cap style used throughout.
- **No emoji, no unicode glyph-hacks** in the Verso UI.

---

## Index / manifest

**Root** — `styles.css` (the single entry point consumers link) · `readme.md` (this file).

**tokens/** — `fonts.css` · `colors.css` · `typography.css` · `spacing.css` · `effects.css`

**components/** (grouped) — see "Canonical controls" above. Each directory has the `.jsx` +
`.d.ts` + `.prompt.md` per component and one `@dsCard` HTML.

**guidelines/** — foundation specimen cards (Colors, Type, Spacing, Brand groups).

**ui_kits/editor/** — the interactive editor recreation (`index.html` + factored JSX).

**Starting points** — `IconField`, `SegmentedControl`, `ColorField` (Controls); the full Editor
screen (Screens).
