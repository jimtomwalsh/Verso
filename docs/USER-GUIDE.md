# Verso User Guide

Verso is a browser-based tool for creating technical documentation and learning materials, and
publishing them in different formats — including interactive **SCORM 1.2** courses that run in an
LMS. Everything runs locally — no server, no account. This guide takes you from opening the app to
publishing your first project. New here? Read the Quick start, then dip into any section from the
search box on the left.

> **What you build.** A project is a set of **chapters**, each holding **pages**, each page built
> from **blocks** (text, images, quizzes, interactions). You can reuse blocks across documents.
> The published output is self-contained — fonts, images, and interactions are embedded, so it
> runs fully offline.

---

## 1. Quick start

Build and export your first course in a few minutes.

1. **Open Verso.** Launch the desktop app, or open `index.html` in a browser (serve the folder
   over `http://` so export and fonts work — see §2).
2. **Add a page.** In the **Structure** panel on the left, click **+** to add a page.
3. **Add a block.** Switch the left panel to **Blocks** and click **Heading**, then
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

**Create a document.** The **＋** beside the tabs opens **New document**: pick a **Product**
(defaults to the one you're scoped to), a **preset** — the starting matrix cell (eLearning,
Presentation, 1-pager, Quick-start guide, Responsive doc), each shown as *geometry · interactive
or static* — then a **title** and **code**. The document is born in that Product and that cell;
you can change the cell later. The same dialog also opens a saved course, imports a document, or
loads a sample.

**Change the document type later.** The **cell chip** in the editor header (e.g. *Reflow ·
Interactive*) opens a small menu to change the document's matrix cell after creation. Toggling
**Interactive / Static** applies at once; switching the **geometry** (Reflow / Fixed frame /
Paged) warns first, because content reflows into the new geometry and may not survive 1:1 — you
can switch back. In a **Static** document the interactive block types (Quiz, Image hotspots,
Web/HTML Embed, Accordion, Card Reveal, and the rest) are hidden from the Blocks library; any
interactive blocks you already placed are kept, and turning interactivity back on restores them.

> **Note.** Your course lives only in this browser. Export a **JSON** backup regularly and
> before clearing browser data or switching machines (§15).

---

## 3. The workspace

Verso has three panes: **Structure/Blocks/Components** (left), the **Canvas** (centre), and the
**Inspector** (right). A slim **global bar** runs across the very top, and the Edit stage has its
own **editor header** beneath it.

![The Structure panel: the outliner of chapters and pages, with the Blocks palette below.](docs/assets/structure-panel.webp "The Structure panel — the outliner of chapters and pages.")

- **Global bar (very top).** App-level only: the **Verso** mark, the **product picker** (sets the
  active product across Source, Edit and Publish — and **scopes the open tabs** to that product;
  "All products" shows every open tab; your choice is **remembered across refresh**), a **＋** beside
  it to **create a new product** from scratch, and the **storage-health dot**.
- **Editor header (Edit stage).** Everything about the document you're editing lives here, on one
  bar split into three zones by faint dividers. **Tabs** (left): the **file-picker** (▤, browse all
  courses — a browser **grouped by document type**, colour-coded, each card showing its product,
  interactive/static and whether it's open; it respects the product scope and opens automatically
  when no course is open) and the **open-course tabs**, each carrying a per-product colour dot.
  **Document** (right of the tabs): a **Document-settings** button (⚙, opens this document's settings —
  **Document type** (geometry + interactivity, set once), Header & Footer, Learner nav, Theme and the
  rest; app-wide settings live under the left-rail cog), the **Build / Read** toggle (glyphs), and the
  **variant** and **software-version** selectors as **named dropdowns** (they show the current value —
  "Flagship", the version name — at a glance). **Output** (far right): the **▶ Demo** preview and **Send
  to publish**. **Light / dark** now lives in the Demo button's **▾** menu, under the size presets. When
  many courses are open the tabs scroll within their own strip so this cluster never moves. The header
  shows only in the Edit stage.
