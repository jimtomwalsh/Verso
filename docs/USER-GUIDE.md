# Verso User Guide

Verso is a browser-based tool for building interactive eLearning courses and exporting them as
**SCORM 1.2** packages for Moodle. Everything runs locally — no server, no account. This guide
takes you from opening the app to publishing a course. New here? Read the Quick start, then dip
into any section from the search box on the left.

> **What you build.** A course is a set of **chapters**, each holding **pages**, each page built
> from **blocks** (text, images, quizzes, interactions). The finished course is self-contained —
> fonts, images, and interactions are embedded, so it runs fully offline.

---

## 1. Quick start

Build and export your first course in a few minutes.

1. **Open Verso.** Launch the desktop app, or open `index.html` in a browser (serve the folder
   over `http://` so export and fonts work — see §2).
2. **Add a page.** In the **Structure** panel on the left, click **+** to add a page.
3. **Add a block.** Open the **Blocks** palette (below Structure) and click **Heading**, then
   **Paragraph**. Click the text on the canvas and type.
4. **Preview it.** Click **▶ Demo** (or press ⌘P) to see the page exactly as a learner will.
   Press **Esc** to return.
5. **Export it.** Open **Import & Export → Export SCORM**. Upload the `.zip` to Moodle as a
   SCORM activity.

> **Reassurance.** You can't lose work by exploring — every edit autosaves, and ⌘Z undoes.
> There's no "save" button for normal editing.

---

## 2. Opening the app

Verso is a plain web app — nothing to install.

- **Desktop app:** launch it. It wraps the same app in a window.
- **Browser:** open `index.html`. For export and fonts to work, serve the folder over `http://`
  rather than `file://`:
  ```
  cd "…/verso"
  python3 -m http.server 8123      # or: ./serve.command
  ```
  Then visit `http://localhost:8123/index.html`.

Your work **saves automatically to this browser** (IndexedDB) as you go; the **All changes
saved** status in the top bar confirms it.

> **Note.** Your course lives only in this browser. Export a **JSON** backup regularly and
> before clearing browser data or switching machines (§13).

---

## 3. The workspace

Verso has three panes: **Structure** (left), the **Canvas** (centre), and the **Inspector**
(right), under a top toolbar.

![The Structure panel: the outliner of chapters and pages, with the Blocks palette below.](docs/assets/structure-panel.webp "The Structure panel — the outliner of chapters and pages.")

- **Toolbar (top).** Light/dark toggle, save status, **Undo/Redo**, **Fit all**, **Comment
  mode**, **Demo**, and the **Import & Export** menu (CSV import, SCORM export, JSON backup).
  Open courses appear as tabs on the left.
- **Structure (left).** The outliner — chapters, pages, and blocks as a tree — with the
  **Blocks** palette and **Shared Library** below it. Click a page to jump to it.
- **Canvas (centre).** An infinite, zoomable board of your pages. Scroll to pan, ⌘+scroll (or
  pinch) to zoom. Every page is a live, editable render of what the learner will see.
- **Inspector (right).** Context-sensitive: with nothing selected it shows **document**
  settings; select a block and it shows that block's settings.

---

## 4. Core concepts

Four ideas cover most of how Verso works.

![Chapters (1) contain pages (2) in the Structure outliner.](docs/assets/annotated-structure.webp "A chapter (1) holds pages (2); the learner moves page to page.")

- **A document is one course**, held in this browser and shown as a tab.
- **Chapters → pages → blocks.** A course is chapters; each chapter holds pages; each page is
  built from blocks. The learner moves page to page, and chapters drive the navigation and
  progress bar.
- **Some blocks are containers.** A **Card**, **Columns**, **Card Reveal**, or **Accordion**
  holds child blocks inside it.
- **The Inspector mirrors your selection.** Select nothing for document-wide settings (theme,
  fonts, header/footer); select a block for that block's settings.

---

## 5. Pages & chapters

Pages are the unit a learner reads; chapters group them and drive navigation.

![Click a page in the outliner to jump to it — the selection follows.](docs/assets/outliner-navigate.webp "Click a page in the outliner to jump to it."){poster=docs/assets/outliner-navigate-still.webp}

- **Add a page.** Click **+** in the Structure header (adds after the selected page).
- **Reorder or move.** Drag pages and chapters in the outliner. Play-order follows the outline,
  so the exported course always navigates in outline order.
