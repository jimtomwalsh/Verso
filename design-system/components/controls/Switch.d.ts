import React from "react";

export interface SwitchProps {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  style?: React.CSSProperties;
}

export interface SwitchRowProps {
  /** Row label. */
  label: React.ReactNode;
  /** Optional secondary line under the label. */
  description?: React.ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  style?: React.CSSProperties;
}

/** Bare on/off toggle. */
export function Switch(props: SwitchProps): JSX.Element;
/** Labelled boolean row (`switchRow`) — the default for any setting toggle. */
export function SwitchRow(props: SwitchRowProps): JSX.Element;
