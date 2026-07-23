import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = accent (top-bar Export); secondary = filled quiet; ghost = transparent; danger = destructive. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** md = 32px (toolbar/dialog); sm = 24px (inline). Default md. */
  size?: "sm" | "md";
  /** Leading icon name (Lucide). */
  icon?: string;
  /** Trailing icon name (e.g. "chevron-down" for split/menu buttons). */
  iconRight?: string;
  /** Stretch to container width. */
  full?: boolean;
  disabled?: boolean;
}

/** Text action button. Primary is reserved for one action per surface (Export). */
export function Button(props: ButtonProps): JSX.Element;
