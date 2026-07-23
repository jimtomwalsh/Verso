**IconField** — the compact 24px value input the inspector is built from (position, size, padding, radius, opacity). A leading icon *or* short `prefix` label identifies the field; `suffix` carries the unit.

```jsx
<IconField prefix="W" value="800" suffix="px" />
<IconField prefix="X" value="65.8" suffix="%" />
<IconField icon="corner-down-right" value="4" suffix="px" />
```

- Pair two side-by-side with `TwoUp` for X/Y or W/H.
- Fires `onChange(stringValue)` — parse/clamp in the consumer.
