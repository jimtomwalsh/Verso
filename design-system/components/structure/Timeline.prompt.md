**Timeline** — vertical node-based activity/history trail. A dot on a connecting line per entry, content (date, label, optional detail) to the right. Newest entry first, by convention. Used for a topic's import/edit history in the Product Rail info panel; reach for it anywhere a "what happened, in order" record needs a home (e.g. a document's revision history, a comment thread's resolution log) instead of a bespoke list.

```jsx
<Timeline entries={[
  { date: "27 Jul 2026", label: "Re-imported manual.md v2.0", detail: "1 updated, 1 flagged for review" },
  { date: "1 Jan 2026", label: "Imported manual.md v1.0", detail: "2 new sections" },
]} />
```
