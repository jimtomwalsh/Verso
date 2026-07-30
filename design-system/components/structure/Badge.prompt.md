**Badge** — small count/status pill. Neutral for counts (chapter page-count, "6 of 5 viewed"); tinted tones for status (success/danger quiz results, warning for a needs-review flag, component-purple for library instances).

`quiet` swaps the solid fill for a tint of the tone with the tone as ink. Reach for it when the badge
repeats down a list — one per release row, one per queue row — where a column of solid fills would
shout louder than the rows themselves. A badge that appears once stays solid.

```jsx
<Badge>4</Badge>
<Badge tone="success">Passed</Badge>
<Badge tone="warning">Source updated</Badge>
<Badge tone="component">Instance</Badge>
<Badge tone="success" quiet>Published</Badge>
<Badge tone="danger" quiet>1 failed</Badge>
```
