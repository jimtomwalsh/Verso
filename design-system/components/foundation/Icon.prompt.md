**Icon** — a single line glyph; the atom every control, button and menu row is built from. Use for all iconography in the Verso chrome.

```jsx
<Icon name="chevron-down" />
<Icon name="trash-2" size={16} color="var(--danger)" />
```

- Names are Lucide names (kebab-case), e.g. `settings`, `eye`, `arrow-up`, `copy`, `search`.
- Default size 16px, stroke 2px — matches the editor's icon grid.
- Substitute for Verso's real icon set; requires the Lucide UMD on `window.lucide`.
