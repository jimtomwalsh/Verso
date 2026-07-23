# Verso Editor — UI kit

A high-fidelity, click-through recreation of the **Verso** authoring workspace,
composed entirely from the design-system primitives (`window.VersoDesignSystem_2a48ac`).

## Layout
- `TopBar.jsx` — document tabs + the toolbar (variant selector, device breakpoints,
  theme toggle, Export, save status, undo/redo, zoom, comment, demo).
- `LeftPanel.jsx` — the **Structure** outliner (chapters → pages) and the **Blocks**
  palette (Text / Media / Layout / Interactive), built from `TreeItem`, `Badge`,
  `BlockPaletteItem`.
- `CanvasView.jsx` — the infinite board rendering the open page (Exo 2 course content)
  with the image-hotspots block. Blocks are click-selectable.
- `Inspector.jsx` — the contextual right dock. Swaps between a **text-block** inspector,
  the **image-hotspots** inspector (matching the screenshot), and the **page/document**
  inspector, all assembled from `PanelSection` + `FieldRow` + the canonical controls.

## Interactions (faked)
- Click a page in Structure or a block on the canvas → the inspector re-contextualises.
- Toolbar **theme toggle** flips the whole workspace between dark and light tokens.
- Segmented controls, switches, selects and colour fields are all live.

## Fidelity notes
- Recreated from `docs/USER-GUIDE.md` and the provided
  screenshots — not from the original source (no code repo was mounted, only docs).
- Icons are Lucide (Verso's own icon set was not provided).
- The base hotspot image is a placeholder gradient; real courses drop an uploaded image.
