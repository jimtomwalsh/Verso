import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * IconButton — square, icon-only action. The toolbar and the per-block
 * "Actions" row (move up/down, duplicate, delete) are built from these.
 * `active` = toggled-on state (e.g. comment mode engaged).
 */
export function IconButton({
  icon,
  size = "md",
  active = false,
  disabled = false,
  danger = false,
  label,
  onClick,
  style,
  ...rest
}) {
  const dims = { sm: "var(--control-sm)", md: "var(--control-md)", lg: "var(--control-lg)" };
  const iconSizes = { sm: 12, md: 16, lg: 18 };
  const [h, setH] = React.useState(false);

  const bg = active
    ? "var(--surface-active)"
    : h && !disabled
    ? "var(--surface-hover)"
    : "transparent";
  const color = danger
    ? "var(--danger)"
    : active
    ? "var(--icon-strong)"
    : h && !disabled
    ? "var(--icon-strong)"
    : "var(--icon-idle)";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dims[size],
        height: dims[size],
        padding: 0,
        border: "none",
        borderRadius: "var(--radius-xs)",
        background: bg,
        color,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)",
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={iconSizes[size]} />
    </button>
  );
}
