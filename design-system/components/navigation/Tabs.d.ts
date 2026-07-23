import React from "react";

export type Tab = string | { value: string; label: string };

export interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Underline tab strip — inspector Design/Interact, settings System/Project. */
export function Tabs(props: TabsProps): JSX.Element;
