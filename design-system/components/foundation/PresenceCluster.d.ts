import React from "react";

export interface PresencePeer {
  /** Display name — drives initials and the deterministic author colour. */
  name: string;
  /** The author colour (from colourForName / COMMENT_COLOURS). Reused across presence + comments. */
  colour: string;
  /** Is this peer actively editing a block (holds a content lock), or merely viewing? */
  state: "editing" | "viewing";
  /** Stable id of the block the peer is on, if any (for the hover tooltip + "route around" cue). */
  blockId?: string | null;
  /** Human label of that block, for the tooltip ("editing Range, bearing…"). */
  blockLabel?: string | null;
}

export interface PresenceClusterProps {
  /** Everyone currently present in the file (excluding "me" — render "me" separately, pinned). */
  peers: PresencePeer[];
  /** Max avatars before collapsing the tail into a "+N" chip. Default 4. */
  max?: number;
  style?: React.CSSProperties;
}

/**
 * The live-collaboration presence cluster — overlapping author avatars pinned to the RIGHT of
 * the toolbar, showing who is in the file right now. SERVER-MODE ONLY: renders nothing when not
 * collaborating (solo/standalone shows no presence chrome at all).
 *
 * Each avatar is `--control-sm` (20px), `--radius-full`, overlapped -6px, ringed in the peer's
 * author colour (`colourForName`, the SAME palette comment-review uses). Two states, one glance:
 * EDITING = a solid author-colour fill + ring (has the lock); VIEWING = a 40%/hollow ring with a
 * tinted centre (just watching). Initials at `--text-2xs`. Beyond `max`, the tail collapses to a
 * "+N" chip. Hover any avatar → a `Tooltip` with the name + viewing/editing + the block label.
 *
 * Ambient, not loud (the-tool-recedes): the cluster never steals focus; it is identity + status
 * only. Per-block "who holds this" lives on the block chip, not here. Motion is opacity/colour
 * only, within the 150–200ms budget, when peers join/leave or flip viewing↔editing.
 */
export function PresenceCluster(props: PresenceClusterProps): JSX.Element | null;
