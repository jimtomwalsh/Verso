import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * IconField — the workhorse input (55 sites in the real editor). A leading
 * glyph (or short text label) sits inside a 24px field with an editable value.
 * Used for X/Y/W/H, padding, radius, opacity, size — anything numeric or short.
 */
export function IconField({
  icon,
  prefix,
  value,
  suffix,
  placeholder,
  disabled = false,
  onChange,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);

  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        height: "var(--control-md)",
        padding: "0 6px",
        background: "var(--surface-input)",
        borderRadius: "var(--radius-xs)",
        border: "1px solid",
        borderColor: focus
          ? "var(--border-focus)"
          : hover && !disabled
          ? "var(--border-input)"
          : "transparent",
        boxShadow: focus ? "inset 0 0 0 1px var(--border-focus)" : "none",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "text",
        transition: "border-color var(--dur-fast) var(--ease-standard)",
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={14} style={{ color: "var(--icon-idle)" }} />}
      {prefix && (
        <span style={{ font: "var(--type-label)", color: "var(--text-tertiary)", flex: "none" }}>
          {prefix}
        </span>
      )}
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-primary)",
          font: "var(--type-value)",
          padding: 0,
        }}
        {...rest}
      />
      {suffix && (
        <span style={{ font: "var(--type-label)", color: "var(--text-tertiary)", flex: "none" }}>
          {suffix}
        </span>
      )}
    </label>
  );
}
