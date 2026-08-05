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
- **What depends on this document.** Under the document title sits a quiet strip of facts about the
  Product you're reading, so you can see the downstream cost of a change before you make it: how
  much of the Product's documents is **aligned** to this approved source, how many documents this
  topic is **linked in**, how many published documents are now **behind** it, and how many
  **outputs** (packages) the Product ships. These are the same numbers, in the same words, that the
  Publish stage shows per document — see §3 for what each one means. With a single document in the
  Product, the alignment figure here and the one on its Publish row are the same number.
- **Find in the document.** The search field above the outline finds your text anywhere in the
  document — headings and body copy — as you type. The **match count ("3 / 12") and the up/down
  jump arrows sit in the field itself**; press Enter (or the arrows) to jump between hits, each
  scrolled to and highlighted. The outline narrows to the sections that contain a match, so it
  doubles as a filter, and it scrolls to and highlights the entry that owns the hit you're on so
  you never lose your place.
- **Replace.** A **replace glyph** in the search field reveals a **replace** row on demand, with
  **Replace** (the current match) and **Replace all** — so it's out of the way until you need it.
  Since replacing edits the base prose, it's available only when the source is **unlocked**; locked,
  the row is disabled and states the reason. Replace is case-insensitive (it matches the find) and
  undoable as a single step; range marks (comments, alternates) ride the edit.
- **The one action left in the rail is Import.** Because there's one document, the old
  per-topic tools — new topic, select, delete, move, reorder topics — are gone. The **Import** button
  is where everything comes into Verso: **Markdown** (below), plus **CSV** (§11) and **Schema**, which
  used to sit on the Publish stage. Markdown import is now
  **additive**: pick a Markdown file (it can be a segment — just one chapter), and Verso shows a
  **preview** first — which chapters it will **add** and which existing chapters it will **update**
  (with how many blocks change), matched by chapter name. Nothing changes until you click **Apply
  import**; an update keeps the parts you haven't changed (so any alternates or comments on them stay
  put) and only adds or removes what actually differs. There's no silent whole-document overwrite.
- **What import turns into rich content.** Headings, bullet and numbered lists, and **tables** (pipe
  tables) come in as real tables — not lines of text with dividers. Inline **bold**, *italic* and
  `code` markup is formatted rather than shown as raw asterisks/backticks, including inside list items
  and table cells. HTML page markers like `<!-- Page 43 -->` (common in PDF-to-Markdown conversions)
  are stripped on the way in.
- **Declaring a Product's variants.** Above the document, **Manage variants** opens a small editor to
  add, rename, or remove the variants this Product's source carries (Flagship is always the base). It's
  shown even when a Product has none yet, so you can declare the first one. Renaming a variant carries
  its divergences with it; removing one just hides its column (re-add the name to bring it back). If you
  attach a course that already has variants (assign it a product from its row menu in Files), those variant names are
  copied onto the Product automatically.
- **Bringing in a variant's manual.** If your Product has variants declared, importing asks first
  whether the file updates the **Flagship** (the base) or a **variant**. Choosing a variant runs a
  **combine**: it reconciles that manual against the Flagship per paragraph and previews exactly what
  will **diverge**, go **absent**, or be **added** for that variant before anything is written — the
  Flagship base is never rewritten. (Choosing Flagship runs the normal additive import.)
- **Comparing variants as columns.** Above the document, a chip row switches variants on. With none
  on, the document reads and edits as normal (Flagship). Turn a variant on and every paragraph that
  differs **splits into side-by-side columns** — one per shown variant — while paragraphs they all
  share stay a single column; a paragraph a variant omits shows "Not in this variant". The column
  view is for comparison and is **read-only for text** — turn the variants off to edit again.
- **A variant can have its own image.** Images are the exception to the read-only column view.
  When variants are shown, each image column has a **swap** button — pick a file and that variant
  gets its own picture, while the others keep the base (Flagship) image. A named variant can also be
  **hidden** (eye-off) so the image doesn't appear in it, or given an image where the base has none.
  Unlock the source first. Previewing or exporting a variant then uses that variant's image, falling
  back to the base whenever a variant has no image of its own.
- **Starting a new Product's source from scratch.** An empty Product's Source stage offers two ways
  in: **New topic** (start writing) or **Import from Markdown…**. Either one seeds the Product's first
  chapter and builds its continuous document straight away — you land in the one-document view
  (chapters in the outline), not an intermediate per-topic list.

The rest of this section describes the earlier per-topic shape, which Source v2 is replacing;
authoring a chapter's text, importing, annotations, history and comments all work as described.

