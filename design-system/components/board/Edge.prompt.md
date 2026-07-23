**Edge** — a directed connector between two nodes on the `GraphBoard`. A curved SVG path from a source pin's port to its target screen, representing a `navigate` marker's link. Edges live in one SVG layer beneath the nodes.

```jsx
<EdgeLayer>            {/* one SVG under the nodes */}
  {edges.map(e => (
    <Edge key={e.id} from={portOf(e.markerId)} to={anchorOf(e.target)}
          selected={sel === e.id} onSelect={() => select(e.id)} onDelete={() => clearTarget(e.markerId)} />
  ))}
  {drag && <Edge from={drag.from} to={drag.cursor} draft />}
</EdgeLayer>
```

- **Reuse the existing connector renderer.** The main editor already draws `data-goto` interaction connectors — the tour-builder edge layer reuses that path maths / hit-area / selection, never a second implementation. (consistency over novelty.)
- **Beneath the nodes.** One SVG layer under the `ScreenNode`s so edges never intercept node or pin drags; the hit-area is a fat invisible stroke for easy selection.
- **State.** Idle `--border-strong`; selected `--accent` + a small delete affordance at the midpoint; a `draft` edge (dragging out of a port, no target yet) is dashed and follows the cursor.
- **Semantics.** An edge IS a `navigate` marker's `target`. Drawing one sets/repoints `marker.target`; deleting one clears it. The model is the truth; the edge is its view.
- Tokens: idle `--border-strong`; selected/active `--accent`; draft dash uses the same stroke at reduced alpha.
