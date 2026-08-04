import React from "react";

export interface CourseCardProps {
  /** Document title (from doc.meta.title). */
  title: string;
  /** Document code (from doc.meta.code) -- the name it is filed under. */
  code: string;
  /** Pre-formatted last-edited copy, LONG form ("11 months ago"); "—" when there is no timestamp. */
  lastEdited?: string;
  /** The pre-scaled live page-1 preview node; omit to show the empty thumbnail. */
  thumbnail?: React.ReactNode;
  selected?: boolean;
  /** Open the document (click anywhere on the card). */
  onOpen?: () => void;
  /** Open the per-document overflow ContextMenu (the "…" button). */
  onMenu?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/** One document in the file browser, as a CARD. The list form is DocumentRow; a card has room for
 *  the long timestamp, a row does not. Live thumbnail + title + code + last-edited + a "…" menu. */
export function CourseCard(props: CourseCardProps): JSX.Element;
