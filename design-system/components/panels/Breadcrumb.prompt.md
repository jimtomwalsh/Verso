**Breadcrumb** — the inspector's selection context line, showing where the selected block sits ("Page 49 › Image hotspots"). The last crumb is emphasised as the current selection.

```jsx
<Breadcrumb items={["Page 49", "Image hotspots"]} />
<Breadcrumb items={[{label:"Card", onClick: stepOut}, "Heading"]} />
```
