import React from "react";

/**
 * Tooltip — a small dark label shown on hover. Wraps any trigger element.
 * Delay + placement match the editor's toolbar tooltips.
 */
export function Tooltip({ label, children, placement = "bottom", style }) {
  const [show, setShow] = React.useState(false);

  const pos = {
    bottom: { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" },
    top: { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" },
  };

  return (
    <span
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: "relative", display: "inline-flex", ...style }}
    >
      {children}
      {show && label && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            ...pos[placement],
            padding: "4px 7px",
            background: "var(--gray-900)",
            color: "var(--text-primary)",
            font: "var(--type-label)",
            whiteSpace: "nowrap",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow-popover)",
            pointerEvents: "none",
            zIndex: 900,
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
