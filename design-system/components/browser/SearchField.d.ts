import React from "react";

export interface SearchFieldProps {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  style?: React.CSSProperties;
}

/** The browser's filter box — the IconField control form tuned for search (leading glyph + clearable). */
export function SearchField(props: SearchFieldProps): JSX.Element;
