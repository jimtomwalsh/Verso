import React from "react";

/**
 * FieldRow — a labelled inspector row: a fixed-width label on the left, the
 * control(s) on the right. The single most repeated layout in the panels
 * (~20 direct sites; the structural basis for most others).
 */
export function FieldRow({ label, children, align = "center", labelWidth = 64, style }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${labelWidth}px 1fr`,
        alignItems: align === "top" ? "start" : "center",
        gap: "8px",
        minHeight: "var(--row-height)",
        padding: "2px 0",
        ...style,
      }}
    >
      <div
        style={{
          font: "var(--type-label)",
          color: "var(--text-secondary)",
          paddingTop: align === "top" ? "5px" : 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/**
 * TwoUp — two equal controls side by side inside a row's control slot
 * (X/Y, W/H, gap/columns). Mirrors the editor's `twoUp` helper.
 */
export function TwoUp({ children, gap = 6, style }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${gap}px`, minWidth: 0, ...style }}>
      {children}
    </div>
  );
}
