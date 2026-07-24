import React from "react";

export interface CanvasOverlayBarProps {
  /**
   * Always-on tool slots, left to right (zone 1). Icon-only toggles/launchers
   * plus an optional embedded value control (zoom). Render `IconButton`s and DS
   * controls; insert `"divider"` between logical groups. Visible with nothing
   * selected.
   */
  children: React.ReactNode;
  /**
   * Selection-contextual actions segment (zone 2), appended after a `"divider"`
   * when an object is selected and cleared on deselect. Hosts per-object VERBS
   * (duplicate, delete, set-entry, …) and the object's DEFINING mode toggles
   * (action/shape switches) — this is their SINGLE home; a control here is
   * removed from the inspector, never duplicated. Value properties (sizes,
   * colours, padding, radius) do NOT belong here — they stay in the inspector.
   * Omit / null when nothing is selected.
   */
  selectionActions?: React.ReactNode;
  /** Horizontal placement within the canvas. Default "center". */
  align?: "center" | "left" | "right";
  style?: React.CSSProperties;
}

/**
 * The persistent floating canvas toolbar. One bar pinned to the BOTTOM-CENTRE of
 * the canvas, in two zones: an ALWAYS-ON tools zone (grid, find & replace, comment
 * mode, zoom) reachable with nothing selected, plus a SELECTION-CONTEXTUAL actions
 * segment appended on select and cleared on deselect. The segment carries per-object
 * verbs + defining mode toggles as their single home (removed from the inspector,
 * not duplicated); value properties stay in the inspector. Shipped realisation: the
 * `.canvas-overlay-bar__actions` sibling + `--sep--actions` divider, managed by
 * `ensureBlockToolbar`/`showBlockToolbar`/`hideBlockToolbar`; graph/board builders
 * reuse the same mechanism. Raised surface: elevated background, `--radius-lg`
 * corners, subtle shadow; 1px hairline dividers between groups. Floats above the
 * canvas via absolute positioning; does not scroll with page content.
 */
export function CanvasOverlayBar(props: CanvasOverlayBarProps): JSX.Element;
