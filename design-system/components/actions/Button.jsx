import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * Button — text action. Primary is the top-bar "Export"; secondary/ghost are
 * the quiet workhorses inside panels and dialogs.
 */
export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  full = false,
  onClick,
  style,
  ...rest
}) {
  const heights = { sm: "var(--control-md)", md: "var(--control-lg)" };
  const pads = { sm: "0 8px", md: "0 12px" };

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: heights[size],
    padding: pads[size],
    font: "var(--type-label-strong)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid transparent",
    cursor: disabled ? "default" : "pointer",
    whiteSpace: "nowrap",
    userSelect: "none",
    width: full ? "100%" : "auto",
    opacity: disabled ? 0.4 : 1,
    transition: "background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)",
  };

  const variants = {
    primary: {
      background: "var(--accent)",
      color: "var(--text-on-accent)",
    },
    secondary: {
      background: "var(--surface-input)",
      color: "var(--text-primary)",
      borderColor: "var(--border-input)",
    },
    ghost: {
      background: "transparent",
      color: "var(--text-primary)",
    },
    danger: {
      background: "var(--danger)",
      color: "var(--white)",
    },
  };

  const hover = {
    primary: "var(--accent-hover)",
    secondary: "var(--surface-hover)",
    ghost: "var(--surface-hover)",
    danger: "var(--danger-hover)",
  };

  const [h, setH] = React.useState(false);
  const vstyle = variants[variant];
  const bg =
    !disabled && h
      ? variant === "secondary" || variant === "ghost"
        ? undefined
        : hover[variant]
      : vstyle.background;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        ...base,
        ...vstyle,
        background: bg || vstyle.background,
        ...(h && !disabled && (variant === "secondary" || variant === "ghost")
          ? { background: "var(--surface-hover)" }
          : null),
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={14} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}
