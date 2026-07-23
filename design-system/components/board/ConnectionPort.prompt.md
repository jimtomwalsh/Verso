**ConnectionPort** — the drag-to-connect handle on a `navigate` pin. A small circular port on a `ScreenNode` pin; press-drag from it to a target node to create or repoint that marker's link.

```jsx
<ConnectionPort
  connected={!!marker.target}
  active={dragFrom === marker.id}
  onConnectStart={(e) => beginConnect(marker.id, e)}   // spawns a draft Edge that follows the cursor
/>
```

- **One gesture, one link.** Press-drag spawns a `draft` `Edge` following the cursor; dropping over a `ScreenNode` sets/repoints `marker.target`; dropping on empty space cancels. Direct manipulation.
- **State.** Hollow ring when unconnected; filled `--accent` when a link exists or the drag is active; slight grow on hover to advertise it.
- **Never traps keyboard users.** The port is a pointer affordance; keyboard/AT authors link via the inspector's already-shipped **Goes to** `Select` (same model, `marker.target`). Two surfaces, one vocabulary.
- Only `navigate` pins grow a port; `card` pins do not (they open popovers, they don't link).
- Tokens: ring `--border-strong` (idle) / fill `--accent` (connected/active); size on the `--control-sm` scale; hover grow within the standard motion budget.
