# board/ — the 2D node-graph builder surface

The **graph builder** category: a full-screen overlay where an author lays out a directed
graph of screens spatially, instead of (or alongside) the linear inspector list. The first and
driving user is the **hotspot software-tour builder** (issue #219 / spec #214): screens as
node cards on a board, navigation drawn as edges, markers as pins. It **augments** the shipped
inline authoring (the Screens list, Goes-to select, per-screen markers of T2–T4); it never
replaces it. **Verso UI (editor chrome) only — it renders and exports nothing.**

## Components
- **GraphBoard** — the pannable/zoomable 2D canvas. One pan+zoom transform over a registered
  child layer; app-standard selection (click / double-click / Escape). Zoom/pan chrome reuses
  `overlays/CanvasOverlayBar`; the shell is the `.vbrowser` overlay + `overlays/Modal` focus rules.
- **ScreenNode** — a screen as a node card: a `browser/ThumbnailFrame` live preview + inline
  title + Entry/Completion `structure/Badge`s + pins. The right panel mirrors the selected node
  with that screen's *existing* inspector — the node never reinvents property editing.
- **Edge** — a directed SVG connector = a `navigate` marker's link. **Reuses the main editor's
  existing `data-goto` connector renderer**, not a second implementation.
- **ConnectionPort** — the drag-to-connect handle on a `navigate` pin. Pointer affordance only;
  keyboard linking stays on the inspector's Goes-to select.
- **LoopContainer** (#224 / T6) — a titled group FRAME holding an ordered *collection of screens*
  the learner cycles forward/back as one carousel behind a single navigate hotspot. Drawn beneath
  the nodes; drag a `ScreenNode` in to add membership; a navigate marker targets it via the same
  `marker.target`/`Edge` plumbing. Frame renders/exports nothing; the learner carousel it drives is
  course output (pure-render invariant, not this contract).

## Why these are new (the DS gap that gated #219)
The canonical set had no free 2D board, node card, connector, or connect-port — the editor
canvas is page-flow and `CanvasOverlayBar` is only a toolbar. Per the front-end law, a new
surface that needs patterns the set lacks gets those patterns added here FIRST, then is built to
them. These four contracts are that addition; #221/#222/#223 build to them.

## Laws they must obey
- **Reuse over invention**: `ThumbnailFrame`, `Badge`, `Modal`, `CanvasOverlayBar`,
  the `data-goto` connector renderer, and the shipped `renderHotspotInspector` — all reused, not
  re-made.
- **The object is the interface**: drag nodes, pins, ports; the panel is the
  fallback.
- **The panel mirrors the selection** (panel-driven): select a node/pin → its
  existing inspector sections, one depth at a time.
- **Data model stays render-pure:** node board coords persist on `screens[].bx/by`; `render()`
  ignores unknown fields, so it remains a pure function of the doc; `mount()` round-trips them.
