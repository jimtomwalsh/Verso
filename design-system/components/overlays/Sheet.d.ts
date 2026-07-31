import React from "react";

export interface SheetProps {
  /** Sheet title, shown in the pinned header. */
  title: React.ReactNode;
  /** Optional one-line description under the title. */
  description?: React.ReactNode;
  /** Optional header strip below the title (canonical Tabs, a filter). */
  header?: React.ReactNode;
  /** The sheet body: one scroll of PanelSection children. Never an internal nav rail. */
  children?: React.ReactNode;
  /**
   * Pinned footer. States the save contract and offers Close.
   * NEVER a Save / Apply / Cancel / Done control — settings apply live.
   */
  footer?: React.ReactNode;
  /** Dock edge. Default "right". The sheet shares the dock with the inspector. */
  side?: "left" | "right";
  /** Dock width. Defaults to the --panel-sheet-width token. */
  width?: string;
  /** Dismiss. Wired to Close and to Esc via the layer stack (topmost only, LIFO). */
  onClose?: () => void;
  style?: React.CSSProperties;
}

/**
 * Canonical right-docked, NON-MODAL settings surface — the spine's "sheet" presentation.
 *
 * No scrim, and no click-out dismissal: the canvas stays live and interactive while the
 * sheet is open (the canvas is SQUEEZED, never covered). The sheet is `Panel` at sheet
 * geometry — it does not introduce a second dock shell.
 */
export function Sheet(props: SheetProps): JSX.Element;
