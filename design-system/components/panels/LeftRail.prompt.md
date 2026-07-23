**LeftRail** — the far-left icon rail. One Verso-UI column: top nav-tab glyphs SWAP the sibling left `Panel`'s content; bottom pinned glyphs fire global actions. Not a second column, not a duplicate of the panel — it absorbs the panel's view switching.

```jsx
<div style={{ display: "flex" }}>
  <LeftRail
    tabs={[
      { id: "document", icon: "layers", label: "Document" },
      { id: "assets",   icon: "image",  label: "Assets" },
      { id: "agent",    icon: "sparkles", label: "Agent" },   // only when the Beta flag is on
    ]}
    activeTab={tab}
    onSelectTab={setTab}
    actions={[
      { id: "export",   icon: "upload",      label: "Export", menu: <ContextMenu .../> },
      { id: "help",     icon: "help-circle", label: "Help" },
      { id: "settings", icon: "settings",    label: "Settings" },
      { id: "recents",  icon: "history",     label: "Recent courses" },
    ]}
    onAction={runRailAction}
  />
  <Panel side="left">{/* the active tab's view: Document / Assets / Agent */}</Panel>
</div>
```

- Active tab renders via `IconButton`'s `active` state; every glyph gets a `Tooltip` from its `label`.
- The **Document** tab shows the Structure outliner + Blocks palette stacked (the panel as it is today) — keep them together so authors drag blocks while seeing the tree.
- Hide the **Agent** tab entirely when its Beta flag is off (no dead tab), don't just disable it.
- Pinned actions are launchers, not panels — they never change `activeTab`. Export's `⋯` overflow (publish / JSON backup / .verso / import) hangs off its `menu`.
- Rail width is a token (`--rail-width`, ~44px); glyphs are `md` IconButtons, vertically centred, ~8px gaps.
