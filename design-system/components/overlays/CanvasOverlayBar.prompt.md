**CanvasOverlayBar** — the persistent floating canvas toolbar. One raised bar pinned to the bottom-centre of the canvas. Two zones in one bar: an **always-on tools** zone (grid / find / comment / zoom), plus a **selection-contextual actions** segment appended when an object is selected and cleared on deselect.

```jsx
<CanvasOverlayBar align="center">
  {/* zone 1 — always-on canvas tools (visible with nothing selected) */}
  <IconButton icon="grid-2x2" label="Alignment grid" active={grid} onClick={toggleGrid} />
  <IconButton icon="search" label="Find & replace" onClick={openFindReplace} />
  <IconButton icon="message-square" label="Comment (C)" active={commentMode} onClick={toggleComments} />
  {"divider"}
  <ZoomControl value={zoom} onChange={setZoom} />   {/* embedded value control */}

  {/* zone 2 — contextual actions segment, only when something is selected */}
  {selection && <>
    {"divider"}
    <SelectionActions>            {/* the .canvas-overlay-bar__actions segment */}
      <IconButton icon="copy" label="Duplicate" onClick={dup} />
      <SegmentedControl value={mode} onChange={setMode} options={/* defining mode toggle */} />
      <IconButton icon="trash-2" label="Delete" danger onClick={del} />
    </SelectionActions>
  </>}
</CanvasOverlayBar>
```

- **Two zones, one bar.** The tools zone is always on — grid / find / comment / zoom must be reachable with nothing selected. The actions segment is appended on select and fully cleared on deselect, so per-object actions live *on the bar alongside the tools* rather than in a separate floating widget. (Shipped since #174 — this replaced the orphaned per-block `.block-toolbar`; block move/duplicate/clear/split/hide/lock/delete now live here.)
- **The segment hosts per-object VERBS + the object's DEFINING mode toggles** (e.g. a block's or hotspot's action/shape switch) — and this is their **single home**: a control placed on the segment is REMOVED from the inspector, never duplicated. Value properties with a range/colour/text (sizes, colours, padding, radius) stay in the inspector — those are NOT segment controls. The rule is single-home, not "actions may never touch the bar".
- **Realisation.** The tools live in `.canvas-overlay-bar__inner`; the contextual segment is a sibling `.canvas-overlay-bar__actions` element preceded by a `.canvas-overlay-bar__sep--actions` hairline divider, appended when an object is selected and emptied + hidden on deselect (`ensureBlockToolbar`/`showBlockToolbar`/`hideBlockToolbar`). Reuse this mechanism for any graph/board builder that needs the same pattern.
- Bottom-centre by default; `align` shifts it only when the bar would collide with a corner UI. It floats above the canvas and does not scroll with the page.
- Raised surface (elevated background, `--radius-lg`, soft shadow); group tools and the actions segment with 1px hairline dividers; glyphs are `md` IconButtons, `active` when their mode is on, `danger` on destructive verbs.
