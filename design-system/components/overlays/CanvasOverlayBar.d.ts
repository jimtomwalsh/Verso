import React from "react";

export interface CanvasOverlayBarProps {
  /**
   * Tool slots, left to right. Icon-only toggles/launchers plus an optional
   * embedded value control (zoom). Render `IconButton`s and DS controls; insert
   * `"divider"` between logical groups.
   */
  children: React.ReactNode;
  /** Horizontal placement within the canvas. Default "center". */
  align?: "center" | "left" | "right";
  style?: React.CSSProperties;
}

/**
 * The persistent floating canvas toolbar. One bar pinned to the BOTTOM-CENTRE of
 * the canvas, ALWAYS visible and independent of selection — it hosts canvas tools
 * (grid, find & replace, comment mode, zoom), never per-block actions (those live
 * in the right-hand inspector). Raised surface: elevated background, `--radius-lg`
 * corners, subtle shadow; 1px hairline dividers between groups. Floats above the
 * canvas via absolute positioning; does not scroll with page content.
 */
export function CanvasOverlayBar(props: CanvasOverlayBarProps): JSX.Element;