**Attaching a course to a Product.** In the file picker (the **Home** button), open a course card's
**⋯** menu and choose **Promote to Product…**. Pick an existing Product or create a new one, choose a
Format (eLearning, Presentations, or Print docs), and promote. This only tags the course — its content
is never touched. The top-bar Product dropdown then lets you switch between every course, and the
Source wiki, for that Product.

**Exporting the source to Markdown.** On the **Source** stage, the **Product actions** menu (the ⋯
button in the **footer strip at the bottom of the topic rail**) has **Export to Markdown** — it downloads the Product's whole continuous
document as a portable `.md` file (named after the Product). Headings, paragraphs, bold/`inline code`,
bullet and numbered lists, tables, images, and callouts all come across, so it round-trips with the
Markdown import. Nothing is changed in the app; it's a save-a-copy.

**Unlinking and deleting.** To detach a course from its Product, open its card's **⋯** menu in the file
picker and choose **Remove from Product** (the course and its content stay; only the tag is removed). On the **Source**
stage, the **Product actions** menu (the ⋯ button in the **footer at the bottom of the topic rail**, kept clear of the New-topic / Import navigation) lets you **Unlink all courses** from
a Product, **Delete source document** (clears the whole continuous document but keeps the Product), or
**Delete Product** (removes the Product entirely, including its source and the tag on any linked
course). The deletes ask for confirmation and can't be undone.

**Populating the Source wiki.** Switch to the **Source** rail tab, then use the icon toolbar above
the topic list (hover any icon for its name). Source opens the document you had open there last,
and falls back to the first product that has source content — you no longer pick a product from the
top bar to get there, because there is no picker. A proper document switcher for Source is coming.

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
delete it. A count appears on the icon while a section has unresolved comments. In continuous-document
mode the right-hand panel's **Marks** section has a **Comments** filter tab that lists every comment on
the topic — that is their single home (there is no separate comments accordion beneath it).

**Continuous-document mode (beta).** A newer way to author a topic: instead of separate sections
with Technical/Digestible/Dot-point versions, the whole topic reads and edits as **one continuous
document** — like the manual it came from. Open a topic and click **Switch to continuous document
(beta)** at the bottom of the article; your existing section text is carried over (nothing is lost).

In this mode:

- **Three modes: Read, Review, Edit.** The switch sits in the top bar, beside the document's other
  controls, and a chip next to it names what the mode locks.
  - **Read** — the document as it reads. Marks hidden, prose locked.
  - **Review** — annotate freely; the base prose stays locked. This is where a document opens.
  - **Edit** — the signed-off prose is editable. The chip turns red, because this is the only mode
    that puts approved wording at risk.

  Beside the mode, the bar states **how exposed this source is**: what share of the downstream
  documents' words trace back to it, and how many published documents are now older than it. Both
  are the same numbers Publish shows, from the same place, so they can never disagree. A number
  with nothing to say isn't shown.

  **Read also widens the column and steps the text up**, because reading a manual end to end and
  editing one passage of it are not the same task.

  Leaving Edit locks the prose, with everything that involves: if your edit changed wording other
  documents link to, you get the same warning you always did. Trying to type while locked shows a
  brief reminder instead of changing anything. Clicking a mark while reading moves you to Review,
  since a mark you cannot see is not much use. Verso remembers the mode between sessions, but never
  reopens a document in Edit — coming back to unlocked prose you did not mean to unlock is a way to
  lose work, not a convenience.
- **You can always annotate, even when locked.** Select any text and a small toolbar appears above
  it. **Add an alternate** (another way to say the same thing, for a particular course or
  audience), **Comment**, or **Mark as restricted** — all three are available whether or not the
  source is unlocked, since saying a passage is controlled shouldn't need the prose unlocked. The
  rich-text buttons (bold, italic, bullets) only appear once you've unlocked, since they change the
  base prose. Alongside them are four **block-format** buttons — **Heading 1**, **Heading 2**, **Body**
  and **Caution box** — that reassign the selected paragraph's type (across several paragraphs if your
  selection spans them), for the structure operating manuals rely on. There is no "link" button here:
  linking a course to a piece of source happens in the Edit stage, not Source.
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
  an alternate opens its card at the top of the right panel, showing the **base vs the alternate**,
  a status dot, and Edit / Delete.
- **A classified document says so before you read it.** When a document's classification is
  anything other than the least restrictive, a banner sits above the prose naming the level. Folded,
  it still carries the three things you need before sending anything: whether it may leave the
  organisation, who may read it, and whether it is waiting on a sign-off — plus where the level came
  from. Open it for the full rule set, with **blocked** and **due** marked on the two rules that
  stop something. In Read mode it fades rather than disappearing: you still need to know. An
  unrestricted document shows no banner at all.
