import React from "react";

export interface ConnectionPortProps {
  /** Whether a link already originates here (filled) or not (hollow). */
  connected?: boolean;
  /** Drag-out started (the port is the origin of a draft `Edge`). */
  active?: boolean;
  /** Begin a drag-to-connect from this port. */
  onConnectStart?: (e: React.PointerEvent) => void;
  style?: React.CSSProperties;
}

/**
 * The drag-to-connect handle on a `navigate` pin. A small circular port on a
 * `ScreenNode`'s pin: press and drag from it to a target node to create or repoint
 * that marker's link (spawns a `draft` `Edge` that follows the cursor and commits on
 * drop over a node). Hollow ring when unconnected, filled `--accent` when a link
 * exists or the drag is active; grows slightly on hover to advertise the affordance.
 * A pointer-only affordance — keyboard linking uses the inspector's "Goes to" select
 * (already shipped), so the port never traps keyboard users.
 */
export function ConnectionPort(props: ConnectionPortProps): JSX.Element;
