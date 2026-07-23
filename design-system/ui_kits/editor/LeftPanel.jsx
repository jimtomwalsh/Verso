// Verso editor — left dock: Structure outliner + Blocks palette.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const { Panel, TreeItem, BlockPaletteItem, BlockTile, BlockGrid, Badge, IconButton, SegmentedControl, Icon } = V;

  function SectionLabel({ children, actions }) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 10px 4px" }}>
        <span style={{ font: "var(--type-section)", color: "var(--text-primary)" }}>{children}</span>
        {actions && <div style={{ display: "flex", gap: 2 }}>{actions}</div>}
      </div>
    );
  }

  function LeftPanel({ selected, onSelect }) {
    const course = window.VERSO_COURSE;
    const [openChapters, setOpenChapters] = React.useState({ intro: true, types: true });
    const [view, setView] = React.useState("grid");

    const toggle = (id) => setOpenChapters((o) => ({ ...o, [id]: !o[id] }));

    return (
      <Panel side="left">
        {/* Structure */}
        <SectionLabel actions={<><IconButton icon="list-collapse" label="Collapse all" size="sm" /><IconButton icon="plus" label="Add page" size="sm" /></>}>
          Structure
        </SectionLabel>
        <div style={{ padding: "0 8px 8px" }}>
          {course.chapters.map((ch) => (
            <React.Fragment key={ch.id}>
              <TreeItem
                label={ch.name}
                depth={0}
                expandable
                expanded={!!openChapters[ch.id]}
                onToggle={() => toggle(ch.id)}
                trailing={<Badge>{ch.pages.length}</Badge>}
              />
              {openChapters[ch.id] &&
                ch.pages.map((p) => (
                  <TreeItem
                    key={p.id}
                    label={p.name}
                    icon="file-text"
                    depth={1}
                    selected={selected.type === "page" && selected.id === p.id}
                    onSelect={() => onSelect({ type: "page", id: p.id })}
                  />
                ))}
            </React.Fragment>
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--border-subtle)" }} />

        {/* Blocks palette — grid of icon tiles (or a list) */}
        <SectionLabel actions={
          <div style={{ width: 56 }}>
            <SegmentedControl size="sm" value={view} onChange={setView} options={[
              { value: "grid", icon: "layout-grid", title: "Grid" },
              { value: "list", icon: "list", title: "List" },
            ]} />
          </div>
        }>
          Blocks
        </SectionLabel>
        <div style={{ padding: "0 8px 16px" }}>
          {window.VERSO_PALETTE.map((cat) => (
            <div key={cat.group} style={{ marginBottom: 10 }}>
              <div style={{ font: "var(--type-label)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", padding: "6px 4px 6px", fontSize: 10 }}>
                {cat.group}
              </div>
              {view === "grid" ? (
                <BlockGrid columns={3}>
                  {cat.items.map((it) => (
                    <BlockTile key={it.label} icon={it.icon} label={it.label.split(" (")[0]} />
                  ))}
                </BlockGrid>
              ) : (
                cat.items.map((it) => (
                  <BlockPaletteItem key={it.label} icon={it.icon} label={it.label} />
                ))
              )}
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  window.LeftPanel = LeftPanel;
})();
