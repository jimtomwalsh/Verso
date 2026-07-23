import React from "react";

export interface ScreenNodePin {
  id: string;
  /** Percent position over the thumbnail (0-100), matching the marker's x/y. */
  x: number;
  y: number;
  /** "card" opens a popover; "navigate" links to another screen (grows a port). */
  action: "card" | "navigate";
}

export interface ScreenNodeProps {
  /** Board coords (pixels). Persisted so the layout round-trips; drag updates them. */
  x: number;
  y: number;
  /** Live scaled-DOM preview of the screen visual — wraps `ThumbnailFrame`. */
  children?: React.ReactNode;
  /** Inline-editable node title (screen name; blank shows the positional default). */
  title?: string;
  onTitleChange?: (title: string) => void;
  /** The screen's markers, drawn as pins over the thumbnail. */
  pins?: ScreenNodePin[];
  /** Entry screen badge ("Home"). */
  isEntry?: boolean;
  /** Completion-screen badge (flag). */
  isCompletion?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** Fires on drag; the board persists the new board coords. */
  onMove?: (x: number, y: number) => void;
  /** Cards-face-up: render the card pins' popovers open on the node for bulk edit. */
  cardsFaceUp?: boolean;
  style?: React.CSSProperties;
}

/**
 * A screen as a node card on the `GraphBoard`. A raised card wrapping a
 * `ThumbnailFrame` (live scaled-DOM preview of the screen visual — image/gif/video
 * poster), an inline-editable title, Entry/Completion `Badge`s, and the screen's
 * markers as pins overlaid at their percent coords. A `navigate` pin grows a
 * `ConnectionPort` (drag-to-link). Selected state uses `--shadow-selected` +
 * `--border-focus`; the card is draggable to reposition (persisted board coords).
 * The panel mirrors selection — selecting a node shows that screen's existing
 * inspector sections; the node never reinvents property editing. Editor chrome only.
 */
export function ScreenNode(props: ScreenNodeProps): JSX.Element;
