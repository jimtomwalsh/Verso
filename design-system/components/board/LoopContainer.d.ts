import React from "react";

export interface LoopContainerProps {
  /** Board coords (pixels) of the container's top-left. Persisted so the layout
   *  round-trips; render() ignores them (stays a pure function of the doc). */
  x: number;
  y: number;
  /** Auto-fit size (pixels): the box grows to hold its members' in-box grid + header.
   *  Persisted for round-trip; render() ignores it too. */
  w: number;
  h: number;
  /** Inline-editable loop title (screen-set name; blank shows the positional default). */
  title?: string;
  onTitleChange?: (title: string) => void;
  /** Member count badge text (e.g. "5 states"). */
  count?: number;
  /** The member `ScreenNode`s, absolutely positioned inside the box's in-box grid.
   *  Membership is by screen id (loop.screens[]); a member is a normal screen node
   *  (keeps its own markers) that has been corralled into the frame. */
  children?: React.ReactNode;
  /** A navigate marker targets this loop -> the box grows an inbound anchor + accent. */
  isTarget?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** Fires on drag; the board persists the new board coords. */
  onMove?: (x: number, y: number) => void;
  /** A screen node was dropped inside -> add it to membership (order = drop slot). */
  onAddMember?: (screenId: string, slot: number) => void;
  /** A member node was dragged out of the frame -> remove it from membership. */
  onRemoveMember?: (screenId: string) => void;
  style?: React.CSSProperties;
}

/**
 * A **loop** on the `GraphBoard`: a titled, auto-fitting rounded-rectangle frame that
 * holds an *ordered collection of screens* the learner cycles forward/back as one
 * carousel — showcasing one piece of UI across its many states (OFF / warning / error
 * / disrupting) behind a single navigate hotspot, instead of wiring a separate
 * hotspot + screen per state.
 *
 * It is a GROUP FRAME, not a node: drawn BENEATH the `ScreenNode`s (like the `Edge`
 * layer) with `--surface-sunken` fill + a dashed `--border-strong` outline and a
 * header strip (title + count `Badge`). Membership is direct-manipulation first
 *: drag a `ScreenNode` so its centre drops inside the frame to add
 * it (the node snaps into the in-box grid and the frame auto-grows to fit); drag a
 * member out to remove it; grid order = collection order (reorder by dropping in a
 * new slot). The inspector's "Add screens" picker is the fallback, not the default.
 *
 * A `navigate` marker can point at the loop exactly like it points at a screen —
 * reuse the SAME `marker.target` plumbing, `ConnectionPort` drag-to-connect, and
 * `Edge` renderer (target anchor = the frame's inbound edge); no second link model.
 *
 * Data model stays render-pure: the loop persists on `block.loops[] =
 * { id, name?, screens:[screenId], bx, by, bw, bh, wrap? }`; `render()` ignores the
 * board coords (bx/by/bw/bh) and reads only membership + order, so it remains a pure
 * function of the doc and `mount()` round-trips the layout. Verso UI (editor chrome)
 * only — the FRAME renders and exports nothing. (The learner-facing forward/back
 * carousel the loop drives is course output, governed by the pure-render invariant +
 * course.css, NOT by this editor-chrome contract.)
 *
 * REUSE, do not invent: `ScreenNode` (members), `Badge` (count), the `data-goto`
 * connector renderer (inbound edge), the shipped hotspot inspector (properties).
 */
export function LoopContainer(props: LoopContainerProps): JSX.Element;
