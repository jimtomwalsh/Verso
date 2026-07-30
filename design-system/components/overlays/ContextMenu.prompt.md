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
- `disabled` + `hint` list an entry that exists but cannot be chosen yet — the entry stays in
  place, greyed, with a trailing state word in tertiary ink (`{ label: "SCORM 2004", disabled:
  true, hint: "Soon" }`). Never fold the state into the label ("SCORM 2004 (soon)") and never drop
  the entry: the point is that the whole set is stated once, in one place.
