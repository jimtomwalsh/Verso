**Switch / SwitchRow** — boolean toggle. Use `SwitchRow` (label + trailing switch) for settings inside panels; use bare `Switch` when the label lives elsewhere.

```jsx
<SwitchRow label="Shuffle questions" checked={shuffle} onChange={setShuffle} />
<SwitchRow label="Top rule" description="Divider above the footer" checked={rule} onChange={setRule} />
```

- Toggle track is accent-blue when on, neutral when off (compact, 28x16).
