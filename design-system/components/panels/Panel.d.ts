import React from "react";

export interface PanelProps {
  children: React.ReactNode;
  /** Which dock edge the border sits on. Default "right". */
  side?: "left" | "right";
  /** Override the default dock width. */
  width?: string;
  /** Pinned header region (tabs, breadcrumb). */
  header?: React.ReactNode;
  /** Pinned footer region (Actions row). */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Left/right dock shell — holds PanelSection children with pinned header/footer. */
export function Panel(props: PanelProps): JSX.Element;
