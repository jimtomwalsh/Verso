## 3. The workspace

Verso has three panes: **Structure/Blocks/Components** (left), the **Canvas** (centre), and the
**Inspector** (right). A single **top bar** runs across the very top of every stage.

![The Structure panel: the outliner of chapters and pages, with the Blocks palette below.](docs/assets/structure-panel.webp "The Structure panel — the outliner of chapters and pages.")

- **Top bar.** One bar carries everything, left to right. **Identity** (always shown): the **Verso**
  mark, the line saying **where you are**, and the **storage-health dot**.

  **One place answers "where am I".** In Source and Edit that line reads *document title · product*
  (or *· No product*); in Files and Publish it reads **Files** or **Publish**. There is no
  breadcrumb and no second copy of it anywhere — when several places answer the same question they
  drift apart and none of them can be trusted.

  **Product is a tag, not a mode.** There is no product picker and no "active product". A document
  carries a product or carries none, and nothing is hidden either way: every open document has a
  tab, the document browser lists everything, and Publish offers everything. You tag a document with
  a product when you create it or from its card menu, and the tab's **colour dot** is how you read
  that tag at a glance. **New Product** in the document browser creates an empty one — it does not
  switch you into anything, because there is nothing to switch into; tag a document with it and the
  product has content.
  The rest of the bar appears **only in the Edit stage** and covers the document you're editing, in
  three zones split by faint dividers. **Tabs:** the **file-picker** (▤, browse all courses — a
  browser **grouped by document type**, colour-coded, each card showing its product,
  interactive/static and whether it's open; it lists every course and opens automatically
  when no course is open) and the **open-course tabs**. Each tab carries a **doc-type glyph** (course,
  presentation, or paged/print document) so a Product's course, one-pager and deck stay
  distinguishable at a glance, plus a **per-product colour dot** (hover it to see which Product).
  **Document:** a **Document-settings** button (a sliders glyph, deliberately not the same cog as
  the app-wide one on the left rail; opens this document's settings —
  **Document type** (geometry + interactivity, set once), **Header**, **Footer**, the learner-nav
  sections, Theme and the rest; app-wide settings live under the left-rail cog), the **Build /
  Read** toggle (glyphs), and the
  **Variant** and **Version** selectors as **named dropdowns**, each captioned with its axis and
  showing the current value ("Flagship", the version name) at a glance. The moment either leaves
  base, a chip appears in the bar — **Read-only** when you're previewing (a variant preview locks
  the canvas) or **Editing <version>** when a software version is the editable flagship — with a
  one-click **Return to base**. **Output:** the **▶ Demo** preview and a labelled **Send to publish**
  button that carries the **pending queue count** (how many documents are waiting to publish).
  **Light / dark** lives in the Demo button's **▾** menu, under the size presets. When
  many courses are open the tabs scroll within their own strip so the Document and Output clusters
  never move. In Source and Publish the bar shows the Identity zone only.
- **Destination rail (far left).** A slim icon rail names four destinations — **Files**,
  **Source**, **Edit**, **Publish**; click one to switch. Below them sit the **User guide** and
  **Settings** glyphs.

  **They are destinations, not steps.** None depends on another: you can write source without ever
  laying a document out, lay one out without touching source, or publish without either.

  **Files** lists **every document you have** — source documents and design documents together, in
  one place. Nothing else in Verso ever showed you both. Its header states the size of what you are
  looking at (*"12 documents · 3 products"*), and a search box filters on title or code.

  Three ways to arrange the same list, chosen with one switch: **Product** (the default — a band per
  product, its source document first, and a trailing **No product** band for shared cross-product
  material), **Type** (Source, Courses, Presentations, Guides), and **Recent** (one flat list,
  newest first). Switching only rearranges: the same documents, the same rows, the same actions.

  **List or cards.** List is the default and works at any size; cards are there for visual recall.
  Click any document to open it where it belongs — a source document into **Source**, a design
  document into **Edit**.

  **Switching is a swap, not a reload.** Leaving a destination does not close, reset or rebuild it —
  come back and you find the same tabs, the same active document and the same scroll position. Rail
  items deliberately carry no counts or badges: what matters is in the work, not on the rail.

  Verso reopens the destination you left when you relaunch. A brand-new install starts on Files.