- **Left (a 3-way switcher: Structure · Blocks · Source).** Pick one section at the top of the
  panel. **Structure** — the outliner of chapters and pages as a tree. **Blocks** — the insert
  palette for built-in block types (Text, Media, Layout, Interactive…), with **Reusable
  components** beneath it: **My Components** (course-local), **Blocks** and **Pages** (the shared
  cross-course library, §9). **Source** — a **read-only, live view of the open document's product
  source**: the same source document you'd see in the Source stage, in a narrow reading column,
  with a **search box** (type to find, Enter / Shift+Enter to cycle matches) and a **table of
  contents** that jumps to a chapter and tracks where you're reading. It keys off the document you
  have open (its product), not the product picker, so it always matches the course in front of you.
  It's read-only — all source editing stays in the Source stage. The panel remembers which section
  you last used.
  **Placing linked copy.** Select any passage in this panel (a phrase, or a heading through a
  paragraph in one sweep) and a small bar appears at the selection with a **drag handle** and a
  **Place** button. Two ways to place it: **drag** the handle onto the canvas — a ghost follows your
  cursor and the target page lights up — and release; or click **Place** then click a spot in the
  canvas (**Esc** cancels). Either way the passage drops in as **live-linked** text in your
  document's own styles. If your selection spans **different formats** — a heading and a paragraph —
  it splits into one block per format (a heading block, then a body block), each independently
  styleable with the normal text-block controls; two passages of the same format stay in one block.
  Drop a passage **onto an existing text block** instead of into a gap and it merges in as a locked
  **inline span** at that block, so one block can mix your own words with linked source copy — each
  linked span carries its own indicator. Drag a source **figure** (a diagram) as a whole and it
  drops as a linked **image** block. Linked copy is **locked** — you can't edit it directly, so it
  can't drift from the source — and it updates automatically whenever the source wording changes. A
  linked block (or span) shows a **link badge**; click it for a menu that jumps back to the exact
  source passage, or lets you say it differently here. **Alternates** are the sanctioned way to
  diverge without breaking the link: pick **Create an alternate…** to fork a named wording that
  applies to *this block only* (and registers on the source, so you can reuse or push it later), or
  pick an existing alternate — or **Base wording** to reset. Passages you've already linked into the
  open document are **highlighted** in the panel, so you can see what you've used.
- **Canvas (centre).** An infinite, zoomable board of your pages. Scroll to pan, ⌘+scroll (or
  pinch) to zoom. Every page is a live, editable render of what the learner will see. The board
  follows the document's **geometry** (set by its preset, §2): **reflow** flows content down a
  fluid page (eLearning / web); **fixed frame** shows each page as one fixed screen and clips
  anything past it with an amber *overflows* warning (decks); **paged** shows page-break guide
  lines, so content reads across pages (print / guides). The same blocks render in every geometry.
- **Inspector (right).** Context-sensitive: with nothing selected it shows the **Document**
  context — the document type (its geometry · interactivity) with that geometry's tools (paged →
  margins / running header-footer / page breaks / page numbers; frame → frame size / transitions /
  animation; reflow → breakpoint preview) — then the canvas backdrop. Select a block and it shows
  that block's settings instead.

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

**Insert a block.** Switch the left panel to **Blocks** and click or drag a block onto a page — or
into a container (**Card**, **Columns**, **Card Reveal**). For a reusable component you've already
saved (§9), use the **Reusable components** beneath the palette in the same Blocks section.

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

- **Heading / Subheading / Paragraph / Quote** — rich text. Select some text to **Bold**,
  *Italic*, underline, or add an inline **Link** — same formatting bar in the Text panel and the
  Copy editor. **List** in that same bar converts the WHOLE block to a bulleted list and back
  (no text selection needed) — your wording carries over line by line, and converting back
  restores the original block type (heading stays a heading, paragraph stays a paragraph). Apply
  a saved text style (§9) for consistent type. When a field is a list, its marker settings
  (bullet style, custom glyph, colour, size) appear just below.
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
  Drag the gap between two columns to resize them; hover a gap for a **swap** glyph that
  exchanges those two columns' content in place.
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
- **Source videos (harvest a tour from a recording).** **Add source video** drops a video onto the
  board as a **Source** node — a scratch surface you build screens from instead of pre-cutting them
  elsewhere. Each source has its own **player**: play/pause, a **playhead** you can drag or click to
  scrub, a time readout, and **Set in** / **Set out** to mark a segment (the marked range highlights
  on the scrub bar). A source is **author-time only: it is never included in the exported course**, so
  a long screen-recording never bloats your package. It stays saved with the course so you can come
  back and keep working from it; the **trash** button on the node removes it (screens you've already
  made from it are kept). To clear every source at once (e.g. once you've finished harvesting and
  want to slim the save file), open the Properties panel with nothing selected and use **Purge all
  sources** near the bottom — it removes all source recordings in one step; screens you've already
  harvested stay.
