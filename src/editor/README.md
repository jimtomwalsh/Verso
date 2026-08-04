# `src/editor/` — the map

The authoring editor used to be one 26,000-line file. It is now `src/editor.js` plus the modules
below. This file says what lives where, so you can find the right one without reading them.

**It is gated.** `tests/run.js` fails if a `.js` file appears here without a row in this table, or
if a row names a file that does not exist. The hand-maintained `node --check` list once drifted four
modules behind the directory before anyone noticed; a map that is not enforced rots the same way.

## How a module reaches editor.js

`src/editor/kernel.js` publishes `window.VersoEditor`. A module `need`s what it reads from the host
and `expose`s its entry points; the host `provide`s stable values and `provideLive`s anything it
reassigns. **`need()` resolves against `provide()`, never against another module's `expose()`** — a
module reaching for what a second module exposes gets editor.js's bound forwarder. Read kernel.js's
header before adding a module; its five rules are each a bug that shipped here.

Most modules are `install(kernel)` and declare their functions inside it. Two — `product-rail.js`
and `dnd.js` — are pure models with no `install()` that publish plain functions on their global.
The suite's orphan gate scans both shapes.

## What is still in `src/editor.js`

Wiring, mostly: ~490 `VE.bind` lines, the `provide` / `provideLive` tables, the `install()` calls
and the `init` block. Also the inspector dispatch table (eighteen one-line forwarders naming
implementations that live here), the canvas mount and input handling, the publish save paths, and a
long tail of substrate that three or more surfaces read — `selection`, `world`, `doc`,
`dirPermission`. State that three surfaces read does not move; only the logic does.

---

## The canvas and what you do on it

| module | lines | what it is |
|---|---|---|
| `world.js` | 578 | how the canvas gets built and painted. THE render loop. Reads the geometry, owns none of it. |
| `canvas-view.js` | 542 | where the canvas is looking: fit-zoom maths and the view region. |
| `editing.js` | 352 | what makes the canvas typeable. **The file the pure-render invariant is really about** — nothing it adds may leak back into `render()`. |
| `selection.js` | 124 | what is selected, and how a click gets there. |
| `drill.js` | 247 | selecting your way INTO something. |
| `interact.js` | 423 | the second thing the canvas can be. Owns the Interact flag, the pick and the preference. |
| `dnd.js` | 319 | where a dropped block actually lands. A pure model, no `install()`. |
| `dnd-ui.js` | 409 | what a drag LOOKS like. Owns the drag payload and the target zone. |
| `text-format.js` | 213 | inline formatting: the toggle set, the bar the panels dock, and the bar that floats over a canvas selection. |
| `block-actions.js` | 290 | what you can do to a selected block, and the two surfaces that offer it. Owns the toolbar separator. |
| `context-menu.js` | 366 | right-click, everywhere. |
| `clipboard.js` | 313 | the verbs that act on a selection. Owns all three clipboards. |
| `structure-ops.js` | 478 | the verbs that change the SHAPE of a course: duplicate, clear, convert, split, merge, move, and the one delete six surfaces route through. |
| `shortcuts.js` | 190 | one place that says what every key does. |

## The inspector

| module | lines | what it is |
|---|---|---|
| `inspector/dispatch.js` | 83 | which panel the right inspector shows, and what runs after it. **Pure** — it decides from a plain fact object and is tested without a browser. Keep it that way. |
| `inspector/primitives.js` | 1101 | THE canonical control set, plus `typeCluster` and the palette colour row. A hand-rolled settings row is a defect; add the shape here instead. |
| `inspector/sections.js` | 323 | THE section, and the author's ordering of them. |
| `inspector/blocks.js` | 908 | which panel a selected block gets, and the panels big enough to need writing out. |
| `inspector/parts.js` | 396 | the panels for the two things that are not blocks: a FIELD (a text slot inside a block) and an INSTANCE (one card of a component grid). |
| `inspector/scopes.js` | 359 | the panels for a selection that is not one block: the whole document, one page, a multi-selection. |

## Documents, pages and the shape of a course

| module | lines | what it is |
|---|---|---|
| `documents.js` | 334 | bringing a course into existence. |
| `tabs.js` | 184 | the open documents, and which one you are looking at. `switchDoc` swaps the whole thing. |
| `pages.js` | 153 | how a course is arranged: chapters, and which one a page belongs to. |
| `outliner.js` | 922 | the document seen as a list. ONE selection, shared with the canvas. |
| `history.js` | 137 | undo, redo, and the rule that a document swap moves everything at once. |
| `storage.js` | 314 | every durable read and write the editor makes. |
| `backup.js` | 214 | the durable copy on disk. |
| `home.js` | 379 | the course browser. |
| `files.js` | 361 | the Files destination: every document from BOTH stores, three groupings, list and cards. Owns the Files view preferences. |
| `product-panel.js` | 279 | what the open document belongs to: product, primary source, extras, siblings, release state. An inspector in the left panel of Source and Edit — never a filter. |
| `library.js` | 433 | one component, many courses: the store, where-used, and the panel. |
| `variants.js` | 559 | the two axes a course varies along, both switchers, and per-key visibility on each. |

## Look and feel

| module | lines | what it is |
|---|---|---|
| `theme.js` | 681 | the course's palette and the panel that edits it. Owns the light/dark mode and the named styles. |
| `color.js` | 340 | every way an author picks a colour. |
| `fonts.js` | 245 | type that survives being taken offline. |
| `header-footer.js` | 554 | the course chrome an author configures once, and the learner nav. |
| `settings-sheet.js` | 656 | everything about the course that is not on a page. Owns the one Escape contract. |
| `modals.js` | 145 | the canonical dialog. |
| `shell.js` | 389 | the frame around the work: which stage, which Product, which matrix cell. Owns the active stage. |
| `palette.js` | 309 | one index, one palette (Cmd-K). |
| `help.js` | 291 | the user guide, read inside the app. |
| `diagnostics.js` | 79 | what the app tells you about itself. |

## Interactive content

| module | lines | what it is |
|---|---|---|
| `hotspots.js` | 82 | reading the unified screen-graph. |
| `hotspots-editor.js` | 856 | editing a hotspot tour on the canvas. Owns the hotspot selection. |
| `board/builder.js` | 1962 | the tour builder, the board you actually touch. |
| `board/layout.js` | 175 | where things sit on that board. |
| `board/harvest.js` | 131 | the source-video segment model behind it. |
| `actions.js` | 274 | what a click does, when the click is the learner's. An action targets a PAGE ID, never an index. |
| `assets.js` | 645 | everything insertable, and the store behind it. Owns the insertable library table. |

## Source, review and output

| module | lines | what it is |
|---|---|---|
| `source-stage.js` | 3305 | the Source stage: one document per Product. |
| `source-link.js` | 763 | copy that stays joined to where it came from. |
| `copy-editor.js` | 799 | the Read view, and the find & replace under it — one write path, two surfaces. |
| `comments.js` | 1179 | review without a server: pins, anchors, the sidecar, presence, and THE comment model. Owns the comment mode. |
| `review-exchange.js` | 223 | the round trip out to a reviewer and back: the frozen snapshot, the shared folder, the poll, the ingest. Not the comment model. |
| `demo.js` | 386 | the course as the learner will meet it. |
| `publish.js` | 379 | what gets built, where it lands, and what the run records. |
| `product-rail.js` | 425 | the facts that follow a document across Source, Edit and Publish, and the tag model. A pure model, no `install()`. |

## The wiring itself

| module | lines | what it is |
|---|---|---|
| `kernel.js` | 182 | the one way a moved region and editor.js reach each other. Read its header first. |
