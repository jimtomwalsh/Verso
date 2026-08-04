import React from "react";

/**
 * The four document types, fixed. `source` is written material; the other three are design
 * documents and correspond to the geometry a document is laid out in.
 */
export type DocumentType = "source" | "reflow" | "frame" | "paged";

/** Where a document is currently open, if it is. Stated, never guessed. */
export type DocumentOpenState = "edit" | "source" | null;

export interface DocumentRowProps {
  /** Document title (from doc.meta.title). Falls back to the code when a document has no title. */
  title: string;
  /** The document's type. Fixes both the glyph and the icon well's colour. */
  type: DocumentType;
  /** Compact relative time ("11mo", "3m", "just now"); "—" when the document has no timestamp. */
  updated?: string;
  /** The full phrase ("11 months ago") for the timestamp's tooltip. */
  updatedTitle?: string;
  /**
   * Show the type as a chip beside the title. OFF by default: in a view already grouped by type
   * the chip is pure redundancy, so each view opts in rather than the row assuming.
   */
  typeChip?: boolean;
  /** Mark this document as its product's primary source. Renders the `Primary` chip. */
  primary?: boolean;
  /** Where this document is already open. Renders "Open in Edit" / "Open in Source". */
  openIn?: DocumentOpenState;
  /** Per-product colour dot, the same identity marker the document's tab carries. */
  dot?: string | null;
  dotTitle?: string;
  /** Selected/active state — an accent tint, matching a selected row anywhere else. */
  active?: boolean;
  /**
   * Trailing affordances a particular list needs and no other does: Publish's selection box,
   * drift badge, alignment meter and variant chip (uio-W16). Kept as a slot so a consumer never
   * forks the row to add one.
   */
  trailing?: React.ReactNode;
  /** Open the document (click anywhere on the row). A row that is already open REVEALS its tab. */
  onOpen?: () => void;
  /** Open the per-document overflow ContextMenu (the "…" button, hover-only). */
  onMenu?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/**
 * One document in any list: Files, Publish, the pickers, the command palette. 32px
 * (`--row-height-doc`), one anatomy everywhere:
 *
 *   [type icon well 24px] [title, flex, ellipsis] [Primary?] [type chip?] [open-state] [updated]
 *
 * This is NOT the spine's shared row. That one is a settings row -- a fixed label column and a
 * canonical control, for a value you set. This is a list item you click to open. They share the
 * token set and nothing else.
 */
export function DocumentRow(props: DocumentRowProps): JSX.Element;
