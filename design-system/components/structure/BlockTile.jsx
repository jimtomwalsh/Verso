import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * BlockTile — a block-palette entry as a compact icon tile (icon over label),
 * for laying the palette out as a scannable grid instead of a long scrolling
 * list. Drag or click to insert. Pair several in a CSS grid (see BlockGrid).
 */
export function BlockTile({ label, icon, selected = false, onClick, draggable = true, style }) {
  const [hover, setHover] = React.useState(false);
  const activeBg = selected ? "var(--surface-selected)" : hover ? "var(--surface-hover)" : "var(--surface-input)";
  return (
    <div
      draggable={draggable}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={label}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        padding: "12px 6px 9px",
        borderRadius: "var(--radius-sm)",
        cursor: "grab",
        background: activeBg,
        boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px var(--border-subtle)",
        color: "var(--text-primary)",
        transition: "background var(--dur-fast) var(--ease-standard)",
        ...style,
      }}
    >
      <Icon name={icon} size={16} style={{ color: selected || hover ? "var(--accent)" : "var(--icon-idle)" }} />
      <span
        style={{
          font: "var(--type-label)",
          fontSize: "10px",
          color: "var(--text-secondary)",
          textAlign: "center",
          lineHeight: 1.25,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * BlockGrid — a responsive grid wrapper for BlockTiles.
 *
 * Default (and preferred) mode is WIDTH-ADAPTIVE: pass `minColWidth` and the
 * column COUNT flexes with the container while each tile keeps a stable target
 * size (`repeat(auto-fill, minmax(<minColWidth>px, 1fr))`). Use this when the
 * dock is user-resizable — a fixed column count makes tiles balloon as the
 * panel widens. `columns` is retained for a fixed-count grid in a fixed-width
 * dock; `minColWidth` wins when both are given.
 */
export function BlockGrid({ children, columns = 3, minColWidth, style }) {
  const gridTemplateColumns = minColWidth
    ? `repeat(auto-fill, minmax(${minColWidth}px, 1fr))`
    : `repeat(${columns}, 1fr)`;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns,
        gap: "6px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
