import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * SegmentedControl — the `segmentedLive` / `segmentedIconLive` control (~20
 * sites). A single-select track of segments. Supports text labels, icons, or
 * both. Used for alignment, fit modes, variant switches, reveal styles.
 */
export function SegmentedControl({ options, value, onChange, size = "md", style }) {
  const height = size === "sm" ? "var(--control-sm)" : "var(--control-md)";

  return (
    <div
      role="tablist"
      style={{
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: "1fr",
        gap: "2px",
        height,
        padding: "2px",
        background: "var(--surface-input)",
        borderRadius: "var(--radius-xs)",
        ...style,
      }}
    >
      {options.map((opt) => {
        const val = typeof opt === "string" ? opt : opt.value;
        const selected = val === value;
        return (
          <Segment
            key={val}
            opt={opt}
            selected={selected}
            onClick={() => onChange && onChange(val)}
          />
        );
      })}
    </div>
  );
}

function Segment({ opt, selected, onClick }) {
  const [hover, setHover] = React.useState(false);
  const label = typeof opt === "string" ? opt : opt.label;
  const icon = typeof opt === "string" ? null : opt.icon;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={typeof opt === "object" ? opt.title || label : label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "5px",
        border: "none",
        borderRadius: "calc(var(--radius-xs) - 1px)",
        cursor: "pointer",
        padding: "0 8px",
        minWidth: 0,
        font: "var(--type-label-strong)",
        background: selected ? "var(--surface-active)" : hover ? "var(--surface-hover)" : "transparent",
        color: selected ? "var(--text-primary)" : "var(--icon-idle)",
        boxShadow: selected ? "0 1px 2px rgba(0,0,0,0.3)" : "none",
        transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)",
      }}
    >
      {icon && <Icon name={icon} size={14} />}
      {label && (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      )}
    </button>
  );
}