- **Split or merge.** Split a page at a block, or **merge with the next page** in the same
  chapter, from the page's frame-label menu or the outliner.
- **Collapse the tree.** The glyph beside **Pages** folds the outline to chapter level and back.

> **Note.** Pages auto-title themselves as `chapter.page firstLineOfCopy` (e.g.
> `2.3 Exclusion zones`) and renumber as you add, split, or delete. Rename any page to override.

---

## 6. Adding & editing blocks

Blocks are the content units on a page. This section covers inserting and editing them; §7 is
the full catalogue.

![Click a page in the outliner; the highlight marks the page you're editing.](docs/assets/annotated-navigate.webp "The highlight marks the active page."){poster=docs/assets/annotated-navigate-still.webp}

**Insert a block.** Open the **Blocks** palette and click or drag a block onto a page — or into
a container (**Card**, **Columns**, **Card Reveal**).

**Select and drill in.** One click selects the outermost container under the cursor; each
further click drills one level in (container → block → text). **Double-click** jumps straight
into text editing. **Esc** steps back out one level.

**Move, duplicate, delete.** Drag to move; **⌘D** duplicates; **Delete** removes the selection;
arrow keys nudge. Group blocks with **⌘G** (ungroup **⌘⇧G**).

> **Tip.** An unfilled image or interaction placeholder glows neon-pink on the canvas so you
> never miss a slot. It's an authoring cue only — it never shows in preview or the export.

---

## 7. Block catalogue

Every block you can insert, grouped by type. Software tours have their own section (§8).

### Text

- **Heading / Subheading / Paragraph / Quote** — rich text. Select text to **Bold**, *Italic*,
  or underline, add an inline **Link**, or turn it into a **List** — all from the one formatting
  bar in the Text panel. Apply a saved text style (§9) for consistent type. When a field is a
  list, its marker settings (bullet style, custom glyph, colour, size) appear just below.
- **Bulleted list** — marker style, colour, custom glyphs, and nesting.
- **Note / callout** — a highlighted aside.

### Media

- **Image** — paste a URL or upload. Set max width, alt text, and a caption; give it a per-mode
  light/dark source; toggle **Click-to-zoom** (on by default) to open it in a full-screen
  lightbox.
- **HTML Interaction** — embed a self-contained interactive HTML file; it's themed to match and
  ships inside the package.
- **Web Embed** — responsive embedded media, such as video.
- **Image hotspots** — pins over an image that open call-outs or navigate between screens. This
  is a rich tool — see §8.

### Layout

- **Card (container)** — a styled box holding child blocks (fill, border, radius, padding).
- **Columns** — a multi-column row; drop blocks into each column. Collapses to a stack on mobile.
- **Table** — a native table: header row, borders, zebra striping, cell padding, and per-column
  alignment. Edit cells directly on the canvas.
- **Divider / Spacer** — a rule, and vertical space.
- **Accordion / Tabs** — collapsible sections or tabs, styled like a card.
- **Card Reveal** — a grid of cards with three reveal modes: **Reveal** (a cover clears on
  hover/tap), **Flip** (click to flip in 3D), or **Off** (static). Set columns, gap, height, an
  optional surface texture, and per-card appearance.
- **Sequence (process / timeline)** — an ordered list of steps as a process or timeline. Choose
  the spine (numbered, dated, or plain), orientation, and reveal behaviour.
- **Card Deck (carousel)** — a paged carousel of full-frame cards the learner steps through with
  the ‹ › arrows. Each card holds any blocks.

### Interactive

- **Navigation button** — jumps to another page.
- **Acknowledge / Checkbox** — a gate the learner must tick.
- **Quiz (knowledge check)** — multiple-choice and other question types, with feedback, a
  pass panel, optional shuffle, per-quiz colours, and a celebrate-on-pass toggle. The pass
  panel's **Chapter summary** is a bulleted list you edit on the canvas; click into it and the
  Text panel's **List** settings (bullet style, custom glyph, marker colour and size) apply to
  it like any other list.
- **Chapter Card grid** — the auto-built chapter-menu component.

> **Note.** Interactive blocks can **gate the Next button** — the learner must complete them to
> advance. With gated progression on, a chapter's knowledge check can gate the next chapter.

---

## 8. Image hotspots & software tours

An **Image hotspots** block places pins over an image. Each pin either opens a **popover**
(a rich-text and image call-out) or **navigates to another screen** — so a set of screens
becomes a guided software walkthrough.

### Behaviour

Under **Behaviour**, **Default for new hotspots** sets whether a *newly added* hotspot starts as a
**Popover on click** or **Screen navigation**. It is only a starting point — each hotspot's own
**Action** (in **Selected hotspot**) is the truth, so **one experience can mix** popover and
navigation hotspots freely. Switching the default never rewrites hotspots you have already placed.
Add screens in the **Screens** list; the first is the **Entry** screen. Each screen has its own
image and pins, so a tour can go any number of levels deep. A navigation pin's **Goes to** menu
targets any screen (or mints a new one).

In a deep tour, the learner gets a **Back** control and, by default, a **Home** control (jumps
to the entry screen). Both are optional and their labels are editable. The navigation controls and
the progress counter sit in a bar **below the screen**, so they never cover screen content — and
the space beneath the image stays clear for step instructions.

### Point or region markers

Select a hotspot and pick its **Shape**:

- **Point** — the default info badge.
- **Box (region)** — a resizable, transparent outline that frames a UI element (a button, a
  field) without covering it. It takes the course accent colour and the same pulse, so it still
  invites a click. Set **W** and **H** as a percentage of the image, or drag the box's
  **bottom-right corner handle** on the canvas or the tour board to resize it. A region marker
  can open a popover or navigate, exactly like a point.

### Video & GIF screens

A screen's image can be a **video or GIF** (a screen recording) — upload it where the image
goes. A video screen offers a **Playback** choice:

- **Loop** — an idle animation that cycles.
- **Play once** — autoplays muted on arrival, then freezes on the last frame with an optional
  **Replay** button. Turn on **Reveal hotspots after it ends** to keep that screen's hotspots
  hidden until the video finishes — so a "continue" or a card only appears once the demo has
  played through. (Reduced-motion learners get those hotspots up front, so they are never stuck.)

Reduced-motion learners see the first frame with a Play button instead. A popover card can also
hold a video. Video is packaged as separate files in the SCORM zip, so the course still loads
fast and works offline.

### Completion

Under **Behaviour**, a tour counts complete once the learner has **visited every screen** —
which releases the page's Next when gating is on. Alternatively, pick a **completion screen**,
or switch tracking off (**Mark as viewed**) so a decorative tour never holds Next. A
**Navigation trail** toggle shows the learner a breadcrumb of the screens they walked.

### Captions

Give each screen a **Caption** (in its inspector, or the secondary field under the screen name on
its tour-builder node). A single caption line sits **beneath the screen** and updates to the current
screen's caption as the learner moves through the tour — a quiet, always-current instruction that
never covers the screen.

### Chrome: nav, counter, progress, restart

- **External nav buttons** (Back / Home) sit below the screen. Turn them off under Behaviour for a
  tour that drives navigation purely through on-screen markers.
- The **screens-visited counter** anchors top-right, above the screen.
- A video screen shows a thin **1px progress bar** along the bottom edge as it plays.
- When the interaction is **fully finished** — every screen visited and every play-once video
  watched to the end — a white **restart** button appears centred on the **final** screen (the
  completion screen, or a dead-end with nowhere further to go) so the learner can replay. It stays
  hidden until then, and hides again if they navigate back through the tour.

### Editing screens on the canvas

For a multi-screen hotspot, small **‹ ›** buttons flank the interaction on the canvas. Step through
the screens with them to place and clean up each screen's markers in place, without opening the tour
builder. A video screen shows its **final frame** on the canvas (paused), so you can place markers
against the real end-state UI instead of a blank frame.

### Tour builder

For a multi-screen tour, the Screens section has an **Open tour builder** button — a full-screen
board where every screen is a node laid out in 2D.

- **Navigate.** Pan with a two-finger or space drag; zoom with ⌘/Ctrl-scroll. A **floating tool bar**
  sits over the board with **Tidy**, the **Cards face-up** toggle and the **zoom / Fit** control — the
  same floating-toolbar idea as the main canvas.
- **Build.** **Upload screens** adds several images at once. Drag nodes to arrange them; the
  layout saves with the course. **Tidy** (⌘/Ctrl+T) snaps nodes into a clean grid.
- **Add a hotspot by clicking.** Press **Add hotspot** in the board's top bar, then click anywhere
  on a screen — a marker drops exactly where you click. Press **Esc** (or the button again) to cancel
  without placing.
- **Link.** Drag the **port** on a navigation pin to another node to draw or repoint its link;
  click a link's **×** to remove it.
- **Edit in place.** Drag a marker to move a hotspot, or nudge it with the arrow keys.
- **Properties drawer.** The board fills the screen; the **Properties** button (top bar) slides in a
  drawer for the finer settings — colours, card padding, blend, alt text, video playback, nav labels —
  showing whatever you've selected. It starts closed so the board dominates; **Esc** or the ‹ button
  closes it. Most building happens on the board and toolbar; the drawer is for the occasional deep tweak.
- **Quick actions in the toolbar.** Whatever you select adds its actions to the floating toolbar:
  a **screen** gets set-as-Home, set-as-Finish, replace image and duplicate; a **hotspot** gets its
  **Card ↔ Navigate** and **Point ↔ Box** toggles plus duplicate and delete; a **loop** gets wrap and
  delete. (Inside the builder those hotspot toggles live on the toolbar, so the Inspector stays for the
  finer settings.) **Right-click** any screen, hotspot or loop for the same actions as a menu. The
  **Home** screen is protected — it can't be deleted.
- **What you see is what they get.** Markers on the board render exactly as the learner sees them —
  the real colour, the point badge or the resizable region box, the pulse — so you place against the
  final look, not a stand-in. A selected marker gets a thin selection ring on top.
- **Video nodes.** A video screen carries a small **play badge** so you can tell it from an image
  at a glance, and its node posters on the video's **final frame**. **Hover** a video node to scrub
  its preview — move left-to-right across the node to seek through the recording.
- **Preview.** **Preview** runs an isolated test of just this tour without exporting; **Escape**
  returns you to the board.

> **Note.** The tour builder is an authoring aid only — it changes nothing in the exported
> course. Press **Done** or **Escape** to close.

### Loops (screen carousels)

To show one piece of UI across several states (off / warning / error) without wiring a separate
pin for each, use a **loop** — a frame holding an ordered set of screens the learner cycles as
one carousel.

- **Create one.** Click **Add loop** in the board's top bar, then drag screen nodes into the
  frame (or add them from the Inspector's **Add a screen** list). Reorder by dragging; a small
  number shows each member's place.
- **Point a pin at it.** Aim a navigation hotspot at the loop the same way you aim one at a
  screen. A pin that opens a loop shows a **stacked-cards** glyph so learners know it reveals a
  set of states.
- **How the learner sees it.** Clicking the pin opens the loop as a contained modal — one member
  screen at a time with **Prev / Next**, its name, and position ("2 / 3"). The **✕** lights up
  once they've seen every state. A **Wrap around** toggle cycles past the last screen back to
  the first. Every member counts toward completion.

---

## 9. Theming & design

Select nothing, and the Inspector shows document-wide design controls.

- **Light / dark.** The top-bar **☾** toggles the palette you preview. Learners get a toggle
  too; the palette crossfades between modes (tunable under **Motion**; respects reduce-motion).
- **Theme.** Edit the colour tokens for each mode — background, ink, accent, success, and so on.
- **Saved Text Styles.** Create named styles (font, size, weight, spacing, case, alignment,
  colour). Apply a style to any text; edit it once and every use updates. Renaming is safe —
  references repoint.
- **Custom fonts.** Upload any `.ttf/.otf/.woff/.woff2` to embed it, or pick a **Google Font**
  from the curated set — it's downloaded and embedded now, so the export stays offline-safe.
  **Exo 2** and **Arial** are always available.
- **Header & footer + learner nav.** Turn on a header, footer, logo, disclaimer, and the footer
  **nav pill** (progress bar, chapter-jump menu, light/dark toggle, glossary button).
- **Glossary.** Upload an abbreviations image (SVG recommended) — a **Glossary** button appears
  in the nav pill and opens it as an overlay.
- **Motion.** Tune the light/dark crossfade and the chapter-change fade (reduce-motion always
  wins).
- **Guided tour.** Turn on a short onboarding coach-mark tour, shown once at course start.
- **Page layout.** A master content-width cap and per-breakpoint page padding.
- **Shared Library.** Save a composed block to a machine-level library and reuse it across
  courses; edit the master and every course using it updates.

---

## 10. Variants

A course can carry **product variants** (e.g. two hardware models) that share most content but
differ in specifics. You author one **flagship**; each variant is a thin layer of overrides on
top, so unchanged copy stays shared and you maintain one source.

- **Switch flagship or variant** from the top bar. **Flagship** is the editable master; picking
  a variant shows a read-only preview. Edit a variant's wording where variant edits are allowed,
  and the change lands only on that variant's override.
- A block with no override for the current variant simply **inherits** the flagship copy.

**Compare side by side.** Open the **Copy editor** (the file-text glyph in the left rail) for a
full-screen, plain-text view of all course copy. With variants, a **Single | Side by side**
toggle appears: **Side by side** adds one column per variant. A held variant cell is read-only
behind a lock — click the lock to edit it; a block with no variant yet shows a **+** to create
its copy from the flagship.

---

## 11. Importing from a spreadsheet (CSV)

For bulk content, use **Import & Export → Import CSV**. Verso reads a flat schema
(`Page, Location, Path, Field, Type, Value`) and builds pages, blocks, and native quizzes.

- See `SCHEMA-TEMPLATE-GUIDE.md` and `course_schema_template.csv` in the app folder for the
  exact columns and an example.
- A **variant tag** column lets one CSV drive several product variants (§10).

---

## 12. Preview (Demo mode)

Click **▶ Demo** (or **⌘P**) for a full-screen, learner-accurate preview. It runs one page at a
time through the real runtime — navigation, quizzes, hotspots, gates, card flips, the light/dark
toggle, and the guided tour all behave exactly as they will for a learner. Switch device
breakpoints, page with **← / →**, and press **Esc** to exit.

> **Tip.** Preview is the truth. If something behaves oddly on the canvas, check **Demo** — it
> runs the real learner runtime.

---

## 13. Review & comments (Verso Viewer)

Gather stakeholder feedback without shipping a SCORM.

1. **Comment.** Turn on **Comment mode** (**C**, or the ▮ button) and drop pinned comments on
   the canvas or in preview, anchored to blocks and pages. Thread replies; resolve.
2. **Publish to Viewer.** Write a frozen `.versopub.json` snapshot to a shared folder. Reviewers
   open it in the standalone **Verso Viewer**, experience the course, and leave comments that
   save back to the same folder.
3. **Ingest reviews.** The editor auto-merges returned comments — pins land on the exact blocks.

> **Note.** Comments never ship in the exported course.

---

## 14. Publishing to SCORM

**Import & Export → Export SCORM** builds a SCORM 1.2 `.zip`. All fonts, images, and HTML
interactions are embedded, so the package is self-contained and runs offline. Upload the `.zip`
to Moodle as a SCORM activity.

**For air-gapped Moodle,** run the **`/publish`** prep on the exported package before uploading —
it embeds the Exo 2 fonts and forces an always-visible scrollbar (`scripts/scorm-publish.sh`).
Do this for every course headed for air-gapped Moodle.

**Backups.** Use **Export JSON** to save a portable copy of the whole course; **Import JSON**
restores it.

---

## 15. Keyboard shortcuts

`⌘` = Cmd (macOS) / Ctrl (Windows).

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
| Hide / show side panels | ⌘\ |
| Comment mode | C |
| Edit text (on a selected field) | Double-click, or Enter |
| Step selection out one level | Esc |
| Delete selection | Delete / Backspace |
| Nudge selection | Arrow keys |

---

## 16. Troubleshooting & tips

- **Your course lives in this browser.** Export a JSON backup regularly, and before clearing
  browser data or switching machines.
- **Neon-pink block?** That's an unfilled image or interaction placeholder — an authoring cue
  only. It never appears in preview or the export.
- **Something looks wrong on the canvas?** Check **Demo** — it runs the real learner runtime, so
  it's the source of truth.
- **Reduce motion is respected.** Every fade and animation is disabled for learners who prefer
  reduced motion.
- **Air-gap rule.** Anything a learner sees is embedded, never fetched at runtime. You can be
  online while authoring; the shipped course sends nothing out.

---

*This guide reflects the app as built. When a screen doesn't match, the app — and the
`SCHEMA-TEMPLATE-GUIDE.md` and `SPEC-*.md` docs in this folder — are the source of truth.*