- **Left (a 3-way switcher: Structure · Blocks · Source).** Pick one section at the top of the
  panel. **Structure** — the outliner of chapters and pages as a tree. **Blocks** — the insert
  palette for built-in block types (Text, Media, Layout, Interactive…), with **Reusable
  components** beneath it: **My Components** (course-local), **Blocks** and **Pages** (the shared
  cross-course library, §9). **Source** — a **read-only, live view of the open document's product
  source**: the same source document you'd see in the Source stage, in a narrow reading column,
  with a **search box** (type to find, Enter / Shift+Enter to cycle matches) and a **table of
  contents** that jumps to a chapter and tracks where you're reading. It keys off the document you
  have open (its product), so it always matches the course in front of you.
  It's read-only — all source editing stays in the Source stage. The panel remembers which section
  you last used.
  **Placing linked copy.** Select any passage in this panel (a phrase, or a heading through a
  paragraph in one sweep) and a small bar appears at the selection with a **drag handle** and a
  **Place** button. Two ways to place it: **drag** the handle onto the canvas — a ghost follows your
  cursor, the target page lights up, and a **drop-line** shows the exact gap between blocks where it
  will land — then release; or click **Place** then click a spot in the canvas (**Esc** cancels).
  Either way the passage drops in at that spot as **live-linked** text in your
  document's own styles. If your selection spans **different formats** — a heading and a paragraph —
  it splits into one block per format (a heading block, then a body block), each independently
  styleable with the normal text-block controls; two passages of the same format stay in one block.
  Drop a passage **onto an existing text block** instead of into a gap and it merges in as a locked
  **inline span** at that block, so one block can mix your own words with linked source copy — each
  linked span carries its own indicator. Drag a source **figure** (a diagram) as a whole and it
  drops as a linked **image** block. Linked copy is **locked** — you can't edit it directly, so it
  can't drift from the source — and it updates automatically whenever the source wording changes. A
  linked block (or span) shows a **link badge**; click it for a menu that jumps back to the exact
  source passage, or lets you say it differently here. Select a linked block and the inspector opens
  with a **From source** line naming the source document it came from, how many documents use that
  passage, and a **Source changed** flag if the source has moved since this document was last
  published. **Alternates** are the sanctioned way to
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
- **The four cross-stage facts.** Four things follow a document wherever you are, always worded and
  coloured the same way. **Alignment** — what share of the document is linked to approved source,
  banded green at 85% or more, amber from 60 to 84, plain below that; **Not indexed** means there is
  nothing to measure yet (no prose, or no approved source document), not a score of zero.
  **Drift** — how many linked source documents have changed since this one was last published; a
  document that has never published shows nothing, because there is nothing for it to have drifted
  from. **Linked in N** — how many documents use a source passage. **Outputs** — how many packages
  a document actually produces (its flagship plus each variant). A fact with nothing to say shows
  nothing at all, so a quiet row means "no news", never "unknown".
- **Inspector (right).** Context-sensitive: with nothing selected it shows the **Document**
  context — the document type (its geometry · interactivity) with that geometry's tools (paged →
  margins / running header-footer / page breaks / page numbers; frame → frame size / transitions /
  animation; reflow → breakpoint preview) — then the canvas backdrop. Select a block and it shows
  that block's settings instead. With a block selected, the **⋯** beside the breadcrumb (**Page 1 ›
  Heading**) opens that block's actions — the same list you get by right-clicking it on the canvas.
  Higher up, the panel's own **⋯** (in the **Design / Interact** tab strip) holds **Reorder inspector
  sections…**, which turns on a drag mode to rearrange the section order across every block's
  inspector — a preference saved for you, not the course; a banner names the scope while it's on.
- **Settings.** Settings opens as a panel down the right-hand side, in the place the inspector
  normally sits. It does not cover the course: the canvas simply narrows, and you can keep clicking,
  scrolling and editing while Settings is open — useful when you want to watch a change land. The
  settings are one scrolling list of sections, each folded shut; open the ones you need and Verso
  remembers which you left open. There is no Save or Done button. Every change applies to the
  course as you make it and is saved for you; **⌘Z** undoes the last one. **Close** or **Esc**
  puts the panel away and brings the inspector back. Clicking the canvas does not close it, so a
  stray click can't lose your place. Where a setting is really owned by another panel, its row
  shows the live value and a link straight to that panel rather than telling you to go and find it.
  When a panel has more than fits, a **hairline and a soft fade** appear at the edge you can keep
  scrolling towards, and go once you reach the end, so a cut-off line is never mistaken for the
  last one. Settings and the inspector both do this.
  A section that has an **on/off switch** keeps that switch and its fold-out arrow separate: the
  arrow opens and closes it, the switch decides whether it applies, and neither moves the other.
  Folded, it shows a one-line summary of what it will do ("On · centred, bottom rule"). Switched
  **off**, its rows dim but stay there and stay usable, so you can set a header up the way you
  want it and then turn it on, rather than turning it on to find out what it does.
  **Drag its left edge** to make it wider or narrower, exactly like the side panels. Settings keeps
  its own width, so widening it does not change how wide the inspector is when it comes back.
  **⌘\\** (hide the side panels) closes Settings, since there would be nowhere left to show it.
- **Esc closes one thing at a time.** If you open a menu or a small pop-up on top of Settings,
  **Esc** closes just that, and Settings stays where it was. Press it again to close Settings.
  Small pop-ups that only hold a setting or two carry a link through to the full Settings panel,
  so you are never left guessing where the rest of them live.
- **⌘K finds anything.** One box over everything Verso can take you to: a **setting**, an
  **action** ("Send to publish", "Add a page", "Go to Publish"), a **page or block** in the open
  document, and a **section of this guide**. Every result says which category it comes from, so
  you know where you are about to land. Settings are indexed by what you actually want, not only
  by what Verso calls them: type *confetti* and you get Motion, *disclaimer* and you get Header &
  Footer. Choosing a setting opens it in the Settings panel with its section already unfolded;
  choosing a guide section opens the guide at that heading. Arrow keys move, Enter runs, Esc
  closes. Because ⌘K covers the guide, the guide no longer has its own search box; its contents
  list on the left is still there.
- **⌘,** opens Settings where you left it. **⌥⌘,** gives you the settings for whatever you have
  selected, which is the inspector: it puts the Settings panel away and hands the space back.

---
