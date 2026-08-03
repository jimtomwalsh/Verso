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
      /**
       * Nested entries, opened to the side on hover with a trailing chevron. Use it to collapse
       * a group that would otherwise spend a third of the menu on rows most authors do not want
       * (variants, software versions). Display-only nesting: a submenu never introduces its own
       * dismissal or a second Escape owner — the whole tree closes with its root.
       */
      submenu?: MenuEntry[];
      onClick?: () => void;
    };

export interface ContextMenuProps {
  /**
   * Menu entries; use "-" for a divider.
   *
   * A menu NEVER renders an empty section. A heading whose group holds no actionable entry is
   * dropped, along with the separators that framed it, so a caller may offer a section
   * unconditionally rather than writing "(none yet)" into the heading. When a whole family has
   * nothing to show, offer its create verb as one ordinary row instead ("Add variant…").
   *
   * Menu entries are plain imperative verbs. No "+" prefix — that is a fourth style for
   * "create" in a product that already has filled buttons and ghost add-rows.
   */
  items: MenuEntry[];
  onSelect?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Floating menu for right-click (canvas/outliner) and ⋯ overflow. */
export function ContextMenu(props: ContextMenuProps): JSX.Element;
