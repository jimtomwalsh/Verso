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
  /**
   * Optional on/off switch in the header. It governs whether the section's setting APPLIES.
   * It must never move the disclosure: the chevron owns open/closed, the switch owns on/off,
   * and turning a section on does not open it. See readme "The UI spine" -> "The shared row".
   */
  enabled?: boolean;
  onEnabledChange?: (next: boolean) => void;
  /**
   * One-line value summary, shown only while COLLAPSED — "centred, top rule". With a switch it
   * is prefixed On/Off, so a folded section never reads as "unknown". A section with nothing
   * to say renders no summary rather than padding the header with "Default".
   */
  summary?: React.ReactNode;
  /** Top hairline divider. Default true (turn off for the first section). */
  divider?: boolean;
  /**
   * Nesting depth. 1 = a section in a panel body; 2 = a section inside another section's body,
   * drawn quieter and indented. There is no level 3: a group that would nest a third time is
   * promoted to a section of its own. See readme "The UI spine" -> "The shared row".
   */
  level?: 1 | 2;
  style?: React.CSSProperties;
}

/** Collapsible titled group of rows — the taxonomy `sectionGroup`. */
export function PanelSection(props: PanelSectionProps): JSX.Element;