- **Crop the source (uniform size).** The **crop** button on a source's player shows a crop frame over
  the video — drag it to move, the corners to resize. Every screen you then harvest from that source
  comes out at that **same size**, so a set of screens lines up perfectly. Re-cropping only affects
  screens you make *after* the change (ones you already harvested keep their size).
- **＋ Screenshot (freeze a frame into a screen).** With a source scrubbed to the moment you want,
  press **Screenshot** on its player — Verso freezes that exact frame into a **new image screen** on
  the board, named after the source and the time (e.g. "Capture 0:07"), and selects it ready for
  hotspots. It's a normal screen from then on. Harvest as many as you like; they stack down their own
  column.
- **＋ Segment (turn a clip into a screen).** Mark **Set in** and **Set out** on a source, then press
  **Segment** — Verso records that stretch of the video into a **new video screen** (silent, cropped to
  the source's crop, so it matches your screenshots). It plays once and freezes on its last frame, and
  carries the full hotspot-video behaviour (progress bar, reveal-after-end). Recording runs in real
  time, so a ten-second clip takes about ten seconds. **Segment** is greyed out until a valid in/out
  range is marked.
- **Re-bake from source (non-destructive tweaks).** A screen you harvested remembers where it came
  from. Select it and press **Re-bake from source** (on its toolbar) to re-capture it from the source
  — handy after you crop the source or want the frame nudged. It **updates the screen in place**: the
  hotspots and links you've already added to it are kept. (Available only while the source is still on
  the board.)
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

