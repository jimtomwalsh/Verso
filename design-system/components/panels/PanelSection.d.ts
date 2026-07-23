import React from "react";

export interface PanelSectionProps {
  /** Section header title (a taxonomy type: Content, Type, Appearance, Layout, …). */
  title?: React.ReactNode;
  children: React.ReactNode;
  /** Allow collapse via the header chevron. Default true. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Right-aligned header controls (e.g. an IconButton "+"). */
  actions?: React.ReactNode;
  /** Top hairline divider. Default true (turn off for the first section). */
  divider?: boolean;
  style?: React.CSSProperties;
}

/** Collapsible titled group of rows — the taxonomy `sectionGroup`. */
export function PanelSection(props: PanelSectionProps): JSX.Element;
