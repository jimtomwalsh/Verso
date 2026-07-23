import React from "react";
import { Icon } from "../foundation/Icon.jsx";
import { IconButton } from "../actions/IconButton.jsx";
import { ThumbnailFrame } from "./ThumbnailFrame.jsx";

/**
 * CourseCard — one course in the file browser: a live page-1 thumbnail on top,
 * then a footer with the course title, a meta line (code + last edited), and a
 * "…" overflow button that opens the per-course ContextMenu (Open, Duplicate,
 * Rename, Delete, Export .verso, …). A flat raised card — 6px radius, 1px
 * hairline, hover wash, accent ring when selected — never a drop shadow while
 * docked (DS: borders over shadows). `lastEdited` is pre-formatted copy; pass
 * "—" when a course has no timestamp yet (it must never be hidden).
 */
export function CourseCard({
  title,
  code,
  lastEdited = "—",
  thumbnail,
  selected = false,
  onOpen,
  onMenu,
  style,
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        background: selected ? "var(--surface-selected)" : hover ? "var(--surface-hover)" : "var(--surface-raised)",
        boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px var(--border-subtle)",
        transition: "background var(--dur-fast) var(--ease-standard)",
        ...style,
      }}
    >
      <ThumbnailFrame empty={!thumbnail}>{thumbnail}</ThumbnailFrame>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-2)",
          padding: "var(--space-4) var(--space-4) var(--space-5)",
        }}
      >
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
          <div
            style={{
              marginTop: "var(--space-1)",
              font: "var(--type-label)",
              color: "var(--text-tertiary)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              overflow: "hidden",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{code}</span>
            <span aria-hidden>·</span>
            <span style={{ whiteSpace: "nowrap" }}>{lastEdited}</span>
          </div>
        </div>
        <IconButton
          icon="more-horizontal"
          title="Course actions"
          onClick={(e) => {
            e.stopPropagation();
            onMenu && onMenu(e);
          }}
        />
      </div>
    </div>
  );
}
