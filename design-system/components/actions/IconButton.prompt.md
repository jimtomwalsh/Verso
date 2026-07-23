**IconButton** — icon-only square action. Used across the toolbar (undo, fit, comment, demo) and the per-block **Actions** row (up / down / duplicate / delete). Always give a `label` for the tooltip + a11y.

```jsx
<IconButton icon="undo-2" label="Undo" />
<IconButton icon="message-square" label="Comment" active />
<IconButton icon="trash-2" label="Delete" danger />
```

- `active` shows the toggled state (mode engaged).
- `danger` tints delete red.
