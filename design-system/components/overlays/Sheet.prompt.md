**Sheet** — the right-docked, non-modal settings surface. One of the spine's six presentations
(see `readme.md`, "The UI spine"). It is `Panel` at sheet width, not a second dock shell.

```jsx
<Sheet title="Settings"
  description="System settings persist across documents; project settings belong to this course."
  header={<Tabs tabs={[{value:"system",label:"System"},{value:"project",label:"Project"}]} …/>}
  footer={<><span>Changes apply live, saved automatically. Undo with ⌘Z.</span>
           <Button variant="secondary" onClick={close}>Close</Button></>}
  onClose={close}>
  <PanelSection title="Theme" collapsed>…</PanelSection>
  <PanelSection title="Custom fonts" collapsed>…</PanelSection>
</Sheet>
```

Rules, all inherited from the spine:

- **No scrim, and no click-out.** The canvas stays live while the sheet is open — that is the
  whole point of the surface. Dismissal is Close and Esc only. A sheet that light-dismisses on a
  canvas click makes the canvas unusable and is a bug, not a convenience.
- **The canvas is squeezed, never covered.** The sheet widens the right dock to
  `--panel-sheet-width`; the canvas keeps its remaining space and stays interactive.
- **Shares the dock with the inspector.** Opening the sheet supersedes the inspector and closing
  restores it. Two right-docked surfaces at once show the same tree twice and squeeze the canvas
  twice — never do it.
- **One scroll of sections, no internal nav rail.** The body is `PanelSection`s, collapsed by
  default with a one-line summary. A nav rail inside a dock is a second navigation system
  competing with the section headers and with the ⌘K index.
- **Save contract:** autosave + live-apply + Undo. The footer states that contract and carries a
  plain `secondary` Close. No Save / Apply / Cancel / Done, and never the accent — the accent
  belongs to the surface's one real primary action.
- **Esc closes the topmost layer only**, LIFO, and focus returns to whatever opened the sheet.
- Every narrow surface (popover, menu) that shows a subset of these settings carries a visible
  route up into the sheet.
