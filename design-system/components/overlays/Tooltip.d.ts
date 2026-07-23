import React from "react";

export interface TooltipProps {
  /** Tooltip text. */
  label: React.ReactNode;
  /** The trigger element. */
  children: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  style?: React.CSSProperties;
}

/** Hover label for icon buttons and truncated text. */
export function Tooltip(props: TooltipProps): JSX.Element;
