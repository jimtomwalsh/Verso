**ContextMenu** — the floating menu for right-click (canvas + outliner) and ⋯ overflow buttons. Keep verbs identical to the block Actions row (duplicate / delete / hide / lock / save to library).

```jsx
<ContextMenu onSelect={run} items={[
  { label: "Duplicate", icon: "copy", shortcut: "⌘D" },
  { label: "Save to library", icon: "package-plus" },
  "-",
  { label: "Delete", icon: "trash-2", shortcut: "⌫", danger: true },
]} />
```

- Use `"-"` for a divider; `danger` for destructive items.
