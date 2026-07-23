import React from "react";

export type SelectOption = string | { value: string; label: string };

export interface SelectProps {
  options: SelectOption[];
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Dropdown for long/dynamic lists (fonts, categories). Bounded sets → SegmentedControl. */
export function Select(props: SelectProps): JSX.Element;
