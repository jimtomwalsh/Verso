**ColorField** — the one colour control for the whole editor (`colorField`, D5). It unified four legacy paths, which fixed the recurring "mode-blind hex" bug. Layout is fixed: **swatch · hex/token · opacity% · eyedropper**.

```jsx
<ColorField value="#0D99FF" opacity={100} onChange={setHex} />
<ColorField value="#14AE5C" tokenName="success" opacity={100} />   // token-bound
```

- For per-mode fills, render two ColorFields (Light / Dark) in a `TwoUp` — never a single "mode-blind" hex.
- Pass `tokenName` to show a bound theme token by name instead of its hex.
