**CanvasOverlayBar** — the persistent floating canvas toolbar. One raised bar pinned to the bottom-centre of the canvas, always visible (not tied to selection). Hosts canvas tools only.

```jsx
<CanvasOverlayBar align="center">
  <IconButton icon="grid-2x2" label="Alignment grid" active={grid} onClick={toggleGrid} />
  <IconButton icon="search" label="Find & replace" onClick={openFindReplace} />
  <IconButton icon="message-square" label="Comment (C)" active={commentMode} onClick={toggleComments} />
  {"divider"}
  <ZoomControl value={zoom} onChange={setZoom} />   {/* embedded value control */}
</CanvasOverlayBar>
```

- **Always on.** Grid / find / comment / zoom must be reachable with nothing selected — that is the whole point (it replaces the orphaned per-block `.block-toolbar`).
- **Canvas tools only.** Never put block move/duplicate/hide/lock/delete here — those stay in the inspector. No control has two homes.
- Bottom-centre by default; `align` shifts it only when the bar would collide with a corner UI. It floats above the canvas and does not scroll with the page.
- Raised surface (elevated background, `--radius-lg`, soft shadow); group tools with 1px hairline dividers; glyphs are `md` IconButtons, `active` when their mode is on.
