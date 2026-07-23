# board/LoopContainer — the loop (screen-carousel) frame

A **loop** on the hotspot software-tour `GraphBoard` (issue #224 / T6, epic #219): a
titled frame holding an *ordered collection of screens* that a single navigate hotspot
drops the learner into. In the loop the learner cycles the members **forward / back**;
exiting (Back) returns to the originating screen and the tour continues. One link, one
carousel — instead of a separate hotspot + screen per state.

## The problem it solves
Showcasing one piece of UI across its **many states** (a panel OFF / warning / error /
disrupting) meant wiring a navigate marker + destination screen for each state. The loop
collapses that to one target: author drops the state screens into the frame; the learner
gets one forward/back carousel.

## What it is (and is not)
- A **group frame**, not a node. It is drawn BENEATH the `ScreenNode`s (with the `Edge`
  layer), `--surface-sunken` fill + dashed `--border-strong` outline, a header strip
  (inline title + a count `Badge`). It auto-fits to its members' in-box grid.
- It is **not** a new board surface (that's `GraphBoard`), not a node card (that's
  `ScreenNode`), and not a connector (that's `Edge`). The canonical set had a node, an
  edge, a port and a board but no *group/collection frame* — this is that addition, added
  here FIRST per the front-end law, then built to by the editor.

## Membership (direct manipulation first)
- **Add:** drag a `ScreenNode` so its centre drops inside the frame -> it joins
  `loop.screens` (order = drop slot) and snaps into the in-box grid; the frame auto-grows.
- **Remove:** drag a member out of the frame -> it leaves `loop.screens`.
- **Reorder:** drop a member in a new grid slot -> its index in `loop.screens` changes.
- **Fallback:** an "Add screens" picker in the loop inspector (the panel mirrors the
  selection), never the primary path.
- A member is a **normal screen node** — it keeps its own markers and can still be a
  navigate target; the frame just corrals it.

## Targeting a loop (reuse, do not invent)
A `navigate` marker points at a loop exactly as it points at a screen: the SAME
`marker.target` field (now resolving to a loop id), the SAME `ConnectionPort`
drag-to-connect, and the SAME `data-goto` `Edge` renderer (the inbound edge lands on the
frame's edge anchor). No parallel link model, no `loopTarget`.

## Laws it must obey
- **Reuse over invention**: `ScreenNode`, `Badge`, `Modal`, the
  `data-goto` connector renderer, and the shipped `renderHotspotInspector` — reused.
- **The object is the interface**: drag screens in/out; the picker is the
  fallback.
- **The panel mirrors the selection** (panel-driven): select a loop -> its
  inspector (title, ordered member strip, wrap toggle), one depth at a time.
- **Data model stays render-pure:** the loop persists on `block.loops[] =
  { id, name?, screens:[screenId], bx, by, bw, bh, wrap? }`. `render()` ignores the board
  coords (bx/by/bw/bh) and reads only membership + order; `mount()` round-trips the layout.
  The FRAME renders and exports nothing.

## Split (T6a / T6b)
- **T6a (this frame):** the board container + `block.loops[]` model + membership + a
  navigate marker targeting a loop. Verso UI only; render stays pure (ignores loops).
- **T6b:** the learner-facing forward/back **carousel** render (`render.js`) + runtime
  cycle state that resumes the tour on exit (`runtime.js`). That is course output — the
  pure-render invariant + `course.css` govern it, NOT this editor-chrome contract.
