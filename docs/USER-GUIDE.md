# Verso — User Guide

A complete, from-scratch guide to the DIY authoring tool ("Verso"). If you have never
opened it before, start at the top and read straight down. No prior knowledge assumed.

> **What Verso is.** A browser-based tool for building interactive eLearning
> courses and exporting them as **SCORM 1.2** packages you can upload to Moodle. Everything
> runs locally in your browser — there is no server and no account. Courses you build are
> **self-contained**: fonts, images and interactions are embedded, so a published course
> runs fully offline (important for air-gapped Moodle).

---

## 1. Opening the app

Verso is a plain web app — no install.

- **In a browser:** open `index.html`. For everything to work (SCORM export, fonts), serve
  the folder over `http://` rather than `file://`:
  ```
  cd "…/authoring-tool"
  python3 -m http.server 8123      # or: ./serve.command
  ```
  then visit `http://localhost:8123/index.html`.
- **In the desktop app (Verso):** just launch it — it wraps the same app in a window.

Your work is **saved automatically to this browser** (IndexedDB) as you go. The **"All
changes saved"** status in the top bar confirms it. There is no "Save" button for normal
editing — but do keep JSON backups (see §12) since the data lives only in this browser.

---

## 2. The workspace at a glance

```
┌───────────────────────────────────────────────────────────────────┐
│  [tabs]        Toolbar:  ☾  saved  ↶ ↷  ⊡fit  ▮comment  ▶demo  …   │
├───────────┬─────────────────────────────────────────┬─────────────┤
│ STRUCTURE │                                          │  INSPECTOR  │
│ (outliner)│              CANVAS                       │  (contextual│
│  Pages    │        pages laid out as an              │   settings  │
│  Blocks   │        infinite, zoomable board          │   panel)    │
│ (palette) │                                          │             │
└───────────┴─────────────────────────────────────────┴─────────────┘
```

![The left panel: the Structure outliner (chapters and pages) above the Blocks palette.](docs/assets/structure-panel.webp "The left panel — Structure outliner on top, Blocks palette below.")

- **Toolbar (top).** Light/dark toggle, save status, **Undo/Redo**, **Fit all**, **Comment
  mode**, **Demo (preview)**, and the **Import & Export** menu (CSV import / SCORM export /
  JSON backup). Document tabs sit on the left — you can have several courses open.
- **Left panel — Structure + Blocks.**
  - **Structure** is the outliner: your chapters → pages → blocks as a tree. Click a page to
    jump to it; twirl a page open to see its blocks. The **collapse-all** glyph (next to
    "Pages") folds the whole tree back to chapter level in one click. **+** adds a page.
  - **Blocks** is the palette of block types you drag/drop or click to insert, plus the
    **Shared Library** of reusable components.
- **Canvas (centre).** An infinite board showing your pages. Scroll to pan, **⌘+scroll** (or
  pinch) to zoom. Every page is a real, editable render of what the learner will see.
- **Inspector (right).** Context-sensitive. With nothing selected it shows **document**
  settings (theme, fonts, header/footer, etc.). Select a block and it shows that block's
  settings.

---

## 3. Core concepts

- **Document = one course.** Held in the browser; shown as a tab.
- **Chapters → Pages → Blocks.** A course is chapters; each chapter has pages; each page
  holds blocks. The learner moves page-to-page; chapters drive the nav/progress.
- **Blocks** are the content units (heading, paragraph, image, quiz, card grid…). Some
  blocks are **containers** (Card, Columns, Card Reveal, Accordion) that hold child blocks.
- **Document settings vs block settings.** The inspector shows **document-wide** settings
  when nothing is selected (theme, fonts, header/footer, glossary, motion, guided tour), and
  **per-block** settings when a block is selected.
- **Autosave.** Edits persist to the browser immediately; the undo history is per session.

---

## 4. Pages & chapters

![Clicking a page in the Structure outliner selects it and jumps the canvas to it.](docs/assets/outliner-navigate.webp "Click a page in the outliner to jump to it — the selection moves from one page to the next."){poster=docs/assets/outliner-navigate-still.webp}

- **Add a page:** the **+** in the Structure header (adds after the selected page). New pages
  are blank.
- **Rename / reorder / move:** drag pages and chapters in the Structure outliner. Play-order
  is derived from the outline, so the exported course always navigates in outline order.
- **Auto page names:** pages are auto-titled `chapter.page firstLineOfCopy` (e.g.
  `2.3 RF exclusion zones`) and renumber themselves as you add/split/delete — you can
  override the title by renaming.
