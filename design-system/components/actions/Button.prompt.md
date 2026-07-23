**Button** — text action. Reserve `primary` (accent blue) for the single most important action on a surface — in Verso that's **Export** in the top bar. Use `secondary` for dialog confirms, `ghost` for quiet inline actions, `danger` for destructive confirms.

```jsx
<Button variant="primary">Export</Button>
<Button variant="secondary" icon="download">Import CSV</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button variant="danger" icon="trash-2">Delete chapter</Button>
```

- `size="md"` (32px) for toolbar/dialogs, `size="sm"` (24px) inline.
- `full` stretches to container width (modal footers).
