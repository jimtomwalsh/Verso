import React from "react";

export interface BadgeProps {
  children: React.ReactNode;
  /** neutral (default) · accent · success · danger · warning · component. */
  tone?: "neutral" | "accent" | "success" | "danger" | "warning" | "component";
  size?: "sm" | "md";
  /**
   * Quiet: a tinted background with the tone as INK, instead of a solid fill with white text.
   * Use when the badge repeats down a list (one per row) and a wall of solid fills would shout —
   * a release log's outcome, a row's state. A one-off badge stays solid.
   */
  quiet?: boolean;
  style?: React.CSSProperties;
}

/** Small count/status pill — chapter counts, "viewed" progress, variant tags. */
export function Badge(props: BadgeProps): JSX.Element;
