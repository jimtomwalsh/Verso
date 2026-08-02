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
**controls/** · `IconField` · `TextField` · `FieldRow` + `TwoUp` · `SegmentedControl` · `Switch` + `SwitchRow` · `Select` · `Checkbox` · `ColorField` · `ToggleChip`
**panels/** · `Panel` · `PanelSection` · `Breadcrumb` · `LeftRail`
**navigation/** · `Tabs` · `DocumentTab`
**structure/** · `TreeItem` · `BlockPaletteItem` · `BlockTile` + `BlockGrid` · `Badge` · `Meter` · `Timeline`
**overlays/** · `Sheet` · `Modal` · `ContextMenu` · `Tooltip` · `CanvasOverlayBar`
**browser/** · `CourseCard` · `CardGrid` + `BrowserEmptyState` · `ThumbnailFrame` · `SearchField` · `RecentsMenuRow`
**board/** · `GraphBoard` · `ScreenNode` · `Edge` · `ConnectionPort`

Direct mapping to the editor's canonical helpers: `IconField`←`iconField` (55 sites),
`SwitchRow`←`switchRow` (27), `SegmentedControl`←`segmentedLive`/`segmentedIconLive` (20),
`FieldRow`+`TwoUp`←`fieldRow`/`twoUp` (20), `ColorField`←the unified `colorField`,
`PanelSection`←`sectionGroup`, `Modal`←`promptModal`/`confirmModal`, `ContextMenu`←`showContextMenu`,
`Sheet`←`openSheet` (the right-docked non-modal settings surface).

### Surfaces
- `Icon` — a glyph wrapper giving components a consistent icon API (line icons, kebab-case names).
- `TextField` — free-text entry (captions, alt text, URLs, disclaimers).
- `ToggleChip` — an independently-toggleable pill for a row where several can be active at
  once (variant/tag/technology filters). `SegmentedControl` is the single-select counterpart
  ("pick exactly one"); reach for `ToggleChip` whenever the choice is genuinely multi-select.
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

## The UI spine

Every settings and overlay surface in Verso is one system shown a few ways. The rule the whole
editor obeys: **one spine, six presentations.** A control's look, the row it sits in, how it
saves, and how you dismiss it never change with which corner of the app you opened it from. This
section is the single source for that spine. Skills and build tickets reference it; they never
restate it. When a UI change is judged, it is judged against this spine and the surface around it,
never in isolation.

### Six presentations, one tree

Settings are one tree. The presentation is chosen by the job, never by where the click came from:

| Surface | Attachment | Holds | For |
|---------|-----------|-------|-----|
| **Sheet** | right-docked, full-height, no scrim | unbounded rows | anything, browsed or searched |
| **Popover** | anchored to its trigger | up to ~6 rows + one escalation link | the few settings for the thing you clicked |
| **Inspector** | docked right, persistent | rows sized to the selection | the current selection (the same rows as the sheet's Block scope) |
| **Menu** | at the pointer | verbs only | actions, each ending in a route into a surface above |
| **Help** | right-docked sheet or popover | prose | teaching beside the work: "show me", not a description |
| **Modal** | centred on a scrim | one decision | destructive confirms and blocking runs only |

Non-modal surfaces keep the canvas live: the canvas is *squeezed*, never covered. The Modal is
the only surface that takes a scrim, and only for a destructive confirm or a blocking run. Every
narrow surface (popover, menu) carries a visible route to escalate into the sheet.

**The sheet and the inspector share one right dock.** They are the same tree at two sizes — the
inspector holds the sheet's Block scope — so they are never both on screen. Opening the sheet
widens the dock to `--panel-sheet-width` and supersedes the inspector; closing it restores the
inspector at `--panel-right-width`. Two right-docked surfaces at once state the same thing twice
and squeeze the canvas twice. The sheet carries no internal navigation rail either: its body is
one scroll of sections, because a rail inside a dock is a second navigation system competing with
the section headers and with the one ⌘K index.

### The shared row

One row anatomy, reused identically in sheet, popover and inspector:

- a **fixed-width label column** so values align in a clean column (see Visual foundations: density);
- the **canonical control** at 24px (`--control-md`), from the set above, never a hand-rolled row;
- an **inheritance tail** that names where an inherited value comes from and offers Reset (below);
- a hover-only **`...` overflow** for the row's rare extra actions.

A section is an 11px semibold header (`--text-xs`) with a chevron, an optional switch, and a
one-line summary when collapsed. This is the `PanelSection` / `sectionGroup` contract: a panel is
never a stack of raw sub-headers.

**One notation, two levels, never three.** A group of rows is a section — always the same
header, always with a chevron. A bold line with no affordance, a bullet-prefixed sub-heading and
a second twirl style are all retired: when three header styles share a pane, the same glyph ends
up meaning "section" in one panel and "sub-section" in another, and the author has to learn which
headers can be opened. Sections nest **one** deep. A level-2 section is the same header, quieter
and indented under its parent. A group that wants a third level is not a sub-sub-group — it is a
section that belongs beside its parent, so promote it. Below a section there are only plain rows.

**The switch and the chevron are independent.** The chevron owns open/closed; the switch owns
on/off. Turning a section on does not open it, and turning it off does not fold it. An **off**
section keeps its rows built, dimmed and reachable — never removed, never `disabled` — so setting
up what a section will do before enabling it is an ordinary move rather than a leap of faith. The
collapsed summary leads with On/Off whenever there is a switch, so folded never reads as unknown.

### Scope and inheritance

Every setting resolves up one five-rung ladder:

**System -> Product -> Course -> Page -> Block.**

One visual language for the state of a value, at any rung, in any surface:

- **Inherited** — the resolved value in tertiary ink, with its source scope named. Never "unset":
  always show what will actually apply.
- **Overridden** — a 4px accent dot plus an inline **Reset**, whose tooltip states what Reset
  restores and from which scope.
- **Section roll-up** — the section header counts its overrides ("3 overridden").

The ladder is a **primitive, not a settings feature**. Resolution takes the property being
resolved as an argument and never inspects it; each rung supplies its own reader, so rungs may
store the same idea under different keys. Nothing in the resolver may assume the value is a
style or theme value. Any other axis that inherits — an export-control classification, an
approval state — rides this same primitive by passing a different property key and a different
scope chain. **A second, parallel inheritance path is a hard fail.**

Concrete anatomy in the app: `--override-dot` sizes the one accent dot (rows and sections
alike), the inherited scope name reads in `--text-tertiary` at `--text-xs`, and **Reset is a
live edit, not a commit control** — it writes straight away and Undo takes it back.

### Cross-stage facts

Some facts follow a document across Source, Edit and Publish — how much of it comes from approved
source, what has drifted since it last went out, where a passage is used, how many packages it
produces. These are read-only status, never controls, and they obey three rules:

- **One resolver, one phrasing.** A fact is computed once and phrased once. If two stages state the
  same fact, they call the same function and print the same words. A stage that phrases a fact its
  own way is a divergence, not a variation.
- **Drawn as the canonical `Badge`, `quiet`, `sm`.** They repeat down lists, which is exactly what
  `quiet` is for. Never a bespoke chip, and never the accent (the accent belongs to the one primary
  action on the surface). One sanctioned exception, below: alignment on Publish rows is the
  canonical `Meter`.
- **Silence over noise, honesty over a number.** A fact with nothing to say renders nothing — no
  chip that only means "nothing here". A fact that cannot be computed says so in words ("Not
  indexed"), never as a `0%` that reads as a failing score.

Banded percentages use one scale, and the tone states the band without scolding: **success** at the
top band, **warning** in the middle, **neutral** at the bottom. Red is reserved for something that
is actually wrong.

On Publish rows — the place the alignment number decides an action — alignment is drawn as the
canonical labelled `Meter` (`structure/Meter`: label · banded track · value), because there the
number must be *explained*, not merely stated. Everywhere else the fact stays a quiet `Badge`.
The Meter keeps the honesty rule: not-indexed is a dashed empty track with the words, never a
`0%` fill, and the band is spoken in text, never colour alone.

A fact badge sits on the row's own meta line, below the title, not beside it — a row must never
trade its name for its numbers.

### Save contract

**Autosave + live-apply + Undo.** There is no Save, Apply, Cancel or Done anywhere in a settings
surface. Edits apply live as you make them; **Close** and Undo (⌘Z) are the only commit-adjacent
controls. Dirty state is per-field (the override dot + Reset), never a panel-level banner. The
one exception is a destructive or irreversible action, which belongs in a **Modal** with an
explicit confirm.

### Keyboard contract

- **Esc** closes the topmost layer only, LIFO.
- **⌘,** opens Settings; **⌥⌘,** opens settings for the current selection.
- **⌘K** is find-anything: one index over settings, actions and help sections. No surface owns its
  own separate search box.

The palette that ⌘K opens is **not a seventh presentation**. It holds no rows, sets no values and
saves nothing: it is navigation, and every result routes into one of the six. That is also why it
may take a scrim when the settings surfaces may not — it captures typing for the moment it is
open, then hands the author to the real surface. Contract:
`components/overlays/CommandPalette.{d.ts,prompt.md}`.

Its index covers settings sections, actions, guide sections, and the open document's pages and
blocks. Sections carry **intent words** as well as their titles, because the names are not
guessable from what an author wants: a disclaimer lives under Header & Footer, confetti under
Motion, the nav pill under Learner nav. A result always names the category it lives in, and
choosing one opens its section already expanded. A contents list (a TOC, the outliner) is
navigation and stays; a second *search field* over a second index does not.

### Density baseline

The spine reuses the tokens Visual foundations already defines: 11px chrome (`--text-xs`), 24px
controls (`--control-md`), 28px rows (`--row-height`), 40px toolbar (`--toolbar-height`), the
`--panel-left-width` / `--panel-right-width` panel widths, the 2/4/6/8 radii, borders over
shadows, one accent, sentence case. The named Source / Edit / Publish icon rail (`--rail-w`) is
standard across stages. There is no new density design here: this is adoption of the existing
token set.

---

## Scope — Verso UI only

This system governs the **Verso UI** (`editor.css`, the inspector/render code in
`src/editor.js`, `src/export.js` UI, `index.html`) and nothing else. It NEVER governs the
exported course output (`src/render.js`, `src/course.css`) — that is the learner-facing
product, styled separately. `render(doc, theme)`, `src/course.css` tokens, and SCORM export
bytes stay byte-identical regardless of the UI. DS Verso-UI tokens must never enter
`src/course.css` nor be read by `render()`.

Verso is vanilla JS (classic-script globals, opens from `file://`, no ES modules / bundler /
npm). The DS ships some artifacts that violate that and are therefore **reference only —
nothing in the app loads them**: the React `.jsx` sources, `_ds_bundle.js` /
`window.VersoDesignSystem_*` (with `_ds_manifest.json`, `_adherence.oxlintrc.json`), and the
DS's Lucide-via-CDN icons + Google-Fonts `@import` in `tokens/fonts.css`. What is **adopted**:
the token CSS values, this visual spec, the component contracts (`.d.ts` / `.prompt.md`), the
Lucide glyph set (inlined locally), and the fonts (vendored locally). Icons resolve through the
single `Icon` accessor keyed by Lucide (kebab-case) names — never a stray inline `<svg>`.

## Machine-gate enforcement

This readme is the human rulebook; `tests/run.js` is its automated negative-space guard — it
enforces that retired patterns stay gone, not that the rulebook is followed line by line.

- **`panel-standards`** (`tests/run.js` section `"panel-standards"`) — canonical primitives
  present; open-state persisted; no word-boolean `segmentedLive`.
- **UI kit conformance gate (ticket 9 — HARD FAIL)** — three violation classes must be 0:
  (1) no hand-appended block container chrome (all via `renderContainerChrome`),
  (2) no inline one-off glyphs (all from the canonical glyph set),
  (3) no labelled dimensional controls (`numRow` / `labeledRow` deleted).

Build against the canonical helpers mapped above — the gate enforces they are used, not
hand-rolled. A future DS drop is applied by replacing the vendored `design-system/` files in
place; if a needed pattern is missing, add it here, not in a second rulebook.

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
