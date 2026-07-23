import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * ContextMenu — the floating menu behind right-click (canvas + outliner) and
 * ⋯ overflow buttons (9 sites). Items carry an optional icon, a keyboard
 * shortcut hint, a danger flag, and dividers between groups. Verb parity with
 * the block Actions row is intentional.
 */
export function ContextMenu({ items, onSelect, style }) {
  return (
    <div
      role="menu"
      style={{
        minWidth: "180px",
        padding: "4px",
        background: "var(--surface-raised)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-menu)",
        color: "var(--text-primary)",
        ...style,
      }}
    >
      {items.map((item, i) => {
        if (item === "-" || item.divider) {
          return <div key={i} style={{ height: "1px", background: "var(--border-subtle)", margin: "4px 0" }} />;
        }
        return <MenuItem key={i} item={item} onSelect={onSelect} />;
      })}
    </div>
  );
}

function MenuItem({ item, onSelect }) {
  const [hover, setHover] = React.useState(false);
  const disabled = item.disabled;
  const danger = item.danger;
  return (
    <div
      role="menuitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        if (disabled) return;
        item.onClick && item.onClick();
        onSelect && onSelect(item.value ?? item.label);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        height: "26px",
        padding: "0 8px",
        borderRadius: "var(--radius-xs)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        background: hover && !disabled ? (danger ? "var(--red-tint)" : "var(--surface-hover)") : "transparent",
        color: danger ? "var(--danger)" : "var(--text-primary)",
      }}
    >
      <span style={{ flex: "none", width: "16px", display: "inline-flex", justifyContent: "center", color: danger ? "var(--danger)" : "var(--icon-idle)" }}>
        {item.icon && <Icon name={item.icon} size={14} />}
      </span>
      <span style={{ flex: 1, font: "var(--type-label)" }}>{item.label}</span>
      {item.shortcut && (
        <span style={{ flex: "none", font: "var(--type-label)", color: "var(--text-tertiary)" }}>{item.shortcut}</span>
      )}
    </div>
  );
}
