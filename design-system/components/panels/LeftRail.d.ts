import React from "react";

export interface LeftRailTab {
  /** Stable id; the app maps this to the panel view it swaps in. */
  id: string;
  /** Lucide icon name. */
  icon: string;
  /** Accessible label + tooltip text. */
  label: string;
}

export interface LeftRailAction {
  /** Stable id; the app maps this to the action it fires. */
  id: string;
  /** Lucide icon name. */
  icon: string;
  /** Accessible label + tooltip text. */
  label: string;
  /** Optional overflow menu (e.g. Export's import/export items) via ContextMenu. */
  menu?: React.ReactNode;
}

export interface LeftRailProps {
  /** Nav-tab glyphs (top). Each swaps the sibling Panel's content. */
  tabs: LeftRailTab[];
  /** Active tab id. */
  activeTab: string;
  onSelectTab: (id: string) => void;
  /** Pinned global-action glyphs (bottom). */
  actions?: LeftRailAction[];
  onAction?: (id: string) => void;
  /** Override the default rail width (token --rail-width, ~44px). */
  width?: string;
  style?: React.CSSProperties;
}

/**
 * Far-left icon rail. A single Verso-UI column whose top nav-tab glyphs SWAP the
 * content of the sibling `Panel side="left"` (never a second always-on column,
 * never a duplicate of the panel), and whose bottom pinned glyphs fire global
 * actions (Export / Help / Settings / recents). Built from `IconButton` + `Tooltip`;
 * the active tab uses IconButton's `active` state. Sits immediately left of the panel:
 * `[LeftRail][Panel side="left"][canvas][Panel side="right"]`.
 */
export function LeftRail(props: LeftRailProps): JSX.Element;
