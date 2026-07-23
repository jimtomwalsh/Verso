**Panel / Breadcrumb** — `Panel` is the left/right dock shell (fixed width, scrolling body, pinned header/footer). `Breadcrumb` is the inspector's selection context line.

```jsx
<Panel side="right" header={<Breadcrumb items={["Page 49", "Image hotspots"]} />}>
  <PanelSection title="Position" divider={false}>…</PanelSection>
  <PanelSection title="Appearance">…</PanelSection>
</Panel>
```

- The last breadcrumb crumb is the current selection (emphasised); earlier crumbs can be clickable to step out.
