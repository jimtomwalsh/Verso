import React from "react";

export type MenuEntry =
  | "-"
  | {
      label: string;
      value?: string;
      icon?: string;
      /** Keyboard shortcut hint (e.g. "⌘D"). */
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      divider?: boolean;
      onClick?: () => void;
    };

export interface ContextMenuProps {
  /** Menu entries; use "-" for a divider. */
  items: MenuEntry[];
  onSelect?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Floating menu for right-click (canvas/outliner) and ⋯ overflow. */
export function ContextMenu(props: ContextMenuProps): JSX.Element;
