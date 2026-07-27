import React from "react";

export interface ToggleChipProps {
  label: string;
  /** Currently toggled on. */
  active?: boolean;
  /** Always-on, non-interactive (e.g. a baseline that can't be turned off). */
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Controls" subtitle="Multi-select toggle pill — independent on/off, unlike SegmentedControl's one-of-N" viewport="240x32"
 * A single pill in a row of independently-toggleable pills (variant filters, tag/
 * technology filters). Each ToggleChip's state is its own — several can be active at
 * once. For a single-select "pick exactly one" row, use SegmentedControl instead.
 */
export function ToggleChip(props: ToggleChipProps): JSX.Element;