- **The rail switches between Outline and Marks.** One column, two views: **Outline** is how you
  move around the document, **Marks** is the list of everything annotated in it. The Marks tab
  carries its count, so you can see there is something to answer without switching to find out.
  Outline rows carry a small dot when their section has something to report — red for a broken
  anchor, amber for a stale alternate, yellow for an open comment, grey for anything else.
  Hover it for the detail. A section with nothing to report shows nothing. The section you are
  reading takes a blue rail down its left edge.
- **One card, in one place.** Whatever you click — an alternate, a linked passage, a restricted one
  — its card opens at the **top of the right panel**, above the mark list. One card is open at a
  time, so opening another replaces it, and no card ever sits on top of the prose you are reading.
  (A comment thread still opens beside its paragraph: a conversation belongs next to the line it is
  about.)
- **Restricted: what a passage may leave in.** Marking a span restricted says its distribution is
  controlled. It doesn't ask you to choose anything — the classification comes down from the
  Product, or from whatever level is set closer to the passage (§4, Classification). Selecting a
  restricted span opens the card, which names the level, says where it was inherited from, and
  lists what that level actually means: whether it may leave the organisation, who may read it,
  who may edit it, and whether it needs sign-off. **Classification** takes you to the panel where
  the value is set. **Request sign-off** records that the passage is waiting on an approver — the
  date and the fact of the request, never an approval. Restricted marks show in red, with a double
  underline, and get their own filter tab beside Alt / Linked / Notes. A restricted image says so
  on the image itself, with a shield badge, so you see it while scrolling.
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
  selecting the linked span opens a **"Linked in N"** panel in the right margin (it never covers the
  text you're reading; if the passage isn't used anywhere yet the panel invites you to place it) —
  one row per place it's used, each tagged **base** or **alternate**, and clicking a row opens that document in Edit
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
  newest first, **grouped by day** (the date is shown once per day). History sits in a **collapsed
  footer section** — expand it when you want the provenance, so it doesn't compete with the marks
  above.
- **The document reads as formatted text.** Bold and `inline code` show as themselves in the
  continuous view — not as literal `**` or `` ` `` marks — so the source reads like a finished
  document, and range marks (comments, alternates, linked spans) stay anchored to exactly the same
  words underneath.
- **Show/hide marks** with the eye button in the bottom bar. Marked spans are tinted by type
  (linked blue / alternate purple / comment yellow), so annotation never clutters plain reading. Jumping to a mark —
  clicking a row in the panel, or an alternate — turns marks back on for you if they were hidden,
  so the highlight you jumped to is always visible.
- **Jump around with the outline.** A **table of contents** down the left side lists the document's
  headings; click one to jump to it, and the heading you're currently reading stays highlighted as
  you scroll. (The outline hides itself on a narrow window so the reading column keeps its width.)
- **Find a topic by anything in it.** The topic search at the top of the left nav now matches the
  full text of every topic — a heading or a phrase inside the document, not just the title.
- **One details panel on the right.** Everything about the document lives in a single right panel.
  At the top is **Marks** — every alternate, link and comment with a status dot (green in sync /
  amber stale / red broken / grey once a comment thread is resolved). Four **labelled filters**
  narrow the list — **All**, **Alt**, **Linked** and **Notes** — and each one carries a live count,
  so the filter row doubles as the document's mark summary. Click a row to jump to that mark.
  Comments appear here under **Notes**, in one place (the old duplicate comments list below the
  panel is gone). Below Marks sit **History** (the provenance timeline) and, for legacy per-topic
  sources, a **Source** section. The bottom-bar panel button shows or hides the whole panel;
  selecting a mark opens it to that mark.
- **One row per mark, and each row says where it is.** A linked passage used by four documents is a
  single row saying "in 4 docs", not four rows repeating the same passage. Under the passage each
  row states its place in the document ("Operation · Detection overview"), so you can tell two
  rows apart even when their text is truncated. Click a linked row to open its card and see the
  individual destinations. If the whole topic is also placed as a component, that is one line at
  the end of the list rather than a row per placement.
- **Every mark type has a fixed colour.** Linked is blue (the accent), an alternate is purple —
  the same purple Verso uses for components everywhere else — and a comment is yellow. The mark
  you last clicked gets a colourless brightening on top of its own colour, so highlighting it
  never hides what kind of mark it is. The type is always spelled out in the list too; the colour
  is a reminder, never the only clue.

This is an early view — the variant columns arrive in a later update; the section editor above
remains the full-featured path.

---
