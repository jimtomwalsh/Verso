import React from "react";

export interface EdgePoint { x: number; y: number }

export interface EdgeProps {
  /** Start point in board coords (a source pin's `ConnectionPort`). */
  from: EdgePoint;
  /** End point in board coords (the target node's anchor). */
  to: EdgePoint;
  /** Selected edges paint `--accent` and expose a delete affordance. */
  selected?: boolean;
  /** A draft edge being dragged out of a port (dashed, no target yet). */
  draft?: boolean;
  onSelect?: () => void;
  /** Delete this link (clears the marker's target). */
  onDelete?: () => void;
  style?: React.CSSProperties;
}

/**
 * A directed connector between two nodes on the `GraphBoard` — a curved SVG path
 * from a source pin's port to its target screen, representing a `navigate` marker's
 * link. Idle stroke `--border-strong`; selected `--accent` (+ a delete affordance);
 * a `draft` edge (mid drag-to-connect) is dashed with no target. Edges live in one
 * SVG layer BENEATH the nodes so they never intercept node/pin drags.
 *
 * REUSE, do not duplicate: the main editor already renders interaction connectors for
 * `data-goto` links — the tour-builder edge layer MUST reuse that connector renderer
 * (path maths, hit-area, selection), not stand up a second connector implementation.
 */
export function Edge(props: EdgeProps): JSX.Element;
