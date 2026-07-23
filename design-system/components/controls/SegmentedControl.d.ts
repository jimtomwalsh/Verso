import React from "react";

export type SegmentOption =
  | string
  | { value: string; label?: string; icon?: string; title?: string };

export interface SegmentedControlProps {
  /** Segments — plain strings, or objects with icon/label/title. */
  options: SegmentOption[];
  /** Currently selected value. */
  value: string;
  /** md 24px (default) · sm 20px. */
  size?: "sm" | "md";
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Controls" subtitle="Single-select segment track (align, fit, variant)" viewport="240x40"
 * Single-select segmented control (`segmentedLive`). Icon-only, text, or both.
 */
export function SegmentedControl(props: SegmentedControlProps): JSX.Element;
