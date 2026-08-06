import React from "react";

export interface CommandResult {
  /** What the entry is: a document, a setting, an action, a guide section, a page, a block. */
  kind: "document" | "setting" | "action" | "guide" | "page" | "block";
  /** The result's own name, as the author would say it. */
  label: string;
  /** The category it lives in ("Project settings", "View", "User guide", "Page"). Always shown. */
  sub: string;
  /** Extra words this result can be found by — intent words, not synonyms of the label. */
  keywords?: string[];
  /**
   * The trailing column: what choosing this result DOES. A document names the destination it
   * lands ("→ Source", "→ Edit"); everything else names its kind ("Command", "Setting"). One
   * list holds both, with no separator, so the column is what tells them apart at a glance.
   */
  dest?: string;
  /** A type glyph, for results that have one. Documents do; verbs do not. */
  icon?: string;
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
  /** Placeholder naming what is indexed. Defaults to the kinds above. */
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
 *
 * DOCUMENTS LIVE IN THIS INDEX TOO. It is the only quick-switch: choosing a document opens it and
 * lands the destination that hosts its type, in one step and with no intermediate screen. Files is
 * the only place you BROWSE documents; this is the only place you jump to one. There is no third
 * finder, and adding one is the specific thing this contract exists to prevent.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element;