- **Split / merge:** split a page at a block, or **merge with the next page** (same chapter),
  from the page's frame-label menu or the outliner.
- **Collapse all → chapters:** the glyph beside "Pages" toggles the whole tree between the
  full block view and a chapter-only overview.

---

## 5. Adding & editing blocks

**Insert:** open the **Blocks** palette (left panel) and click or drag a block onto a page,
or into a container block (Card, Columns, Card Reveal). An **unfilled image or interaction
placeholder glows neon-pink on the canvas** so you never miss a slot you still need to fill
(this is an authoring aid only — it never ships or shows in preview).

**Select & drill in.** A click selects the **outermost** container under the
cursor; each further click drills one level in (container → block → text field). **Double-
click** jumps straight into text editing. **Escape** steps back out one level. (There's a
"Text editing" option in document settings to switch to old-style click-to-edit if you
prefer.)

**Move / duplicate / delete.** Drag to move; **⌘D** duplicates; **Delete/Backspace** removes
the selection; arrow keys nudge. Group multiple blocks with **⌘G** (ungroup **⌘⇧G**).

### The block catalogue

**Text**
- **Heading / Subheading / Paragraph / Quote** — rich text. Select text to **Bold / Italic /
  Underline**, or add an inline **Link** (opens in a new tab). Apply a **saved text style**
  (see §6) for consistent typography.
- **Bulleted list** — marker style, colour, custom glyphs, nesting.
- **Note / callout** — a highlighted aside.

**Media**
- **Image** — paste a URL or upload. Options: max width, fit height, alt text, **caption**,
  a per-mode **light/dark** source or auto-tint for vector art, and a per-image **Click-to-
  zoom** toggle. Every image is, by default, click-to-zoom into a full-screen **lightbox**
  with its caption (× / click-away / Esc to close).
- **HTML Interaction** — embed a self-contained interactive HTML file; it is themed to match
  and ships inside the package.
