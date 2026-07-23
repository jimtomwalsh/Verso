// Verso editor — top bar: document tabs + toolbar.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const { DocumentTab, IconButton, Button, Tooltip } = V;

  function TopBar({ theme, onToggleTheme, zoom }) {
    return (
      <div style={{ flex: "none", background: "var(--surface-app)", borderBottom: "1px solid var(--border-subtle)" }}>
        {/* Tab row */}
        <div style={{ display: "flex", alignItems: "center", height: "var(--tabbar-height)" }}>
          <div style={{ display: "flex", alignItems: "center", paddingLeft: 8, gap: 2 }}>
            <span style={{ font: "var(--type-brand)", fontSize: 15, color: "var(--text-primary)", padding: "0 10px 0 6px" }}>
              Verso<span style={{ color: "var(--accent)" }}>.</span>
            </span>
          </div>
          <DocumentTab label="Sample Course" active />
          <DocumentTab label="RF Systems 201" />
          <IconButton icon="plus" label="New course" size="md" />
        </div>
        {/* Toolbar row */}
        <div style={{ display: "flex", alignItems: "center", height: 40, padding: "0 8px", gap: 6, borderTop: "1px solid var(--border-subtle)" }}>
          {/* Variant selector */}
          <button style={variantBtn}>
            <span style={{ color: "var(--text-tertiary)" }}>Variant</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>Flagship</span>
            <V.Icon name="chevron-down" size={13} style={{ color: "var(--icon-idle)" }} />
          </button>
          <div style={{ flex: 1 }} />
          {/* Device breakpoints */}
          <div style={groupStyle}>
            <IconButton icon="monitor" label="Desktop" active />
            <IconButton icon="tablet" label="Tablet" />
            <IconButton icon="smartphone" label="Mobile" />
          </div>
          <div style={dividerStyle} />
          <Tooltip label={theme === "dark" ? "Light mode" : "Dark mode"}>
            <IconButton icon={theme === "dark" ? "sun" : "moon"} label="Theme" onClick={onToggleTheme} />
          </Tooltip>
          <IconButton icon="search" label="Search (⌘K)" />
          <IconButton icon="help-circle" label="Help" />
          <span style={{ font: "var(--type-label)", color: "var(--text-tertiary)", padding: "0 6px", whiteSpace: "nowrap" }}>
            Saved 08:09
          </span>
          <div style={groupStyle}>
            <IconButton icon="undo-2" label="Undo" />
            <IconButton icon="redo-2" label="Redo" />
          </div>
          <span style={{ font: "var(--type-label)", color: "var(--text-secondary)", padding: "0 4px" }}>{zoom}%</span>
          <IconButton icon="message-square" label="Comment (C)" />
          <div style={dividerStyle} />
          <Button variant="secondary" icon="upload" iconRight="chevron-down">Export</Button>
          <Button variant="primary" icon="play">Preview</Button>
          <IconButton icon="more-horizontal" label="More" />
        </div>
      </div>
    );
  }

  const variantBtn = {
    display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px",
    background: "var(--surface-input)", border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)", cursor: "pointer",
    font: "var(--type-label)", color: "var(--text-primary)",
  };
  const groupStyle = { display: "flex", alignItems: "center", gap: 2 };
  const dividerStyle = { width: 1, height: 20, background: "var(--border-subtle)", margin: "0 4px" };

  window.TopBar = TopBar;
})();
