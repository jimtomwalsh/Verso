import React from "react";

export interface CardGridProps {
  children: React.ReactNode;
  /** Minimum card width before the column count drops (auto-fill). Default "180px". */
  min?: string;
  style?: React.CSSProperties;
}

export interface BrowserEmptyStateProps {
  title?: string;
  hint?: string;
  /** Optional primary action node (e.g. a "New course" Button). */
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Responsive auto-fill grid of CourseCards (the library wall). */
export function CardGrid(props: CardGridProps): JSX.Element;
/** Empty-library placeholder shown in place of the grid. */
export function BrowserEmptyState(props: BrowserEmptyStateProps): JSX.Element;
