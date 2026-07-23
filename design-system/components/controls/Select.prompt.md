**Select** — dropdown for lists too long or dynamic for a segmented control (font family, question type, category). For 2–4 fixed options, use `SegmentedControl` instead.

```jsx
<Select value={font} onChange={setFont} options={["Exo 2", "Inter", "Arial"]} />
<Select value={type} onChange={setType} placeholder="Question type"
  options={[{value:"mc",label:"Multiple choice"},{value:"tf",label:"True / false"}]} />
```
