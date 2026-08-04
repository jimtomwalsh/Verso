import React from "react";
import { Icon } from "../foundation/Icon.jsx";
import { IconButton } from "../actions/IconButton.jsx";

/**
 * The four document types, and the glyph + icon-well colour each one always gets. ONE definition:
 * the top-bar tab and every document list read this same map, so a glyph can never come to mean
 * one thing in a strip and another in a list.
 *
 * Source documents get the accent-quiet well; design documents get the neutral input well. That
 * single colour difference is what makes written material legible from laid-out material without
 * reading a word.
 */
export const DOCUMENT_TYPES = {
  source: { icon: "book-open", label: "Source", well: "var(--accent-quiet)", ink: "var(--accent)" },
  reflow: { icon: "layers", label: "Course", well: "var(--surface-input)", ink: "var(--icon-idle)" },
  frame: { icon: "monitor", label: "Presentation", well: "var(--surface-input)", ink: "var(--icon-idle)" },
  paged: { icon: "file-text", label: "Guide", well: "var(--surface-input)", ink: "var(--icon-idle)" },
};

/**
 * DocumentRow — one document in any list: Files, Publish, the pickers, the palette. 32px
 * (`--row-height-doc`), one anatomy everywhere:
 *
 *   [type icon well 24px] [title, flex, ellipsis] [Primary?] [type chip?] [open-state] [updated]
 *
 * NOT the spine's shared row. That one is a settings row -- fixed label column plus a canonical
 * control, for a value you set. This is a list item you click to open.
 *
 * `updated` is pre-formatted COMPACT copy ("11mo", "3m"); the full phrase goes in `updatedTitle`
 * as a tooltip. The long form would not fit the column and would ellipsise in every row.
 *
 * `typeChip` is off by default: a view already grouped by type does not repeat it per row.
 */
export function DocumentRow({
  title,
  type = "reflow",
  updated = "—",
  updatedTitle,
  typeChip = false,
  primary = false,
  openIn = null,
  dot = null,
  dotTitle,
  active = false,
  trailing,
  onOpen,
  onMenu,
  style,
}) {
  const [hover, setHover] = React.useState(false);
  const t = DOCUMENT_TYPES[type] || DOCUMENT_TYPES.reflow;
  const openLabel = openIn === "edit" ? "Open in Edit" : openIn === "source" ? "Open in Source" : null;
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        height: "var(--row-height-doc)",
        padding: "0 var(--space-4)",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        font: "var(--type-label)",
        color: "var(--text-primary)",
        background: active ? "var(--accent-quiet)" : hover ? "rgba(255,255,255,0.06)" : "transparent",
        ...style,
      }}
    >
      {/* Type well. The colour, not the glyph, is what reads at a glance. */}
      <span
        aria-hidden="true"
        style={{
          flex: "0 0 auto",
          width: "var(--control-md)",
          height: "var(--control-md)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-xs)",
          background: t.well,
          color: t.ink,
        }}
      >
        <Icon name={t.icon} size={14} />
      </span>

      {dot ? (
        <span
          title={dotTitle}
          style={{ flex: "0 0 auto", width: 6, height: 6, borderRadius: "var(--radius-full)", background: dot }}
        />
      ) : null}

      <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </span>

      {primary ? <Chip label="Primary" tone="accent" /> : null}
      {typeChip ? <Chip label={t.label} /> : null}

      {/* Open-state is a FACT about the document, not a value you set and not a click target --
          so it is plain text, never a chip. Nothing here is pill-rounded but toggles and counts. */}
      {openLabel ? (
        <span style={{ flex: "0 0 auto", color: "var(--text-secondary)" }}>{openLabel}</span>
      ) : null}

      {trailing}

      <span
        title={updatedTitle}
        style={{ flex: "0 0 64px", textAlign: "right", color: "var(--text-secondary)" }}
      >
        {updated}
      </span>

      {onMenu ? (
        <span style={{ flex: "0 0 auto", visibility: hover ? "visible" : "hidden" }}>
          <IconButton
            icon="more-horizontal"
            label="Document actions"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onMenu(e); }}
          />
        </span>
      ) : null}
    </div>
  );
}

/** A small square-ish chip. 2px radius per the DS -- chips are not pills. */
function Chip({ label, tone }) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        padding: "0 var(--space-2)",
        borderRadius: "var(--radius-xs)",
        background: tone === "accent" ? "var(--accent-quiet)" : "var(--surface-input)",
        color: tone === "accent" ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {label}
    </span>
  );
}
