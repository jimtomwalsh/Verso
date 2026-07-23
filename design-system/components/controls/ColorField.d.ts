import React from "react";

export interface ColorFieldProps {
  /** Current colour as hex (e.g. "#0D99FF"). */
  value?: string;
  /** Alpha as a 0–100 percentage. */
  opacity?: number;
  /** When the colour is bound to a theme token, its display name (shown in place of the hex). */
  tokenName?: string;
  disabled?: boolean;
  onChange?: (hex: string) => void;
  onOpacityChange?: (pct: number) => void;
  /** Invoked when the eyedropper is clicked. */
  onEyedrop?: () => void;
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Controls" subtitle="Unified colour: swatch · hex · opacity · eyedropper" viewport="240x40"
 * The single canonical colour control (`colorField`). Handles custom hex,
 * token-bound colours, and (via two instances) per-mode light/dark fills.
 */
export function ColorField(props: ColorFieldProps): JSX.Element;
