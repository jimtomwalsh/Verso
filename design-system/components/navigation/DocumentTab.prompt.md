**DocumentTab** — a top-bar tab for one open course. The active tab connects visually to the canvas below it; a close "×" shows on hover or when active.

```jsx
<DocumentTab label="Sample Course" active onClose={close} />
<DocumentTab label="Untitled" onSelect={open} />
```
