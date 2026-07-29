**ResizeHandles** — the on-canvas selection chrome for resizing a selected object (an image, a media frame) by dragging its edges. Two grab handles pinned to the object's left and right edges, live while dragging, Confluence-style. Width is symmetric about the object's centre, so the object stays centred as it grows and shrinks.

```jsx
<figure className="obj is-object-selected">
  <img style={{ width: pct + "%" }} />
  <ResizeHandle side="left"  onResize={setPct} />   {/* .obj__handle--l */}
  <ResizeHandle side="right" onResize={setPct} />   {/* .obj__handle--r */}
</figure>
```

- **Handles show only on selection.** The handles are painted only when the host carries the selection state (`.is-object-selected`); they are invisible and non-interactive otherwise. They never appear on hover alone — selection is the gate, matching the object-select model.
- **Symmetric, centred resize.** Dragging either handle changes the width about the object's centre: the new width is `2 x |pointerX - centreX|`, clamped and expressed as a percentage of the containing column. The object does not shift its centre while resizing (alignment is a separate control). Full width (100 / unset) hides no information; below 100 the object centres in its column.
- **Live + committed.** Width updates live during the drag (direct style write, no re-render per frame) and commits to the model on pointer-up (a single width value, a percentage of the column). It round-trips through the document and renders purely from that value — no editor-only state.
- **Light snap.** Free-drag with a light magnetic snap at 25 / 50 / 75 / 100% (snap when within ~4% of a stop) plus a faint centre guide line shown during the drag. Snap assists; it never blocks a value between stops.
- **Appearance.** Each handle is a small (10px) square, `--surface-raised` fill with a 1.5px `--accent` border and `--radius-xs` corners (chip scale), vertically centred on its edge and nudged just outside the object bounds; cursor `ew-resize`. The selected object itself carries `--shadow-selected` (the existing selection ring), so the ring + the two handles read as one selection state. Reuse this pattern for any resizable on-canvas object; do not hand-roll per-surface handles.
