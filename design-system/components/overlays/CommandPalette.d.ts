import React from "react";

export interface CommandResult {
  /** What the entry is: a setting, an action, a guide section, a page, a block. */
  kind: "setting" | "action" | "guide" | "page" | "block";
  /** The result's own name, as the author would say it. */
  label: string;
  /** The category it lives in ("Project settings", "View", "User guide", "Page"). Always shown. */
  sub: string;
  /** Extra words this result can be found by — intent words, not synonyms of the label. */
  keywords?: string[];
}

export interface CommandPaletteProps {
  /** Everything findable right now, already flattened into one list. */
  results: CommandResult[];
  /** The live query. */
  value: string;
  onChange: (next: string) => void;
  /** Run the highlighted result. The palette closes first, then the result routes. */
  onRun: (result: CommandResult) => void;
  /** Dismiss. Wired to Esc via the layer stack (topmost only, LIFO) and to a click outside. */
  onClose: () => void;
  /** Placeholder naming what is indexed. Defaults to the four kinds. */
  placeholder?: string;
  /** Shortlist length. Defaults to 40 — a palette you scroll is a list. */
  limit?: number;
}

/**
 * The ONE find-anything index, opened with ⌘K.
 *
 * It is NOT a seventh presentation. The palette holds no settings rows, sets no values and
 * saves nothing — it is navigation, and every result routes into one of the six surfaces. That
 * is why it may take a scrim while the six settings surfaces (bar the Modal) may not: it
 * captures typing for the moment it is open, then hands the author to the real surface.
 *
 * It is also the reason no other surface owns a search box. A second search field over a second
 * index is the divergence this component exists to remove.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element;
