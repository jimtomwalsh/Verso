## 19. Product Rail: Publish stage (early)

The **Publish** rail tab is a **persistent publish queue** — like a render queue. You line up the
documents you want to package, then run them all with one button; the queue is saved, so it survives
a refresh and a stage-switch.

- **Left — pick documents.** A list of **every** document. It used to be scoped to a product chosen
  in the top bar, which meant untagged documents dropped out of the list entirely; there is no such
  scope now. Click **+** on a row to add it to the queue, or use
  **Add current document** at the top to queue the document you have open. A solo export is just a
  queue of one.
- **Send straight from the editor.** You don't have to switch stages first: the **send** glyph in the
  editor header (also in the Publish head's **⋯** menu as **Send to publish queue**) drops the
  document you're editing into the queue with its remembered preset — no configuration — and confirms
  with a small toast showing how many are now pending. Sending a document that's already queued re-arms
  its row rather than adding a second. Queue a few in a row, then switch to Publish and run them.
- **Right — the queue.** One row per document, each showing its status — **Pending**, **Publishing…**,
  **Done** (with the package's file name), or **Failed**. Remove a row with **×**. Adding a document
  that's already queued re-arms it rather than duplicating it.
- **Where it goes, and what it will be called.** Every queue row states its destination on a chip,
  and next to it the exact file name that row will write, before you press Publish — for example
  `SAFE-101_V001_SCORM.zip`. Change the row's preset and the name changes with it, so you can see
  what you're about to get. The name comes from the exporter itself, so what the row promises is what
  lands. Once a row has run, its status carries the real result and the prediction steps aside.
- **Set one folder for the whole Product.** In the Publish head, **Set publish folder** picks one
  folder for the product your queued rows share. Every queued row then inherits it and nests itself into
  `Product / document-variant`, so a whole-family publish costs one folder pick rather than one per
  row. Until you set it, rows say **Downloads** and packages go to your browser's downloads folder —
  nothing is written anywhere you didn't choose. The folder is remembered between visits.
- **Overriding one output.** Click a row's destination chip to open its **Publish destination**
  popover. It lists one path row per output the document produces — Flagship plus each variant — each
  showing where it lands and the exact file it will write. **Choose folder** on any of them overrides
  the inherited Product folder for that one output; **Reset** puts it back, and says what it is
  putting it back to. A row whose outputs all sit under the Product folder shows the part they share,
  ending in `…`; if you have sent them to genuinely different folders it reads **Mixed** and defers to
  this popover rather than naming one and implying the rest.
- **Versions never overwrite by accident.** Each output keeps its own version number — a variant
  steps independently of its flagship — and every run writes the next one up (`V001`, `V002`, …), so
  the package you shipped last week is still there. When you deliberately want to re-cut the same
  version, turn on **Replace current version** in that row's destination popover; it is off by
  default, and it is the only way a package gets written over.
- **The facts on each row.** Under every document's name, in both the left list and the queue, sits a
  line of small badges — the same four facts described in §3, in the same words they use everywhere
  else in the app:
  - **N changed** (amber) — that many linked source documents have moved since this one was last
    published. Informational only: it never blocks or warns, and it clears the moment you publish
    the document again. A document that has **never published** shows no drift badge, because there
    is nothing for it to have drifted from — the line beside it already says "Never published".
- **Output options and presets.** A row's **preset chip** names the options its package is built
  with. Open it and pick **Edit options…** to see those options — the same controls the export
  dialog uses, because they are the same engine. Changes apply to that row straight away; the note
  at the top says how many differ from the preset. **Save as preset…** turns the row's current
  options into a named preset you can point other rows at. Manage them under **Settings → System →
  Output presets**: each one says what it changes and how many queued rows use it, and deleting one
  tells you how many rows fall back to **Master** before it happens. Master is the shipped default
  and can't be edited.
- **Named destinations.** A folder with a name your team recognises — "LMS drop · production",
  "Client share" — defined once and pointed at from rows, instead of re-picking a path each time.
  Manage them under **Settings → System → Publish destinations**: add one, choose its folder,
  rename it, or delete it. Re-point a destination there and **every output using it moves with
  it**, which is the whole reason it has a name. On a queue row, open the destination chip and
  pick one; the chip then shows the destination's name. A folder chosen for that one output still
  wins over a named destination, and choosing either clears the other so only one answer is ever
  in play. Delete a destination and its rows fall back to inheriting the Product folder.
- **Reviewing the drift.** A queued document whose source has moved carries a **Review source
  drift** line you can open. Each changed passage gets a row naming where it sits in its source,
  a line-by-line **diff** of the words you published against the words source has now, and three
  answers: **Take the update** (record source's wording as this document's published text),
  **Open in Edit** (go to the block and change it yourself), or **Keep ours…** (keep this
  document's wording and say why — the reason shows on the row from then on). Passages are
  answered one at a time, so taking one update never silently accepts another. A kept passage
  stays quiet until source changes *again*, because the reason you gave was about wording that has
  since moved on. Passages placed since the last release are listed as **Not published before** —
  there is nothing to compare them against yet.
  - **N% aligned** — the share of the document's words linked to approved source rather than novel
    copy written here. Green at 85% or more, amber from 60 to 84, plain below. **Not indexed** means
    there is nothing to measure yet.
  - **N outputs** — how many packages this document actually produces (its flagship plus each
    variant). Shown only when there is more than one.
  The same alignment figure is available while editing (the storage-dot popover in the editor header
  shows a **Source alignment** readout) and in the Source stage top bar, all read from one place, so
  they can never disagree.
- **Presets.** Each queue row shows an **output preset** chip — click it to switch the row's preset,
  save the current settings as a new named preset, or rename/delete one of your own. Three come built
  in: **Master** (full quality), **Review copy** (adds the reviewer file, learner theme off), and
  **Lightweight** (optimises media hard for a smaller package). Presets are shared across the app, and
  each document remembers the preset it last used, so re-queuing it is one click.
- **Format.** Beside the Publish button, a **Format** control states the format the queue will emit —
  today that is **SCORM 1.2**. Open it to see the whole list once: the formats Verso can't emit yet
  (SCORM 2004, xAPI / Tin Can, standalone web) are greyed and marked **Soon**. Format is part of a
  row's output preset, so this control states it rather than setting it; if you queue documents whose
  presets ask for different formats, it reads **Mixed**. The **⋯** button beside it holds the
  occasional export jobs that aren't the queue: the one-off **Export SCORM** dialog, **Export .verso**,
  **Export JSON**, **Export Schema**, **Publish to Viewer** and **Reset Workspace**.
  **Importing has moved to the Source stage** — the Publish stage only sends work out.
- **Publish.** One **Publish** button runs every pending row in turn. A row is packaged once per
  output — its flagship and each variant — so the **N outputs** badge and the packages that appear are
  the same number. Each is built with that row's preset, written to that output's folder (or
  downloaded when none is set), and its version recorded only once it has landed, so a failed write
  never burns a version number. Done rows stay in the queue, greyed, with their result — the queue
  isn't cleared, so you can see what shipped.
- **Release history.** Each Publish run records **one** timestamped release entry, and history takes
  whatever room the queue isn't using — it answers "what did we ship?", so it sits open in the pane
  rather than folded away. Each release states how many documents went out, the preset (or a count
  when a run mixed several), where they were delivered, and the outcome: **Published**, or **N failed**
  when part of the run didn't make it. Expand a release to see every document in it with its format,
  variant, version and preset; a document that failed is marked in the list. It's a read-only audit
  trail — it never re-exports anything. To publish a whole product family as one release, queue its
  documents and run them together.
- **Finding the right document.** The Documents list states its scope and how many documents it's
  showing, and carries a **search** field. The **sort** control beside the heading offers the three
  orderings that matter: **Title**, **Drift** (most changed source first) and **Last published**,
  which leads with anything never published and then works forward from the oldest — the two
  documents most likely to need your attention, at the top. When something does need attention —
  approved source has moved under it, or it has never gone out — a **Needs attention** filter
  appears with its count. It only appears when there's something in it.
- **Last published, per document.** Every row in the Documents list states when that document last
  actually went out and as what version ("Last published 12 Jun · v1.4"), or **Never published**.
  That's usually the fastest way to tell whether a re-publish is needed at all. The line is read
  from the release record, so it can never disagree with the history beside it — and a run that
  failed doesn't count as published.

- **Queueing several at once.** Every row in the Documents list has a **tick box**. Tick the documents
  you want and press **Queue selected (N)** at the bottom of the list — they all go into the queue in
  one action, each with its own remembered preset, and you get one confirmation instead of one per
  document. **Select all** ticks everything currently shown. The button stays greyed out until you
  tick something, and says so if you hover it. The ticks clear once the batch is queued.
  The per-row **+** still works exactly as before for adding a single document.
- **Searching never loses your ticks.** Search, the **Needs attention** filter and the sort control
  change what the list shows, never what you've ticked — so you can tick five documents, search for
  a sixth, and still have all five. When the current search or filter is hiding part of your
  selection, the bottom of the list says so ("3 selected · 2 hidden by search") and offers **Clear**
  to drop the whole selection, hidden documents included. **Queue selected (3)** queues all three,
  including the two you can't see: that's what you ticked, and the line above the button says it
  will. Ticks are for the session only; they aren't saved with the document.

This is an early view — a chosen save folder and staleness dots arrive in later updates.

---

*This guide reflects the app as built. When a screen doesn't match, the app — and the
`SCHEMA-TEMPLATE-GUIDE.md` and `SPEC-*.md` docs in this folder — are the source of truth.*
