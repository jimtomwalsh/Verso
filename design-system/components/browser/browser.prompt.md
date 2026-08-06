**File browser (DocumentRow / CourseCard / CardGrid / ThumbnailFrame / SearchField / RecentsMenuRow)** — the local-first home screen and save/recents menu. **A list of `DocumentRow`s is the default and the shipped answer**; forty products in a card grid is a scrolling problem, while a list still reads at any size. Cards are for visual recall, and the save menu is the same idea condensed into a dropdown.

**One noun: Document.** A source document, a course, a presentation, a paged guide are four *types* of one thing. "Course" is a type label, never the generic — nothing in the UI calls a document a course, a file or a project when it means any of them.

```jsx
// The document list — the default form
{docs.map((d) => (
  <DocumentRow
    key={d.code}
    title={d.title}
    type={d.type}                /* source | reflow | frame | paged */
    updated={d.updatedShort}     /* COMPACT: "11mo", "3m"; long form goes in updatedTitle */
    updatedTitle={d.updatedLong}
    typeChip={grouping !== "type"} /* a view grouped by type does not repeat it per row */
    primary={d.isPrimarySource}
    openIn={d.openIn}            /* "edit" | "source" | null */
    dot={d.productColour}
    onOpen={() => openDocument(d.code)}
    onMenu={(e) => showDocumentMenu(e, d.code)}
  />
))}
```

```jsx
// The card wall — for visual recall, not the default
<SearchField value={q} onChange={setQ} onClear={() => setQ("")} />
<CardGrid min="180px">
  {courses.map((c) => (
    <CourseCard
      key={c.code}
      title={c.title}
      code={c.code}
      lastEdited={c.lastEdited}   /* "—" when doc.meta.updatedAt is absent */
      thumbnail={c.preview}       /* a scale()'d live render of page 1 */
      onOpen={() => openCourse(c.code)}
      onMenu={(e) => showCourseMenu(e, c.code)}
    />
  ))}
</CardGrid>
{courses.length === 0 && <BrowserEmptyState action={<Button label="New course" />} />}

// The save / recents dropdown
{recents.map((c) => (
  <RecentsMenuRow key={c.code} title={c.title} code={c.code} lastEdited={c.lastEdited} thumbnail={c.preview} onClick={() => openCourse(c.code)} />
))}
```

- **Thumbnails are live scaled-DOM, not rasterised PNGs** — `ThumbnailFrame` clips + centres a `transform: scale()`d render of page 1. No rasteriser lib (vanilla `file://` constraint); always current, no cache-invalidation. Lazy/throttle offscreen frames on a big library.
- **A document with no `updatedAt` is never hidden** — it sorts last and shows "—". Sort by recents uses `doc.meta.updatedAt` (see #71).
- **The type glyph has ONE definition** — `DOCUMENT_TYPES` in `DocumentRow.jsx`, shared by the row and the top-bar `DocumentTab`. Source gets the `--accent-quiet` icon well, design documents the neutral `--surface-input`; that single colour difference is what makes written material legible from laid-out material without reading. Never re-declare the map in a consumer.
- **Row height is `--row-height-doc` (32px), not `--row-height`** — the 28px token is the *inspector* row, a different species (label column + one control, a value you set). A document row is a click target.
- **The timestamp is compact in a row, long on a card.** "11 months ago" does not fit a row's 64px column and would ellipsise in every line; the full phrase is the tooltip. Cards have the room and keep the long form.
- **Open-state is plain text, never a chip.** It states a fact about the document rather than offering an action, and a chip there would compete with the type chip beside it. Nothing is pill-rounded but toggles and count badges.
- **Publish-only affordances go in `trailing`** — the selection box, drift badge, alignment meter and variant chip are one list's needs, not the row's. A consumer never forks the row to add one.
- **Reuse, don't reinvent:** the `…` menu is the canonical `ContextMenu`; `SearchField` is the `IconField` control form; the empty-state action is a `Button`. Cards are flat raised surfaces (6px radius, 1px hairline, hover wash, accent ring when selected) — no drop shadow while docked (borders over shadows).
- **Copy:** sentence case, British spelling, no emoji. Placeholder is a lowercase instruction ("search documents").
