import React from "react";

/**
 * Badge — a small count / status pill. Neutral by default; `tone` tints it for
 * status (accent, success, danger, component-purple). Used for chapter counts,
 * "viewed" progress, variant tags, and NEW markers.
 */
export function Badge({ children, tone = "neutral", size = "sm", style }) {
  const tones = {
    neutral: { bg: "var(--surface-input)", fg: "var(--text-secondary)" },
    accent: { bg: "var(--accent-quiet)", fg: "var(--accent)" },
    success: { bg: "var(--green-tint)", fg: "var(--success)" },
    danger: { bg: "var(--red-tint)", fg: "var(--danger)" },
    warning: { bg: "var(--yellow-tint)", fg: "var(--warning)" },
    component: { bg: "rgba(151,71,255,0.16)", fg: "var(--component)" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: size === "sm" ? "16px" : "20px",
        minWidth: size === "sm" ? "16px" : "20px",
        padding: "0 5px",
        borderRadius: "var(--radius-full)",
        background: t.bg,
        color: t.fg,
        font: "var(--type-label-strong)",
        fontSize: size === "sm" ? "10px" : "11px",
        letterSpacing: "var(--tracking-normal)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
