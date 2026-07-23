import React from "react";

export interface IconFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "prefix"> {
  /** Leading Lucide glyph (e.g. axis / dimension icon). */
  icon?: string;
  /** Short leading text label instead of/with an icon (e.g. "W", "X", "R"). */
  prefix?: string;
  /** Current value. */
  value?: string | number;
  /** Trailing unit (e.g. "px", "%", "°"). */
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Fires with the raw string value. */
  onChange?: (value: string) => void;
}

/**
 * @startingPoint section="Controls" subtitle="The 24px value input — X/Y/W/H, padding, opacity" viewport="240x40"
 * Compact labelled value field. The most-used control in the inspector.
 */
export function IconField(props: IconFieldProps): JSX.Element;
