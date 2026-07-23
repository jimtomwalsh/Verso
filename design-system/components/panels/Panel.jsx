import React from "react";

/**
 * Panel — the left/right dock shell. A fixed-width, full-height column with
 * the panel surface + a single edge border. Compose PanelSection children
 * inside. `side` controls which edge border shows.
 */
export function Panel({ children, side = "right", width, header, footer, style }) {
  const w = width || (side === "left" ? "var(--panel-left-width)" : "var(--panel-right-width)");
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        width: w,
        flex: "none",
        height: "100%",
        background: "var(--surface-panel)",
        borderLeft: side === "right" ? "1px solid var(--border-subtle)" : "none",
        borderRight: side === "left" ? "1px solid var(--border-subtle)" : "none",
        color: "var(--text-primary)",
        overflow: "hidden",
        ...style,
      }}
    >
      {header && <div style={{ flex: "none" }}>{header}</div>}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>{children}</div>
      {footer && (
        <div style={{ flex: "none", borderTop: "1px solid var(--border-subtle)" }}>{footer}</div>
      )}
    </aside>
  );
}
