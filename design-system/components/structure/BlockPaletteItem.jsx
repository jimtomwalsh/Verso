import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * BlockPaletteItem — a row in the Blocks palette: a leading block-type icon
 * and its name. Click or drag to insert. Hover raises the row.
 */
export function BlockPaletteItem({ label, icon, onClick, draggable = true, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      draggable={draggable}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        height: "30px",
        padding: "0 8px",
        borderRadius: "var(--radius-xs)",
        cursor: "grab",
        background: hover ? "var(--surface-hover)" : "transparent",
        color: "var(--text-primary)",
        ...style,
      }}
    >
      <span
        style={{
          flex: "none",
          width: "24px",
          height: "24px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-xs)",
          background: "var(--surface-input)",
          color: hover ? "var(--accent)" : "var(--icon-idle)",
        }}
      >
        <Icon name={icon} size={15} />
      </span>
      <span style={{ font: "var(--type-label)" }}>{label}</span>
    </div>
  );
}
