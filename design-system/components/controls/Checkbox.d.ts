import React from "react";

export interface CheckboxProps {
  checked?: boolean;
  /** Indeterminate ("mixed") state — renders a dash. */
  mixed?: boolean;
  disabled?: boolean;
  /** Optional trailing label. */
  label?: React.ReactNode;
  onChange?: (next: boolean) => void;
  style?: React.CSSProperties;
}

/** Small square checkbox — quiz keys, acknowledge gates, multi-select. */
export function Checkbox(props: CheckboxProps): JSX.Element;
