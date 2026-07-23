**ScreenNode** — a screen as a node card on the `GraphBoard`. A raised card wrapping a live `ThumbnailFrame` of the screen visual, an inline-editable title, Entry/Completion badges, and the screen's markers drawn as pins. A `navigate` pin grows a `ConnectionPort` for drag-to-link.

```jsx
<ScreenNode
  x={s.bx} y={s.by} title={s.name} onTitleChange={renameScreen}
  isEntry={s.id === entry} isCompletion={s.id === completionScreen}
  pins={s.markers.map(m => ({ id: m.id, x: m.x, y: m.y, action: m.action }))}
  selected={sel === s.id} onSelect={() => select(s.id)} onMove={(x, y) => setBoardCoords(s.id, x, y)}
  cardsFaceUp={facesUp}
>
  <ThumbnailFrame ratio="16 / 9">{livePreviewOf(s.visual)}</ThumbnailFrame>
</ScreenNode>
```

- **Reuse, don't reinvent.** The preview is `browser/ThumbnailFrame` (live scaled-DOM, no rasteriser — the `file://` constraint); title editing is inline (rename-in-place, not a dialog); badges are `structure/Badge`. No bespoke card.
- **The panel mirrors the node**: selecting a node shows that screen's *existing* inspector sections (`renderHotspotInspector`) in the right panel — the node card is a handle, not a second property editor.
- **Direct manipulation.** Drag the card = reposition (persist board coords `screens[].bx/by`; render ignores them so it stays pure). Drag a pin = set its x/y%. A `navigate` pin exposes a `ConnectionPort`.
- **State.** Selected = `--shadow-selected` + `--border-focus`; idle card = `--surface-raised`, `--radius-md`, `--border-subtle`. Entry badge "Home", completion badge a flag glyph.
- **Cards-face-up** (`cardsFaceUp`): the node's `card` pins render their popovers open for inline bulk copy editing (reuses the shipped popover render — no new content pipeline).
- Tokens: card `--surface-raised` / `--radius-md` / `--border-subtle`; title `--text-primary`; selected `--shadow-selected` / `--border-focus`; spacing `--space-2`…`--space-4`.