- **Web Embed** — responsive embedded media (e.g. video).
- **Image hotspots / software tours** — pins ("hotspots") over an image. Each pin either
  **opens a popover** (rich-text + image call-out) or **navigates to another screen**, so you
  can build a guided software walkthrough. Under **Behaviour** pick *Popover on click* or
  *Screen navigation*. Add screens in the **Screens** list (the first is the *Entry* screen);
  each screen has its own image and its own pins, so a tour can go any number of levels deep. A
  navigation pin's **Goes to** dropdown targets any screen (or mints a new one); use *Edit this
  screen and its hotspots* to jump in and add pins to it. In a deep tour the learner gets a
  **Back** control (retraces one step) and, by default, a **Home** control (jumps to the entry
  screen) — Home can be turned off, and both labels are editable.
  A screen's image can also be a **video or GIF** (a screen recording) — upload it in the same
  spot as the image. A video screen gets a **Playback** choice: *Loop* (an idle animation that
  cycles) or *Play once* (autoplays muted when the learner arrives, then freezes on the last
  frame and shows a **Replay** button you can hide). Reduced-motion learners see the first frame
  with a Play button instead of autoplay. A popover card can also hold a video (**Add video to
  popover** — then select the video block in the card to upload the file; it plays in place with
  its own controls and sound). Video is packaged as separate files inside the SCORM zip, so the
  course still loads fast and works fully offline.
  **Completion** (under Behaviour): by default a tour counts complete once the learner has
  **visited every screen** — which releases the page's Next when interaction-gating is on. You can
  instead pick a **completion screen** (arriving there finishes a linear tour), or turn tracking
  off entirely (the *Mark as viewed* switch) so an optional/decorative tour never holds Next. A
  **Navigation trail** toggle (off by default) shows the learner a breadcrumb of the screens they
  walked; each crumb jumps back along their path.
  **Tour builder (spatial view).** For a multi-screen tour, the Screens section has an **Open tour
  builder** button that opens a full-screen board where every screen is a node card laid out in 2D.
  Pan with a two-finger/space drag, zoom with cmd/ctrl-scroll or the zoom control, and press
  **Fit** to frame everything. **Upload screens** adds several images/GIFs/videos at once (each
  becomes a new screen). Drag a node to arrange it; the layout is saved with the course. **Tidy**
  (or **Cmd/Ctrl+T**) snaps the nodes into a clean grid in their current reading order — with nodes
  box-selected it tidies just those. Zoom in close (cmd/ctrl-scroll) for precise pin placement.
  Selecting a node highlights the links running to and from it. **Box-select**
  by dragging across empty board space (Shift-drag adds to the selection) to grab several nodes
  (selected nodes get an accent ring) and move them together; Space-drag or middle-drag pans from
  anywhere on the board — including over a node or loop frame — so you can still pan when zoomed in
  with little empty canvas to grab.
  **Preview** opens an isolated test of just this tour (click hotspots, cycle loops, use Back to
  return) without leaving the builder or exporting; press **Close preview** or **Escape** to return. Screens stay crisp as you zoom in so their
  content is readable. The builder stays open across a page refresh (it re-opens on the same block).
  Each node shows its screen at its true shape, so a hotspot sits exactly where the learner will see
  it. Drag a pin on a node to move that hotspot, or select it and nudge with the arrow keys (Shift for
  larger steps) for fine placement; the inspector's X/Y fields take exact values. Selecting a
  node (or a pin on it) shows that screen's normal properties in the right panel — it is the same
  editor, just re-hosted, so nothing new to learn. Drag the small **port** on a navigation pin to
  another node to draw (or repoint) its link; click a link and its **×** to remove it (click empty
  space or press Escape to deselect it). **Cards face-up** is on by default: every callout card opens
  around its node, wired to its pin; hovering or selecting a pin highlights its box and wire. With it
  off, selecting a pin still opens just that card. Pins stay a readable size as you zoom, so clustered
  hotspots separate instead of piling up, and you edit any card's copy inline right on the board. The
  board is an authoring aid only — it changes nothing in the exported course. Press **Done** or
  **Escape** to close; the inline Screens/Hotspots controls still work exactly as before.

  **Loops (screen carousels).** To showcase one piece of UI across its many states (a panel OFF /
  warning / error / disrupting) without wiring a separate hotspot and screen for each state, use a
  **loop**: a frame that holds an ordered set of screens the learner will cycle forward/back as one
  carousel. Click **Add loop** in the board's top bar to drop a loop frame, then add screens to it by
  **dragging a screen node into the frame** (it snaps into the frame's grid and the frame grows to
  fit) — you can box-select several screens and drag them in together — or, with the loop selected,
  by picking them from the **Add a screen** list in the right panel.
  A small number on each member shows its place in the carousel; reorder by dragging a member to a new
  spot, or with the up/down buttons in the panel. Drag a member out of the frame to remove it. Point a
  **navigation** hotspot at the loop the same way you point one at a screen — drag its port onto the
  loop frame, or choose the loop under **Goes to** in the hotspot's properties. In the panel a loop
  has a **name** and a **Wrap around** toggle (cycle past the last screen back to the first).
  A hotspot that opens a loop shows a distinct **stacked-cards** glyph (rather than the default "i"),
  so learners can tell it reveals a set of states. Clicking it opens the loop as a **contained
  modal** — a card over a dimmed backdrop showing the loop's name, position ("2 / 3"), and one
  member screen at a time (scaled to fit the card without cropping), with
  **Prev / Next** inside it (styled like the course page nav, Next gently pulsing to invite stepping
  through). While the modal is open the tour's own Back/Home and hotspots are hidden behind the dim,
  so the loop reads as a distinct, self-contained step rather than another layer of navigation. The
  learner exits with the **✕**, a click on the backdrop, or **Escape** — which returns them to the
  screen they came from so the tour continues. Once they've stepped through every state in the loop
  the **✕ lights up** to signal they've seen them all. Every member counts toward completion. With Wrap around off, the arrows stop at the first and last screen;
  with it on, they cycle round. Completion counts every member the learner can reach through the
  loop. Deleting a loop frees its screens (they stay on the board) and clears any hotspot aimed at it.

**Layout**
- **Card (container)** — a styled box holding child blocks (fill, border, radius, padding).
- **Columns** — a multi-column row; drop any blocks into each column. Columns collapse to a
  full-width stack on mobile automatically.
- **Table** — a native table: toggle a header row, choose borders (all / none), zebra
  striping, cell padding, and per-column alignment. Edit cell text directly on the canvas.
- **Divider / Spacer** — rules and vertical space.
- **Accordion / Tabs** — collapsible sections or tabs, styled to match the card look.
- **Card Reveal** — a responsive grid of cards with **three "Reveal style" modes**:
  - **Reveal** (default): a frosted cover clears on hover / hold / tap to reveal the content.
  - **Flip**: click a card to flip it in 3D — front shows the number + a label, back shows
    the content (click again to flip back).
  - **Off**: static cards, no interaction.
  Set columns, gap, card height, an optional surface texture (grid / dots / none), and
  per-card appearance (fill per light/dark mode, border, corner radius).