- **Light / dark.** Open the **▾** menu on the **▶ Demo** button (under the size presets) and pick
  **Light** or **Dark** to switch the palette you preview. Learners get a toggle too; the palette
  crossfades between modes (tunable under **Motion**; respects reduce-motion).
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
- **Shared Library.** Right-click a block and choose **Save as component…** (or use the
  Inspector's equivalent button) to save it to a machine-level library and reuse it across
  courses. Clicking the resulting entry in the **Components** pane's **Blocks** group places a
  **live-linked instance**, marked "linked" on the canvas — edit the master (Settings → System →
  Component Library) and every placement updates automatically, including already-exported courses you
  re-export. A linked instance is read-only in place on the canvas; select it, use **Edit
  library instance settings**, and an **Overrides** field per text field on the master lets
  you change that one placement's wording without touching the master or breaking the link —
  leave a field empty to keep inheriting from the master. If the master's structure changes
  and an override's field no longer exists, it's dropped automatically and flagged the next
  time you open that instance. Use **Detach** to convert a placement into an independent,
  editable copy (any overrides are kept as its own content; it stops receiving master
  updates) — a detached block remembers where it came from, so **Relink to library** can
  re-attach it later (replacing its content with the master's current content). Each entry
  in Component Library also shows **"Used in N courses / M instances"** so you can see a
  master's blast radius before touching it; overwriting or removing a master shows that
  count again as a confirmation. Placements always resolve the master's current content the
  moment they're viewed — there's no separate publish step — but **Push update** gives you an
  explicit "yes, this is live everywhere" confirmation and durably saves the master.
- **Multi-block and whole-page masters.** Select two or more blocks, right-click, and choose
  **Save selection to library…** to capture the whole selection (grouped) as one reusable
  master — same live-link/Overrides/Detach behaviour as a single-block master. To reuse a
  whole page, right-click its label above the canvas (or use **Save page to library…** in its
  Inspector). Placing a page master back into a course is done from the **Components** pane's
  **Pages** group — click an entry to live-link a new page right after the current one. A page
  instance is read-only in place on the canvas; its own Inspector gets the same Overrides /
  Detach controls a block instance does. **Known limitation:** any navigation button or menu
  link *inside* a captured page that points to another page is **not** rewired when the page
  is placed elsewhere — check and fix links after placing a page master into a new course.
- **Components pane vs. Component Library.** The **Components** left pane (above) is where you
  *browse and insert* — My Components, Blocks, Pages. **Settings → System → Component
  Library** is where you *manage* the shared library — rename, overwrite, remove, import/export
  JSON, see where a master is used, and push updates. Both read from the same shared library;
  they just serve different jobs.

---

## 10. Variants

A course can carry **product variants** (e.g. two hardware models) that share most content but
differ in specifics. You author one **flagship**; each variant is a thin layer of overrides on
top, so unchanged copy stays shared and you maintain one source.

- **Switch flagship or variant** from the editor header. **Flagship** is the editable master; picking
  a variant shows a read-only preview. Edit a variant's wording where variant edits are allowed,
  and the change lands only on that variant's override.
- A block with no override for the current variant simply **inherits** the flagship copy.

**Compare side by side.** Switch the editor header's **Build / Read** toggle to **Read** for a
plain-text view of all course copy; **Build** returns you to the canvas. With variants, a **Single | Side by side**
toggle appears: **Side by side** adds one column per variant. A held variant cell is read-only
behind a lock — click the lock to edit it; a block with no variant yet shows a **+** to create
its copy from the flagship. Click into any row to select some text and use the **B / I / U /
Link** toolbar plus the **Weight** dropdown — the same formatting controls the canvas Inspector's
Style row uses.

**Shared Library masters inherit variants and software versions too.** If you gave a block
per-variant or per-software-version wording *before* saving it to the Shared Library (§9), every
placement of that master automatically shows the right wording for whichever variant/version the
host course is currently on — no extra setup. A placement's own **Overrides** (§9) always win
over the master's variant/version content if both target the same field. **Detach** bakes in
whatever you were previewing at the moment you detached, not the master's flagship/base content.

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

## 14. Collaborating in server mode

When your team runs Verso on a shared server (rather than the standalone app), several people
can edit the same course at once. **The standalone `file://` app is unchanged — this section
applies only in server mode.**

- **See who's here.** Avatars of everyone in the course show in the top bar, each in that
  person's colour (the same colour their comments use). A solid ring means they're editing; a
  hollow ring means they're just viewing, and a small flag shows where a colleague is looking.
- **Edit together, safely.** The moment you start typing in a block it becomes yours. A block
  someone else is editing shows read-only with their "editing…" badge, so two people never
  overwrite each other, and their edits appear on your canvas live without disturbing your cursor.
- **Ask for a block.** Click a colleague's "editing…" badge to **Request handoff** (a nudge to
  release it) or **Notify me when free** (you're told the moment it frees).
- **Nothing is lost.** Your in-progress edits are saved on your own machine as you type, so a
  dropped connection or a closed tab is survivable — they replay when you reconnect. If a block
  changed while you were away, Verso shows a **prompt to keep your version or theirs** — never a
  silent overwrite.
- **Previews are read-only while collaborating.** With others in the file, editing always targets
  the base course; previewing a variant or software version is view-only, which keeps everyone's
  edits and history unambiguous.

**Review links.** Share a link to a **frozen snapshot** of a course. A reviewer opens it in their
browser — no app, no account — reads it, and leaves comments pinned to the content. Their comments
appear back in your editor, pinned to the live block and tagged **Guest** so you can tell them from
your team's notes; reply and resolve, and they see it on their link. If you later delete a block a
reviewer commented on, their note isn't lost — it moves to an **Orphaned** list so you can re-place
or dismiss it.

---

## 15. Publishing to SCORM

**Import & Export → Export SCORM** builds a SCORM 1.2 `.zip`. All fonts, images, and HTML
interactions are embedded, so the package is self-contained and runs offline. Upload the `.zip`
to Moodle as a SCORM activity.

**For air-gapped Moodle,** run the **`/publish`** prep on the exported package before uploading —
it embeds the Exo 2 fonts and forces an always-visible scrollbar (`scripts/scorm-publish.sh`).
Do this for every course headed for air-gapped Moodle.

**Backups.** Use **Export JSON** to save a portable copy of the whole course; **Import JSON**
restores it.

---

## 16. Keyboard shortcuts

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

## 17. Troubleshooting & tips

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

## 18. Product Rail: Source stage (early)

Product Rail groups your courses under **Products** (e.g. a hardware line), with a left rail
switching between **Source** (reference wiki), **Edit** (the course canvas you already know), and
**Publish**. This section covers Source — an early feature, still growing.

**One document per Product (Source v2).** A Product's source is now **one continuous document**,
not a list of separate topics. The first time you open the Source rail for a Product, the topics
you imported are joined into a single document — each becomes a top-level **chapter**, its headings
nested underneath. Nothing is thrown away; the original topics are kept, so this is reversible.

- **The left rail is the document's table of contents.** Chapters sit at the top level with a twirl
  to fold their headings in or out; click any entry to jump to it; the entry you're reading
  highlights as you scroll. The button above the outline collapses every chapter at once (and
  expands them again). Drag a chapter to move that whole chapter (and everything under it) within
  the document — the dragged row dims and a line shows exactly where it will land.
- **Find in the document.** The search field above the outline finds your text anywhere in the
  document — headings and body copy — as you type. It shows a match count ("3 / 12"); press Enter
  (or the up/down arrows next to the count) to jump between hits, each scrolled to and highlighted.
  The outline narrows to the sections that contain a match, so it doubles as a filter, and it
  scrolls to and highlights the entry that owns the hit you're on so you never lose your place.
- **The one action left in the rail is Import from Markdown.** Because there's one document, the old
  per-topic tools — new topic, select, delete, move, reorder topics — are gone. Import is now
  **additive**: pick a Markdown file (it can be a segment — just one chapter), and Verso shows a
  **preview** first — which chapters it will **add** and which existing chapters it will **update**
  (with how many blocks change), matched by chapter name. Nothing changes until you click **Apply
  import**; an update keeps the parts you haven't changed (so any alternates or comments on them stay
  put) and only adds or removes what actually differs. There's no silent whole-document overwrite.
- **Bringing in a variant's manual.** If your Product has variants declared, importing asks first
  whether the file updates the **Flagship** (the base) or a **variant**. Choosing a variant runs a
  **combine**: it reconciles that manual against the Flagship per paragraph and previews exactly what
  will **diverge**, go **absent**, or be **added** for that variant before anything is written — the
  Flagship base is never rewritten. (Choosing Flagship runs the normal additive import.)
- **Comparing variants as columns.** Above the document, a chip row switches variants on. With none
  on, the document reads and edits as normal (Flagship). Turn a variant on and every paragraph that
  differs **splits into side-by-side columns** — one per shown variant — while paragraphs they all
  share stay a single column; a paragraph a variant omits shows "Not in this variant". The column
  view is for comparison and is **read-only** — turn the variants off to edit again.
- **The first import into a new Product** builds the continuous document straight away — you land in
  the one-document view (chapters in the outline), not an intermediate per-topic list.

The rest of this section describes the earlier per-topic shape, which Source v2 is replacing;
authoring a chapter's text, importing, annotations, history and comments all work as described.

**Attaching a course to a Product.** Open a course, then **Save/Recents → Promote to Product…**.
Pick an existing Product or create a new one, choose a Format (eLearning, Presentations, or Print
docs), and promote. This only tags the course — its content is never touched. The top-bar Product
dropdown then lets you switch between every course, and the Source wiki, for that Product.

**Exporting the source to Markdown.** On the **Source** stage, the **Product actions** menu (the ⋯
button by the toolbar) has **Export to Markdown** — it downloads the Product's whole continuous
document as a portable `.md` file (named after the Product). Headings, paragraphs, bold/`inline code`,
bullet and numbered lists, tables, images, and callouts all come across, so it round-trips with the
Markdown import. Nothing is changed in the app; it's a save-a-copy.

**Unlinking and deleting.** To detach a course from its Product, open it and choose **Save/Recents →
Remove from Product** (the course and its content stay; only the tag is removed). On the **Source**
stage, the **Product actions** menu (the ⋯ button by the toolbar) lets you **Unlink all courses** from
a Product, **Delete source document** (clears the whole continuous document but keeps the Product), or
**Delete Product** (removes the Product entirely, including its source and the tag on any linked
course). The deletes ask for confirmation and can't be undone.

**Populating the Source wiki.** Switch to the **Source** rail tab, pick a Product from the top bar,
then use the icon toolbar above the topic list (hover any icon for its name):

- **New topic** — creates a blank topic you write directly, the same click-to-edit way as a
  course's text blocks: click a heading or body to edit it, click away to save. Editing a body
  is real formatted text, not raw Markdown — bold/code/bullets show as themselves while you
  type, never as `**`/`` ` ``/`- ` marks. A small toolbar (Bold, inline code, bullet list)
  appears next to whichever block you're actively editing; the section widens while you're in
  it so you can see the whole thing.
- **Import from Markdown…** — creates topics straight from a Markdown file (e.g. a manual you've
  converted to `.md`). Numbered headings (`# 1`, `## 1.1`, `### 1.1.1`) split into topics and
  sections by their number — the number itself decides the split even if the file's own `#`/`##`
  levels are inconsistent (common in converted manuals); the number is never shown in the wiki
  itself, only used to organise it. A `1` becomes a topic, its `1.1` headings become that topic's
  sections, and anything numbered deeper folds into the section text as a bold line. Bold, inline
  code, bullet lists, numbered lists, and Markdown tables in the file all carry over. If the Product has no
  declared variants, this opens your file picker directly; if it does, a small dialog lets you
  add one optional file per variant, whose matching sections become that variant's own text (via
  the same "Diverge for `<variant>`" mechanism described in §10) — a section that only exists in a
  variant's file is added with blank Flagship text so nothing is lost. Only import produces the
  wiki's "Technical" version of each section; the "Digestible" and "Dot-point" versions (switchable
  above the article) are yours to write afterward. You can optionally note each file's version and
  publish date when asked — shown later in the topic's info panel under "Source".

