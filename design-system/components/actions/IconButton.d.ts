import React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide icon name. */
  icon: string;
  /** sm 20 · md 24 (default) · lg 32. */
  size?: "sm" | "md" | "lg";
  /** Toggled-on state (e.g. active tool / mode). */
  active?: boolean;
  /** Tint the glyph with --danger (delete). */
  danger?: boolean;
  /** Accessible label + tooltip text. */
  label?: string;
  disabled?: boolean;
}

/** Icon-only square action. Toolbar buttons and the block Actions row. */
export function IconButton(props: IconButtonProps): JSX.Element;
