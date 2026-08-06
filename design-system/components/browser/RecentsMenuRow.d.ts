import React from "react";

export interface RecentsMenuRowProps {
  title: string;
  code: string;
  /** Pre-formatted last-edited copy; "—" when absent. */
  lastEdited?: string;
  /** The pre-scaled mini page-1 preview node; omit to show the empty thumbnail. */
  thumbnail?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** One recent document inside the top-bar save/recents dropdown (mini snapshot + title/code + last-edited).
 *  For a document list proper, use DocumentRow -- this is the condensed dropdown form. */
export function RecentsMenuRow(props: RecentsMenuRowProps): JSX.Element;
