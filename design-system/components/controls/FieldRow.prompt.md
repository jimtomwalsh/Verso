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
- Keep `labelWidth` consistent within a section for clean column alignment. The shared row uses
  one fixed width (76px) so every surface — sheet, popover, inspector — aligns identically; the
  label column is fixed and the control slot flexes, so the row reads the same at any panel width.

**The shared row (the UI spine's row anatomy).** This is the one row every settings/overlay
surface reuses: a fixed label column, the canonical control at 24px (`--control-md`), an optional
**inheritance tail**, and a hover-only **overflow**. Row height is `--row-height` (28px); the label
is `--text-xs` (11px). A `Switch` is a control in the slot, not a different row — a "switch row" is
just `<FieldRow label="…"><Switch/></FieldRow>`.

```jsx
<FieldRow label="Padding"
          inheritanceTail={<InheritanceTail source="Course" onReset={…} />}
          overflow={<RowOverflow items={…} />}>
  <IconField value="16" suffix="px" />
</FieldRow>
```

- **Inheritance tail** is collapsed by default: shown only when a value is inherited (its resolved
  value in tertiary ink + the source scope named) or overridden (a 4px `--accent` dot + inline
  Reset whose tooltip states what it restores, from where). A plain local value shows no tail.
- **Overflow** reveals on row hover only and never reflows the row (opacity, not display).
- For a **wide control** (colour field, a full-width segmented control) the label stacks above the
  control instead of beside it — same row family, `labelWidth` does not apply.
