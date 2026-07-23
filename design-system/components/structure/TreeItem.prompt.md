**TreeItem** — a Structure-outliner row. Indents by `depth`, shows a twirl chevron when `expandable`, a leading block/page/chapter icon, and a `trailing` slot for a count `Badge` or visibility eye.

```jsx
<TreeItem label="INTRODUCTION" depth={0} expandable expanded trailing={<Badge>4</Badge>} />
<TreeItem label="1.2 Page" icon="file-text" depth={1} selected />
<TreeItem label="Heading" icon="heading" depth={2} muted />
```
