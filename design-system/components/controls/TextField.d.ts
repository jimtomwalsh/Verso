import React from "react";

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value?: string;
  placeholder?: string;
  /** Render a growing textarea instead of a single-line input. */
  multiline?: boolean;
  /** Textarea row count when multiline. Default 3. */
  rows?: number;
  /** Optional leading Lucide glyph (e.g. "link" for a URL field). */
  leadingIcon?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

/**
 * @startingPoint section="Controls" subtitle="Free text entry — captions, alt text, URLs, disclaimers" viewport="240x40"
 * Full-width free-text input; the prose counterpart to IconField. `multiline`
 * gives a textarea.
 */
export function TextField(props: TextFieldProps): JSX.Element;
