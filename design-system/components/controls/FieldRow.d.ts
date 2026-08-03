import React from "react";

export interface FieldRowProps {
  /** Left-column label text. Omit for a label-less full-width control row. */
  label?: React.ReactNode;
  /** Control(s) for the right column. */
  children: React.ReactNode;
  /** Vertical alignment of label vs control. Default "center". */
  align?: "center" | "top";
  /**
   * Label column width in px. Default 76 (the adopted editor value; the shared row
   * keeps one fixed width so values align in a clean column across every surface).
   */
  labelWidth?: number;
  /**
   * Inheritance tail — the right-aligned slot that shows where an inherited value
   * comes from (tertiary ink + named source) or that it is overridden (a 4px accent
   * dot + inline Reset). The SLOT is part of the shared row; the resolve/reset logic
   * is the scope-and-inheritance model's job. Omit when the value is a plain local one.
   */
  inheritanceTail?: React.ReactNode;
  /**
   * Hover-only overflow — the `…` affordance for a row's rare extra actions. Reveals
   * on row hover only and must not reflow the row. Routes into a ContextMenu.
   */
  overflow?: React.ReactNode;
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
