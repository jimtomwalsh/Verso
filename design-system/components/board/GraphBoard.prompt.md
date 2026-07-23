**GraphBoard** — a pannable, zoomable 2D node canvas. The working surface of a graph builder (the hotspot software-tour builder is the first user). Not the page-flow editor canvas; not a toolbar. Nodes carry their own board coords; the board applies one pan/zoom transform to the whole layer.

```jsx
<GraphBoard zoom={zoom} pan={pan} onZoomChange={setZoom} onPanChange={setPan} onBackgroundClick={clearSelection}>
  <EdgeLayer>{edges.map(e => <Edge key={e.id} {...e} />)}</EdgeLayer>
  {screens.map(s => (
    <ScreenNode key={s.id} x={s.bx} y={s.by} selected={sel === s.id} onSelect={() => select(s.id)} {...s} />
  ))}
</GraphBoard>
```

- **One transform, registered layers.** Pan + zoom are applied once to the child layer so nodes and the edge layer stay pixel-registered; children never scroll themselves. Background `--surface-canvas`, optional faint dot grid.
- **Selection is the app model, unforked** (panel-ia depth): click node = select (mirror in the right inspector), double-click = drill in, `Escape` = up / close, background click = clear. Never invent a per-feature selection scheme.
- **Direct manipulation first.** Drag nodes to reposition, drag pins to place them, drag ports to link (see `Edge`/`ConnectionPort`). The panel is the fallback for what can't be done on the object.
- **Pan** = space-drag or trackpad two-finger; **zoom** = Cmd/Ctrl-scroll (clamped) + a zoom/fit control reusing the `CanvasOverlayBar` zoom form. No custom zoom widget.
- Lives inside a full-screen overlay built to the `.vbrowser` shell + `Modal` focus/Escape rules. **Verso UI (editor chrome) only — renders/exports nothing.**
- Tokens: surface `--surface-canvas`; overlay chrome `--surface-app`/`--surface-panel`; radius `--radius-lg` on the framed board; motion within the standard budget (pan/zoom are direct, not animated).
