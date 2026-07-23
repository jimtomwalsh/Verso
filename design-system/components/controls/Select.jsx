import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * Select — a native-backed dropdown styled to the Verso chrome. Kept native
 * for long/dynamic option lists (fonts, categories); bounded choices should
 * use SegmentedControl instead.
 */
export function Select({ options, value, onChange, disabled = false, placeholder, style }) {
  const [hover, setHover] = React.useState(false);
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        height: "var(--control-md)",
        padding: "0 6px",
        background: "var(--surface-input)",
        borderRadius: "var(--radius-xs)",
        border: "1px solid",
        borderColor: hover && !disabled ? "var(--border-input)" : "transparent",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: value ? "var(--text-primary)" : "var(--text-tertiary)",
          font: "var(--type-value)",
          cursor: disabled ? "default" : "pointer",
          padding: 0,
          paddingRight: "16px",
        }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {norm.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-down"
        size={14}
        style={{ position: "absolute", right: "6px", color: "var(--icon-idle)", pointerEvents: "none" }}
      />
    </div>
  );
}
