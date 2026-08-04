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