**Re-importing an updated manual.** Run "Import from Markdown…" again with the same filename for
the same Product, and it updates the existing topics instead of duplicating them: a section whose
text changed only in the file is updated automatically; a section you haven't touched since the
last import is left alone if the file didn't change it either. If a section changed **both** in
the file and in what you've since written in the wiki, nothing is overwritten — a small "Source
updated" flag appears next to its heading. Click it to see exactly what changed (added lines in
green, removed in red), then choose **Use updated text** or **Keep mine**. Whenever a Product has
1+ topics with a pending flag, a **Needs review** chip appears above the topic list — click it to
filter down to just those topics.

If you rename the manual file and import it under its new name, and its topics substantially
match ones already imported from a different filename for this Product, you're asked whether it's
the same manual (updates the existing topics under the new filename) or a genuinely separate one
(imports as new topics instead) — nothing is guessed silently.

**Reordering.** Under Source v2 (above), reorder by dragging a **chapter** in the document outline —
the old per-topic reorder, multi-select, delete, and move-to-Product tools are gone with the topic
list, since a Product is now one document.

**Reordering and removing sections.** Hover a section to reveal its controls: drag the grip handle
to reorder it within the topic, or click the trash icon to delete it (you'll be asked to confirm).
Controls stay out of the way until you're actually looking at that section.

**A topic's history.** The info panel's History section shows every import and re-import that
touched a topic as a timeline, newest first — file, version, publish date, and what changed each
time (new sections, sections updated from source, sections flagged for review). A topic you wrote
by hand shows a single "Created" entry. In continuous-document mode (below) the same timeline also
records your edits and annotations (see "History records what changed and why").

**Comments.** The same comment/discussion feature as the canvas editor, for this wiki. Click the
comment icon next to any section to open its thread — write a note, reply, mark it Resolved, or
delete it. A count appears on the icon while a section has unresolved comments. The info panel's
Comments section lists every comment on the topic (Open / Resolved), including any left
"Orphaned" if the section they were on gets deleted — nothing is silently lost.

**Continuous-document mode (beta).** A newer way to author a topic: instead of separate sections
with Technical/Digestible/Dot-point versions, the whole topic reads and edits as **one continuous
document** — like the manual it came from. Open a topic and click **Switch to continuous document
(beta)** at the bottom of the article; your existing section text is carried over (nothing is lost).

In this mode:

- **The source is locked by default.** The signed-off prose is protected — a bar docked at the
  bottom-centre shows a padlock; click it to **unlock** and edit the base text, click again to
  lock. Trying to type while locked shows a brief reminder instead of changing anything.
- **You can always annotate, even when locked.** Select any text and a small toolbar appears above
  it. **Add an alternate** (another way to say the same thing, for a particular course or
  audience) or **Comment** — both are available whether or not the source is unlocked. The
  rich-text buttons (bold, italic, bullets) only appear once you've unlocked, since they change the
  base prose. There is no "link" button here: linking a course to a piece of source happens in the
  Edit stage, not Source.
- **Select as little or as much as you like — one word to the whole document.** A selection that
  spans several paragraphs (or titles) is fine, locked or unlocked: the toolbar still appears, so an
  alternate or a comment can cover a whole passage, not just a single paragraph. A multi-paragraph
  mark highlights across every paragraph it covers and rides your edits the same way — edit the middle
  of it and it stays put.
- **Editing across paragraphs.** Once unlocked, a selection that spans paragraphs edits as one: type
  over it, or press Delete/Backspace, and the covered text goes — the paragraph you started in and the
  one you ended in join into a single paragraph, and any paragraphs wholly inside the selection are
  removed. A Backspace at the very start of a paragraph (or Delete at the very end) merges it with its
  neighbour. Undo (Ctrl/Cmd+Z) puts the paragraphs back.
- **Insert an image or a table.** Once unlocked, the bottom bar shows an **image** and a **table**
  button. Each drops the new block **after the block you're in** (or at the end of the document if you
  haven't clicked into one). An image opens your file picker and is stored in the document itself; a
  table starts as a small 2×2 you can build out. Both are whole **objects** — click to select, and the
  same alternate / comment actions apply. (The buttons are hidden while the source is locked.)
- **Alternates: one base, many renditions.** The base prose is the single source of truth. When a
  particular course needs to say a span differently, add an **alternate** — the same meaning, no new
  information — and optionally tag it with what it's *appropriate for* (e.g. "quick-start" or
  "plain-language"). A span can carry several, and most spans carry none. Selecting a span that has
  an alternate opens a **panel pinned in the right margin** that tracks the span as you scroll,
  showing the **base vs the alternate**, a status dot, and Edit / Delete.