- **Sequence (process / timeline)** — an ordered list of steps rendered as a process or
  timeline. Choose the marker **spine** (numbered / dated / plain), **orientation** (vertical
  or horizontal), and **reveal** behaviour (scroll / click-through / static). Each step has a
  title, body blocks, and an optional icon; the dated spine gives each step free-text marker
  copy.
- **Card Deck (carousel)** — a paged carousel of full-frame cards the learner steps through
  with the **‹ ›** arrows. Each card holds any blocks (drop content straight in); card numbers
  are automatic.

**Interactive**
- **Navigation button** — jumps to another page.
- **Acknowledge / Checkbox** — a gate the learner must tick.
- **Quiz (knowledge check)** — multiple-choice and other question types with feedback, a
  pass/complete panel, optional shuffle, per-quiz colours, and a **"Celebrate on pass
  (confetti)"** toggle. Correct answers show in the **brand green**; incorrect in red.
- **Chapter Card grid** — the auto-built chapter menu component.

Interactive blocks can **gate the Next button** (the learner must complete them to advance),
and, with **gated progression** on, a chapter's knowledge-check can gate the next chapter.

---

## 6. Theming & design (document settings)

Select nothing, and the inspector shows document-wide design controls:

- **Light / dark.** The top-bar **☾** toggles the palette you're previewing. Learners get a
  toggle too, and the palette **crossfades** between modes (duration is tunable under
  *Motion*; respects "reduce motion").
- **Theme.** Edit the colour tokens for each mode (background, ink, accent, success, etc.).
- **Saved Text Styles.** Create named styles (font, size, weight, line-height, letter/word
  spacing, case, indent, alignment incl. **Justify**, colour). Apply a style to any text; edit
  the style once and every use updates. Rename safely — references are repointed.
- **Custom fonts.**
  - Upload any `.ttf/.otf/.woff/.woff2` to **embed** it (renders offline).
  - **Google Fonts:** pick from a curated set of popular families — the font is **downloaded
    and embedded now** (you need internet while authoring), so the exported course stays
    offline-safe and never phones home. **Exo 2** (bundled) and **Arial** (system) are always
    available.
- **Header & Footer + Learner nav.** Turn on a header/footer, a logo, a disclaimer, and the
  footer **nav pill** (progress bar, chapter-jump menu, light/dark toggle, glossary button).
  The pill has fill/opacity/blur/hover controls.
- **Glossary.** Upload an abbreviations image (SVG recommended) — a **Glossary** button
  appears in the nav pill and opens it as an overlay. The glossary tracks the mode (white on
  dark, dark on light).
- **Motion.** Tune the light/dark crossfade and the chapter-change fade (ms; 0 = instant;
  "reduce motion" always wins).
- **Guided tour.** Turn on a short **onboarding coach-mark tour** shown once at course start
  (points out Next, the nav pill, the glossary). Learners can Skip; you can override each
  step's caption.
- **Page layout.** Master content-width cap and per-breakpoint page padding.
- **Custom Components / Shared Library.** Save a composed block to a machine-level library and
  reuse it across courses; edit the master and every course using it updates (import/export
  the library as JSON to move it between machines).

---

## 7. Importing content from a spreadsheet (CSV)

For bulk content, use **Import & Export → Import CSV**. Verso reads a flat **Import Schema
CSV** (`Page, Location, Path, Field, Type, Value`) and builds pages, blocks and native
quizzes. See `SCHEMA-TEMPLATE-GUIDE.md` and `course_schema_template.csv` in the app folder
for the exact columns and an example.

- The `/VersoCSV` skill converts a Confluence course export straight into this CSV.
- A **variant tag** column lets one CSV drive several **product variants** of the same course.

---

## 8. Variants

A single course can carry **product variants** (e.g. two hardware models) that share most
content but differ in specifics. You author one **flagship** course; each variant is a thin
layer of **overrides** on top of it, so unchanged copy stays shared and you maintain one source.

- **Switch flagship/variant** from the top bar. **Flagship** is the editable master; picking a
  variant shows a read-only **preview** of how that variant reads. To change a variant's wording,
  edit its text where variant edits are allowed (the field inspector, or the copy editor below) —
  the edit lands only on that variant's override, leaving the flagship untouched.
