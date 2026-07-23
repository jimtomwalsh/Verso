import React from "react";

export interface FieldRowProps {
  /** Left-column label text. */
  label: React.ReactNode;
  /** Control(s) for the right column. */
  children: React.ReactNode;
  /** Vertical alignment of label vs control. Default "center". */
  align?: "center" | "top";
  /** Label column width in px. Default 64. */
  labelWidth?: number;
  style?: React.CSSProperties;
}

export interface TwoUpProps {
  children: React.ReactNode;
  /** Gap between the two controls in px. Default 6. */
  gap?: number;
  style?: React.CSSProperties;
}

/** Labelled inspector row (label | control). */
export function FieldRow(props: FieldRowProps): JSX.Element;
/** Two equal controls side-by-side within a row. */
export function TwoUp(props: TwoUpProps): JSX.Element;
