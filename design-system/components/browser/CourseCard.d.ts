import React from "react";

export interface CourseCardProps {
  /** Course title (from doc.meta.title). */
  title: string;
  /** Course code (from doc.meta.code). */
  code: string;
  /** Pre-formatted last-edited copy; "—" when the course has no timestamp yet. */
  lastEdited?: string;
  /** The pre-scaled live page-1 preview node; omit to show the empty thumbnail. */
  thumbnail?: React.ReactNode;
  selected?: boolean;
  /** Open the course (click anywhere on the card). */
  onOpen?: () => void;
  /** Open the per-course overflow ContextMenu (the "…" button). */
  onMenu?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/** One course in the file browser: live thumbnail + title + code + last-edited + a "…" actions menu. */
export function CourseCard(props: CourseCardProps): JSX.Element;
