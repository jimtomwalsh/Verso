import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * DocumentTab — a top-bar course tab. The active tab reads as connected to
 * the workspace; inactive tabs are quiet. A close "×" appears on hover/active.
 */
export function DocumentTab({ label, active = false, onSelect, onClose, style }) {
  const [hover, setHover] = React.useState(false);
  const showClose = active || hover;
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        height: "var(--tabbar-height)",
        maxWidth: "180px",
        padding: "0 10px",
        cursor: "pointer",
        font: "var(--type-label)",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "var(--surface-canvas)" : "transparent",
        borderRight: "1px solid var(--border-subtle)",
        ...style,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onClose && onClose();
        }}
        style={{
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "16px",
          height: "16px",
          borderRadius: "var(--radius-xs)",
          color: "var(--icon-idle)",
          visibility: showClose ? "visible" : "hidden",
        }}
      >
        <Icon name="x" size={12} />
      </span>
    </div>
  );
}
