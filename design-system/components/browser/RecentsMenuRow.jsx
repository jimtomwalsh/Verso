import React from "react";
import { ThumbnailFrame } from "./ThumbnailFrame.jsx";

/**
 * RecentsMenuRow — one recent course inside the top-bar save/recents dropdown: a
 * small page-1 snapshot, the title + code stacked, and the last-edited time on the
 * trailing edge. A menu row (hover wash, full-width, click to open), sized denser
 * than a CourseCard because it lives in a ContextMenu/overlay, not the wall grid.
 */
export function RecentsMenuRow({ title, code, lastEdited = "—", thumbnail, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        background: hover ? "var(--surface-hover)" : "transparent",
        transition: "background var(--dur-fast) var(--ease-standard)",
        ...style,
      }}
    >
      <div style={{ width: "44px", flex: "none", borderRadius: "var(--radius-xs)", overflow: "hidden" }}>
        <ThumbnailFrame empty={!thumbnail} style={{ borderRadius: "var(--radius-xs)" }}>
          {thumbnail}
        </ThumbnailFrame>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            font: "var(--type-label-strong)",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={title}
        >
          {title}
        </div>
        <div style={{ font: "var(--type-label)", color: "var(--text-tertiary)" }}>{code}</div>
      </div>
      <div style={{ font: "var(--type-label)", color: "var(--text-tertiary)", whiteSpace: "nowrap", flex: "none" }}>
        {lastEdited}
      </div>
    </div>
  );
}
