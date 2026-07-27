**ToggleChip** — an independently-toggleable pill for a row where more than one can be active at once (variant filters, tag/technology filters). Distinct from `SegmentedControl`, which is single-select (exactly one of N).

```jsx
<ToggleChip label="Flagship" active disabled />
<ToggleChip label="Coastal" active={toggled.has("Coastal")} onClick={() => toggle("Coastal")} />
<ToggleChip label="Desert" active={toggled.has("Desert")} onClick={() => toggle("Desert")} />
```

- Pill shape (`radius-full`), `text-secondary` at rest, `accent`/`accent-quiet` when active — matches the topic-row/rail-tab active convention already used elsewhere, not a new colour language.
- `disabled` reads as a permanent baseline (e.g. "Flagship" in a variant-column toggle row) — active + non-interactive, no hover change.
- First promoted from a one-off pill built for the Source stage's variant-column toggle (Product Rail); reuse this for any future filter-chip need (e.g. a cross-product technology-tag filter row) instead of hand-rolling another pill.
