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
  /**
   * Scope roll-up — how many rows in this section carry their own value instead of an
   * inherited one. Renders as "3 overridden" beside the title, in accent ink; 0 or
   * undefined renders nothing. See readme "The UI spine" -> "Scope and inheritance".
   */
  overrideCount?: number;
  /** Top hairline divider. Default true (turn off for the first section). */
  divider?: boolean;
  style?: React.CSSProperties;
}

/** Collapsible titled group of rows — the taxonomy `sectionGroup`. */
export function PanelSection(props: PanelSectionProps): JSX.Element;
