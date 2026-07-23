**SegmentedControl** — single-select track for bounded, mutually-exclusive options: alignment, fit mode, card reveal style, variant. Prefer this over a `Select` whenever there are 2–4 short options.

```jsx
// icon-only (alignment)
<SegmentedControl value={a} onChange={setA} options={[
  { value: "left", icon: "align-left", title: "Left" },
  { value: "center", icon: "align-center", title: "Center" },
  { value: "right", icon: "align-right", title: "Right" },
]} />

// text (reveal style)
<SegmentedControl value={m} onChange={setM} options={["Reveal", "Flip", "Off"]} />
```

- The selected segment lifts with a subtle shadow .
- Falls to `Select` when options are many or labels long.
