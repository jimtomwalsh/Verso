import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * TreeItem — an outliner row (chapter / page / block). Handles indentation,
 * an optional twirl chevron for containers, a leading icon, the label, and a
 * trailing slot (count badge, visibility eye). Mirrors the Structure panel.
 */
export function TreeItem({
  label,
  icon,
  depth = 0,
  selected = false,
  expandable = false,
  expanded = false,
  muted = false,
  trailing,
  onToggle,
  onSelect,
  style,
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        height: "26px",
        paddingRight: "8px",
        paddingLeft: `${8 + depth * 14}px`,
        cursor: "pointer",
        borderRadius: "var(--radius-xs)",
        background: selected ? "var(--surface-selected)" : hover ? "var(--surface-hover)" : "transparent",
        color: muted ? "var(--text-tertiary)" : "var(--text-primary)",
        ...style,
      }}
    >
      <span
        onClick={(e) => {
          e.stopPropagation();
          expandable && onToggle && onToggle();
        }}
        style={{
          flex: "none",
          width: "12px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--icon-idle)",
        }}
      >
        {expandable && (
          <Icon
            name="chevron-right"
            size={12}
            style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform var(--dur-fast) var(--ease-standard)" }}
          />
        )}
      </span>
      {icon && <Icon name={icon} size={14} style={{ color: selected ? "var(--accent)" : "var(--icon-idle)", flex: "none" }} />}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          font: selected ? "var(--type-label-strong)" : "var(--type-label)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {trailing && <span style={{ flex: "none", display: "inline-flex", alignItems: "center" }}>{trailing}</span>}
    </div>
  );
}
