import React from "react";

export interface DocumentTabProps {
  /** Document title. */
  label: string;
  active?: boolean;
  /**
   * The document's type. Fixes the leading glyph, from the ONE vocabulary in
   * browser/DocumentRow.jsx (DOCUMENT_TYPES) that every document surface shares -- so a glyph
   * cannot mean one thing in the strip and another in a list.
   */
  type?: "source" | "reflow" | "frame" | "paged";
  /** Human name of the type, for the tab's tooltip. */
  typeLabel?: string;
  /** Per-product colour dot: a stable identity marker, NOT a changed-since-export cue. */
  dot?: string | null;
  dotTitle?: string;
  onSelect?: () => void;
  onClose?: () => void;
  style?: React.CSSProperties;
}

/** A top-bar document tab. Several documents can be open at once. */
export function DocumentTab(props: DocumentTabProps): JSX.Element;
