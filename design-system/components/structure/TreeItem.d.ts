import React from "react";

export interface TreeItemProps {
  label: React.ReactNode;
  /** Leading Lucide glyph (block type / page / chapter). */
  icon?: string;
  /** Indent level (0 = chapter). */
  depth?: number;
  selected?: boolean;
  /** Shows a twirl chevron (containers, chapters, pages with blocks). */
  expandable?: boolean;
  expanded?: boolean;
  /** Dim the row (e.g. hidden/skipped page). */
  muted?: boolean;
  /** Trailing slot — a Badge count or an eye toggle. */
  trailing?: React.ReactNode;
  onToggle?: () => void;
  onSelect?: () => void;
  style?: React.CSSProperties;
}

/** Outliner row for the Structure panel — chapters, pages, blocks. */
export function TreeItem(props: TreeItemProps): JSX.Element;
