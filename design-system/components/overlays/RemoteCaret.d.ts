import React from "react";

export interface RemoteCaretProps {
  /** Peer display name — shown on the caret flag. */
  name: string;
  /** The peer's author colour (colourForName / COMMENT_COLOURS) — caret, flag, and selection wash. */
  colour: string;
  /** Caret position within the canvas layer, in canvas coordinates (pre-pan/zoom transform). */
  x: number;
  y: number;
  /** Caret height in px (matches the line it sits on). Default 20. */
  height?: number;
  /**
   * Optional selection rectangle(s) in the same canvas coordinates — drawn as a thin outline +
   * a faint author-colour wash. Omit for a bare caret (no selection).
   */
  selection?: Array<{ x: number; y: number; w: number; h: number }>;
  style?: React.CSSProperties;
}

/**
 * A remote collaborator's live cursor + selection, projected onto the canvas. SERVER-MODE ONLY
 * and EPHEMERAL: not seq-stamped, not persisted, `pointer-events: none` — it must never intercept
 * a click or block the local author. Rendered on the EXISTING comment pin layer (`.comment-pin-layer`)
 * so it inherits the same pan/zoom reprojection as comment pins — do NOT add a second overlay layer.
 *
 * A 2px caret in the peer's author colour with a small name flag above-left (`--text-2xs`, the
 * author colour, a notched corner like a comment pin). A selection draws a 1.5px author-colour
 * outline + a ~12% wash. Position eases (150–200ms) when the peer moves, so cursors glide rather
 * than teleport. Colour is the SAME `colourForName` colour the peer uses in presence + comments.
 */
export function RemoteCaret(props: RemoteCaretProps): JSX.Element;
