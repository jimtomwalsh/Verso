import React from "react";

export type MenuEntry =
  | "-"
  | {
      label: string;
      value?: string;
      icon?: string;
      /** Keyboard shortcut hint (e.g. "⌘D"). */
      shortcut?: string;
      /**
       * Trailing state word in tertiary ink (e.g. "Soon" on a format that cannot be
       * emitted yet). Use with `disabled` to list something once, as unavailable,
       * rather than hiding it or renaming the entry.
       */
      hint?: string;
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
