**FieldRow / TwoUp** — the labelled-row scaffold every inspector section is built from. `FieldRow` lays out a fixed label column beside a control slot; `TwoUp` splits that slot into two equal halves.

```jsx
<FieldRow label="Opacity"><IconField value="100" suffix="%" /></FieldRow>
<FieldRow label="Position">
  <TwoUp>
    <IconField prefix="X" value="0" /><IconField prefix="Y" value="0" />
  </TwoUp>
</FieldRow>
```

- Use `align="top"` when the control is multi-line (a textarea, a stacked group).
- Keep `labelWidth` consistent within a section for clean column alignment.
