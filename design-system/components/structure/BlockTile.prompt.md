**BlockTile / BlockGrid** — the block palette as a scannable **grid of icon tiles** instead of a long scrolling list. Now that every block type has a distinct glyph, a 3-column grid shows a whole category at a glance without scrolling.

```jsx
<BlockGrid columns={3}>
  <BlockTile icon="heading" label="Heading" />
  <BlockTile icon="align-left" label="Paragraph" />
  <BlockTile icon="image" label="Image" />
  <BlockTile icon="list-checks" label="Quiz" />
</BlockGrid>
```

- Use `BlockPaletteItem` (list rows) when labels are long or you want a dense vertical menu; use `BlockTile` when the icon set carries the meaning and you want scan-ability.
