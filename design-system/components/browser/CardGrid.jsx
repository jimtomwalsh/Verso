import React from "react";

/**
 * CardGrid — the responsive grid the file browser lays CourseCards out in.
 * Auto-fills columns at a minimum card width so the library reflows from a wide
 * multi-column wall down to a single column without a media-query per breakpoint.
 * `min` is the smallest a card is allowed to get before the column count drops.
 */
export function CardGrid({ children, min = "180px", style }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))`,
        gap: "var(--space-8)",
        alignContent: "start",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * BrowserEmptyState — the empty library placeholder shown when there are no
 * courses (a gentle instruction, DS voice). Sits where the CardGrid would.
 */
export function BrowserEmptyState({ title = "No courses yet", hint = "Create a new course or import a .verso to get started.", action, style }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--space-16)",
        textAlign: "center",
        color: "var(--text-tertiary)",
        ...style,
      }}
    >
      <div style={{ font: "var(--type-section)", color: "var(--text-secondary)" }}>{title}</div>
      <div style={{ font: "var(--type-label)", maxWidth: "34ch" }}>{hint}</div>
      {action}
    </div>
  );
}
