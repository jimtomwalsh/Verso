import React from "react";

export interface TimelineEntry {
  /** Short date/eyebrow text, e.g. "27 Jul 2026". */
  date?: string;
  /** One-line summary of the event, e.g. "Imported manual.md v1.4". */
  label?: string;
  /** Optional secondary detail, e.g. "2 new sections". */
  detail?: string;
}

export interface TimelineProps {
  /** Caller orders entries -- newest-first is the established convention. */
  entries: TimelineEntry[];
  style?: React.CSSProperties;
}

/** Vertical node-based activity/history trail — a dot + connecting line per entry,
 * content to the right. Used for a topic's import/edit history in the info panel;
 * reach for it wherever a record of "what happened, in order" needs a home. */
export function Timeline(props: TimelineProps): JSX.Element;