- A block with no override for the current variant simply **inherits** the flagship copy.
- Variant-tagged spreadsheet content (a **variant tag** column, §7) can seed variants on import.

**See variants side by side (copy editor).** Open the **Copy editor** (the file-text glyph in the
left rail) for a full-screen, plain-text view of all course copy. When the course has variants, a
**Single | Side by side** toggle appears in its toolbar:

- **Single** — one column of flagship copy (the default).
- **Side by side** — the flagship column plus **one column per variant**. Any block that *holds* a
  variant shows that variant's wording beside it; a block with no variant shows nothing beside.
  A held variant cell is **read-only behind a lock** — click the lock to edit it (your edit writes
  that variant's override). A block with no variant yet shows a quiet **`+`** to create its copy
  from the flagship, ready to edit.

---

## 9. Preview (Demo mode)

Click **▶ Demo** (or **⌘P**) for a full-screen, learner-accurate preview: it runs one page at
a time through the real runtime — nav, quizzes, hotspots, gates, card flips, the light/dark
toggle, and the guided tour all behave exactly as they will for a learner. Switch device
breakpoints, page with **← / →**, and **Esc** to exit.

---

## 10. Review loop (Verso Viewer)

For stakeholder review without shipping a SCORM:

1. **Comment mode** (**C** or the ▮ toolbar/preview button): drop pinned comments on the
   canvas or in the preview, anchored to blocks/pages; thread replies; resolve.
2. **Publish to Viewer:** writes a frozen `.versopub.json` snapshot (images embedded) into a
   shared folder. Reviewers open it in the standalone **Verso Viewer**, experience the course,
   and leave comments that save back to the same folder.
3. **Ingest reviews:** the editor auto-merges returned comments (on launch + periodically), or
   ingest on demand — pins land on the exact blocks. Comments never ship in the exported
   course.

---

## 11. Publishing — export to SCORM

**Import & Export → Export SCORM** builds a SCORM 1.2 `.zip`:

- All fonts, images, and HTML interactions are **embedded** — the package is self-contained
  and runs offline.
- Upload the `.zip` to Moodle as a SCORM activity.

**Air-gapped Moodle:** run the **`/publish`** prep on the exported package before uploading —
it embeds the Exo 2 fonts for offline rendering and forces an always-visible scrollbar
(`scripts/scorm-publish.sh`). Do this on **every** course headed for air-gapped Moodle.

**Backups.** Also use **Export JSON** to save a portable copy of the whole course (the data
otherwise lives only in this browser). **Import JSON** restores it.

---

## 12. Keyboard shortcuts

(`⌘` = Cmd on macOS / Ctrl on Windows.)

| Action | Shortcut |
|---|---|
| Undo / Redo | ⌘Z / ⌘⇧Z (or ⌘Y) |
| Zoom in / out | ⌘= / ⌘− |
| Zoom to 100% / Fit all pages | ⌘1 / ⌘0 |
| Select all on page | ⌘A |
| Duplicate | ⌘D |
| Copy / Paste / Paste without formatting | ⌘C / ⌘V / ⌘⇧V |
| Group / Ungroup | ⌘G / ⌘⇧G |
| Preview (Demo) | ⌘P |
| Quick-jump to a page | ⌘K |
| Hide / show side panels (maximise canvas) | ⌘\ |
| Comment mode | C |
| Edit text (on a selected field) | Double-click, or Enter |
| Step selection out one level | Esc |
| Delete selection | Delete / Backspace |
| Nudge selection | Arrow keys |

---

## 13. Tips & gotchas

- **Your course lives in this browser.** Export a JSON backup regularly, and before clearing
  browser data or switching machines.
- **Neon-pink block = unfilled.** A hot-pink image/interaction placeholder means a slot you
  haven't filled yet. It's an authoring cue only — it never appears in preview or the export.
- **Air-gap rule.** Anything a learner sees must be embedded, never fetched at runtime. Fonts
  (incl. Google Fonts) are downloaded and embedded at author time; interactions are inlined.
  You can be online while authoring; the shipped course sends nothing out.
- **Reduce motion is respected.** All fades/animations (mode crossfade, chapter fade, card
  flip, confetti) are disabled for learners who prefer reduced motion.
- **Preview is the truth.** If something behaves oddly on the canvas, check **Demo** — it
  runs the real learner runtime.

---

*This guide reflects the app as built. When a screen doesn't match, the app (and the
`SCHEMA-TEMPLATE-GUIDE.md` / `SPEC-*.md` docs in this folder) are the source of truth.*
