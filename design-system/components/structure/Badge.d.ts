import React from "react";

export interface BadgeProps {
  children: React.ReactNode;
  /** neutral (default) · accent · success · danger · component. */
  tone?: "neutral" | "accent" | "success" | "danger" | "component";
  size?: "sm" | "md";
  style?: React.CSSProperties;
}

/** Small count/status pill — chapter counts, "viewed" progress, variant tags. */
export function Badge(props: BadgeProps): JSX.Element;
