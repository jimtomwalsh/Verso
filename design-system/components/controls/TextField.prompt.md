**TextField** — free text entry. Use it for prose values the compact `IconField` isn't meant for: image **alt text** / **caption**, a **link URL**, a **disclaimer**, a **chapter name**. Sits full-width under its `FieldRow` label; use `multiline` for longer text.

```jsx
<FieldRow label="Alt text" align="top"><TextField placeholder="Describe the image" /></FieldRow>
<FieldRow label="Caption"><TextField value={cap} onChange={setCap} /></FieldRow>
<FieldRow label="URL"><TextField leadingIcon="link" placeholder="https://" /></FieldRow>
<FieldRow label="Disclaimer" align="top"><TextField multiline rows={3} value={txt} onChange={setTxt} /></FieldRow>
```

- Numeric / short values → `IconField`. Prose → `TextField`.