- **Images and tables are markable too.** An image or a table is a whole **object** — click it (a
  ring shows it's selected) and the same **Add an alternate** / **Comment** / **Add a link** actions
  appear, so you can attach, say, a simplified caption to a diagram, a note to a table, or a link on
  an image (its **Linked in** panel then tracks where it's used). An object's mark is tied
  to the object itself, so it stays put no matter how you edit the prose around it; a marked object
  carries the same status tint as a marked span, and its alternate/comment opens the same margin
  panel (its "base" line names the object, e.g. "Image — <caption>").
- **Resize an image.** Select an image (with the source unlocked) and grab handles appear on its
  left and right edges. Drag either handle to resize it live; it grows and shrinks about its centre,
  with a light snap at 25 / 50 / 75 / 100% of the column width. Release to set the size — it persists
  and travels with the document. Leave it at full width to fill the column.
- **Align an image.** When an image is selected, its floating toolbar also has align **left /
  centre / right** (centre is the default). Choosing one positions a resized image within the column;
  a full-width image looks the same whichever you pick. The choice persists with the document.
- **Place images side by side.** The image toolbar's **columns** button puts the selected image
  beside the next one, in a row (up to three across). Each image in the row keeps its own size and
  its own comments / alternates / links. Select an image already in a row and the same button
  **takes it back out**. Text stays full width above and below the row.
- **Staleness keeps alternates honest.** If you later change the base text, any alternate written
  against the old wording is flagged **stale** (an amber dot, a note in the panel, and an entry in
  History) — nothing is silently rewritten. Reword the alternate to match, then click **Mark
  reviewed** to clear the flag. Deleting a span's text flags its marks **broken** (a red dot);
  Ctrl/Cmd+Z brings the text and the mark back.
- **See where a span is used, and push a wording out.** When documents link a piece of this source,
  selecting the linked span opens a **"Linked in N"** panel in the right margin — one row per place
  it's used, each tagged **base** or **alternate**, and clicking a row opens that document in Edit
  with the exact block selected. If the passage has alternates, **Push an alternate…** sends a
  forked wording to those documents — all of them, or a chosen subset — so you can roll out a better
  wording deliberately. A placement keeps showing **base** until an alternate is chosen for it or
  pushed to it; pushes are never automatic. A span that isn't linked anywhere says so.
- **Editing linked source warns first.** If you unlock and change wording that other documents link,
  locking shows a **"linked in N places"** check before it propagates: **Update all** (the linked
  copies re-resolve to your new wording), **Keep as-is (fork)** (freeze their current wording as an
  alternate, then your source moves on), or **Cancel** (undo the edit). A placement already pinned to
  an alternate is never touched by a base edit.
- **Comments live in the margin.** Selecting text and choosing **Comment** drops a small **blue
  comment glyph just to the right of the text** next to that span; the pin tracks the span as you
  scroll. It matches the canvas comment glyph — subtle, no box. Click a pin to open
  the thread in place — the same comment threads, replies, and Resolved control as the canvas
  editor, so a comment behaves the same everywhere. Add more comments or replies, tick **Resolved**
  when it's handled, and both events show up in History. Comments can be added while the source is
  locked. Click away or press **Esc** to close a thread.
- **Marks ride your edits.** An alternate or comment is anchored to the exact span you selected;
  as you edit around it the anchor moves with the text, and if you delete the anchored text the
  mark is flagged as broken. **Ctrl/Cmd+Z** is a document-aware undo — it restores deleted text
  *and* reconnects its mark, which the browser's own undo cannot do.
- **History records what changed and why.** The info panel's **History** timeline now shows your
  editing, not just imports. A run of prose edits between unlocking and locking collapses into one
  **"Edited source"** entry (with a `+added / −removed` character summary), so the log reads as
  meaningful changes rather than keystroke noise. When you **lock**, a small dialog offers an
  optional note — *why* you made the change — which you can type or **Skip**. Structural events
  each get their own entry: an alternate added, a mark going stale, broken, or restored, a comment
  opened or resolved. Import events (from the section view) and these doc events share one timeline,
  newest first.
- **Show/hide marks** with the eye button in the bottom bar. Marked spans are tinted by type
  (linked / alternate / comment), so annotation never clutters plain reading.
- **Jump around with the outline.** A **table of contents** down the left side lists the document's
  headings; click one to jump to it, and the heading you're currently reading stays highlighted as
  you scroll. (The outline hides itself on a narrow window so the reading column keeps its width.)
- **Find a topic by anything in it.** The topic search at the top of the left nav now matches the
  full text of every topic — a heading or a phrase inside the document, not just the title.
- **One details panel on the right.** Everything about the document lives in a single right panel:
  **Marks** (every alternate, link, and comment with a status dot — green in sync / amber stale /
  red broken; filter to **Alternates**, **Linked**, or **Comments**, and click a row to jump to that
  mark), **History** (the provenance timeline), **Source** (where the document came from, and where
  it's used), and **Comments**. The bottom-bar panel button shows or hides it; selecting a mark opens
  the panel to that mark. (This replaces the older split of a fixed info panel plus a separate
  slide-over marks drawer.)

This is an early view — the variant columns arrive in a later update; the section editor above
remains the full-featured path.

---

## 19. Product Rail: Publish stage (early)

The **Publish** rail tab is a **persistent publish queue** — like a render queue. You line up the
documents you want to package, then run them all with one button; the queue is saved, so it survives
a refresh and a stage-switch.

- **Left — pick documents.** A list of your documents, scoped to the Product chosen in the top bar
  (all documents when no Product is selected). Click **+** on a row to add it to the queue, or use
  **Add current document** at the top to queue the document you have open. A solo export is just a
  queue of one.
- **Send straight from the editor.** You don't have to switch stages first: the top-bar **Import &
  export** (⋯) menu has **Send to publish queue**, which drops the document you're editing into the
  queue with its remembered preset — no configuration — and confirms with a small toast. Queue a few
  in a row, then switch to Publish and run them.
- **Right — the queue.** One row per document, each showing its status — **Pending**, **Publishing…**,
  **Done** (with the package's file name), or **Failed**. Remove a row with **×**. Adding a document
  that's already queued re-arms it rather than duplicating it.
- **Presets.** Each queue row shows an **output preset** chip — click it to switch the row's preset,
  save the current settings as a new named preset, or rename/delete one of your own. Three come built
  in: **Master** (full quality), **Review copy** (adds the reviewer file, learner theme off), and
  **Lightweight** (optimises media hard for a smaller package). Presets are shared across the app, and
  each document remembers the preset it last used, so re-queuing it is one click.
- **Publish.** One **Publish** button runs every pending row in turn: each is packaged as a SCORM
  `.zip` (using that row's preset) and downloaded. Done rows stay in the queue, greyed, with their
  result — the queue isn't cleared, so you can see what shipped.

This is an early view — a chosen save folder and staleness dots arrive in later updates.

---

*This guide reflects the app as built. When a screen doesn't match, the app — and the
`SCHEMA-TEMPLATE-GUIDE.md` and `SPEC-*.md` docs in this folder — are the source of truth.*
