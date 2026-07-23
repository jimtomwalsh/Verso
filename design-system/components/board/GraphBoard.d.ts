import React from "react";

export interface GraphBoardProps {
  /**
   * Board contents in board-space: `ScreenNode`s absolutely positioned by their
   * board coords, and the `Edge` connector layer beneath them. The board applies a
   * single pan/zoom transform to this layer; children never manage their own scroll.
   */
  children: React.ReactNode;
  /** Zoom factor (1 = 100%). Cmd/Ctrl-scroll and the zoom control drive it. */
  zoom?: number;
  /** Pan offset in board pixels. Space-drag / trackpad two-finger drag drive it. */
  pan?: { x: number; y: number };
  onZoomChange?: (zoom: number) => void;
  onPanChange?: (pan: { x: number; y: number }) => void;
  /** Fires when empty board space is clicked (clears selection). */
  onBackgroundClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * A pannable, zoomable 2D node canvas — the working surface of a graph builder
 * (e.g. the hotspot software-tour builder). NOT the page-flow editor canvas and NOT
 * a `CanvasOverlayBar` (that is only a toolbar): this is a free 2D board whose nodes
 * carry their own x/y. Fills its host overlay; background is `--surface-canvas` with
 * an optional faint dot grid; one transform (pan + zoom) is applied to the child
 * layer so nodes and edges stay registered. Pan = space-drag or trackpad; zoom =
 * Cmd/Ctrl-scroll, clamped, plus a zoom/fit control that reuses the `CanvasOverlayBar`
 * zoom form. Selection model matches the app: click a node = select, double-click =
 * drill in, Escape = up / close, background click = clear. Direct manipulation first
 *: drag nodes, drag pins, drag ports — panel controls are the
 * fallback, not the default. Renders/exports nothing; Verso UI (editor chrome) only.
 */
export function GraphBoard(props: GraphBoardProps): JSX.Element;
