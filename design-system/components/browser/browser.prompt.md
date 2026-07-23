**File browser (CourseCard / CardGrid / ThumbnailFrame / SearchField / RecentsMenuRow)** — the local-first home screen and save/recents menu. The library is a wall of course cards you recognise by sight; the save menu is the same idea condensed into a dropdown.

```jsx
// The library wall
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
- **A course with no `updatedAt` is never hidden** — it sorts last and shows `lastEdited="—"`. Sort by recents uses `doc.meta.updatedAt` (see #71).
- **Reuse, don't reinvent:** the `…` menu is the canonical `ContextMenu`; `SearchField` is the `IconField` control form; the empty-state action is a `Button`. Cards are flat raised surfaces (6px radius, 1px hairline, hover wash, accent ring when selected) — no drop shadow while docked (borders over shadows).
- **Copy:** sentence case, British spelling, no emoji. Placeholder is a lowercase instruction ("search courses").
