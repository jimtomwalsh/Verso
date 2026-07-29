import React from "react";

export interface ResizeHandleProps {
  /** Which edge this handle sits on. */
  side: "left" | "right";
  /**
   * Called live during the drag AND on commit with the new width as a
   * percentage of the containing column (20-100). Width is symmetric about the
   * object's centre: newWidth = 2 x |pointerX - centreX|, clamped to [20, 100].
   * The object stays centred; alignment is a separate control.
   */
  onResize: (pct: number) => void;
  /**
   * Optional light-snap stops the drag magnetises to (default 25/50/75/100),
   * with a snap radius of ~4%. Snap assists; it never prevents an in-between value.
   */
  snap?: number[];
}

/**
 * The on-canvas selection chrome for resizing a selected object by dragging its
 * edges (Confluence-style). Rendered as two handles, one per edge, ONLY when the
 * host object carries `.is-object-selected` (selection gates the handles; hover
 * does not). Resize is symmetric about the object centre and commits a single
 * width percentage of the column that renders purely (editor == export) and
 * round-trips through the document. Each handle: a 10px square, `--surface-raised`
 * fill, 1.5px `--accent` border, `--radius-xs`, cursor `ew-resize`, nudged just outside
 * the object bound. The selected object carries `--shadow-selected`; the ring plus
 * the handles read as one selection state. Reuse for any resizable on-canvas object.
 */
export function ResizeHandle(props: ResizeHandleProps): JSX.Element;
